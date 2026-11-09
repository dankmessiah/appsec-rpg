const { randomUUID } = require('node:crypto');
const { join } = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');
const { adminRoutes } = require('./admin');
const { auth } = require('./auth');
const { battleRoutes } = require('./battles');
const { HttpError } = require('./http');
const { readRoutes } = require('./read-routes');

function limiter(options) {
  return rateLimit({
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'Too many requests', requestId: req.id }),
    ...options,
  });
}

function jsonContent(req, res, next) {
  if (['POST', 'PUT', 'DELETE'].includes(req.method) &&
      (Number(req.get('Content-Length')) > 0 || req.get('Transfer-Encoding')) &&
      !req.is('application/json')) {
    throw new HttpError(415, 'Expected application/json');
  }
  next();
}

function createApp({ pool, now = Date.now, authRateLimit = 10 }) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });

  const secureCookies = process.env.COOKIE_SECURE !== 'false';
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        ...(secureCookies ? {} : { upgradeInsecureRequests: null }),
      },
    },
    strictTransportSecurity: secureCookies,
  }));

  const health = async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: true });
    } catch {
      console.error('Health database check failed', { requestId: req.id });
      res.status(503).json({ status: 'unavailable', db: false });
    }
  };
  app.get(['/health', '/api/v1/health'], health);

  const api = express.Router();
  const authHandlers = auth({ pool, now, secureCookies });
  const loginLimit = limiter({ windowMs: 15 * 60 * 1000, limit: authRateLimit });
  api.post(['/auth/register', '/auth/login'], loginLimit);
  api.use(jsonContent, express.json({ limit: '16kb' }));
  api.use('/auth', authHandlers.publicRouter);
  api.use(authHandlers.loadSession);
  api.use(limiter({
    windowMs: 60 * 1000,
    limit: 120,
    keyGenerator: (req) => req.session ? 'user:' + req.session.id : 'ip:' + ipKeyGenerator(req.ip),
  }));
  api.use('/auth', authHandlers.privateRouter);
  api.use(readRoutes(pool));
  api.use(battleRoutes({ pool, now }));
  api.use('/admin', adminRoutes(pool));
  api.use((req, res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api/v1', api);

  app.use(express.static(join(__dirname, '../public')));
  app.use((req, res, next) => next(new HttpError(404, 'Not found')));

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message, requestId: req.id });
    if ([400, 413, 415].includes(error.status)) {
      return res.status(error.status).json({ error: 'Invalid request', requestId: req.id });
    }
    console.error('Request failed', { requestId: req.id });
    return res.status(500).json({ error: 'Internal server error', requestId: req.id });
  });
  return app;
}

module.exports = { createApp };
