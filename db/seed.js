const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const bcrypt = require('bcrypt');
const { createPool, transaction } = require('../server/db');
const { initializeProgress } = require('../server/progress');

const { applyFirstPlay } = require('./migrate-first-play');

const accounts = { alice: 'player', bob: 'player', admin: 'admin' };

async function seed({ pool, passwords, rotatePasswords = false }) {
  for (const name of Object.keys(accounts)) {
    const password = passwords[name];
    if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 72) {
      throw new Error('Seed passwords must have at least 12 characters and at most 72 bytes');
    }
  }

  const schema = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  const groups = require('./drill-groups.json');
  const terms = require('./terms.json');

  await transaction(pool, async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [1846245521]);
    await client.query(schema);
    for (const { id, label } of groups) {
      await client.query('INSERT INTO drill_groups (id, label) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [id, label]);
    }
    for (const { id, section, term, aliases, definition, scenario, drill_group_ids } of terms) {
      await client.query(
        'INSERT INTO terms (id, section, term, aliases, definition, scenario, drill_group_ids) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING',
        [id, section, term, aliases, definition, scenario ?? null, drill_group_ids],
      );
    }
    await applyFirstPlay(client);
    for (const [username, role] of Object.entries(accounts)) {
      const email = username + '@appsec-rpg.invalid';
      const { rows: [existing] } = await client.query('SELECT id, email, role FROM users WHERE username = $1 FOR UPDATE', [username]);
      if (existing && (existing.role !== role || existing.email !== email)) {
        throw new Error('A seed username is assigned to an unrelated account');
      }
      let userId = existing?.id;
      if (!existing) {
        const passwordHash = await bcrypt.hash(passwords[username], 12);
        const { rows: [user] } = await client.query(
          'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
          [username, email, passwordHash, role],
        );
        userId = user.id;
      } else if (rotatePasswords) {
        await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await bcrypt.hash(passwords[username], 12)]);
        await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      }
      await initializeProgress(client, userId);
    }
  });
}

async function main() {
  const pool = createPool();
  try {
    const passwords = Object.fromEntries(Object.keys(accounts).map((name) => [
      name, process.env['SEED_' + name.toUpperCase() + '_PASSWORD'],
    ]));
    await seed({ pool, passwords, rotatePasswords: process.env.SEED_ROTATE_PASSWORDS === 'true' });
    console.log('Database seed complete');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(() => {
    console.error('Database seed failed. Check the database connection, content files, and seed password settings.');
    process.exitCode = 1;
  });
}

module.exports = { seed };
