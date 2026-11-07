import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { conflict, forbidden, notFound, nowIso, parse, route } from '../lib/http.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);

adminRouter.use((req, _res, next) => {
  const row = db.prepare('SELECT is_platform_owner FROM users WHERE id = ?').get(req.user!.id) as any;
  if (!row || !row.is_platform_owner) {
    next(forbidden('Platform owner access is required'));
    return;
  }
  next();
});

const count = (sql: string, ...params: any[]) => (db.prepare(sql).get(...params) as any)?.c ?? 0;

adminRouter.get(
  '/overview',
  route(async (_req, res) => {
    const maintenance = db.prepare(`SELECT value FROM platform_settings WHERE key = 'maintenance_mode'`).get() as any;
    const signup = db.prepare(`SELECT value FROM platform_settings WHERE key = 'signup_enabled'`).get() as any;
    const notice = db.prepare(`SELECT value FROM platform_settings WHERE key = 'platform_notice'`).get() as any;
    const settings = {
      maintenanceMode: maintenance ? JSON.parse(maintenance.value) === true : false,
      signupEnabled: signup ? JSON.parse(signup.value) !== false : true,
      platformNotice: notice ? String(JSON.parse(notice.value) ?? '') : '',
    };
    res.json({
      counts: {
        users: count('SELECT COUNT(*) c FROM users'),
        suspendedUsers: count('SELECT COUNT(*) c FROM users WHERE suspended_at IS NOT NULL'),
        workspaces: count('SELECT COUNT(*) c FROM workspaces'),
        projects: count('SELECT COUNT(*) c FROM projects'),
        services: count('SELECT COUNT(*) c FROM services'),
        deployments: count('SELECT COUNT(*) c FROM deployments'),
        runningDeployments: count(`SELECT COUNT(*) c FROM deployments WHERE status = 'running'`),
        failedDeployments: count(`SELECT COUNT(*) c FROM deployments WHERE status = 'failed'`),
        databases: count('SELECT COUNT(*) c FROM databases'),
        providerConnections: count('SELECT COUNT(*) c FROM provider_connections'),
        errorReports: count('SELECT COUNT(*) c FROM error_reports'),
      },
      settings,
    });
  }),
);

adminRouter.get(
  '/users',
  route(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.avatar_url, u.email_verified_at, u.is_platform_owner, u.suspended_at, u.created_at,
           (SELECT COUNT(*) FROM workspace_members m WHERE m.user_id = u.id) AS workspace_count
         FROM users u
         WHERE (? = '' OR u.email LIKE ? OR u.name LIKE ?)
         ORDER BY u.created_at DESC LIMIT 100`,
      )
      .all(q, `%${q}%`, `%${q}%`) as any[];
    res.json({
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        avatarUrl: r.avatar_url,
        verified: Boolean(r.email_verified_at),
        isPlatformOwner: Boolean(r.is_platform_owner),
        suspendedAt: r.suspended_at,
        createdAt: r.created_at,
        workspaceCount: r.workspace_count,
      })),
    });
  }),
);

adminRouter.patch(
  '/users/:id',
  route(async (req, res) => {
    const body = parse(z.object({ suspended: z.boolean() }), req.body);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as any;
    if (!user) throw notFound('User not found');
    if (user.is_platform_owner) throw conflict('The platform owner account cannot be suspended');
    db.prepare('UPDATE users SET suspended_at = ? WHERE id = ?').run(body.suspended ? nowIso() : null, user.id);
    if (body.suspended) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    }
    audit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: body.suspended ? 'admin.user_suspended' : 'admin.user_restored',
      targetType: 'user',
      targetId: user.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/workspaces',
  route(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT w.id, w.name, w.slug, w.created_at,
           (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id) AS projects,
           (SELECT COUNT(*) FROM workspace_members m WHERE m.workspace_id = w.id) AS members
         FROM workspaces w ORDER BY w.created_at DESC LIMIT 100`,
      )
      .all() as any[];
    res.json({ workspaces: rows });
  }),
);

adminRouter.get(
  '/projects',
  route(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT p.id, p.name, p.slug, p.created_at, w.name AS workspace,
           (SELECT COUNT(*) FROM services s WHERE s.project_id = p.id) AS services
         FROM projects p JOIN workspaces w ON w.id = p.workspace_id
         ORDER BY p.created_at DESC LIMIT 100`,
      )
      .all() as any[];
    res.json({ projects: rows });
  }),
);

adminRouter.get(
  '/deployments',
  route(async (_req, res) => {
    const rows = db
      .prepare(
        `SELECT d.id, d.status, d.trigger, d.created_at, d.started_at, d.finished_at, d.error_message,
           s.name AS service, p.name AS project, w.name AS workspace
         FROM deployments d
         JOIN services s ON s.id = d.service_id
         JOIN projects p ON p.id = d.project_id
         JOIN workspaces w ON w.id = p.workspace_id
         ORDER BY d.created_at DESC LIMIT 100`,
      )
      .all() as any[];
    res.json({ deployments: rows });
  }),
);

adminRouter.get(
  '/audit',
  route(async (_req, res) => {
    const rows = db
      .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`)
      .all() as any[];
    res.json({ events: rows });
  }),
);

adminRouter.get(
  '/errors',
  route(async (_req, res) => {
    const rows = db
      .prepare(`SELECT * FROM error_reports ORDER BY created_at DESC LIMIT 100`)
      .all() as any[];
    res.json({ errors: rows });
  }),
);

adminRouter.get(
  '/settings',
  route(async (_req, res) => {
    const rows = db.prepare('SELECT key, value, updated_at FROM platform_settings').all() as any[];
    res.json({
      settings: rows
        .filter((r) => !r.key.startsWith('oauth_state:'))
        .map((r) => {
          let value: unknown = r.value;
          try {
            value = JSON.parse(r.value);
          } catch {
            /* keep raw */
          }
          return { key: r.key, value, updatedAt: r.updated_at };
        }),
    });
  }),
);

adminRouter.put(
  '/settings',
  route(async (req, res) => {
    const body = parse(
      z.object({
        maintenanceMode: z.boolean().optional(),
        signupEnabled: z.boolean().optional(),
        platformNotice: z.string().max(500).optional(),
      }),
      req.body,
    );
    const write = (key: string, value: unknown) => {
      db.prepare(
        `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(key, JSON.stringify(value), nowIso());
    };
    if (body.maintenanceMode !== undefined) write('maintenance_mode', body.maintenanceMode);
    if (body.signupEnabled !== undefined) write('signup_enabled', body.signupEnabled);
    if (body.platformNotice !== undefined) write('platform_notice', body.platformNotice);
    audit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'admin.settings_updated',
      targetType: 'platform',
      metadata: body,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

adminRouter.patch(
  '/templates/:id',
  route(async (req, res) => {
    const body = parse(z.object({ featured: z.boolean() }), req.body);
    const row = db.prepare('SELECT id FROM templates WHERE id = ?').get(req.params.id) as any;
    if (!row) throw notFound('Template not found');
    db.prepare('UPDATE templates SET featured = ? WHERE id = ?').run(body.featured ? 1 : 0, row.id);
    res.json({ ok: true });
  }),
);
