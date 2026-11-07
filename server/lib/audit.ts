import { db } from '../db.js';
import { randomToken } from './crypto.js';

export function logActivity(input: {
  workspaceId: string;
  projectId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): void {
  db.prepare(
    `INSERT INTO activity_logs (id, workspace_id, project_id, actor_id, actor_name, action, target_type, target_id, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomToken(12),
    input.workspaceId,
    input.projectId ?? null,
    input.actorId ?? null,
    input.actorName ?? null,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
}

export function audit(input: {
  workspaceId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  ip?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  db.prepare(
    `INSERT INTO audit_logs (id, workspace_id, actor_id, actor_email, action, target_type, target_id, ip, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomToken(12),
    input.workspaceId ?? null,
    input.actorId ?? null,
    input.actorEmail ?? null,
    input.action,
    input.targetType ?? null,
    input.targetId ?? null,
    input.ip ?? null,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  );
}
