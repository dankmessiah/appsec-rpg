const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const request = require('supertest');
const { createApp } = require('../../server/app');
const { seed } = require('../../db/seed');

const schema = 'rpg_reads_' + randomUUID().replaceAll('-', '');
let control;
let pool;
let api;
let alice;
let bob;
async function login(username) {
  const reply = await api.post('/api/v1/auth/login')
    .send({ username, password: username + '-password-for-tests' }).expect(200);
  return { id: reply.body.user.id, cookie: reply.headers['set-cookie'][0].split(';')[0], csrf: reply.body.csrfToken };
}
beforeAll(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !databaseUrl || !/^\/[a-z0-9_]+_test$/i.test(new URL(databaseUrl).pathname)) {
    throw new Error('Requires an isolated database ending in _test');
  }
  control = new Pool({ connectionString: databaseUrl });
  await control.query('CREATE SCHEMA ' + schema);
  pool = new Pool({ connectionString: databaseUrl, options: '-c search_path=' + schema });
  await seed({ pool, passwords: { alice: 'alice-password-for-tests', bob: 'bob-password-for-tests', admin: 'admin-password-for-tests' } });
  api = request(createApp({ pool, authRateLimit: 100 }));
  alice = await login('alice');
  bob = await login('bob');
}, 30000);
afterAll(async () => {
  if (pool) await pool.end();
  if (control) {
    try { await control.query('DROP SCHEMA IF EXISTS ' + schema + ' CASCADE'); }
    finally { await control.end(); }
  }
});

test('weak spots reflect a real missed answer and remain private to its player', async () => {
  await api.get('/api/v1/weak-spots').expect(401);
  const start = await api.post('/api/v1/battles').set('Cookie', alice.cookie)
    .set('X-CSRF-Token', alice.csrf).send({ mode: 'campaign' }).expect(201);
  const { rows: [battle] } = await pool.query('SELECT question FROM battles WHERE id=$1', [start.body.id]);
  const answer = battle.question;
  const result = await api.post('/api/v1/battles/' + start.body.id + '/answer').set('Cookie', alice.cookie)
    .set('X-CSRF-Token', alice.csrf).send({ questionId: answer.id, choice: (answer.answer + 1) % 4 }).expect(200);
  expect(result.body.correct).toBe(false);
  const { body } = await api.get('/api/v1/weak-spots').set('Cookie', alice.cookie).expect(200);
  expect(body.terms).toHaveLength(1);
  const source = require('../../db/terms.json').find(term => term.id === answer.termId);
  expect(body.terms[0]).toMatchObject({ id: source.id, term: source.term, section: source.section, definition: source.definition, correct: 0, wrong: 1 });
  const other = await api.get('/api/v1/weak-spots').set('Cookie', bob.cookie).expect(200);
  expect(other.body.terms).toEqual([]);
});

test('weak spots shows the fifteen most unresolved terms, with accurate counts and definitions', async () => {
  await pool.query('DELETE FROM term_stats WHERE user_id=$1', [alice.id]);
  const terms = require('../../db/terms.json').slice(0, 18);
  for (const [index, term] of terms.entries()) {
    await pool.query('INSERT INTO term_stats(user_id,term_id,correct,wrong) VALUES($1,$2,$3,$4)', [alice.id, term.id, index, index * 2 + 1]);
  }
  const response = await api.get('/api/v1/weak-spots').set('Cookie', alice.cookie).expect(200);
  expect(response.body.terms).toHaveLength(15);
  const expected = terms.slice(3).reverse();
  expect(response.body.terms.map(term => term.id)).toEqual(expected.map(term => term.id));
  for (const actual of response.body.terms) {
    const index = terms.findIndex(term => term.id === actual.id);
    expect(actual).toMatchObject({ definition: terms[index].definition, correct: index, wrong: index * 2 + 1 });
  }
});
