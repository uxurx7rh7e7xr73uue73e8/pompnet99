import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { assertWorkspaceAccess, requireAuth } from '../lib/auth.js';
import { audit, logActivity } from '../lib/audit.js';
import { conflict, forbidden, notFound, nowIso, parse, route, slugify } from '../lib/http.js';
import { encryptSecret, randomToken } from '../lib/crypto.js';
import { requireProviderConnection } from '../providers/index.js';
import { startDeployment } from '../services/deployments.js';

export const templateRouter = Router();
templateRouter.use(requireAuth);

function shape(row: any) {
  return {
    ...row,
    required_env: JSON.parse(row.required_env || '[]'),
    resources: JSON.parse(row.resources || '{}'),
    providers: JSON.parse(row.providers || '[]'),
    featured: Boolean(row.featured),
    editable: Boolean(row.created_by),
  };
}

templateRouter.get(
  '/',
  route(async (req, res) => {
    const category = String(req.query.category || '');
    const rows = db
      .prepare(
        `SELECT * FROM templates WHERE (? = '' OR category = ?) ORDER BY featured DESC, name ASC`,
      )
      .all(category, category) as any[];
    res.json({
      templates: rows.map(shape),
      categories: Array.from(new Set((db.prepare('SELECT DISTINCT category FROM templates').all() as any[]).map((r) => r.category))).sort(),
    });
  }),
);

templateRouter.post(
  '/',
  route(async (req, res) => {
    const body = parse(
      z.object({
        workspaceId: z.string().min(1),
        name: z.string().trim().min(2).max(80),
        description: z.string().trim().min(5).max(400),
        category: z.string().trim().min(2).max(40),
        icon: z.string().trim().max(40).optional().default('box'),
        sourceType: z.enum(['github', 'docker_image']),
        repoFullName: z.string().trim().max(140).optional(),
        dockerImage: z.string().trim().max(200).optional(),
        requiredEnv: z
          .array(
            z.object({
              key: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
              description: z.string().max(200).optional().default(''),
              secret: z.boolean().optional().default(false),
            }),
          )
          .max(40)
          .optional()
          .default([]),
        instructions: z.string().trim().max(2000).optional().default(''),
      }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    if (body.sourceType === 'github' && !body.repoFullName) throw conflict('Provide the repository (owner/name)');
    if (body.sourceType === 'docker_image' && !body.dockerImage) throw conflict('Provide the Docker image reference');
    const base = slugify(`${body.name}-${randomToken(4)}`);
    const id = randomToken(12);
    db.prepare(
      `INSERT INTO templates (id, slug, name, description, category, icon, source_type, repo_full_name, docker_image,
         required_env, resources, instructions, providers, featured, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, '["railway"]', 0, ?, ?)`,
    ).run(
      id,
      base,
      body.name,
      body.description,
      body.category,
      body.icon,
      body.sourceType,
      body.repoFullName ?? null,
      body.dockerImage ?? null,
      JSON.stringify(body.requiredEnv),
      body.instructions,
      req.user!.id,
      nowIso(),
    );
    logActivity({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'template.created',
      targetType: 'template',
      targetId: id,
      metadata: { name: body.name },
    });
    res.status(201).json({ template: shape(db.prepare('SELECT * FROM templates WHERE id = ?').get(id)) });
  }),
);

templateRouter.delete(
  '/:id',
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id) as any;
    if (!row) throw notFound('Template not found');
    if (row.created_by !== req.user!.id) throw forbidden('Only the creator can delete this template');
    db.prepare('DELETE FROM templates WHERE id = ?').run(row.id);
    res.json({ ok: true });
  }),
);

templateRouter.post(
  '/:id/deploy',
  route(async (req, res) => {
    const body = parse(
      z.object({
        workspaceId: z.string().min(1),
        projectName: z.string().trim().min(2).max(80),
        environment: z.string().trim().min(2).max(40).optional().default('production'),
        variables: z.record(z.string().max(20000)).optional().default({}),
      }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'developer');
    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(req.params.id) as any;
    if (!template) throw notFound('Template not found');
    const requiredEnv = JSON.parse(template.required_env || '[]') as Array<{ key: string; secret?: boolean }>;
    const missing = requiredEnv.filter((v) => !body.variables[v.key]);
    if (missing.length) {
      throw conflict(`Missing required variables: ${missing.map((m) => m.key).join(', ')}`);
    }

    // Template deployment uses the workspace's own provider account.
    requireProviderConnection(body.workspaceId, 'railway');

    const projectId = randomToken(12);
    const envId = randomToken(12);
    const serviceId = randomToken(12);
    const now = nowIso();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO projects (id, workspace_id, name, slug, description, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        projectId,
        body.workspaceId,
        body.projectName,
        slugify(`${body.projectName}-${randomToken(3)}`),
        template.description,
        req.user!.id,
        now,
        now,
      );
      db.prepare(
        `INSERT INTO environments (id, project_id, name, slug, kind, created_at) VALUES (?, ?, ?, ?, 'production', ?)`,
      ).run(envId, projectId, body.environment, slugify(body.environment), now);
      db.prepare(
        `INSERT INTO services (id, project_id, environment_id, name, source_type, repo_full_name, docker_image,
           template_slug, auto_deploy, webhook_secret, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(
        serviceId,
        projectId,
        envId,
        template.name,
        template.source_type === 'github' ? 'github' : 'docker_image',
        template.repo_full_name,
        template.docker_image,
        template.slug,
        randomToken(24),
        req.user!.id,
        now,
        now,
      );
      const insertVar = db.prepare(
        `INSERT INTO environment_variables (id, project_id, environment_id, service_id, key, value_encrypted, is_secret, created_by, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`,
      );
      for (const [key, value] of Object.entries(body.variables)) {
        const spec = requiredEnv.find((r) => r.key === key);
        insertVar.run(randomToken(12), projectId, envId, key, encryptSecret(String(value)), spec?.secret ? 1 : 0, req.user!.id, now, now);
      }
    })();

    const deployment = await startDeployment({
      projectId,
      serviceId,
      environmentId: envId,
      trigger: 'manual',
      userId: req.user!.id,
    });
    logActivity({
      workspaceId: body.workspaceId,
      projectId,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'template.deployed',
      targetType: 'service',
      targetId: serviceId,
      metadata: { template: template.slug },
    });
    audit({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'template.deployed',
      targetType: 'template',
      targetId: template.id,
      metadata: { projectId },
      ip: req.ip,
    });
    res.status(202).json({ projectId, serviceId, deployment });
  }),
);
