const { createPool, transaction } = require('../server/db');
const terms = require('./terms.json');

async function applyFirstPlay(client) {
  await client.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS awaiting_advance boolean NOT NULL DEFAULT false');
  await client.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS advanced_from uuid');
  await client.query('ALTER TABLE battles ADD COLUMN IF NOT EXISTS last_feedback jsonb');
  await client.query('ALTER TABLE terms ADD COLUMN IF NOT EXISTS explanation text');
  for (const term of terms.filter(item => item.section === 0)) {
    await client.query('UPDATE terms SET explanation = $2 WHERE id = $1 AND explanation IS NULL ' +
      'AND section = $3 AND term = $4 AND definition = $5 AND aliases = $6 AND scenario IS NOT DISTINCT FROM $7',
      [term.id, term.explanation, term.section, term.term, term.definition, term.aliases, term.scenario ?? null]);
  }
}

async function migrateFirstPlay(pool) {
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [1846245521]);
    await applyFirstPlay(client);
  });
}

if (require.main === module) {
  const pool = createPool();
  migrateFirstPlay(pool).then(() => console.log('First-play migration complete'))
    .catch(() => { console.error('First-play migration failed'); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { applyFirstPlay, migrateFirstPlay };
