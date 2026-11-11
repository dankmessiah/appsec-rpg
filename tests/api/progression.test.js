const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const request = require('supertest');
const { createApp } = require('../../server/app');
const { seed } = require('../../db/seed');

const schema = 'rpg_progression_' + randomUUID().replaceAll('-', '');
const fights = [
  ['grunt', 15], ['grunt', 15], ['grunt', 15], ['grunt', 15],
  ['elite', 30], ['elite', 30], ['boss', 65],
];
let pool;
let control;
let api;
let now;

beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !databaseUrl || !/^\/[a-z0-9_]+_test$/i.test(new URL(databaseUrl).pathname)) {
    throw new Error('API tests require NODE_ENV=test and DATABASE_URL naming a database ending in _test');
  }
  control = new Pool({ connectionString: databaseUrl });
  await control.query('CREATE SCHEMA ' + schema);
  pool = new Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  await pool.query(readFileSync(join(__dirname, '../../db/schema.sql'), 'utf8'));
  await seed({ pool, passwords: {
    alice: 'alice-password-for-tests',
    bob: 'bob-password-for-tests',
    admin: 'admin-password-for-tests',
  } });
  now = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  api = request(createApp({ pool, now: () => now, authRateLimit: 100 }));
}, 30000);

afterAll(async () => {
  jest.restoreAllMocks();
  if (pool) await pool.end();
  if (control) {
    try {
      await control.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    } finally {
      await control.end();
    }
  }
});

async function register(username) {
  const reply = await api.post('/api/v1/auth/register').send({
    username, email: username + '@example.test', password: 'progression-password-for-tests',
  }).expect(201);
  const cookie = reply.headers['set-cookie'][0].split(';')[0];
  return (method, path) => api[method]('/api/v1' + path)
    .set('Cookie', cookie).set('X-CSRF-Token', reply.body.csrfToken);
}

async function startFight(player, section, fight) {
  // Pace the campaign against the real request limiter without waiting in real time.
  now += 60_000;
  const { body } = await player('post', '/battles').send({ mode: 'campaign' }).expect(201);
  expect(body.progress.campaign).toMatchObject({ section, fight });
  expect(body.enemy).toMatchObject({ section, type: fights[fight][0] });
  return body;
}

async function answer(player, battleId, question, timeout = false) {
  const { rows: [saved] } = await pool.query('SELECT question FROM battles WHERE id = $1', [battleId]);
  expect(saved.question.id).toBe(question.id);
  const correct = saved.question.answer;
  const submission = typeof correct === 'number' ? { choice: correct } : { text: correct };
  now = question.startedAt + (timeout ? (question.timeLimitSeconds + 3) * 1000 : 1000);
  const { body } = await player('post', '/battles/' + battleId + '/answer')
    .send({ questionId: question.id, ...submission }).expect(200);
  expect(body.correct).toBe(!timeout);
  expect(body.timedOut).toBe(timeout);
  if (body.status === 'active') {
    const advanced = await player('post', '/battles/' + battleId + '/advance')
      .send({ questionId: question.id }).expect(200);
    body.question = advanced.body.question;
  }
  return body;
}

async function winFight(player, section, fight) {
  const battle = await startFight(player, section, fight);
  let turn = battle;
  for (let attempt = 0; attempt < 8 && turn.question; attempt += 1) {
    turn = await answer(player, battle.id, turn.question);
  }
  expect(turn).toMatchObject({ status: 'won', earnedXp: fights[fight][1], question: null });
  return turn.progress;
}

test('wins all 49 campaign fights and unlocks endless only after the final boss', async () => {
  const player = await register('campaign_runner');
  await player('post', '/battles').send({ mode: 'endless' }).expect(409);
  let progress;
  for (let section = 0; section < 7; section += 1) {
    for (let fight = 0; fight < fights.length; fight += 1) {
      progress = await winFight(player, section, fight);
      const clearedCount = section + Number(fight === 6);
      expect(progress.campaign.cleared).toEqual(Array.from({ length: 7 }, (_, i) => i < clearedCount));
      expect(progress.endless.unlocked).toBe(clearedCount === 7);
    }
  }

  const stored = await player('get', '/progress').expect(200);
  expect(stored.body).toEqual(progress);
  expect(stored.body.player).toMatchObject({ xp: 1295, rank: 'Program Lead', hp: 130, maxHp: 130 });
  await player('post', '/battles').send({ mode: 'campaign' }).expect(409);
  const endless = await player('post', '/battles').send({ mode: 'endless' }).expect(201);
  expect(endless.body.progress.endless).toEqual({ kills: 0, difficulty: 0, unlocked: true });
  expect(endless.body.question.id).toBeDefined();
}, 30000);

test('defeat preserves earned XP and restarts the current section at its first fight', async () => {
  const player = await register('retry_runner');
  for (let fight = 0; fight < fights.length; fight += 1) {
    await winFight(player, 0, fight);
  }
  const previous = await winFight(player, 1, 0);
  const battle = await startFight(player, 1, 1);
  let turn = battle;
  for (let attempt = 0; attempt < 14 && turn.question; attempt += 1) {
    turn = await answer(player, battle.id, turn.question, true);
  }
  expect(turn).toMatchObject({ status: 'lost', earnedXp: 0, question: null });
  expect(turn.progress.campaign).toEqual({ ...previous.campaign, fight: 0 });
  expect(turn.progress.player).toEqual({
    ...previous.player, hp: previous.player.maxHp, combo: 0,
  });
  const stored = await player('get', '/progress').expect(200);
  expect(stored.body).toEqual(turn.progress);
  await startFight(player, 1, 0);
}, 30000);


test('five endless kills raise difficulty, concurrent forfeits record one run and retained XP', async () => {
  const player = await register('endless_runner');
  const { rows: [user] } = await pool.query("SELECT id FROM users WHERE username = 'endless_runner'");
  await pool.query('UPDATE progress SET endless = $2 WHERE user_id = $1', [user.id, { unlocked: true, kills: 0, difficulty: 0 }]);
  let outcome;
  for (let kills = 1; kills <= 5; kills += 1) {
    now += 60_000;
    const { body: battle } = await player('post', '/battles').send({ mode: 'endless', replaceActive: false }).expect(201);
    let turn = battle;
    for (let attempt = 0; attempt < 12 && turn.question; attempt += 1) {
      turn = await answer(player, battle.id, turn.question);
    }
    expect(turn.status).toBe('won');
    expect(turn.progress.endless.kills).toBe(kills);
    expect(turn.progress.endless.difficulty).toBe(Math.floor(kills / 5));
    outcome = turn;
  }
  now += 60_000;
  const { body: battle } = await player('post', '/battles').send({ mode: 'endless', replaceActive: false }).expect(201);
  expect(battle.progress.endless.difficulty).toBe(1);
  expect([18, 28]).toContain(battle.question.timeLimitSeconds);
  const replies = await Promise.all([1, 2].map(() => player('post', '/battles/' + battle.id + '/forfeit').send({})));
  expect(replies.map(reply => reply.status).sort()).toEqual([200, 409]);
  const forfeited = replies.find(reply => reply.status === 200).body;
  expect(forfeited.runSummary.kills).toBe(5);
  expect(forfeited.progress.player.xp).toBe(outcome.progress.player.xp);
  expect(forfeited.progress.endless).toEqual({ unlocked: true, kills: 0, difficulty: 0 });
  const records = await pool.query('SELECT * FROM leaderboard WHERE user_id = $1', [user.id]);
  expect(records.rowCount).toBe(1);
  expect(records.rows[0].best_kills).toBe(5);
});
