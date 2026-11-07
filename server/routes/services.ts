import { Router } from 'express';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { requireAuth } from '../lib/auth.js';
import { assertCanWrite, requireProject, requireService } from '../lib/access.js';
import { audit, logActivity } from '../lib/audit.js';
import { ApiError, conflict, forbidden, notFound, nowIso, parse, route } from '../lib/http.js';
import { randomToken } from '../lib/crypto.js';
import { requireProviderConnection } from '../providers/index.js';
import {
  deploymentWithLogs,
  recordUsage,
  startDeployment,
  syncDeployment,
} from '../services/deployments.js';

export const serviceRouter = Router();
serviceRouter.use(requireAuth);

/**
 * A service always deploys into a concrete environment. Legacy rows may have a
 * null environment_id, so fall back to the project's first environment.
 */
function resolveEnvironmentId(service: { project_id: string; environment_id: string | null }): string {
  if (service.environment_id) return service.environment_id;
  const fallback = db
    .prepare('SELECT id FROM environments WHERE project_id = ? ORDER BY created_at ASC LIMIT 1')
    .get(service.project_id) as { id: string } | undefined;
  if (!fallback) throw notFound('No environment available for this project');
  return fallback.id;
}

function providerCapabilities(workspaceId: string) {
  const row = db
    .prepare(`SELECT id, label, account_name, created_at, last_verified_at FROM provider_connections
               WHERE workspace_id = ? AND provider = 'railway'`)
    .get(workspaceId) as any;
  const ctx = row ? requireProviderConnection(workspaceId, 'railway') : null;
  return {
    connected: Boolean(row),
    connection: row ?? null,
    capabilities: ctx
      ? ctx.adapter.capabilities
      : { stopService: false, resourceMetrics: false, rollback: false, managedDatabases: false },
  };
}

/* --------------------------------- services -------------------------------- */

serviceRouter.get(
  '/',
  route(async (req, res) => {
    const projectId = String(req.query.projectId || '');
    const { project, role } = requireProject(req.user!.id, projectId, 'viewer');
    const services = db
      .prepare(
        `SELECT s.*,
                (SELECT status FROM deployments d WHERE d.service_id = s.id ORDER BY d.created_at DESC LIMIT 1) AS last_deployment_status,
                (SELECT created_at FROM deployments d WHERE d.service_id = s.id ORDER BY d.created_at DESC LIMIT 1) AS last_deployment_at,
                (SELECT COUNT(*) FROM deployments d WHERE d.service_id = s.id) AS deployment_count
           FROM services s WHERE s.project_id = ? ORDER BY s.created_at ASC`,
      )
      .all(project.id);
    res.json({ services, role });
  }),
);

serviceRouter.post(
  '/',
  route(async (req, res) => {
    const body = parse(
      z.object({
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        name: z.string().trim().min(2).max(60),
        sourceType: z.enum(['github', 'docker_image', 'template']),
        repoFullName: z.string().trim().max(140).optional(),
        branch: z.string().trim().max(120).optional(),
        dockerImage: z.string().trim().max(200).optional(),
        templateSlug: z.string().trim().max(80).optional(),
        rootDirectory: z.string().trim().max(200).optional(),
        buildCommand: z.string().trim().max(500).optional(),
        startCommand: z.string().trim().max(500).optional(),
        healthcheckPath: z.string().trim().max(200).optional(),
        autoDeploy: z.boolean().optional().default(false),
      }),
      req.body,
    );
    const { project, role } = requireProject(req.user!.id, body.projectId, 'viewer');
    assertCanWrite(role, 'create services');
    const environment = db
      .prepare('SELECT * FROM environments WHERE id = ? AND project_id = ?')
      .get(body.environmentId, project.id);
    if (!environment) throw notFound('Environment not found');

    if (body.sourceType === 'github' && !body.repoFullName) {
      throw conflict('A GitHub service needs a repository (owner/name)');
    }
    if (body.sourceType === 'docker_image' && !body.dockerImage) {
      throw conflict('A Docker service needs an image reference');
    }
    if (body.sourceType === 'template' && !body.templateSlug) {
      throw conflict('A template service needs a template slug');
    }

    const id = randomToken(12);
    const now = nowIso();
    db.prepare(
      `INSERT INTO services (id, project_id, environment_id, name, source_type, repo_full_name, branch,
         docker_image, template_slug, root_directory, build_command, start_command, healthcheck_path,
         auto_deploy, webhook_secret, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      project.id,
      body.environmentId,
      body.name,
      body.sourceType,
      body.repoFullName ?? null,
      body.branch ?? null,
      body.dockerImage ?? null,
      body.templateSlug ?? null,
      body.rootDirectory ?? null,
      body.buildCommand ?? null,
      body.startCommand ?? null,
      body.healthcheckPath ?? null,
      body.autoDeploy ? 1 : 0,
      randomToken(24),
      req.user!.id,
      now,
      now,
    );
    logActivity({
      workspaceId: project.workspace_id,
      projectId: project.id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'service.created',
      targetType: 'service',
      targetId: id,
      metadata: { name: body.name, sourceType: body.sourceType },
    });
    res.status(201).json({ service: db.prepare('SELECT * FROM services WHERE id = ?').get(id) });
  }),
);

serviceRouter.get(
  '/:id',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    const provider = providerCapabilities(project.workspace_id);
    const domains = db
      .prepare('SELECT * FROM domains WHERE service_id = ? ORDER BY created_at ASC')
      .all(service.id);
    const deployments = db
      .prepare(
        `SELECT id, status, trigger, commit_sha, commit_message, commit_author, created_at, started_at,
                finished_at, error_message, provider_deployment_id
           FROM deployments WHERE service_id = ? ORDER BY created_at DESC LIMIT 20`,
      )
      .all(service.id);
    res.json({
      service,
      project,
      role,
      domains,
      deployments,
      provider,
      webhookUrl: `${process.env.APP_URL || ''}/api/webhooks/github/${service.id}`,
    });
  }),
);

serviceRouter.patch(
  '/:id',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'edit services');
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(60).optional(),
        branch: z.string().trim().max(120).nullable().optional(),
        repoFullName: z.string().trim().max(140).nullable().optional(),
        dockerImage: z.string().trim().max(200).nullable().optional(),
        rootDirectory: z.string().trim().max(200).nullable().optional(),
        buildCommand: z.string().trim().max(500).nullable().optional(),
        startCommand: z.string().trim().max(500).nullable().optional(),
        healthcheckPath: z.string().trim().max(200).nullable().optional(),
        autoDeploy: z.boolean().optional(),
      }),
      req.body,
    );
    db.prepare(
      `UPDATE services SET
         name = COALESCE(?, name),
         branch = COALESCE(?, branch),
         repo_full_name = COALESCE(?, repo_full_name),
         docker_image = COALESCE(?, docker_image),
         root_directory = COALESCE(?, root_directory),
         build_command = COALESCE(?, build_command),
         start_command = COALESCE(?, start_command),
         healthcheck_path = COALESCE(?, healthcheck_path),
         auto_deploy = COALESCE(?, auto_deploy),
         updated_at = ?
       WHERE id = ?`,
    ).run(
      body.name ?? null,
      body.branch ?? null,
      body.repoFullName ?? null,
      body.dockerImage ?? null,
      body.rootDirectory ?? null,
      body.buildCommand ?? null,
      body.startCommand ?? null,
      body.healthcheckPath ?? null,
      body.autoDeploy === undefined ? null : body.autoDeploy ? 1 : 0,
      nowIso(),
      service.id,
    );
    logActivity({
      workspaceId: (db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(service.project_id) as any).workspace_id,
      projectId: service.project_id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'service.updated',
      targetType: 'service',
      targetId: service.id,
      metadata: body,
    });
    res.json({ service: db.prepare('SELECT * FROM services WHERE id = ?').get(service.id) });
  }),
);

serviceRouter.delete(
  '/:id',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    if (role !== 'owner' && role !== 'admin') throw forbidden('Only workspace admins can delete services');
    if (String(req.query.confirm || '') !== service.name) {
      throw conflict(`Type the service name "${service.name}" to confirm deletion`);
    }
    db.prepare('DELETE FROM services WHERE id = ?').run(service.id);
    audit({
      workspaceId: (db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(service.project_id) as any).workspace_id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'service.deleted',
      targetType: 'service',
      targetId: service.id,
      metadata: { providerServiceId: service.provider_service_id },
      ip: req.ip,
    });
    res.json({
      ok: true,
      note: service.provider_service_id
        ? 'POMP NET deleted its own service record. The service still exists in your provider account.'
        : undefined,
    });
  }),
);

serviceRouter.post(
  '/:id/deploy',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'deploy services');
    const body = parse(
      z.object({
        environmentId: z.string().optional(),
        commit: z
          .object({
            sha: z.string().max(64).nullable().optional(),
            message: z.string().max(500).nullable().optional(),
            author: z.string().max(120).nullable().optional(),
          })
          .optional(),
      }),
      req.body ?? {},
    );
    const deployment = await startDeployment({
      projectId: service.project_id,
      serviceId: service.id,
      environmentId: body.environmentId || resolveEnvironmentId(service),
      trigger: 'manual',
      commit: body.commit,
      userId: req.user!.id,
    });
    res.status(202).json({ deployment });
  }),
);

serviceRouter.post(
  '/:id/redeploy',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'redeploy services');
    const deployment = await startDeployment({
      projectId: service.project_id,
      serviceId: service.id,
      environmentId: resolveEnvironmentId(service),
      trigger: 'redeploy',
      userId: req.user!.id,
    });
    res.status(202).json({ deployment });
  }),
);

serviceRouter.post(
  '/:id/restart',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'restart services');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    const ctx = requireProviderConnection(project.workspace_id, 'railway');
    if (!ctx.adapter.capabilities.stopService) {
      throw new ApiError(
        501,
        'provider_capability_missing',
        'Restart needs a stop/start cycle, which the connected provider API does not expose. Trigger a redeploy instead — it builds and replaces the running instance.',
      );
    }
    const deployment = await startDeployment({
      projectId: service.project_id,
      serviceId: service.id,
      environmentId: resolveEnvironmentId(service),
      trigger: 'redeploy',
      userId: req.user!.id,
    });
    res.status(202).json({ deployment });
  }),
);

serviceRouter.post(
  '/:id/stop',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'stop services');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    const ctx = requireProviderConnection(project.workspace_id, 'railway');
    if (!ctx.adapter.capabilities.stopService) {
      throw new ApiError(
        501,
        'provider_capability_missing',
        'The connected provider API does not expose stopping a service. Remove the service in your provider dashboard to stop billing; POMP NET will not pretend it was stopped.',
      );
    }
    throw new ApiError(501, 'provider_capability_missing', 'Stop is not implemented for this provider version');
  }),
);

serviceRouter.get(
  '/:id/deployments',
  route(async (req, res) => {
    const { service } = requireService(req.user!.id, req.params.id, 'viewer');
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    res.json({
      deployments: db
        .prepare(
          `SELECT id, status, trigger, commit_sha, commit_message, commit_author, created_at, started_at,
                  finished_at, error_message, duration_ms, provider_deployment_id
             FROM deployments WHERE service_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(service.id, limit),
    });
  }),
);

serviceRouter.get(
  '/:id/logs',
  route(async (req, res) => {
    const { service } = requireService(req.user!.id, req.params.id, 'viewer');
    const level = String(req.query.level || '');
    const stream = String(req.query.stream || '');
    const q = String(req.query.q || '');
    const deploymentId = req.query.deploymentId ? String(req.query.deploymentId) : null;
    const limit = Math.min(Number(req.query.limit) || 500, 2000);
    const rows = db
      .prepare(
        `SELECT l.id, l.deployment_id, l.ts, l.stream, l.level, l.message
           FROM deployment_logs l JOIN deployments d ON d.id = l.deployment_id
          WHERE d.service_id = ?
            AND (? IS NULL OR l.deployment_id = ?)
            AND (? = '' OR l.level = ?)
            AND (? = '' OR l.stream = ?)
            AND (? = '' OR l.message LIKE ?)
          ORDER BY l.id DESC LIMIT ?`,
      )
      .all(
        service.id,
        deploymentId,
        deploymentId,
        level,
        level,
        stream,
        stream,
        q,
        q ? `%${q}%` : '',
        limit,
      );
    res.json({
      logs: rows.reverse(),
      runtimeLogsAvailable: false,
      note:
        'These are the build and system logs POMP NET recorded for this service. Live runtime log streaming is not exposed by the connected provider API, so none are invented.',
    });
  }),
);

serviceRouter.get(
  '/:id/metrics',
  route(async (req, res) => {
    const { service } = requireService(req.user!.id, req.params.id, 'viewer');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    const provider = providerCapabilities(project.workspace_id);
    if (!provider.connected) {
      res.json({
        available: false,
        reason: 'provider_not_connected',
        message: 'Connect your infrastructure provider to read real CPU, memory and network metrics.',
        series: [],
      });
      return;
    }
    if (!provider.capabilities.resourceMetrics) {
      res.json({
        available: false,
        reason: 'provider_capability_missing',
        message:
          'The connected provider API does not expose historical resource metrics to third-party integrations. Values are never generated locally.',
        series: [],
      });
      return;
    }
    res.json({
      available: false,
      reason: 'not_implemented',
      message: 'Metric ingestion for this provider version is not implemented yet.',
      series: [],
    });
  }),
);

/* --------------------------------- domains --------------------------------- */

serviceRouter.get(
  '/:id/domains',
  route(async (req, res) => {
    const { service } = requireService(req.user!.id, req.params.id, 'viewer');
    res.json({
      domains: db.prepare('SELECT * FROM domains WHERE service_id = ? ORDER BY created_at ASC').all(service.id),
    });
  }),
);

serviceRouter.post(
  '/:id/domains',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'manage domains');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    const ctx = requireProviderConnection(project.workspace_id, 'railway');
    if (!service.provider_service_id || !service.provider_environment_id) {
      throw conflict('Deploy this service once so it exists in your provider account, then generate a domain');
    }
    const created = await ctx.adapter.createServiceDomain(ctx.token, {
      serviceId: service.provider_service_id,
      environmentId: service.provider_environment_id,
    });
    const id = randomToken(12);
    db.prepare(
      `INSERT INTO domains (id, project_id, service_id, environment_id, hostname, kind, status, provider_domain_id, dns_record, ssl_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'provider', 'pending_dns', ?, NULL, 'pending', ?)`,
    ).run(id, service.project_id, service.id, service.environment_id, created.domain, created.id, nowIso());
    res.status(201).json({
      domain: db.prepare('SELECT * FROM domains WHERE id = ?').get(id),
      note: 'The domain stays pending until your provider confirms it is serving traffic.',
    });
  }),
);

serviceRouter.post(
  '/:id/domains/custom',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'manage domains');
    const body = parse(z.object({ hostname: z.string().trim().min(4).max(200) }), req.body);
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    const ctx = requireProviderConnection(project.workspace_id, 'railway');
    if (!service.provider_service_id || !service.provider_environment_id) {
      throw conflict('Deploy this service once before attaching a custom domain');
    }
    const created = await ctx.adapter.createCustomDomain(ctx.token, {
      serviceId: service.provider_service_id,
      environmentId: service.provider_environment_id,
      hostname: body.hostname,
    });
    const id = randomToken(12);
    db.prepare(
      `INSERT INTO domains (id, project_id, service_id, environment_id, hostname, kind, status, provider_domain_id, dns_record, ssl_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'custom', 'pending_dns', ?, ?, 'pending', ?)`,
    ).run(
      id,
      service.project_id,
      service.id,
      service.environment_id,
      body.hostname,
      created.id,
      created.dns ? JSON.stringify(created.dns) : null,
      nowIso(),
    );
    res.status(201).json({
      domain: db.prepare('SELECT * FROM domains WHERE id = ?').get(id),
      note: 'Add the DNS record shown, then wait for your provider to verify ownership. Status is never set to active locally.',
    });
  }),
);

serviceRouter.delete(
  '/:id/domains/:domainId',
  route(async (req, res) => {
    const { service, role } = requireService(req.user!.id, req.params.id, 'viewer');
    assertCanWrite(role, 'manage domains');
    const domain = db
      .prepare('SELECT * FROM domains WHERE id = ? AND service_id = ?')
      .get(req.params.domainId, service.id) as any;
    if (!domain) throw notFound('Domain not found');
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    if (domain.provider_domain_id) {
      const ctx = requireProviderConnection(project.workspace_id, 'railway');
      await ctx.adapter.deleteDomain(ctx.token, domain.provider_domain_id);
    }
    db.prepare('DELETE FROM domains WHERE id = ?').run(domain.id);
    res.json({ ok: true });
  }),
);

/* ------------------------------- deployments ------------------------------- */

serviceRouter.get(
  '/deployments/:deploymentId',
  route(async (req, res) => {
    const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.deploymentId) as any;
    if (!deployment) throw notFound('Deployment not found');
    requireService(req.user!.id, deployment.service_id, 'viewer');
    res.json({ deployment: deploymentWithLogs(deployment.id) });
  }),
);

serviceRouter.post(
  '/deployments/:deploymentId/sync',
  route(async (req, res) => {
    const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.deploymentId) as any;
    if (!deployment) throw notFound('Deployment not found');
    requireService(req.user!.id, deployment.service_id, 'viewer');
    const synced = await syncDeployment(deployment.id);
    res.json({ deployment: synced });
  }),
);

serviceRouter.post(
  '/deployments/:deploymentId/rollback',
  route(async (req, res) => {
    const target = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.deploymentId) as any;
    if (!target) throw notFound('Deployment not found');
    const { service, role } = requireService(req.user!.id, target.service_id, 'viewer');
    assertCanWrite(role, 'roll back deployments');
    if (target.status !== 'running') {
      throw conflict('Only a deployment that reached the running state can be rolled back to');
    }
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
    const ctx = requireProviderConnection(project.workspace_id, 'railway');
    if (!ctx.adapter.capabilities.rollback) {
      throw new ApiError(501, 'provider_capability_missing', 'The connected provider cannot re-activate previous deployments');
    }
    if (!target.provider_deployment_id) {
      throw conflict('This deployment has no provider deployment id to roll back to');
    }
    const result = await ctx.adapter.rollbackTo(ctx.token, target.provider_deployment_id);
    const id = randomToken(12);
    const now = nowIso();
    db.prepare(
      `INSERT INTO deployments (id, project_id, service_id, environment_id, status, trigger, commit_sha, commit_message,
         commit_author, provider, provider_deployment_id, rollback_of, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'deploying', 'rollback', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      service.project_id,
      service.id,
      target.environment_id,
      target.commit_sha,
      target.commit_message,
      target.commit_author,
      ctx.adapter.id,
      result.deploymentId,
      target.id,
      req.user!.id,
      now,
      now,
    );
    logActivity({
      workspaceId: project.workspace_id,
      projectId: service.project_id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'deployment.rollback',
      targetType: 'deployment',
      targetId: id,
      metadata: { rolledBackTo: target.id },
    });
    recordUsage({
      workspaceId: project.workspace_id,
      projectId: service.project_id,
      serviceId: service.id,
      metric: 'deployments',
      value: 1,
      unit: 'count',
      source: 'pompnet',
    });
    res.status(202).json({ deployment: deploymentWithLogs(id) });
  }),
);

serviceRouter.post(
  '/deployments/:deploymentId/cancel',
  route(async (req, res) => {
    const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.deploymentId) as any;
    if (!deployment) throw notFound('Deployment not found');
    const { role } = requireService(req.user!.id, deployment.service_id, 'viewer');
    assertCanWrite(role, 'cancel deployments');
    if (!['queued', 'building', 'deploying'].includes(deployment.status)) {
      throw conflict('Only an in-progress deployment can be cancelled');
    }
    db.prepare(
      `UPDATE deployments SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?`,
    ).run(nowIso(), nowIso(), deployment.id);
    db.prepare(
      `INSERT INTO deployment_logs (deployment_id, ts, stream, level, message)
       VALUES (?, ?, 'system', 'warn', 'Cancelled by user. POMP NET stopped tracking this deployment; any build still running at the provider was not terminated by POMP NET.')`,
    ).run(deployment.id, nowIso());
    res.json({ deployment: deploymentWithLogs(deployment.id) });
  }),
);

/* ------------------------- GitHub push webhook ----------------------------- */

export const webhookRouter = Router();

webhookRouter.post(
  '/github/:serviceId',
  route(async (req, res) => {
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.serviceId) as any;
    if (!service || !service.webhook_secret) throw notFound('Unknown webhook endpoint');
    const signature = String(req.header('x-hub-signature-256') || '');
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const raw = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    const expected = `sha256=${createHmac('sha256', service.webhook_secret).update(raw).digest('hex')}`;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw forbidden('Invalid webhook signature');
    }
    if (!service.auto_deploy) {
      res.json({ ignored: true, reason: 'Automatic deployments are disabled for this service' });
      return;
    }
    const ref = String(req.body?.ref || '');
    if (service.branch && ref && !ref.endsWith(`/${service.branch}`)) {
      res.json({ ignored: true, reason: `Push was to ${ref}, service tracks ${service.branch}` });
      return;
    }
    const deployment = await startDeployment({
      projectId: service.project_id,
      serviceId: service.id,
      environmentId: resolveEnvironmentId(service),
      trigger: 'github_push',
      commit: {
        sha: req.body?.after ?? null,
        message: req.body?.head_commit?.message ?? null,
        author: req.body?.head_commit?.author?.name ?? null,
      },
      userId: service.created_by,
    });
    res.status(202).json({ deployment: { id: deployment.id, status: deployment.status } });
  }),
);
