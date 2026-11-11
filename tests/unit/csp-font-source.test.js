const test = global.test || require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../../server/app');

for (const secure of [true, false]) {
  test(`font sources remain same-origin in ${secure ? 'default' : 'LAN'} mode`, async () => {
    const previous = process.env.COOKIE_SECURE;
    try {
      if (secure) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = 'false';
      const api = request(createApp({ pool: { query: async () => ({ rows: [] }) } }));
      for (const path of ['/', '/app.js', '/health']) {
        const response = await api.get(path).expect(200);
        const directives = response.headers['content-security-policy'].split(';');
        assert.equal(directives.find(value => value.startsWith('font-src ')), "font-src 'self'");
        for (const name of ['default-src', 'script-src', 'style-src']) {
          assert.ok(directives.includes(`${name} 'self'`));
        }
        assert.equal(directives.includes('upgrade-insecure-requests'), secure);
      }
    } finally {
      if (previous === undefined) delete process.env.COOKIE_SECURE;
      else process.env.COOKIE_SECURE = previous;
    }
  });
}
