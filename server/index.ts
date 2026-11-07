import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db, migrate } from './db.js';
import { attachUser } from './lib/auth.js';
import { ApiError } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { workspaceRouter } from './routes/workspaces.js';
import { projectRouter } from './routes/projects.js';
import { serviceRouter, webhookRouter } from './routes/services.js';
import { providerRouter } from './routes/providers.js';
import { templateRouter } from './routes/templates.js';
import { adminRouter } from './routes/admin.js';
import { dashboardRouter } from './routes/dashboard.js';
import { ensureProviderColumns, resumeActiveDeployments } from './services/deployments.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const PORT = Number(process.env.PORT || 8080);

migrate();
ensureProviderColumns();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(
  express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf;
    },
  }),
);
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'pomp-net-cloud', time: new Date().toISOString() });
});

// GitHub webhooks are mounted before user attachment and use raw body signatures.
app.use('/api/webhooks', webhookRouter);

app.use('/api', attachUser);

// Maintenance mode blocks writes for everyone except the platform owner.
app.use('/api', (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.path.startsWith('/auth')) {
    next();
    return;
  }
  if (req.user) {
    const row = db.prepare('SELECT is_platform_owner FROM users WHERE id = ?').get(req.user.id) as any;
    if (row?.is_platform_owner) {
      next();
      return;
    }
  }
  const setting = db.prepare(`SELECT value FROM platform_settings WHERE key = 'maintenance_mode'`).get() as any;
  if (setting && JSON.parse(setting.value) === true) {
    next(new ApiError(503, 'maintenance', 'POMP NET CLOUD is in maintenance mode. Writes are temporarily disabled.'));
    return;
  }
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/workspaces', workspaceRouter);
app.use('/api/projects', projectRouter);
app.use('/api/services', serviceRouter);
app.use('/api/providers', providerRouter);
app.use('/api/railway', railwayRouter);
app.use('/api/templates', templateRouter);
app.use('/api/admin', adminRouter);
app.use('/api/dashboard', dashboardRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'not_found', message: 'Unknown API endpoint' } });
});

const webDir = path.join(root, 'dist/web');
if (fs.existsSync(webDir)) {
  app.use(
    express.static(webDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('cache-control', 'no-cache');
        else res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.get('*', (req, res) => {
    // The client uses a hash router, so clean paths such as /login or /projects/42
    // must be translated to their hash route to keep shared links working.
    const hasFileExtension = /\.[a-z0-9]+$/i.test(req.path);
    if (req.path !== '/' && !hasFileExtension) {
      const queryIndex = req.originalUrl.indexOf('?');
      const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);
      res.redirect(302, `/#${req.path}${query}`);
      return;
    }
    res.sendFile(path.join(webDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('POMP NET CLOUD API is running. Build the web app with `npm run build` to serve the dashboard.');
  });
}

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err instanceof ApiError ? err.status : 500;
  const code = err instanceof ApiError ? err.code : 'internal_error';
  const message =
    err instanceof ApiError ? err.message : 'Unexpected server error. The incident was recorded for review.';
  if (!(err instanceof ApiError)) {
    try {
      db.prepare(
        `INSERT INTO error_reports (id, message, stack, path, method, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        `err_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        String(err?.message ?? err),
        String(err?.stack ?? ''),
        req.path,
        req.method,
        (req as any).user?.id ?? null,
        new Date().toISOString(),
      );
    } catch {
      /* error reporting must never crash the handler */
    }
    // eslint-disable-next-line no-console
    console.error('[pomp-net]', err);
  }
  if (res.headersSent) return;
  res.status(status).json({
    error: { code, message, ...(err instanceof ApiError && err.details ? { details: err.details } : {}) },
  });
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[pomp-net] POMP NET CLOUD API listening on 0.0.0.0:${PORT}`);
  resumeActiveDeployments();
});
