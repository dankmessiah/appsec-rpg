const { Pool } = require('pg');
const request = require('supertest');
const { createApp } = require('../../server/app');

test('both health URLs share the per-IP budget and rejected requests skip PostgreSQL', async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (process.env.NODE_ENV !== 'test' || !databaseUrl || !/^\/[a-z0-9_]+_test$/i.test(new URL(databaseUrl).pathname)) {
    throw new Error('API tests require NODE_ENV=test and DATABASE_URL naming a database ending in _test');
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const query = jest.spyOn(pool, 'query');
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now());
  try {
    const api = request(createApp({ pool }));
    for (let i = 0; i < 60; i += 1) {
      const path = i % 2 === 0 ? '/health' : '/api/v1/health';
      await api.get(path).expect(200, { status: 'ok', db: true, buildRevision: 'unknown' });
    }
    expect(query).toHaveBeenCalledTimes(60);

    for (const path of ['/health', '/api/v1/health']) {
      const limited = await api.get(path).expect(429);
      expect(limited.body).toEqual({ error: 'Too many requests', requestId: limited.headers['x-request-id'] });
      expect(limited.headers['retry-after']).toBe('60');
    }
    expect(query).toHaveBeenCalledTimes(60);
  } finally {
    clock.mockRestore();
    query.mockRestore();
    await pool.end();
  }
}, 30000);
