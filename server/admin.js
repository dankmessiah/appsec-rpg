const { Router } = require('express');
const { z } = require('zod');
const { requireAdmin, requireCsrf, requireSession } = require('./auth');
const { transaction } = require('./db');
const { HttpError, validate } = require('./http');

const kebabId = z.string().max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const label = z.string().trim().min(1).max(256).refine((value) => !value.includes('\0'));
const description = z.string().trim().min(1).max(4000).refine((value) => !value.includes('\0'));
const emptyBody = z.strictObject({}).optional();
const termSchema = z.strictObject({
  id: kebabId,
  section: z.int().min(0).max(6),
  term: label,
  aliases: z.array(label).max(50),
  definition: description,
  scenario: description.nullable().optional(),
  drill_group_ids: z.array(kebabId).max(25).refine((groups) => new Set(groups).size === groups.length),
});

async function writeTerm(pool, term, update) {
  return transaction(pool, async (client) => {
    const { id, section, aliases, definition, scenario, drill_group_ids } = term;
    const groups = await client.query('SELECT id FROM drill_groups WHERE id = ANY($1::text[])', [drill_group_ids]);
    if (groups.rowCount !== drill_group_ids.length) throw new HttpError(400, 'Invalid drill group');
    const values = [id, section, term.term, aliases, definition, scenario ?? null, drill_group_ids];
    const sql = update
      ? 'UPDATE terms SET section = $2, term = $3, aliases = $4, definition = $5, scenario = $6, drill_group_ids = $7 WHERE id = $1 RETURNING *'
      : 'INSERT INTO terms (id, section, term, aliases, definition, scenario, drill_group_ids) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING RETURNING *';
    const { rows: [saved] } = await client.query(sql, values);
    if (!saved) throw update ? new HttpError(404, 'Not found') : new HttpError(409, 'Term already exists');
    return saved;
  });
}

function adminRoutes(pool) {
  const router = Router();
  router.use(requireSession, requireAdmin);
  router.get('/terms', async (req, res) => {
    const { rows: terms } = await pool.query('SELECT * FROM terms ORDER BY section, id');
    res.json({ terms });
  });
  router.post('/terms', requireCsrf, async (req, res) => {
    const saved = await writeTerm(pool, validate(termSchema, req.body), false);
    res.status(201).json(saved);
  });
  router.put('/terms/:id', requireCsrf, async (req, res) => {
    const id = validate(kebabId, req.params.id);
    const term = validate(termSchema, req.body);
    if (term.id !== id) throw new HttpError(400, 'Invalid request');
    res.json(await writeTerm(pool, term, true));
  });
  router.delete('/terms/:id', requireCsrf, async (req, res) => {
    const id = validate(kebabId, req.params.id);
    validate(emptyBody, req.body);
    const result = await pool.query('DELETE FROM terms WHERE id = $1', [id]);
    if (!result.rowCount) throw new HttpError(404, 'Not found');
    res.status(204).end();
  });
  return router;
}

module.exports = { adminRoutes };
