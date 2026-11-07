import { db } from '../db.js';
import { ROLE_RANK, assertWorkspaceAccess, workspaceRole, type Role } from './auth.js';
import { forbidden, notFound } from './http.js';

export interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceRow {
  id: string;
  project_id: string;
  environment_id: string | null;
  name: string;
  source_type: string;
  provider: string;
  provider_service_id: string | null;
  provider_project_id: string | null;
  provider_environment_id: string | null;
  status: string;
}

export function requireProject(userId: string, projectId: string, minRole: Role = 'viewer') {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as ProjectRow | undefined;
  if (!project) throw notFound('Project not found');
  const role = assertWorkspaceAccess(userId, project.workspace_id, minRole);
  return { project, role };
}

export function requireService(userId: string, serviceId: string, minRole: Role = 'viewer') {
  const service = db
    .prepare('SELECT * FROM services WHERE id = ?')
    .get(serviceId) as ServiceRow | undefined;
  if (!service) throw notFound('Service not found');
  const { project, role } = requireProject(userId, service.project_id, minRole);
  return { service, project, role };
}

export function requireEnvironment(userId: string, environmentId: string, minRole: Role = 'viewer') {
  const env = db.prepare('SELECT * FROM environments WHERE id = ?').get(environmentId) as any;
  if (!env) throw notFound('Environment not found');
  const { project, role } = requireProject(userId, env.project_id, minRole);
  return { environment: env, project, role };
}

export function requireDatabase(userId: string, databaseId: string, minRole: Role = 'viewer') {
  const database = db.prepare('SELECT * FROM databases WHERE id = ?').get(databaseId) as any;
  if (!database) throw notFound('Database not found');
  const { project, role } = requireProject(userId, database.project_id, minRole);
  return { database, project, role };
}

export function canWrite(role: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.developer;
}

export function assertCanWrite(role: Role, action = 'change'): void {
  if (!canWrite(role)) throw forbidden(`Viewers cannot ${action} resources in this workspace`);
}

export function projectWorkspaceId(projectId: string): string {
  const row = db.prepare('SELECT workspace_id FROM projects WHERE id = ?').get(projectId) as any;
  if (!row) throw notFound('Project not found');
  return row.workspace_id;
}

export { workspaceRole };
