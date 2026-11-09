const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const bcrypt = require('bcrypt');
const { Router } = require('express');
const { z } = require('zod');
const { transaction } = require('./db');
const { HttpError, validate } = require('./http');
const { initializeProgress } = require('./progress');

const sessionLength = 7 * 24 * 60 * 60 * 1000;
const passwordSchema = z.string().max(72).refine((value) => Buffer.byteLength(value) <= 72);
const usernameSchema = z.string().regex(/^[a-zA-Z0-9_-]{3,20}$/).transform((value) => value.toLowerCase());
const emptyBody = z.strictObject({}).optional();
const registerSchema = z.strictObject({
  username: usernameSchema,
  email: z.email().max(254).transform((value) => value.toLowerCase()),
  password: passwordSchema.refine((value) => value.length >= 12),
});
const loginSchema = z.strictObject({ username: usernameSchema, password: passwordSchema });
const seedUsernames = new Set(['alice', 'bob', 'admin']);
const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 12);

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieToken(req) {
  return /(?:^|;\s*)sid=([0-9a-f]{64})(?=;|$)/.exec(req.headers.cookie || '')?.[1];
}

function auth({ pool, now, secureCookies }) {
  const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/' };

  async function loadSession(req, res, next) {
    const token = cookieToken(req);
    if (!token) return next();
    const hash = tokenHash(token);
    const date = new Date(now());
    const { rows: [session] } = await pool.query(
      'SELECT s.id AS session_id, s.csrf_token, u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2',
      [hash, date],
    );
    if (session) {
      req.session = session;
      res.set('Cache-Control', 'no-store');
    } else {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1 AND expires_at <= $2', [hash, date]);
    }
    next();
  }

  async function issueSession(client, user, req) {
    const existing = cookieToken(req);
    if (existing) await client.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(existing)]);
    const token = randomBytes(32).toString('hex');
    const csrfToken = randomBytes(32).toString('hex');
    await client.query(
      'INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at) VALUES ($1, $2, $3, $4, $5)',
      [randomUUID(), user.id, tokenHash(token), csrfToken, new Date(now() + sessionLength)],
    );
    return { token, csrfToken };
  }

  function respond(res, status, user, session) {
    res.cookie('sid', session.token, { ...cookieOptions, maxAge: sessionLength });
    res.set('Cache-Control', 'no-store').status(status).json({ user, csrfToken: session.csrfToken });
  }

  const publicRouter = Router();
  publicRouter.post('/register', async (req, res) => {
    const { username, email, password } = validate(registerSchema, req.body);
    if (seedUsernames.has(username) || email.endsWith('@appsec-rpg.invalid')) {
      throw new HttpError(409, 'Account unavailable');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const { user, session } = await transaction(pool, async (client) => {
      const { rows: [user] } = await client.query(
        'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING id, username, role',
        [username, email, passwordHash],
      );
      if (!user) throw new HttpError(409, 'Account unavailable');
      await initializeProgress(client, user.id);
      return { user, session: await issueSession(client, user, req) };
    });
    respond(res, 201, user, session);
  });

  publicRouter.post('/login', async (req, res) => {
    const { username, password } = validate(loginSchema, req.body);
    const { rows: [found] } = await pool.query('SELECT id, username, role, password_hash FROM users WHERE username = $1', [username]);
    const passwordMatches = await bcrypt.compare(password, found?.password_hash ?? dummyHash);
    if (!found || !passwordMatches) throw new HttpError(401, 'Invalid credentials');
    const user = { id: found.id, username: found.username, role: found.role };
    const session = await transaction(pool, async (client) => {
      const { rows: [current] } = await client.query('SELECT password_hash FROM users WHERE id = $1 FOR SHARE', [user.id]);
      if (current?.password_hash !== found.password_hash) throw new HttpError(401, 'Invalid credentials');
      return issueSession(client, user, req);
    });
    respond(res, 200, user, session);
  });

  const privateRouter = Router();
  privateRouter.get('/me', requireSession, (req, res) => {
    const { id, username, role, csrf_token: csrfToken } = req.session;
    res.json({ user: { id, username, role }, csrfToken });
  });
  privateRouter.post('/logout', requireSession, requireCsrf, async (req, res) => {
    validate(emptyBody, req.body);
    await pool.query('DELETE FROM sessions WHERE id = $1', [req.session.session_id]);
    res.clearCookie('sid', cookieOptions).status(204).end();
  });
  return { publicRouter, privateRouter, loadSession };
}

function requireSession(req, res, next) {
  if (!req.session) throw new HttpError(401, 'Authentication required');
  next();
}

function requireCsrf(req, res, next) {
  const submitted = req.get('X-CSRF-Token');
  if (!submitted || !/^[0-9a-f]{64}$/.test(submitted) ||
      !timingSafeEqual(Buffer.from(submitted), Buffer.from(req.session.csrf_token))) {
    throw new HttpError(403, 'Forbidden');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.role !== 'admin') throw new HttpError(403, 'Forbidden');
  next();
}

module.exports = { auth, requireSession, requireCsrf, requireAdmin };
