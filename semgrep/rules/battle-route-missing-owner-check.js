const express = require('express');
const router = express.Router();
const db = require('../db');

// ruleid: battle-route-missing-owner-check
router.post('/:id/answer', requireAuth, csrf, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM battles WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(applyAnswer(rows[0], req.body));
});

// ruleid: battle-route-missing-owner-check
app.post('/api/v1/battles/:id/forfeit', async function (req, res) {
  await db.query("UPDATE battles SET status = 'forfeit' WHERE id = $1", [req.params.id]);
  res.status(204).end();
});

// ok: battle-route-missing-owner-check
router.post('/:id/answer', requireAuth, csrf, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM battles WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(applyAnswer(rows[0], req.body));
});

// ok: battle-route-missing-owner-check
router.post('/:id/forfeit', requireAuth, async (req, res) => {
  const battle = await getBattle(req.params.id);
  if (!battle || battle.user_id !== req.user.id) return res.status(404).end();
  res.status(204).end();
});

// ok: battle-route-missing-owner-check
router.post('/:id/forfeit', requireAuth, loadOwnedBattle, async (req, res) => {
  await forfeit(req.battle);
  res.status(204).end();
});

// ok: battle-route-missing-owner-check
router.put('/admin/terms/:id', requireAdmin, async (req, res) => {
  await db.query('UPDATE terms SET term = $1 WHERE id = $2', [req.body.term, req.params.id]);
  res.status(204).end();
});
