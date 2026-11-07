import { db } from '../db.js';
import { decryptSecret } from '../lib/crypto.js';
import { ApiError, nowIso } from '../lib/http.js';
import { logActivity } from '../lib/audit.js';
import { requireProviderConnection } from '../providers/index.js';
import type { DeploymentSnapshot, LogLine } from '../providers/types.js';
import { randomToken } from '../lib/crypto.js';

const ACTIVE = new Set(['queued', 'building', 'deploying']);
const POLL_INTERVAL_MS = 6_000;
const MAX_POLL_MS = 25 * 60_000;

interface StartInput {
  projectId: string;
  serviceId: string;
  environmentId: string;
  trigger: 'manual' | 'github_push' | 'rollback' | 'redeploy';
  commit?: { sha?: string | null; message?: string | null; author?: string | null };
  userId: string;
  rollbackOf?: string | null;
}

export function deploymentWithLogs(deploymentId: string) {
  const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(deploymentId) as any;
  if (!deployment) return null;
  const logs = db
    .prepare('SELECT id, ts, stream, level, message FROM deployment_logs WHERE deployment_id = ? ORDER BY id ASC LIMIT 2000')
    .all(deploymentId);
  return { ...deployment, logs };
}

function insertLogs(deploymentId: string, lines: LogLine[]): void {
  if (!lines.length) return;
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO deployment_logs (deployment_id, ts, stream, level, message)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: LogLine[]) => {
    for (const line of rows) {
      stmt.run(deploymentId, line.ts, line.stream, line.level, line.message.slice(0, 4000));
    }
  });
  tx(lines);
}

function systemLog(deploymentId: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  db.prepare(
    `INSERT OR IGNORE INTO deployment_logs (deployment_id, ts, stream, level, message)
     VALUES (?, ?, 'system', ?, ?)`,
  ).run(deploymentId, nowIso(), level, message.slice(0, 4000));
}

export function recordUsage(input: {
  workspaceId: string;
  projectId?: string | null;
  serviceId?: string | null;
  metric: 'deployments' | 'database_provisioned';
  value: number;
  unit: string;
  source: string;
}): void {
  db.prepare(
    `INSERT INTO usage_records (id, workspace_id, project_id, service_id, metric, value, unit, source, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomToken(12),
    input.workspaceId,
    input.projectId ?? null,
    input.serviceId ?? null,
    input.metric,
    input.value,
    input.unit,
    input.source,
    nowIso(),
  );
}

function serviceRow(serviceId: string): any {
  return db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
}

function environmentName(environmentId: string): string {
  const row = db.prepare('SELECT name FROM environments WHERE id = ?').get(environmentId) as any;
  return row?.name ?? 'production';
}

/**
 * Pushes decrypted variables to the provider right before a deployment.
 * Values only ever leave the server inside an authenticated provider call.
 */
async function syncVariables(
  ctx: ReturnType<typeof requireProviderConnection>,
  service: any,
  environmentId: string,
): Promise<void> {
  const rows = db
    .prepare(
      `SELECT key, value_encrypted FROM environment_variables
        WHERE environment_id = ? AND project_id = ? AND (service_id = '' OR service_id = ?)`,
    )
    .all(environmentId, service.project_id, service.id) as Array<{
    key: string;
    value_encrypted: string;
  }>;
  if (!rows.length) return;
  const variables: Record<string, string> = {};
  for (const row of rows) variables[row.key] = decryptSecret(row.value_encrypted);
  await ctx.adapter.upsertVariables(ctx.token, {
    projectId: service.provider_project_id,
    environmentId: service.provider_environment_id,
    serviceId: service.provider_service_id,
    variables,
  });
}

async function ensureProviderService(
  ctx: ReturnType<typeof requireProviderConnection>,
  service: any,
): Promise<void> {
  if (service.provider_project_id && service.provider_service_id) return;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(service.project_id) as any;
  const workspaceId = project.workspace_id;

  let providerProjectId = service.provider_project_id as string | null;
  if (!providerProjectId) {
    const providerProject = await ctx.adapter.createProject(ctx.token, `POMP NET · ${project.name}`);
    providerProjectId = providerProject.id;
  }

  const envName = environmentName(service.environment_id);
  const providerEnv = await ctx.adapter.ensureEnvironment(ctx.token, providerProjectId, envName);

  const created = await ctx.adapter.createService(ctx.token, {
    projectId: providerProjectId,
    environmentId: providerEnv.id,
    name: service.name,
    repo: service.source_type === 'github' ? service.repo_full_name : null,
    branch: service.branch,
    image: service.source_type === 'github' ? null : service.docker_image,
    rootDirectory: service.root_directory,
  });

  db.prepare(
    `UPDATE services SET provider_project_id = ?, provider_service_id = ?, updated_at = ? WHERE id = ?`,
  ).run(providerProjectId, created.id, nowIso(), service.id);

  db.prepare(
    `UPDATE services SET provider_environment_id = ? WHERE id = ?`,
  ).run(providerEnv.id, service.id);

  logActivity({
    workspaceId,
    projectId: service.project_id,
    actorId: null,
    actorName: 'POMP NET CLOUD',
    action: 'provider.service.created',
    targetType: 'service',
    targetId: service.id,
    metadata: { provider: ctx.adapter.id, providerServiceId: created.id },
  });
}

/** Adds the provider_environment_id column lazily for older databases. */
export function ensureProviderColumns(): void {
  const cols = db.prepare(`PRAGMA table_info(services)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'provider_environment_id')) {
    db.exec('ALTER TABLE services ADD COLUMN provider_environment_id TEXT');
  }
}

export async function startDeployment(input: StartInput): Promise<any> {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(input.projectId) as any;
  if (!project) throw new ApiError(404, 'not_found', 'Project not found');

  const ctx = requireProviderConnection(project.workspace_id, 'railway');
  const service = serviceRow(input.serviceId);
  if (!service) throw new ApiError(404, 'not_found', 'Service not found');

  await ensureProviderService(ctx, service);
  const freshService = serviceRow(input.serviceId);
  await syncVariables(ctx, freshService, input.environmentId);

  const id = randomToken(12);
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO deployments
       (id, project_id, service_id, environment_id, status, trigger, commit_sha, commit_message, commit_author,
        provider, rollback_of, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.serviceId,
    input.environmentId,
    input.trigger,
    input.commit?.sha ?? null,
    input.commit?.message ?? null,
    input.commit?.author ?? null,
    ctx.adapter.id,
    input.rollbackOf ?? null,
    input.userId,
    createdAt,
    createdAt,
  );

  systemLog(id, `Deployment queued for ${service.name} (${ctx.adapter.displayName}).`);

  try {
    const { deploymentId } = await ctx.adapter.triggerDeployment(ctx.token, {
      serviceId: freshService.provider_service_id,
      environmentId: freshService.provider_environment_id,
    });
    db.prepare(
      `UPDATE deployments SET provider_deployment_id = ?, status = 'building', started_at = ?, updated_at = ? WHERE id = ?`,
    ).run(deploymentId, nowIso(), nowIso(), id);
    systemLog(id, `Provider accepted the build (deployment ${deploymentId}).`);
    db.prepare(`UPDATE services SET status = 'deploying', updated_at = ? WHERE id = ?`).run(
      nowIso(),
      service.id,
    );

    logActivity({
      workspaceId: project.workspace_id,
      projectId: project.id,
      actorId: input.userId,
      action: 'deployment.started',
      targetType: 'deployment',
      targetId: id,
      metadata: { service: service.name, provider: ctx.adapter.id },
    });
    recordUsage({
      workspaceId: project.workspace_id,
      projectId: project.id,
      serviceId: service.id,
      metric: 'deployments',
      value: 1,
      unit: 'count',
      source: 'pompnet',
    });

    schedulePoll(id, project.workspace_id);
  } catch (err) {
    const message = (err as Error).message;
    db.prepare(
      `UPDATE deployments SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
    ).run(message, nowIso(), nowIso(), id);
    db.prepare(`UPDATE services SET status = 'failed', updated_at = ? WHERE id = ?`).run(
      nowIso(),
      service.id,
    );
    systemLog(id, `Provider rejected the deployment: ${message}`, 'error');
    throw err;
  }

  return deploymentWithLogs(id);
}

function applySnapshot(deploymentId: string, snapshot: DeploymentSnapshot): void {
  const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(deploymentId) as any;
  if (!dep) return;
  const terminal = !ACTIVE.has(snapshot.status);
  db.prepare(
    `UPDATE deployments SET status = ?, updated_at = ?, finished_at = ?, error_message = COALESCE(?, error_message)
      WHERE id = ?`,
  ).run(
    snapshot.status,
    nowIso(),
    terminal ? dep.finished_at ?? nowIso() : null,
    snapshot.error,
    deploymentId,
  );

  if (terminal) {
    const serviceStatus =
      snapshot.status === 'running'
        ? 'running'
        : snapshot.status === 'stopped'
          ? 'stopped'
          : snapshot.status === 'failed'
            ? 'failed'
            : 'created';
    db.prepare('UPDATE services SET status = ?, updated_at = ? WHERE id = ?').run(
      serviceStatus,
      nowIso(),
      dep.service_id,
    );
    systemLog(
      deploymentId,
      `Deployment finished with provider status ${snapshot.rawStatus}.`,
      snapshot.status === 'running' ? 'info' : 'error',
    );
  }
}

async function pollOnce(deploymentId: string, workspaceId: string): Promise<boolean> {
  const dep = db.prepare('SELECT * FROM deployments WHERE id = ?').get(deploymentId) as any;
  if (!dep || !dep.provider_deployment_id) return false;
  if (!ACTIVE.has(dep.status)) return false;

  const ctx = requireProviderConnection(workspaceId, dep.provider || 'railway');
  const snapshot = await ctx.adapter.getDeployment(ctx.token, dep.provider_deployment_id);

  try {
    const logs = await ctx.adapter.fetchDeploymentLogs(ctx.token, dep.provider_deployment_id);
    insertLogs(deploymentId, logs);
  } catch {
    // Log streaming is best-effort; the deployment status below remains authoritative.
  }

  applySnapshot(deploymentId, snapshot);
  return ACTIVE.has(snapshot.status);
}

function schedulePoll(deploymentId: string, workspaceId: string, startedAt = Date.now()): void {
  const tick = async () => {
    try {
      const active = await pollOnce(deploymentId, workspaceId);
      if (active && Date.now() - startedAt < MAX_POLL_MS) {
        setTimeout(tick, POLL_INTERVAL_MS).unref?.();
      }
    } catch (err) {
      systemLog(
        deploymentId,
        `Status sync failed: ${(err as Error).message}. POMP NET will retry on the next refresh.`,
        'warn',
      );
    }
  };
  setTimeout(tick, 2_000).unref?.();
}

/** Called by the API when a client opens a deployment, so state is always provider-derived. */
export async function syncDeployment(deploymentId: string): Promise<any> {
  const dep = db
    .prepare(
      `SELECT d.*, p.workspace_id FROM deployments d JOIN projects p ON p.id = d.project_id WHERE d.id = ?`,
    )
    .get(deploymentId) as any;
  if (!dep) return null;
  if (dep.provider_deployment_id && ACTIVE.has(dep.status)) {
    try {
      const ctx = requireProviderConnection(dep.workspace_id, dep.provider || 'railway');
      const snapshot = await ctx.adapter.getDeployment(ctx.token, dep.provider_deployment_id);
      try {
        const logs = await ctx.adapter.fetchDeploymentLogs(ctx.token, dep.provider_deployment_id);
        insertLogs(deploymentId, logs);
      } catch {
        /* best effort */
      }
      applySnapshot(deploymentId, snapshot);
    } catch (err) {
      systemLog(deploymentId, `Status sync failed: ${(err as Error).message}`, 'warn');
    }
  }
  return deploymentWithLogs(deploymentId);
}

/** Re-attaches polling to deployments that were in flight when the server restarted. */
export function resumeActiveDeployments(): void {
  const rows = db
    .prepare(
      `SELECT d.id, p.workspace_id FROM deployments d JOIN projects p ON p.id = d.project_id
        WHERE d.status IN ('queued','building','deploying')`,
    )
    .all() as Array<{ id: string; workspace_id: string }>;
  for (const row of rows) schedulePoll(row.id, row.workspace_id);
}
