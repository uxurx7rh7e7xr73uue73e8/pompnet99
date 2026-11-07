import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { assertWorkspaceAccess, requireAuth } from '../lib/auth.js';
import { assertCanWrite, requireDatabase, requireEnvironment, requireProject } from '../lib/access.js';
import { audit, logActivity } from '../lib/audit.js';
import { conflict, forbidden, notFound, nowIso, parse, route, slugify } from '../lib/http.js';
import { decryptSecret, encryptSecret, randomToken } from '../lib/crypto.js';
import { requireProviderConnection } from '../providers/index.js';
import { recordUsage } from '../services/deployments.js';

export const projectRouter = Router();
projectRouter.use(requireAuth);

const DB_SPECS: Record<
  string,
  { image: string; port: number; user: string; db: string; passwordKey: string }
> = {
  postgres: { image: 'postgres:16-alpine', port: 5432, user: 'postgres', db: 'app', passwordKey: 'POSTGRES_PASSWORD' },
  mysql: { image: 'mysql:8.4', port: 3306, user: 'root', db: 'app', passwordKey: 'MYSQL_ROOT_PASSWORD' },
  redis: { image: 'redis:7-alpine', port: 6379, user: 'default', db: '0', passwordKey: 'REDIS_PASSWORD' },
  mongodb: { image: 'mongo:7', port: 27017, user: 'root', db: 'admin', passwordKey: 'MONGO_INITDB_ROOT_PASSWORD' },
};

function envKind(name: string): 'production' | 'staging' | 'development' | 'custom' {
  const n = name.toLowerCase();
  if (n === 'production' || n === 'prod') return 'production';
  if (n === 'staging' || n === 'stage') return 'staging';
  if (n === 'development' || n === 'dev') return 'development';
  return 'custom';
}

function uniqueSlug(table: 'projects' | 'environments', scope: { column: string; value: string }, name: string) {
  const base = slugify(name);
  let slug = base;
  let n = 1;
  const stmt = db.prepare(`SELECT id FROM ${table} WHERE ${scope.column} = ? AND slug = ?`);
  while (stmt.get(scope.value, slug)) slug = `${base}-${++n}`;
  return slug;
}

function insertEnvironment(projectId: string, name: string): string {
  const id = randomToken(12);
  db.prepare(
    `INSERT INTO environments (id, project_id, name, slug, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, name, uniqueSlug('environments', { column: 'project_id', value: projectId }, name), envKind(name), nowIso());
  return id;
}

/* --------------------------------- projects -------------------------------- */

projectRouter.get(
  '/',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    const role = assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    const projects = db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM services s WHERE s.project_id = p.id) AS service_count,
                (SELECT COUNT(*) FROM databases d WHERE d.project_id = p.id) AS database_count,
                (SELECT COUNT(*) FROM environments e WHERE e.project_id = p.id) AS environment_count,
                (SELECT COUNT(*) FROM deployments d WHERE d.project_id = p.id AND d.status = 'running') AS running_deployments
           FROM projects p WHERE p.workspace_id = ? AND p.archived_at IS NULL
          ORDER BY p.created_at DESC`,
      )
      .all(workspaceId);
    res.json({ projects, role });
  }),
);

projectRouter.post(
  '/',
  route(async (req, res) => {
    const body = parse(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().max(400).optional().default(''),
        environment: z.string().trim().min(2).max(40).optional().default('production'),
      }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    const id = randomToken(12);
    const now = nowIso();
    db.prepare(
      `INSERT INTO projects (id, workspace_id, name, slug, description, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      body.workspaceId,
      body.name,
      uniqueSlug('projects', { column: 'workspace_id', value: body.workspaceId }, body.name),
      body.description,
      req.user!.id,
      now,
      now,
    );
    insertEnvironment(id, body.environment || 'production');
    logActivity({
      workspaceId: body.workspaceId,
      projectId: id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'project.created',
      targetType: 'project',
      targetId: id,
      metadata: { name: body.name },
    });
    audit({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'project.created',
      targetType: 'project',
      targetId: id,
      ip: req.ip,
    });
    res.status(201).json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(id) });
  }),
);

projectRouter.get(
  '/:id',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    const environments = db
      .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY created_at ASC')
      .all(project.id);
    const services = db
      .prepare(
        `SELECT s.*,
                (SELECT status FROM deployments d WHERE d.service_id = s.id ORDER BY d.created_at DESC LIMIT 1) AS last_deployment_status,
                (SELECT created_at FROM deployments d WHERE d.service_id = s.id ORDER BY d.created_at DESC LIMIT 1) AS last_deployment_at
           FROM services s WHERE s.project_id = ? ORDER BY s.created_at ASC`,
      )
      .all(project.id);
    const databases = db
      .prepare(
        `SELECT id, name, engine, status, provider, provider_service_id, connection_host, connection_port,
                connection_db, connection_user, environment_id, created_at, updated_at
           FROM databases WHERE project_id = ? ORDER BY created_at ASC`,
      )
      .all(project.id);
    const recentDeployments = db
      .prepare(
        `SELECT d.*, s.name AS service_name FROM deployments d JOIN services s ON s.id = d.service_id
          WHERE d.project_id = ? ORDER BY d.created_at DESC LIMIT 10`,
      )
      .all(project.id);
    res.json({ project, role, environments, services, databases, recentDeployments });
  }),
);

projectRouter.patch(
  '/:id',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'edit projects');
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        description: z.string().trim().max(400).optional(),
      }),
      req.body,
    );
    db.prepare(
      'UPDATE projects SET name = COALESCE(?, name), description = COALESCE(?, description), updated_at = ? WHERE id = ?',
    ).run(body.name ?? null, body.description ?? null, nowIso(), project.id);
    logActivity({
      workspaceId: project.workspace_id,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'project.updated',
      targetType: 'project',
      targetId: project.id,
      metadata: body,
    });
    res.json({ project: db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id) });
  }),
);

projectRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    if (role !== 'owner' && role !== 'admin') throw forbidden('Only workspace admins can delete projects');
    if (String(req.query.confirm || '') !== project.name) {
      throw conflict(`Type the project name "${project.name}" to confirm deletion`);
    }
    const linked = db
      .prepare('SELECT provider_service_id FROM services WHERE project_id = ? AND provider_service_id IS NOT NULL')
      .all(project.id) as any[];
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
    audit({
      workspaceId: project.workspace_id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'project.deleted',
      targetType: 'project',
      targetId: project.id,
      metadata: { name: project.name, providerServicesNotDeleted: linked.length },
      ip: req.ip,
    });
    res.json({
      ok: true,
      note:
        linked.length > 0
          ? 'POMP NET deleted its own records only. Services still exist in your provider account; remove them there to stop provider billing.'
          : undefined,
    });
  }),
);

/* ------------------------------- environments ------------------------------ */

projectRouter.get(
  '/:id/environments',
  route(async (req, res) => {
    const { project } = requireProject(req.user!.id, req.params.id, 'viewer');
    res.json({
      environments: db
        .prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY created_at ASC')
        .all(project.id),
    });
  }),
);

projectRouter.post(
  '/:id/environments',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'create environments');
    const body = parse(z.object({ name: z.string().trim().min(2).max(40) }), req.body);
    if (db.prepare('SELECT id FROM environments WHERE project_id = ? AND lower(name) = lower(?)').get(project.id, body.name)) {
      throw conflict('An environment with this name already exists');
    }
    const id = insertEnvironment(project.id, body.name);
    logActivity({
      workspaceId: project.workspace_id,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'environment.created',
      targetType: 'environment',
      targetId: id,
      metadata: { name: body.name },
    });
    res.status(201).json({ environment: db.prepare('SELECT * FROM environments WHERE id = ?').get(id) });
  }),
);

projectRouter.post(
  '/:id/environments/:envId/duplicate',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'duplicate environments');
    const { environment } = requireEnvironment(req.user!.id, req.params.envId, 'developer');
    if (environment.project_id !== project.id) throw notFound('Environment not found');
    const body = parse(z.object({ name: z.string().trim().min(2).max(40) }), req.body);
    const id = insertEnvironment(project.id, body.name);
    const vars = db
      .prepare('SELECT * FROM environment_variables WHERE environment_id = ?')
      .all(environment.id) as any[];
    const insert = db.prepare(
      `INSERT INTO environment_variables (id, project_id, environment_id, service_id, key, value_encrypted, is_secret, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = nowIso();
    for (const v of vars) {
      insert.run(randomToken(12), project.id, id, v.service_id, v.key, v.value_encrypted, v.is_secret, now, now);
    }
    logActivity({
      workspaceId: project.workspace_id,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'environment.duplicated',
      targetType: 'environment',
      targetId: id,
      metadata: { from: environment.name, name: body.name, variables: vars.length },
    });
    res.status(201).json({
      environment: db.prepare('SELECT * FROM environments WHERE id = ?').get(id),
      copiedVariables: vars.length,
    });
  }),
);

projectRouter.patch(
  '/:id/environments/:envId',
  route(async (req, res) => {
    requireProject(req.user!.id, req.params.id, 'developer');
    const body = parse(z.object({ name: z.string().trim().min(2).max(40) }), req.body);
    const { environment } = requireEnvironment(req.user!.id, req.params.envId, 'developer');
    db.prepare('UPDATE environments SET name = ?, slug = ?, kind = ? WHERE id = ?').run(
      body.name,
      slugify(body.name),
      envKind(body.name),
      environment.id,
    );
    res.json({ ok: true });
  }),
);

projectRouter.delete(
  '/:id/environments/:envId',
  route(async (req, res) => {
    requireProject(req.user!.id, req.params.id, 'developer');
    const { environment } = requireEnvironment(req.user!.id, req.params.envId, 'developer');
    const count = db.prepare('SELECT COUNT(*) AS c FROM environments WHERE project_id = ?').get(environment.project_id) as any;
    if (count.c <= 1) throw conflict('A project needs at least one environment');
    const services = db.prepare('SELECT COUNT(*) AS c FROM services WHERE environment_id = ?').get(environment.id) as any;
    if (services.c > 0) throw conflict('Move or delete the services in this environment first');
    db.prepare('DELETE FROM environments WHERE id = ?').run(environment.id);
    res.json({ ok: true });
  }),
);

/* --------------------------- environment variables ------------------------- */

projectRouter.get(
  '/:id/variables',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    const environmentId = req.query.environmentId ? String(req.query.environmentId) : null;
    const serviceId = req.query.serviceId ? String(req.query.serviceId) : null;
    const rows = db
      .prepare(
        `SELECT id, key, is_secret, service_id, environment_id, updated_at FROM environment_variables
          WHERE project_id = ?
            AND (? IS NULL OR environment_id = ?)
            AND (? IS NULL OR service_id = '' OR service_id = ?)
          ORDER BY key ASC`,
      )
      .all(project.id, environmentId, environmentId, serviceId, serviceId);
    res.json({ variables: rows, revealAllowed: role === 'owner' || role === 'admin' });
  }),
);

projectRouter.post(
  '/:id/variables',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'manage variables');
    const body = parse(
      z.object({
        environmentId: z.string().min(1),
        serviceId: z.string().nullable().optional(),
        variables: z
          .array(
            z.object({
              key: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid variable name'),
              value: z.string().max(20000),
              isSecret: z.boolean().optional().default(false),
            }),
          )
          .min(1)
          .max(200),
      }),
      req.body,
    );
    const { environment } = requireEnvironment(req.user!.id, body.environmentId, 'developer');
    if (environment.project_id !== project.id) throw notFound('Environment not found');
    const now = nowIso();
    const upsert = db.prepare(
      `INSERT INTO environment_variables (id, project_id, environment_id, service_id, key, value_encrypted, is_secret, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (environment_id, service_id, key) DO UPDATE SET
         value_encrypted = excluded.value_encrypted,
         is_secret = excluded.is_secret,
         updated_at = excluded.updated_at`,
    );
    const keys: string[] = [];
    db.transaction(() => {
      for (const v of body.variables) {
        upsert.run(
          randomToken(12),
          project.id,
          environment.id,
          body.serviceId ?? '',
          v.key,
          encryptSecret(v.value),
          v.isSecret ? 1 : 0,
          req.user!.id,
          now,
          now,
        );
        keys.push(v.key);
      }
    })();
    logActivity({
      workspaceId: project.workspace_id,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'variables.saved',
      targetType: 'environment',
      targetId: environment.id,
      metadata: { count: keys.length, keys },
    });
    audit({
      workspaceId: project.workspace_id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'variables.saved',
      targetType: 'environment',
      targetId: environment.id,
      metadata: { keys },
      ip: req.ip,
    });
    res.json({ saved: keys.length, keys });
  }),
);

projectRouter.post(
  '/:id/variables/:varId/reveal',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    if (role !== 'owner' && role !== 'admin') {
      throw forbidden('Only workspace admins can reveal secret values');
    }
    const row = db
      .prepare('SELECT * FROM environment_variables WHERE id = ? AND project_id = ?')
      .get(req.params.varId, project.id) as any;
    if (!row) throw notFound('Variable not found');
    audit({
      workspaceId: project.workspace_id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'variable.revealed',
      targetType: 'variable',
      targetId: row.id,
      metadata: { key: row.key },
      ip: req.ip,
    });
    res.json({ id: row.id, key: row.key, value: decryptSecret(row.value_encrypted) });
  }),
);

projectRouter.get(
  '/:id/variables/export',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    if (role !== 'owner' && role !== 'admin') {
      throw forbidden('Only workspace admins can export secret values');
    }
    const environmentId = String(req.query.environmentId || '');
    const rows = db
      .prepare('SELECT key, value_encrypted FROM environment_variables WHERE project_id = ? AND environment_id = ?')
      .all(project.id, environmentId) as any[];
    audit({
      workspaceId: project.workspace_id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'variables.exported',
      targetType: 'environment',
      targetId: environmentId,
      metadata: { count: rows.length },
      ip: req.ip,
    });
    res
      .type('text/plain')
      .send(rows.map((r) => `${r.key}=${decryptSecret(r.value_encrypted)}`).join('\n'));
  }),
);

projectRouter.delete(
  '/:id/variables/:varId',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'delete variables');
    const row = db
      .prepare('SELECT * FROM environment_variables WHERE id = ? AND project_id = ?')
      .get(req.params.varId, project.id) as any;
    if (!row) throw notFound('Variable not found');
    db.prepare('DELETE FROM environment_variables WHERE id = ?').run(row.id);
    logActivity({
      workspaceId: project.workspace_id,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'variable.deleted',
      targetType: 'variable',
      targetId: row.id,
      metadata: { key: row.key },
    });
    res.json({ ok: true });
  }),
);

/* -------------------------------- databases -------------------------------- */

projectRouter.get(
  '/:id/databases',
  route(async (req, res) => {
    const { project } = requireProject(req.user!.id, req.params.id, 'viewer');
    res.json({
      databases: db
        .prepare(
          `SELECT id, project_id, environment_id, name, engine, status, provider, provider_service_id,
                  connection_host, connection_port, connection_db, connection_user, error_message,
                  created_at, updated_at
             FROM databases WHERE project_id = ? ORDER BY created_at ASC`,
        )
        .all(project.id),
    });
  }),
);

projectRouter.post(
  '/:id/databases',
  route(async (req, res) => {
    const { project, role } = requireProject(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'provision databases');
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(60),
        engine: z.enum(['postgres', 'mysql', 'redis', 'mongodb']),
        environmentId: z.string().min(1),
      }),
      req.body,
    );
    const spec = DB_SPECS[body.engine];
    const { environment } = requireEnvironment(req.user!.id, body.environmentId, 'developer');
    if (environment.project_id !== project.id) throw notFound('Environment not found');

    // Provisioning requires the workspace's own connected provider. There is no
    // shared POMP NET infrastructure and no simulated instance.
    const ctx = requireProviderConnection(project.workspace_id, 'railway');

    const password = randomToken(24);
    const id = randomToken(12);
    const now = nowIso();
    db.prepare(
      `INSERT INTO databases (id, project_id, environment_id, name, engine, status, provider,
         connection_user, connection_db, connection_port, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'provisioning', 'railway', ?, ?, ?, ?, ?)`,
    ).run(id, project.id, environment.id, body.name, body.engine, spec.user, spec.db, spec.port, now, now);

    try {
      const providerProject = await ctx.adapter.createProject(
        ctx.token,
        `POMP NET · ${project.name} · ${body.name}`,
      );
      const providerEnv = await ctx.adapter.ensureEnvironment(ctx.token, providerProject.id, environment.name);
      const created = await ctx.adapter.createService(ctx.token, {
        projectId: providerProject.id,
        environmentId: providerEnv.id,
        name: body.name,
        image: spec.image,
      });
      await ctx.adapter.upsertVariables(ctx.token, {
        projectId: providerProject.id,
        environmentId: providerEnv.id,
        serviceId: created.id,
        variables: { [spec.passwordKey]: password },
      });
      const triggered = await ctx.adapter.triggerDeployment(ctx.token, {
        serviceId: created.id,
        environmentId: providerEnv.id,
      });
      db.prepare(
        `UPDATE databases SET provider_project_id = ?, provider_environment_id = ?, provider_service_id = ?,
           connection_password_encrypted = ?, updated_at = ? WHERE id = ?`,
      ).run(providerProject.id, providerEnv.id, created.id, encryptSecret(password), nowIso(), id);
      db.prepare(
        `INSERT INTO environment_variables (id, project_id, environment_id, service_id, key, value_encrypted, is_secret, created_by, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, 1, ?, ?, ?)`,
      ).run(
        randomToken(12),
        project.id,
        environment.id,
        `${body.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_PASSWORD`,
        encryptSecret(password),
        req.user!.id,
        nowIso(),
        nowIso(),
      );
      recordUsage({
        workspaceId: project.workspace_id,
        projectId: project.id,
        metric: 'database_provisioned',
        value: 1,
        unit: 'count',
        source: 'pompnet',
      });
      logActivity({
        workspaceId: project.workspace_id,
        projectId: project.id,
        actorId: req.user!.id,
        actorName: req.user!.name,
        action: 'database.provisioning',
        targetType: 'database',
        targetId: id,
        metadata: { engine: body.engine, providerServiceId: created.id, providerDeploymentId: triggered.deploymentId },
      });
    } catch (err: any) {
      db.prepare(`UPDATE databases SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?`).run(
        String(err?.message ?? err),
        nowIso(),
        id,
      );
      throw err;
    }
    res.status(201).json({
      database: db
        .prepare(
          `SELECT id, project_id, environment_id, name, engine, status, provider, provider_service_id, created_at
             FROM databases WHERE id = ?`,
        )
        .get(id),
      note:
        'Provisioning started through your connected provider. The status becomes ready only when the provider reports the instance healthy, and the password is stored encrypted on the server.',
    });
  }),
);

projectRouter.delete(
  '/:id/databases/:dbId',
  route(async (req, res) => {
    const { project } = requireProject(req.user!.id, req.params.id, 'viewer');
    const { database } = requireDatabase(req.user!.id, req.params.dbId, 'admin');
    if (database.project_id !== project.id) throw notFound('Database not found');
    if (String(req.query.confirm || '') !== database.name) {
      throw conflict(`Type the database name "${database.name}" to confirm deletion`);
    }
    db.prepare('DELETE FROM databases WHERE id = ?').run(database.id);
    audit({
      workspaceId: project.workspace_id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'database.record_deleted',
      targetType: 'database',
      targetId: database.id,
      metadata: { providerServiceId: database.provider_service_id },
      ip: req.ip,
    });
    res.json({
      ok: true,
      note: database.provider_service_id
        ? 'POMP NET removed its record. The instance still exists in your provider account — delete it there to stop provider billing.'
        : undefined,
    });
  }),
);
