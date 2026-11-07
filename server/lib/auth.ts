import type { NextFunction, Request, Response } from 'express';
import { db } from '../db.js';
import { randomToken, sha256 } from './crypto.js';
import { forbidden, notFound, unauthorized } from './http.js';

export const SESSION_COOKIE = 'pn_session';
const SESSION_TTL_DAYS = 30;

export type Role = 'owner' | 'admin' | 'developer' | 'viewer';
export const ROLE_RANK: Record<Role, number> = { viewer: 1, developer: 2, admin: 3, owner: 4 };

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  isPlatformOwner: boolean;
  suspended: boolean;
  createdAt: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: string;
    }
  }
}

function mapUser(row: any): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url ?? null,
    emailVerified: Boolean(row.email_verified_at),
    isPlatformOwner: Boolean(row.is_platform_owner),
    suspended: Boolean(row.suspended_at),
    createdAt: row.created_at,
  };
}

export function publicUser(user: SessionUser) {
  return user;
}

export function createSession(userId: string, req: Request, res: Response): string {
  const token = randomToken(32);
  const id = randomToken(16);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 864e5);
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    userId,
    sha256(token),
    (req.headers['user-agent'] || '').slice(0, 300),
    req.ip ?? null,
    now.toISOString(),
    now.toISOString(),
    expires.toISOString(),
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: (process.env.APP_URL || '').startsWith('https://'),
    path: '/',
    maxAge: SESSION_TTL_DAYS * 864e5,
  });
  return id;
}

export function destroySession(req: Request, res: Response): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, u.*
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as any;
  if (!row) return next();
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
    return next();
  }
  req.user = mapUser(row);
  req.sessionId = row.session_id;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    row.session_id,
  );
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.suspended) {
    return next(forbidden('This account is suspended. Contact the platform owner.'));
  }
  next();
}

export function requireVerifiedEmail(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.emailVerified) {
    return next(
      forbidden('Verify your email address before connecting infrastructure or deploying.'),
    );
  }
  next();
}

export function requirePlatformOwner(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user?.isPlatformOwner) return next(forbidden('Platform owner access required'));
  next();
}

export function workspaceRole(userId: string, workspaceId: string): Role | null {
  const row = db
    .prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
    .get(workspaceId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

export function assertWorkspaceAccess(userId: string, workspaceId: string, min: Role): Role {
  const role = workspaceRole(userId, workspaceId);
  if (!role) throw notFound('Workspace not found');
  if (ROLE_RANK[role] < ROLE_RANK[min]) {
    throw forbidden(`This action requires the ${min} role in this workspace`);
  }
  return role;
}

export function projectWorkspace(projectId: string): { id: string; workspace_id: string } {
  const row = db
    .prepare('SELECT id, workspace_id FROM projects WHERE id = ?')
    .get(projectId) as { id: string; workspace_id: string } | undefined;
  if (!row) throw notFound('Project not found');
  return row;
}

export function assertProjectAccess(userId: string, projectId: string, min: Role): Role {
  const project = projectWorkspace(projectId);
  return assertWorkspaceAccess(userId, project.workspace_id, min);
}

export function assertServiceAccess(
  userId: string,
  serviceId: string,
  min: Role,
): { service: any; role: Role } {
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId) as any;
  if (!service) throw notFound('Service not found');
  const role = assertProjectAccess(userId, service.project_id, min);
  return { service, role };
}

export function userWorkspaces(userId: string) {
  return db
    .prepare(
      `SELECT w.*, m.role AS role,
              (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id AND p.archived_at IS NULL) AS project_count
         FROM workspaces w
         JOIN workspace_members m ON m.workspace_id = w.id
        WHERE m.user_id = ?
        ORDER BY w.created_at ASC`,
    )
    .all(userId);
}
