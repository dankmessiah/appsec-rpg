const { randomUUID } = require('node:crypto');
const { Router } = require('express');
const { z } = require('zod');
const { checkAnswer, generateQuestion, publicQuestion } = require('../shared/questions');
const { requireSession, requireCsrf } = require('./auth');
const { transaction } = require('./db');
const { createEnemy, forfeitProgress, resolveTurn } = require('./engine');
const { HttpError, validate } = require('./http');
const { toProgress } = require('./progress');

const startSchema = z.strictObject({
  mode: z.enum(['campaign', 'endless']),
  replaceActive: z.boolean().default(true),
});
const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
const answerSchema = z.union([
  z.strictObject({ questionId: uuidSchema, choice: z.int().min(0).max(3) }),
  z.strictObject({ questionId: uuidSchema, text: z.string().trim().max(256) }),
]);
const emptyBody = z.strictObject({}).optional();

async function lockProgress(client, userId) {
  const { rows: [row] } = await client.query(
    'SELECT player, campaign, endless, endless_best_streak FROM progress WHERE user_id = $1 FOR UPDATE',
    [userId],
  );
  return row;
}

async function saveProgress(client, userId, { player, campaign, endless }, bestStreak) {
  await client.query(
    'UPDATE progress SET player = $2, campaign = $3, endless = $4, endless_best_streak = $5, updated_at = now() WHERE user_id = $1',
    [userId, player, campaign, endless, bestStreak],
  );
}

async function lockOwnedBattle(client, id, userId) {
  const { rows: [owner] } = await client.query('SELECT user_id FROM battles WHERE id = $1', [id]);
  if (!owner) throw new HttpError(404, 'Not found');
  if (owner.user_id !== userId) throw new HttpError(403, 'Forbidden');
  const { rows: [battle] } = await client.query('SELECT * FROM battles WHERE id = $1 FOR UPDATE', [id]);
  if (battle.status !== 'active') throw new HttpError(409, 'Battle is inactive');
  return battle;
}

async function nextQuestion(client, userId, enemy, mode, difficulty, now) {
  const { rows } = await client.query(
    'SELECT t.*, COALESCE(s.correct, 0) AS correct, COALESCE(s.wrong, 0) AS wrong ' +
    'FROM terms t LEFT JOIN term_stats s ON s.term_id = t.id AND s.user_id = $1 ORDER BY t.id',
    [userId],
  );
  const stats = Object.fromEntries(rows.map(({ id, correct, wrong }) => [id, { correct, wrong }]));
  return generateQuestion({
    terms: rows, section: enemy.section, boss: enemy.type === 'boss',
    mode, stats, difficulty, now: now(),
  });
}

async function recordAnswer(client, userId, termId, correct) {
  const existing = await client.query('SELECT id FROM terms WHERE id = $1 FOR KEY SHARE', [termId]);
  if (!existing.rowCount) return;
  await client.query(
    'INSERT INTO term_stats (user_id, term_id, correct, wrong) VALUES ($1, $2, $3, $4) ' +
    'ON CONFLICT (user_id, term_id) DO UPDATE SET correct = term_stats.correct + EXCLUDED.correct, wrong = term_stats.wrong + EXCLUDED.wrong',
    [userId, termId, Number(correct), Number(!correct)],
  );
}

async function recordRun(client, userId, kills, bestStreak) {
  await client.query(
    'INSERT INTO leaderboard (user_id, best_kills, best_streak) VALUES ($1, $2, $3) ' +
    'ON CONFLICT (user_id) DO UPDATE SET best_kills = GREATEST(leaderboard.best_kills, EXCLUDED.best_kills), ' +
    'best_streak = GREATEST(leaderboard.best_streak, EXCLUDED.best_streak), updated_at = now()',
    [userId, kills, bestStreak],
  );
  return { kills, bestStreak };
}

async function abandon(client, battle, userId, progress, bestStreak) {
  await client.query("UPDATE battles SET status = 'forfeit', ended_at = now() WHERE id = $1", [battle.id]);
  const next = forfeitProgress(progress, battle.mode);
  if (battle.mode !== 'endless') return { progress: next };
  const runSummary = await recordRun(client, userId, progress.endless.kills, bestStreak);
  return { progress: next, runSummary };
}

function battleRoutes({ pool, now }) {
  const router = Router();
  router.use('/battles', requireSession, requireCsrf);

  router.post('/battles', async (req, res) => {
    const { mode, replaceActive } = validate(startSchema, req.body);
    const userId = req.session.id;
    const response = await transaction(pool, async (client) => {
      const row = await lockProgress(client, userId);
      let progress = toProgress(row);
      let bestStreak = row.endless_best_streak;
      if (mode === 'endless' && !progress.endless.unlocked) throw new HttpError(409, 'Endless mode is locked');
      if (mode === 'campaign' && progress.campaign.cleared.every(Boolean)) throw new HttpError(409, 'Campaign is complete');

      const { rows: [active] } = await client.query(
        "SELECT id, mode FROM battles WHERE user_id = $1 AND status = 'active' FOR UPDATE", [userId],
      );
      if (active) {
        if (!replaceActive) throw new HttpError(409, 'A battle is already active');
        const abandoned = await abandon(client, active, userId, progress, bestStreak);
        progress = abandoned.progress;
        if (abandoned.runSummary) bestStreak = 0;
        await saveProgress(client, userId, progress, bestStreak);
      }

      const { section, fight } = progress.campaign;
      const difficulty = mode === 'endless' ? progress.endless.difficulty : 0;
      const enemy = createEnemy({ section, fight, mode, difficulty });
      const question = await nextQuestion(client, userId, enemy, mode, difficulty, now);
      const id = randomUUID();
      await client.query(
        "INSERT INTO battles (id, user_id, mode, enemy, question, status, started_at) VALUES ($1, $2, $3, $4, $5, 'active', $6)",
        [id, userId, mode, enemy, question, new Date(question.startedAt)],
      );
      return { id, enemy, question: publicQuestion(question), progress };
    });
    res.status(201).json(response);
  });

  router.post('/battles/:id/answer', async (req, res) => {
    const receivedAt = now();
    const id = validate(uuidSchema, req.params.id);
    const submission = validate(answerSchema, req.body);
    const userId = req.session.id;
    const response = await transaction(pool, async (client) => {
      const row = await lockProgress(client, userId);
      const battle = await lockOwnedBattle(client, id, userId);
      const { question, enemy, mode } = battle;
      if (question.id !== submission.questionId) throw new HttpError(409, 'Question is stale');
      if ((typeof question.answer === 'number') !== ('choice' in submission)) throw new HttpError(400, 'Invalid request');

      const result = checkAnswer(question, submission, receivedAt);
      const turn = resolveTurn({
        progress: toProgress(row), enemy, correct: result.correct, elapsedMs: result.elapsedMs,
        timeLimitSeconds: question.timeLimitSeconds, noDamage: battle.no_damage, mode,
      });
      await recordAnswer(client, userId, question.termId, result.correct);
      let bestStreak = row.endless_best_streak;
      let runSummary;
      if (mode === 'endless') {
        bestStreak = Math.max(bestStreak, row.player.combo, turn.progress.player.combo);
        if (turn.status === 'lost') {
          runSummary = await recordRun(client, userId, row.endless.kills, bestStreak);
          bestStreak = 0;
        }
      }
      await saveProgress(client, userId, turn.progress, bestStreak);
      const next = turn.status === 'active'
        ? await nextQuestion(client, userId, turn.enemy, mode, mode === 'endless' ? turn.progress.endless.difficulty : 0, now)
        : null;
      await client.query(
        "UPDATE battles SET enemy = $2, question = $3, no_damage = $4, status = $5, ended_at = CASE WHEN $5 = 'active' THEN NULL ELSE now() END WHERE id = $1",
        [id, turn.enemy, next ?? question, turn.noDamage, turn.status],
      );
      return {
        correct: result.correct, timedOut: result.timedOut, correctAnswer: result.correctAnswer,
        explanation: result.explanation, damageDealt: turn.damageDealt, damageTaken: turn.damageTaken,
        status: turn.status, earnedXp: turn.earnedXp, rankUp: turn.rankUp,
        progress: turn.progress, enemy: turn.enemy, question: next ? publicQuestion(next) : null,
        ...(runSummary && { runSummary }),
      };
    });
    res.json(response);
  });

  router.post('/battles/:id/forfeit', async (req, res) => {
    const id = validate(uuidSchema, req.params.id);
    validate(emptyBody, req.body);
    const userId = req.session.id;
    const response = await transaction(pool, async (client) => {
      const row = await lockProgress(client, userId);
      const battle = await lockOwnedBattle(client, id, userId);
      const result = await abandon(client, battle, userId, toProgress(row), row.endless_best_streak);
      await saveProgress(client, userId, result.progress, result.runSummary ? 0 : row.endless_best_streak);
      return result;
    });
    res.json(response);
  });

  return router;
}

module.exports = { battleRoutes };
