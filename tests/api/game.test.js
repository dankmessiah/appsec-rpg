const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Pool } = require('pg');
const request = require('supertest');
const { createApp } = require('../../server/app');
const { seed } = require('../../db/seed');

const databaseUrl = process.env.DATABASE_URL;
const seedPasswords = {
  alice: 'alice-password-for-tests',
  bob: 'bob-password-for-tests',
  admin: 'admin-password-for-tests',
};
const schema = 'rpg_api_' + randomUUID().replaceAll('-', '');
let pool;
let control;
let api;
let now;
let alice;
let bob;
let admin;

async function login(username) {
  const response = await api.post('/api/v1/auth/login')
    .send({ username, password: seedPasswords[username] }).expect(200);
  return {
    cookie: response.headers['set-cookie'][0].split(';')[0],
    csrf: response.body.csrfToken,
    user: response.body.user,
    flags: response.headers['set-cookie'][0],
  };
}

function mutate(actor, method, path) {
  return api[method]('/api/v1' + path).set('Cookie', actor.cookie).set('X-CSRF-Token', actor.csrf);
}

beforeAll(async () => {
  if (process.env.NODE_ENV !== 'test' || !databaseUrl || !/^\/[a-z0-9_]+_test$/i.test(new URL(databaseUrl).pathname)) {
    throw new Error('API tests require NODE_ENV=test and DATABASE_URL naming a database ending in _test');
  }
  control = new Pool({ connectionString: databaseUrl });
  await control.query('CREATE SCHEMA ' + schema);
  pool = new Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  const schemaSql = readFileSync(join(__dirname, '../../db/schema.sql'), 'utf8');
  await pool.query(schemaSql);
  await seed({ pool, passwords: seedPasswords });
  now = Date.now();
  api = request(createApp({ pool, now: () => now, authRateLimit: 100 }));
  [alice, bob, admin] = await Promise.all(['alice', 'bob', 'admin'].map(login));
}, 30000);

afterAll(async () => {
  if (pool) await pool.end();
  if (control) {
    try {
      await control.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE');
    } finally {
      await control.end();
    }
  }
});

test('health and generic errors have safe bodies and request IDs', async () => {
  for (const path of ['/health', '/api/v1/health']) {
    const response = await api.get(path).expect(200, { status: 'ok', db: true });
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  }
  const failed = request(createApp({ pool: { query: async () => { throw new Error('private-db-info'); } } }));
  const response = await failed.get('/api/v1/leaderboard').expect(500);
  expect(response.body).toEqual({ error: 'Internal server error', requestId: response.headers['x-request-id'] });
});

test('registers a player, applies flags, rotates sessions, expires and logs out', async () => {
  const registration = await api.post('/api/v1/auth/register')
    .send({ username: 'new-player', email: 'new@example.test', password: 'a-strong-password' }).expect(201);
  expect(registration.body.user).toEqual({ id: expect.any(Number), username: 'new-player', role: 'player' });
  expect(alice.flags).toMatch(/HttpOnly/);
  expect(alice.flags).toMatch(/Secure/);
  expect(alice.flags).toMatch(/SameSite=Strict/);
  expect(alice.flags).toMatch(/Path=\//);
  expect(alice.flags).toMatch(/Max-Age=604800/);
  const renewed = await api.post('/api/v1/auth/login').set('Cookie', alice.cookie)
    .send({ username: 'alice', password: seedPasswords.alice }).expect(200);
  await api.get('/api/v1/auth/me').set('Cookie', alice.cookie).expect(401);
  alice.cookie = renewed.headers['set-cookie'][0].split(';')[0];
  alice.csrf = renewed.body.csrfToken;
  await api.get('/api/v1/auth/me').set('Cookie', alice.cookie)
    .expect(200, { user: alice.user, csrfToken: alice.csrf });

  const expiring = await login('bob');
  const originalTime = now;
  now += 7 * 24 * 60 * 60 * 1000;
  try {
    await api.get('/api/v1/auth/me').set('Cookie', expiring.cookie).expect(401);
  } finally {
    now = originalTime;
  }
  const expiringTokenHash = require('node:crypto').createHash('sha256').update(expiring.cookie.slice(4)).digest('hex');
  expect((await pool.query('SELECT id FROM sessions WHERE token_hash = $1', [expiringTokenHash])).rowCount).toBe(0);
  const leaving = await login('bob');
  await mutate(leaving, 'post', '/auth/logout').send({}).expect(204);
  await api.get('/api/v1/auth/me').set('Cookie', leaving.cookie).expect(401);
});

test('enforces the per-IP auth limit', async () => {
  const limited = request(createApp({ pool, authRateLimit: 1 }));
  await limited.post('/api/v1/auth/login').send({ username: 'unknown', password: 'wrong' }).expect(401);
  await limited.post('/api/v1/auth/login').send({ username: 'unknown', password: 'wrong' }).expect(429);
});

test('validates CSRF and hides all private fields from public stats', async () => {
  await api.post('/api/v1/battles').set('Cookie', alice.cookie).send({ mode: 'campaign' }).expect(403);
  const response = await api.get('/api/v1/users/' + alice.user.id + '/stats').expect(200);
  expect(response.body).toEqual({ username: 'alice', rank: 'Intern', bestKills: 0, sectionsCleared: 0 });
});

test('protects term CRUD by role and validates drill groups', async () => {
  const group = require('../../db/drill-groups.json')[0];
  const term = { id: 'api-test-term', section: 0, term: 'API test term', aliases: [], definition: 'API test definition', drill_group_ids: [group.id] };
  await api.get('/api/v1/admin/terms').set('Cookie', bob.cookie).expect(403);
  await mutate(bob, 'post', '/admin/terms').send(term).expect(403);
  await mutate(admin, 'post', '/admin/terms').send({ ...term, drill_group_ids: ['unknown-group'] }).expect(400);
  await mutate(admin, 'post', '/admin/terms').send(term).expect(201);
  const updated = await mutate(admin, 'put', '/admin/terms/' + term.id).send({ ...term, aliases: ['alias'] }).expect(200);
  expect(updated.body).toMatchObject({ aliases: ['alias'], is_top25: true });
  const list = await api.get('/api/v1/admin/terms').set('Cookie', admin.cookie).expect(200);
  expect(list.body.terms).toContainEqual(expect.objectContaining({ id: term.id }));
  await mutate(admin, 'delete', '/admin/terms/' + term.id).expect(204);
});

test('checks battle ownership before answers, hides unanswered fields, serializes answers', async () => {
  const start = await mutate(alice, 'post', '/battles').send({ mode: 'campaign' }).expect(201);
  const battle = start.body;
  expect(Object.keys(battle.question).sort()).toEqual(
    (battle.question.options ? ['id', 'options', 'prompt', 'startedAt', 'timeLimitSeconds', 'variant'] :
      ['id', 'prompt', 'startedAt', 'timeLimitSeconds', 'variant']).sort(),
  );
  const path = '/battles/' + battle.id;
  const saved = await pool.query('SELECT question FROM battles WHERE id = $1', [battle.id]);
  const answer = saved.rows[0].question.answer;
  const submission = { questionId: battle.question.id, ...(typeof answer === 'number' ? { choice: answer } : { text: answer }) };
  await mutate(bob, 'post', path + '/answer').send(submission).expect(403);
  await mutate(bob, 'post', path + '/forfeit').send({}).expect(403);
  await mutate(alice, 'post', path + '/answer').send({ ...submission, questionId: randomUUID() }).expect(409);
  const replies = await Promise.all([1, 2].map(() => mutate(alice, 'post', path + '/answer').send(submission)));
  expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
  expect(replies.find((reply) => reply.status === 200).body.correct).toBe(true);
  expect((await pool.query('SELECT SUM(correct)::int AS total FROM term_stats WHERE user_id = $1', [alice.user.id])).rows[0].total).toBe(1);
});

test('concurrent starts leave only one active battle and reset forfeited progress', async () => {
  const replies = await Promise.all([1, 2].map(() => mutate(alice, 'post', '/battles').send({ mode: 'campaign' })));
  expect(replies.map((reply) => reply.status)).toEqual([201, 201]);
  const { rows } = await pool.query("SELECT id FROM battles WHERE user_id = $1 AND status = 'active'", [alice.user.id]);
  expect(rows).toHaveLength(1);
  await mutate(alice, 'post', '/battles/' + rows[0].id + '/forfeit').send({}).expect(200);
  await mutate(alice, 'post', '/battles/' + rows[0].id + '/forfeit').send({}).expect(409);
});

test('safe starts serialize and preserve an existing battle and progress', async () => {
  const start = () => mutate(alice, 'post', '/battles').send({ mode: 'campaign', replaceActive: false });
  const replies = await Promise.all([start(), start()]);
  expect(replies.map((reply) => reply.status).sort()).toEqual([201, 409]);
  const battle = replies.find((reply) => reply.status === 201).body;
  const battles = () => pool.query('SELECT * FROM battles WHERE user_id = $1 ORDER BY id', [alice.user.id]);
  const progress = () => pool.query('SELECT * FROM progress WHERE user_id = $1', [alice.user.id]);
  const terms = () => pool.query('SELECT * FROM term_stats WHERE user_id = $1 ORDER BY term_id', [alice.user.id]);
  const before = [(await battles()).rows, (await progress()).rows, (await terms()).rows];
  expect(before[0].filter((row) => row.status === 'active').map((row) => row.id)).toEqual([battle.id]);

  const rejected = await start().expect(409);
  expect(rejected.body.error).toBe('A battle is already active');
  expect([(await battles()).rows, (await progress()).rows, (await terms()).rows]).toEqual(before);

  const replacement = await mutate(alice, 'post', '/battles').send({ mode: 'campaign' }).expect(201);
  expect(replacement.body.id).not.toBe(battle.id);
  const { rows } = await pool.query('SELECT status FROM battles WHERE id = $1', [battle.id]);
  expect(rows).toEqual([{ status: 'forfeit' }]);
  await mutate(alice, 'post', '/battles/' + replacement.body.id + '/forfeit').send({}).expect(200);
});

test('rejects nonboolean replacement values', async () => {
  for (const replaceActive of ['false', 0, null]) {
    await mutate(alice, 'post', '/battles').send({ mode: 'campaign', replaceActive }).expect(400);
  }
});

test('validates malformed, oversized, and incorrectly typed JSON payloads', async () => {
  await mutate(alice, 'post', '/battles').type('json').send('{').expect(400);
  await mutate(alice, 'post', '/battles').type('text').send('campaign').expect(415);
  await mutate(alice, 'post', '/battles').send({ mode: 'x'.repeat(17000) }).expect(413);
  await mutate(alice, 'post', '/battles').send({ mode: 'campaign', userId: bob.user.id }).expect(400);
  await mutate(alice, 'post', '/battles/invalid/forfeit').send({}).expect(400);
  await mutate(alice, 'post', '/battles/' + randomUUID() + '/forfeit').send({}).expect(404);
  await mutate(alice, 'post', '/battles').send({ mode: 'endless' }).expect(409);
});

test('records an endless timeout loss, resets the run, and exposes only best scores', async () => {
  await pool.query(
    "UPDATE progress SET endless = $2, player = jsonb_set(player, '{hp}', '1'), endless_best_streak = 9 WHERE user_id = $1",
    [bob.user.id, { unlocked: true, kills: 4, difficulty: 0 }],
  );
  const { body: battle } = await mutate(bob, 'post', '/battles').send({ mode: 'endless' }).expect(201);
  const question = battle.question;
  const originalTime = now;
  now += question.timeLimitSeconds * 1000 + 2001;
  try {
    const submission = { questionId: question.id, ...(question.options ? { choice: 0 } : { text: '' }) };
    const { body } = await mutate(bob, 'post', '/battles/' + battle.id + '/answer').send(submission).expect(200);
    expect(body).toMatchObject({
      correct: false, timedOut: true, status: 'lost', question: null,
      runSummary: { kills: 4, bestStreak: 9 },
      progress: { endless: { kills: 0, difficulty: 0, unlocked: true } },
    });
    expect(body.progress.player.hp).toBe(body.progress.player.maxHp);
  } finally {
    now = originalTime;
  }
  await api.get('/api/v1/leaderboard').expect(200, {
    entries: [{ userId: bob.user.id, username: 'bob', rank: 'Intern', bestKills: 4, bestStreak: 9 }],
  });
  const weakSpots = await api.get('/api/v1/weak-spots').set('Cookie', bob.cookie).expect(200);
  expect(weakSpots.body.terms).toEqual([expect.objectContaining({ wrong: 1, correct: 0 })]);
});

test('repeat seeding preserves the original password hashes, progress, and users', async () => {
  const saved = await pool.query(
    'SELECT u.id, u.password_hash, p.player, p.campaign, p.endless FROM users u JOIN progress p ON p.user_id = u.id ORDER BY u.id',
  );
  await seed({
    pool,
    passwords: { alice: 'unused-alice-password', bob: 'unused-bob-password', admin: 'unused-admin-password' },
  });
  const reseeded = await pool.query(
    'SELECT u.id, u.password_hash, p.player, p.campaign, p.endless FROM users u JOIN progress p ON p.user_id = u.id ORDER BY u.id',
  );
  expect(reseeded.rows).toEqual(saved.rows);
});
