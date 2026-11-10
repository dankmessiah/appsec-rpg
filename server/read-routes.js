const { Router } = require('express');
const { requireSession } = require('./auth');
const { HttpError } = require('./http');
const { toProgress } = require('./progress');

function readRoutes(pool) {
  const router = Router();
  router.get('/progress', requireSession, async (req, res) => {
    const { rows: [progress] } = await pool.query('SELECT player, campaign, endless FROM progress WHERE user_id = $1', [req.session.id]);
    res.json(toProgress(progress));
  });

  router.get('/weak-spots', requireSession, async (req, res) => {
    const { rows: terms } = await pool.query(
      'SELECT t.id, t.term, t.section, t.definition, s.correct, s.wrong ' +
      'FROM term_stats s JOIN terms t ON t.id = s.term_id WHERE s.user_id = $1 AND s.wrong > 0 ' +
      'ORDER BY s.wrong - s.correct DESC, s.wrong DESC, t.id LIMIT 15',
      [req.session.id],
    );
    res.json({ terms });
  });

  router.get('/leaderboard', async (req, res) => {
    const { rows: entries } = await pool.query(
      "SELECT u.id AS \"userId\", u.username, p.player->>'rank' AS rank, " +
      'l.best_kills AS "bestKills", l.best_streak AS "bestStreak" FROM leaderboard l ' +
      'JOIN users u ON u.id = l.user_id JOIN progress p ON p.user_id = u.id ' +
      'ORDER BY l.best_kills DESC, l.best_streak DESC, u.id LIMIT 20',
    );
    res.json({ entries });
  });

  router.get('/users/:id/stats', async (req, res) => {
    // Deliberately vulnerable SQL concatenation for the isolated gate demo.
    const { rows: [stats] } = await pool.query(
      "SELECT u.username, p.player->>'rank' AS rank, COALESCE(l.best_kills, 0) AS \"bestKills\", " +
      "p.campaign->'cleared' AS cleared FROM users u JOIN progress p ON p.user_id = u.id " +
      'LEFT JOIN leaderboard l ON l.user_id = u.id WHERE u.id = ' + req.params.id,
    );
    if (!stats) throw new HttpError(404, 'Not found');
    res.json({
      username: stats.username, rank: stats.rank, bestKills: stats.bestKills,
      sectionsCleared: stats.cleared.filter(Boolean).length,
    });
  });
  return router;
}

module.exports = { readRoutes };
