import { Router } from 'express';
import { db } from '../db.js';
import { assertWorkspaceAccess, requireAuth, workspaceRole } from '../lib/auth.js';
import { route } from '../lib/http.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const num = (sql: string, ...params: any[]) => Number((db.prepare(sql).get(...params) as any)?.c ?? 0);

dashboardRouter.get(
  '/',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    const role = assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');

    const counts = {
      projects: num('SELECT COUNT(*) c FROM projects WHERE workspace_id = ?', workspaceId),
      services: num(
        'SELECT COUNT(*) c FROM services s JOIN projects p ON p.id = s.project_id WHERE p.workspace_id = ?',
        workspaceId,
      ),
      databases: num(
        'SELECT COUNT(*) c FROM databases d JOIN projects p ON p.id = d.project_id WHERE p.workspace_id = ?',
        workspaceId,
      ),
      environments: num(
        'SELECT COUNT(*) c FROM environments e JOIN projects p ON p.id = e.project_id WHERE p.workspace_id = ?',
        workspaceId,
      ),
      members: num('SELECT COUNT(*) c FROM workspace_members WHERE workspace_id = ?', workspaceId),
      deployments: num(
        'SELECT COUNT(*) c FROM deployments d JOIN projects p ON p.id = d.project_id WHERE p.workspace_id = ?',
        workspaceId,
      ),
      running: num(
        `SELECT COUNT(*) c FROM deployments d JOIN projects p ON p.id = d.project_id
         WHERE p.workspace_id = ? AND d.status = 'running'`,
        workspaceId,
      ),
      inProgress: num(
        `SELECT COUNT(*) c FROM deployments d JOIN projects p ON p.id = d.project_id
         WHERE p.workspace_id = ? AND d.status IN ('queued','building','deploying')`,
        workspaceId,
      ),
      failed: num(
        `SELECT COUNT(*) c FROM deployments d JOIN projects p ON p.id = d.project_id
         WHERE p.workspace_id = ? AND d.status = 'failed'`,
        workspaceId,
      ),
    };

    const recentDeployments = db
      .prepare(
        `SELECT d.id, d.status, d.trigger, d.commit_sha, d.commit_message, d.created_at, d.finished_at,
           s.name AS service_name, s.id AS service_id, p.name AS project_name, p.id AS project_id,
           e.name AS environment_name
         FROM deployments d
         JOIN services s ON s.id = d.service_id
         JOIN projects p ON p.id = d.project_id
         LEFT JOIN environments e ON e.id = d.environment_id
         WHERE p.workspace_id = ?
         ORDER BY d.created_at DESC LIMIT 8`,
      )
      .all(workspaceId) as any[];

    const activity = db
      .prepare(
        `SELECT a.id, a.action, a.target_type, a.metadata, a.created_at, u.name AS actor_name, u.email AS actor_email
         FROM activity_logs a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT 10`,
      )
      .all(workspaceId) as any[];

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const usageRows = db
      .prepare(
        `SELECT metric, SUM(value) AS total, unit FROM usage_records
         WHERE workspace_id = ? AND recorded_at >= ? GROUP BY metric, unit`,
      )
      .all(workspaceId, monthStart.toISOString()) as any[];

    const provider = db
      .prepare(`SELECT provider, account_name, status, last_checked_at FROM provider_connections WHERE workspace_id = ?`)
      .all(workspaceId) as any[];
    const github = provider.find((p) => p.provider === 'github') ?? null;
    const railway = provider.find((p) => p.provider === 'railway') ?? null;

    const notice = db.prepare(`SELECT value FROM platform_settings WHERE key = 'platform_notice'`).get() as any;

    res.json({
      role,
      counts,
      recentDeployments,
      activity: activity.map((a) => ({
        ...a,
        metadata: a.metadata ? JSON.parse(a.metadata) : {},
      })),
      usage: usageRows.map((u) => ({ metric: u.metric, total: u.total, unit: u.unit })),
      usagePeriodStart: monthStart.toISOString(),
      connections: {
        railway: railway
          ? { connected: true, accountName: railway.account_name, status: railway.status }
          : { connected: false },
        github: github
          ? { connected: true, accountName: github.account_name, status: github.status }
          : { connected: false },
      },
      platformNotice: notice ? JSON.parse(notice.value) : null,
    });
  }),
);

dashboardRouter.get(
  '/search',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    const q = String(req.query.q || '').trim();
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    if (!q) {
      res.json({ projects: [], services: [], deployments: [] });
      return;
    }
    const like = `%${q}%`;
    const projects = db
      .prepare(`SELECT id, name, slug FROM projects WHERE workspace_id = ? AND (name LIKE ? OR slug LIKE ?) LIMIT 5`)
      .all(workspaceId, like, like) as any[];
    const services = db
      .prepare(
        `SELECT s.id, s.name, s.project_id, p.name AS project_name FROM services s
         JOIN projects p ON p.id = s.project_id
         WHERE p.workspace_id = ? AND (s.name LIKE ? OR s.repo_full_name LIKE ? OR s.docker_image LIKE ?) LIMIT 5`,
      )
      .all(workspaceId, like, like, like) as any[];
    const deployments = db
      .prepare(
        `SELECT d.id, d.status, d.commit_sha, s.name AS service_name, s.id AS service_id, p.id AS project_id
         FROM deployments d JOIN services s ON s.id = d.service_id JOIN projects p ON p.id = d.project_id
         WHERE p.workspace_id = ? AND (d.id LIKE ? OR d.commit_sha LIKE ? OR d.commit_message LIKE ?)
         ORDER BY d.created_at DESC LIMIT 5`,
      )
      .all(workspaceId, like, like, like) as any[];
    res.json({ projects, services, deployments, role: workspaceRole(req.user!.id, workspaceId) });
  }),
);
