import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { assertWorkspaceAccess, requireAuth } from '../lib/auth.js';
import { audit, logActivity } from '../lib/audit.js';
import { ApiError, conflict, notFound, nowIso, parse, route, slugify, unavailable } from '../lib/http.js';
import { randomToken } from '../lib/crypto.js';
import { rateLimit } from '../lib/rateLimit.js';
import { requireService } from '../lib/access.js';
import { requireProviderConnection } from '../providers/index.js';
import { mapStatus } from '../providers/railway.js';
import type { ProviderContext } from '../providers/index.js';

/**
 * Real Railway integration surface. Every mutation below is executed against the
 * connected account's Railway API; nothing is simulated. Local rows only mirror
 * the provider ids so the dashboard can show history and status.
 */
export const railwayRouter = Router();
railwayRouter.use(requireAuth);

/** Public images that can be deployed as-is; no template is listed without a real image. */
const PANEL_PRESETS = [
  {
    slug: '3x-ui',
    name: '3x-ui',
    image: 'ghcr.io/mhsanaei/3x-ui:latest',
    port: 2053,
    category: 'panel',
    fa: 'پنل مدیریت Xray با رابط وب',
    en: 'Xray web admin panel',
    variables: [] as Array<{ key: string; value: string; secret: boolean }>,
  },
  {
    slug: 'marzban',
    name: 'Marzban',
    image: 'gozargah/marzban:latest',
    port: 8000,
    category: 'panel',
    fa: 'پنل مدیریت Marzban',
    en: 'Marzban management panel',
    variables: [
      { key: 'SUDO_USERNAME', value: 'admin', secret: false },
      { key: 'SUDO_PASSWORD', value: '', secret: true },
    ],
  },
  {
    slug: 'nginx',
    name: 'Nginx',
    image: 'nginx:alpine',
    port: 80,
    category: 'web',
    fa: 'وب‌سرور Nginx',
    en: 'Nginx web server',
    variables: [],
  },
  {
    slug: 'node',
    name: 'Node.js',
    image: 'node:22-alpine',
    port: 3000,
    category: 'runtime',
    fa: 'زمان اجرای Node.js',
    en: 'Node.js runtime',
    variables: [],
  },
  {
    slug: 'postgres',
    name: 'PostgreSQL',
    image: 'postgres:17-alpine',
    port: 5432,
    category: 'database',
    fa: 'پایگاه داده PostgreSQL',
    en: 'PostgreSQL database',
    variables: [{ key: 'POSTGRES_PASSWORD', value: '', secret: true }],
  },
  {
    slug: 'redis',
    name: 'Redis',
    image: 'redis:7-alpine',
    port: 6379,
    category: 'cache',
    fa: 'کش Redis',
    en: 'Redis cache',
    variables: [],
  },
];

const workspaceRef = z.object({ workspaceId: z.string().min(1) });

function ctxFor(workspaceId: string): ProviderContext {
  return requireProviderConnection(workspaceId, 'railway');
}

function providerError(err: unknown): never {
  if (err instanceof ApiError) throw err;
  const message = err instanceof Error ? err.message : 'Railway request failed';
  throw new ApiError(502, 'provider_error', `Railway API error: ${message}`);
}

/* ------------------------------ local mirroring ----------------------------- */

function ensureLocalProject(
  workspaceId: string,
  userId: string,
  providerProjectId: string,
  name: string,
) {
  const existing = db
    .prepare(
      `SELECT p.* FROM projects p
       JOIN services s ON s.project_id = p.id
       WHERE p.workspace_id = ? AND s.provider = 'railway' AND s.provider_project_id = ?
       LIMIT 1`,
    )
    .get(workspaceId, providerProjectId) as any;
  if (existing) return existing;

  const base = slugify(name) || 'railway-project';
  let slug = base;
  let suffix = 1;
  while (db.prepare('SELECT 1 FROM projects WHERE workspace_id = ? AND slug = ?').get(workspaceId, slug)) {
    slug = `${base}-${++suffix}`;
  }
  const id = randomToken(12);
  const now = nowIso();
  db.prepare(
    `INSERT INTO projects (id, workspace_id, name, slug, description, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspaceId, name, slug, 'Imported from Railway', userId, now, now);
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
}

function environmentKind(name: string): 'production' | 'staging' | 'development' | 'custom' {
  const lower = name.toLowerCase();
  if (lower === 'production') return 'production';
  if (lower === 'staging') return 'staging';
  if (lower === 'development') return 'development';
  return 'custom';
}

function ensureLocalEnvironment(projectId: string, providerEnvironmentId: string, name: string) {
  const slug = slugify(name) || providerEnvironmentId.slice(0, 8);
  const existing = db
    .prepare('SELECT * FROM environments WHERE project_id = ? AND slug = ?')
    .get(projectId, slug) as any;
  if (existing) return existing;
  const id = randomToken(12);
  db.prepare(
    `INSERT INTO environments (id, project_id, name, slug, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, name, slug, environmentKind(name), nowIso());
  return db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as any;
}

function mirrorService(input: {
  projectId: string;
  environmentId: string;
  name: string;
  providerProjectId: string;
  providerEnvironmentId: string;
  providerServiceId: string;
  image?: string | null;
  repo?: string | null;
  branch?: string | null;
  buildCommand?: string | null;
  startCommand?: string | null;
  rootDirectory?: string | null;
  status?: string;
}) {
  const existing = db
    .prepare(`SELECT * FROM services WHERE provider_service_id = ? LIMIT 1`)
    .get(input.providerServiceId) as any;
  const now = nowIso();
  if (existing) {
    db.prepare(`UPDATE services SET status = ?, updated_at = ? WHERE id = ?`).run(
      input.status ?? existing.status,
      now,
      existing.id,
    );
    return { ...existing, status: input.status ?? existing.status };
  }
  const id = randomToken(12);
  db.prepare(
    `INSERT INTO services (
       id, project_id, environment_id, name, source_type, repo_full_name, branch, root_directory,
       docker_image, build_command, start_command, healthcheck_path, auto_deploy, provider,
       provider_project_id, provider_environment_id, provider_service_id, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.environmentId,
    input.name,
    input.repo ? 'github' : 'docker_image',
    input.repo ?? null,
    input.branch ?? null,
    input.rootDirectory ?? '/',
    input.image ?? null,
    input.buildCommand ?? null,
    input.startCommand ?? null,
    '/',
    0,
    'railway',
    input.providerProjectId,
    input.providerEnvironmentId,
    input.providerServiceId,
    input.status ?? 'created',
    now,
    now,
  );
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id) as any;
}

function mirrorDeployment(input: {
  projectId: string;
  serviceId: string;
  environmentId: string;
  providerDeploymentId: string;
  status: string;
  trigger?: 'manual' | 'github_push' | 'rollback' | 'redeploy';
  createdBy?: string | null;
  error?: string | null;
}) {
  const mapped = mapStatus(input.status);
  const existing = db
    .prepare('SELECT * FROM deployments WHERE provider_deployment_id = ? LIMIT 1')
    .get(input.providerDeploymentId) as any;
  const now = nowIso();
  if (existing) {
    db.prepare('UPDATE deployments SET status = ?, error_message = ?, updated_at = ? WHERE id = ?').run(
      mapped,
      input.error ?? null,
      now,
      existing.id,
    );
    return { ...existing, status: mapped };
  }
  const id = randomToken(12);
  db.prepare(
    `INSERT INTO deployments (
       id, project_id, service_id, environment_id, status, trigger, provider,
       provider_deployment_id, error_message, created_by, started_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.serviceId,
    input.environmentId,
    mapped,
    input.trigger ?? 'manual',
    'railway',
    input.providerDeploymentId,
    input.error ?? null,
    input.createdBy ?? null,
    now,
    now,
    now,
  );
  return db.prepare('SELECT * FROM deployments WHERE id = ?').get(id) as any;
}

/* --------------------------------- endpoints -------------------------------- */

railwayRouter.get(
  '/overview',
  route(async (req, res) => {
    const { workspaceId } = parse(workspaceRef, req.query);
    const role = assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    const row = db
      .prepare('SELECT status, account_name, account_email, last_checked_at FROM provider_connections WHERE workspace_id = ? AND provider = ?')
      .get(workspaceId, 'railway') as any;

    const connection = row
      ? {
          connected: row.status === 'connected',
          status: row.status,
          accountName: row.account_name,
          accountEmail: row.account_email,
          lastCheckedAt: row.last_checked_at,
        }
      : null;

    let projects: Array<{ id: string; name: string; imported: boolean }> = [];
    let projectsError: string | null = null;

    if (connection?.connected) {
      try {
        const ctx = ctxFor(workspaceId);
        const list = await ctx.adapter.listProjects(ctx.token);
        const imported = new Set(
          (
            db
              .prepare(
                `SELECT DISTINCT s.provider_project_id FROM services s
                 JOIN projects p ON p.id = s.project_id
                 WHERE p.workspace_id = ? AND s.provider = 'railway'`,
              )
              .all(workspaceId) as Array<{ provider_project_id: string }>
          ).map((r) => r.provider_project_id),
        );
        projects = list.map((p) => ({ ...p, imported: imported.has(p.id) }));
      } catch (err) {
        projectsError = err instanceof Error ? err.message : 'Railway request failed';
      }
    }

    res.json({
      provider: 'railway',
      role,
      connection,
      projects,
      projectsError,
      presets: PANEL_PRESETS,
      capabilities: ctxCapabilities(),
      note: connection?.connected
        ? 'Projects and deployments come from your connected Railway account.'
        : 'Connect your own Railway token in Settings → Providers to enable real deployments.',
    });
  }),
);

function ctxCapabilities() {
  return {
    stopService: false,
    resourceMetrics: false,
    rollback: true,
    managedDatabases: false,
    reasons: {
      stopService: 'The Railway public API exposes deploy/delete but not a stop mutation; use delete or redeploy instead.',
      resourceMetrics: 'Railway does not expose historical CPU/memory series through the public API, so no metrics are shown.',
      managedDatabases: 'Railway has no database provisioning mutation; databases are deployable only as container images.',
    },
  };
}

railwayRouter.get(
  '/projects/:providerProjectId',
  route(async (req, res) => {
    const { workspaceId } = parse(workspaceRef, req.query);
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    const ctx = ctxFor(workspaceId);
    try {
      const detail = await ctx.adapter.getProjectDetails(ctx.token, req.params.providerProjectId);
      res.json({ project: detail });
    } catch (err) {
      providerError(err);
    }
  }),
);

railwayRouter.post(
  '/import',
  route(async (req, res) => {
    const body = parse(
      workspaceRef.extend({ providerProjectId: z.string().min(1) }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'admin');
    const ctx = ctxFor(body.workspaceId);
    rateLimit(`railway-import:${req.user!.id}`, 10, 60_000);

    let detail;
    try {
      detail = await ctx.adapter.getProjectDetails(ctx.token, body.providerProjectId);
    } catch (err) {
      providerError(err);
    }

    const project = ensureLocalProject(body.workspaceId, req.user!.id, detail.id, detail.name);
    let importedEnvironments = 0;
    let importedServices = 0;
    const defaultEnv = detail.environments[0] ?? null;

    for (const env of detail.environments) {
      ensureLocalEnvironment(project.id, env.id, env.name);
      importedEnvironments += 1;
    }
    for (const service of detail.services) {
      if (!defaultEnv) break;
      const localEnv = ensureLocalEnvironment(project.id, defaultEnv.id, defaultEnv.name);
      let instance = null;
      try {
        instance = await ctx.adapter.getServiceInstance(ctx.token, {
          serviceId: service.id,
          environmentId: defaultEnv.id,
        });
      } catch {
        instance = null;
      }
      mirrorService({
        projectId: project.id,
        environmentId: localEnv.id,
        name: service.name,
        providerProjectId: detail.id,
        providerEnvironmentId: defaultEnv.id,
        providerServiceId: service.id,
        image: instance?.source.image ?? null,
        repo: instance?.source.repo ?? null,
        status: 'created',
      });
      importedServices += 1;
    }

    logActivity({
      workspaceId: body.workspaceId,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.email,
      action: 'railway.project.imported',
      targetType: 'project',
      targetId: project.id,
      metadata: { providerProjectId: detail.id, services: importedServices },
    });
    audit({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'railway.import',
      targetType: 'project',
      targetId: project.id,
      ip: req.ip,
      metadata: { providerProjectId: detail.id },
    });

    res.status(201).json({
      projectId: project.id,
      providerProjectId: detail.id,
      environments: importedEnvironments,
      services: importedServices,
    });
  }),
);

railwayRouter.post(
  '/deploy',
  route(async (req, res) => {
    const body = parse(
      workspaceRef.extend({
        providerProjectId: z.string().min(1),
        providerEnvironmentId: z.string().min(1),
        name: z.string().min(1).max(60),
        image: z.string().min(3).max(200),
        port: z.number().int().min(1).max(65535).optional(),
        variables: z.record(z.string(), z.string()).optional(),
        buildCommand: z.string().max(500).optional(),
        startCommand: z.string().max(500).optional(),
        createDomain: z.boolean().optional(),
      }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    rateLimit(`railway-deploy:${req.user!.id}`, 10, 60_000);
    const ctx = ctxFor(body.workspaceId);

    let serviceId: string;
    try {
      const created = await ctx.adapter.createService(ctx.token, {
        projectId: body.providerProjectId,
        environmentId: body.providerEnvironmentId,
        name: body.name,
        image: body.image,
      });
      serviceId = created.id;
      if (body.buildCommand || body.startCommand) {
        await ctx.adapter.updateServiceInstance(ctx.token, {
          serviceId,
          environmentId: body.providerEnvironmentId,
          buildCommand: body.buildCommand ?? undefined,
          startCommand: body.startCommand ?? undefined,
        });
      }
      if (body.variables && Object.keys(body.variables).length) {
        await ctx.adapter.upsertVariables(ctx.token, {
          projectId: body.providerProjectId,
          environmentId: body.providerEnvironmentId,
          serviceId,
          variables: body.variables,
        });
      }
    } catch (err) {
      providerError(err);
    }

    let deploymentId: string | null = null;
    let deployError: string | null = null;
    try {
      const started = await ctx.adapter.triggerDeployment(ctx.token, {
        serviceId,
        environmentId: body.providerEnvironmentId,
      });
      deploymentId = started.deploymentId;
    } catch (err) {
      deployError = err instanceof Error ? err.message : 'Railway rejected the deployment';
    }

    let domain: { id: string | null; domain: string } | null = null;
    let domainError: string | null = null;
    if (body.createDomain) {
      try {
        domain = await ctx.adapter.createServiceDomain(ctx.token, {
          serviceId,
          environmentId: body.providerEnvironmentId,
        });
      } catch (err) {
        domainError = err instanceof Error ? err.message : 'Railway did not return a domain';
      }
    }

    const project = ensureLocalProject(
      body.workspaceId,
      req.user!.id,
      body.providerProjectId,
      body.name,
    );
    const localEnv = ensureLocalEnvironment(project.id, body.providerEnvironmentId, 'production');
    const localService = mirrorService({
      projectId: project.id,
      environmentId: localEnv.id,
      name: body.name,
      providerProjectId: body.providerProjectId,
      providerEnvironmentId: body.providerEnvironmentId,
      providerServiceId: serviceId,
      image: body.image,
      buildCommand: body.buildCommand ?? null,
      startCommand: body.startCommand ?? null,
      status: deployError ? 'failed' : 'deploying',
    });
    const deployment = deploymentId
      ? mirrorDeployment({
          projectId: project.id,
          serviceId: localService.id,
          environmentId: localEnv.id,
          providerDeploymentId: deploymentId,
          status: 'queued',
          createdBy: req.user!.id,
          error: deployError,
        })
      : null;

    logActivity({
      workspaceId: body.workspaceId,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.email,
      action: 'railway.service.deploy_requested',
      targetType: 'service',
      targetId: localService.id,
      metadata: { image: body.image, providerServiceId: serviceId, deploymentId },
    });

    res.status(201).json({
      service: {
        id: localService.id,
        providerServiceId: serviceId,
        providerProjectId: body.providerProjectId,
        providerEnvironmentId: body.providerEnvironmentId,
      },
      deployment: deployment ? { id: deployment.id, providerDeploymentId: deploymentId } : null,
      deployError,
      domain,
      domainError,
    });
  }),
);

railwayRouter.get(
  '/services',
  route(async (req, res) => {
    const { workspaceId } = parse(workspaceRef, req.query);
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    const services = db
      .prepare(
        `SELECT s.id, s.name, s.status, s.provider_project_id, s.provider_environment_id,
                s.provider_service_id, s.docker_image, s.repo_full_name, s.created_at, s.updated_at,
                p.id AS project_id, p.name AS project_name
         FROM services s
         JOIN projects p ON p.id = s.project_id
         WHERE p.workspace_id = ? AND s.provider = 'railway'
         ORDER BY s.created_at DESC`,
      )
      .all(workspaceId);
    res.json({ services, capabilities: ctxCapabilities() });
  }),
);

railwayRouter.get(
  '/services/:serviceId/status',
  route(async (req, res) => {
    const { workspaceId } = parse(workspaceRef, req.query);
    const { service } = requireService(req.user!.id, req.params.serviceId, 'viewer');
    const ctx = ctxFor(service.project_id ? workspaceId : workspaceId);
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');

    if (!service.provider_service_id || !service.provider_environment_id) {
      throw unavailable('This service is not linked to a Railway service yet.');
    }

    try {
      const deployments = await ctx.adapter.listDeployments(ctx.token, {
        projectId: service.provider_project_id!,
        environmentId: service.provider_environment_id,
        serviceId: service.provider_service_id,
        limit: 10,
      });
      const instance = await ctx.adapter.getServiceInstance(ctx.token, {
        serviceId: service.provider_service_id,
        environmentId: service.provider_environment_id,
      });
      const latest = deployments[0] ?? null;
      let logs: Array<{ ts: string; stream: string; level: string; message: string }> = [];
      let logsError: string | null = null;
      if (latest) {
        try {
          logs = await ctx.adapter.fetchDeploymentLogs(ctx.token, latest.id);
        } catch (err) {
          logsError = err instanceof Error ? err.message : 'Railway did not return logs';
        }
      }

      for (const dep of deployments) {
        mirrorDeployment({
          projectId: service.project_id,
          serviceId: service.id,
          environmentId: service.environment_id,
          providerDeploymentId: dep.id,
          status: dep.rawStatus,
        });
      }
      if (latest) {
        db.prepare('UPDATE services SET status = ?, updated_at = ? WHERE id = ?').run(
          latest.status === 'running' ? 'running' : latest.status === 'failed' ? 'failed' : 'deploying',
          nowIso(),
          service.id,
        );
      }

      res.json({ deployments, instance, logs, logsError, capabilities: ctxCapabilities() });
    } catch (err) {
      providerError(err);
    }
  }),
);

railwayRouter.post(
  '/services/:serviceId/redeploy',
  route(async (req, res) => {
    const body = parse(workspaceRef, req.body);
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    const { service } = requireService(req.user!.id, req.params.serviceId, 'developer');
    const ctx = ctxFor(body.workspaceId);
    if (!service.provider_service_id || !service.provider_environment_id) {
      throw unavailable('This service is not linked to a Railway service.');
    }
    rateLimit(`railway-redeploy:${req.user!.id}`, 15, 60_000);

    try {
      const result = await ctx.adapter.redeploy(ctx.token, {
        serviceId: service.provider_service_id,
        environmentId: service.provider_environment_id,
      });
      mirrorDeployment({
        projectId: service.project_id,
        serviceId: service.id,
        environmentId: service.environment_id,
        providerDeploymentId: result.deploymentId,
        status: 'queued',
        trigger: 'redeploy',
        createdBy: req.user!.id,
      });
      logActivity({
        workspaceId: body.workspaceId,
        projectId: service.project_id,
        actorId: req.user!.id,
        actorName: req.user!.email,
        action: 'railway.service.redeployed',
        targetType: 'service',
        targetId: service.id,
        metadata: { deploymentId: result.deploymentId },
      });
      res.json({ deploymentId: result.deploymentId });
    } catch (err) {
      providerError(err);
    }
  }),
);

railwayRouter.post(
  '/services/:serviceId/rollback',
  route(async (req, res) => {
    const body = parse(workspaceRef.extend({ deploymentId: z.string().min(1) }), req.body);
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    const { service } = requireService(req.user!.id, req.params.serviceId, 'developer');
    const ctx = ctxFor(body.workspaceId);
    if (!service.provider_service_id || !service.provider_environment_id) {
      throw unavailable('This service is not linked to a Railway service.');
    }

    try {
      const result = await ctx.adapter.rollbackTo(ctx.token, body.deploymentId);
      mirrorDeployment({
        projectId: service.project_id,
        serviceId: service.id,
        environmentId: service.environment_id,
        providerDeploymentId: result.deploymentId ?? body.deploymentId,
        status: 'queued',
        trigger: 'rollback',
        createdBy: req.user!.id,
      });
      audit({
        workspaceId: body.workspaceId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'railway.rollback',
        targetType: 'deployment',
        targetId: body.deploymentId,
        ip: req.ip,
        metadata: { serviceId: service.id },
      });
      res.json({ deploymentId: result.deploymentId });
    } catch (err) {
      providerError(err);
    }
  }),
);

railwayRouter.post(
  '/services/:serviceId/domain',
  route(async (req, res) => {
    const body = parse(workspaceRef, req.body);
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    const { service } = requireService(req.user!.id, req.params.serviceId, 'developer');
    const ctx = ctxFor(body.workspaceId);
    if (!service.provider_service_id || !service.provider_environment_id) {
      throw unavailable('This service is not linked to a Railway service.');
    }
    try {
      const domain = await ctx.adapter.createServiceDomain(ctx.token, {
        serviceId: service.provider_service_id,
        environmentId: service.provider_environment_id,
      });
      res.status(201).json({ domain });
    } catch (err) {
      providerError(err);
    }
  }),
);

railwayRouter.post(
  '/services/:serviceId/variables',
  route(async (req, res) => {
    const body = parse(
      workspaceRef.extend({ variables: z.record(z.string(), z.string()) }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    const { service } = requireService(req.user!.id, req.params.serviceId, 'developer');
    const ctx = ctxFor(body.workspaceId);
    if (!service.provider_service_id || !service.provider_environment_id) {
      throw unavailable('This service is not linked to a Railway service.');
    }
    try {
      await ctx.adapter.upsertVariables(ctx.token, {
        projectId: service.provider_project_id!,
        environmentId: service.provider_environment_id,
        serviceId: service.provider_service_id,
        variables: body.variables,
      });
      logActivity({
        workspaceId: body.workspaceId,
        projectId: service.project_id,
        actorId: req.user!.id,
        actorName: req.user!.email,
        action: 'railway.variables.updated',
        targetType: 'service',
        targetId: service.id,
        metadata: { keys: Object.keys(body.variables) },
      });
      res.json({ updated: Object.keys(body.variables).length });
    } catch (err) {
      providerError(err);
    }
  }),
);

railwayRouter.delete(
  '/services/:serviceId',
  route(async (req, res) => {
    const { workspaceId } = parse(workspaceRef, req.query);
    assertWorkspaceAccess(req.user!.id, workspaceId, 'admin');
    const { service } = requireService(req.user!.id, req.params.serviceId, 'admin');
    const ctx = ctxFor(workspaceId);
    if (!service.provider_service_id) {
      throw unavailable('This service is not linked to a Railway service.');
    }
    try {
      await ctx.adapter.deleteService(ctx.token, service.provider_service_id);
      db.prepare('DELETE FROM services WHERE id = ?').run(service.id);
      audit({
        workspaceId,
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'railway.service.deleted',
        targetType: 'service',
        targetId: service.id,
        ip: req.ip,
        metadata: { providerServiceId: service.provider_service_id },
      });
      res.json({ deleted: true });
    } catch (err) {
      providerError(err);
    }
  }),
);
