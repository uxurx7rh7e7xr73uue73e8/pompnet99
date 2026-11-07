import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import {
  ROLE_RANK,
  assertWorkspaceAccess,
  requireAuth,
  workspaceRole,
} from '../lib/auth.js';
import { audit, logActivity } from '../lib/audit.js';
import { conflict, forbidden, notFound, nowIso, parse, route, slugify } from '../lib/http.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { mailConfigured, sendMail } from '../lib/mailer.js';
import { rateLimit } from '../lib/rateLimit.js';

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

const roleSchema = z.enum(['admin', 'developer', 'viewer']);

workspaceRouter.get(
  '/',
  route(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT w.*, m.role AS role,
                (SELECT COUNT(*) FROM projects p WHERE p.workspace_id = w.id AND p.archived_at IS NULL) AS project_count,
                (SELECT COUNT(*) FROM workspace_members mm WHERE mm.workspace_id = w.id) AS member_count
           FROM workspaces w JOIN workspace_members m ON m.workspace_id = w.id
          WHERE m.user_id = ? ORDER BY w.created_at ASC`,
      )
      .all(req.user!.id);
    res.json({ workspaces: rows });
  }),
);

workspaceRouter.post(
  '/',
  route(async (req, res) => {
    rateLimit(`ws-create:${req.user!.id}`, 10, 3600_000);
    const body = parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
    const id = randomToken(12);
    const now = nowIso();
    let slug = slugify(body.name);
    while (db.prepare('SELECT id FROM workspaces WHERE slug = ?').get(slug)) {
      slug = `${slugify(body.name)}-${randomToken(3).toLowerCase()}`;
    }
    db.prepare(
      `INSERT INTO workspaces (id, name, slug, owner_id, plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free', ?, ?)`,
    ).run(id, body.name, slug, req.user!.id, now, now);
    db.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`,
    ).run(randomToken(12), id, req.user!.id, now);
    audit({
      workspaceId: id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: id,
      ip: req.ip,
    });
    res.status(201).json({ workspace: db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) });
  }),
);

workspaceRouter.get(
  '/:id',
  route(async (req, res) => {
    const role = assertWorkspaceAccess(req.user!.id, req.params.id, 'viewer');
    const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id) as any;
    const members = db
      .prepare(
        `SELECT m.id, m.role, m.created_at, u.id AS user_id, u.name, u.email, u.avatar_url, u.email_verified_at
           FROM workspace_members m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ? ORDER BY m.created_at ASC`,
      )
      .all(req.params.id);
    const invitations = db
      .prepare(
        `SELECT id, email, role, expires_at, accepted_at, created_at FROM invitations
          WHERE workspace_id = ? AND accepted_at IS NULL ORDER BY created_at DESC`,
      )
      .all(req.params.id);
    res.json({ workspace, role, members, invitations });
  }),
);

workspaceRouter.patch(
  '/:id',
  route(async (req, res) => {
    assertWorkspaceAccess(req.user!.id, req.params.id, 'admin');
    const body = parse(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
    db.prepare('UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?').run(
      body.name,
      nowIso(),
      req.params.id,
    );
    audit({
      workspaceId: req.params.id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'workspace.renamed',
      targetType: 'workspace',
      targetId: req.params.id,
      metadata: { name: body.name },
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

workspaceRouter.delete(
  '/:id',
  route(async (req, res) => {
    const role = workspaceRole(req.user!.id, req.params.id);
    if (role !== 'owner') throw forbidden('Only the workspace owner can delete a workspace');
    const projectCount = (
      db.prepare('SELECT COUNT(*) AS c FROM projects WHERE workspace_id = ?').get(req.params.id) as any
    ).c;
    if (projectCount > 0) {
      throw conflict(
        'Delete or move the projects in this workspace first — POMP NET will not cascade-delete infrastructure records silently.',
      );
    }
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id);
    audit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'workspace.deleted',
      targetType: 'workspace',
      targetId: req.params.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

workspaceRouter.get(
  '/:id/members',
  route(async (req, res) => {
    assertWorkspaceAccess(req.user!.id, req.params.id, 'viewer');
    const members = db
      .prepare(
        `SELECT m.id, m.role, m.created_at, u.id AS user_id, u.name, u.email, u.avatar_url
           FROM workspace_members m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = ? ORDER BY m.created_at ASC`,
      )
      .all(req.params.id);
    res.json({ members });
  }),
);

workspaceRouter.post(
  '/:id/members/invite',
  route(async (req, res) => {
    assertWorkspaceAccess(req.user!.id, req.params.id, 'admin');
    rateLimit(`invite:${req.user!.id}`, 20, 3600_000);
    const body = parse(
      z.object({ email: z.string().trim().toLowerCase().email(), role: roleSchema }),
      req.body,
    );

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email) as any;
    if (existingUser) {
      const already = db
        .prepare('SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
        .get(req.params.id, existingUser.id);
      if (already) throw conflict('This person is already a member of the workspace');
    }

    const token = randomToken(32);
    const id = randomToken(12);
    db.prepare(
      `INSERT INTO invitations (id, workspace_id, email, role, token_hash, invited_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.params.id,
      body.email,
      body.role,
      sha256(token),
      req.user!.id,
      new Date(Date.now() + 7 * 864e5).toISOString(),
      nowIso(),
    );
    const link = `${(process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '')}/invite?token=${token}`;
    const mail = await sendMail(
      body.email,
      'You were invited to a POMP NET CLOUD workspace',
      `Accept your invitation (valid 7 days):\n${link}`,
    );
    logActivity({
      workspaceId: req.params.id,
      actorId: req.user!.id,
      actorName: req.user!.name,
      action: 'member.invited',
      targetType: 'invitation',
      targetId: id,
      metadata: { email: body.email, role: body.role },
    });
    audit({
      workspaceId: req.params.id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'workspace.member_invited',
      targetType: 'invitation',
      targetId: id,
      metadata: { email: body.email, role: body.role },
      ip: req.ip,
    });
    res.status(201).json({
      ok: true,
      emailDelivery: mailConfigured() ? 'sent' : 'not_configured',
      link: !mailConfigured() && process.env.NODE_ENV !== 'production' ? link : undefined,
      reason: mailConfigured() ? undefined : mail.reason,
    });
  }),
);

workspaceRouter.patch(
  '/:id/members/:memberId',
  route(async (req, res) => {
    const actorRole = assertWorkspaceAccess(req.user!.id, req.params.id, 'admin');
    const body = parse(z.object({ role: z.enum(['admin', 'developer', 'viewer']) }), req.body);
    const member = db
      .prepare('SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?')
      .get(req.params.memberId, req.params.id) as any;
    if (!member) throw notFound('Member not found');
    if (member.role === 'owner') throw forbidden('The workspace owner role cannot be changed');
    if (ROLE_RANK[actorRole] <= ROLE_RANK[body.role] && actorRole !== 'owner') {
      throw forbidden('You cannot assign a role equal to or above your own');
    }
    db.prepare('UPDATE workspace_members SET role = ? WHERE id = ?').run(body.role, member.id);
    audit({
      workspaceId: req.params.id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'workspace.member_role_changed',
      targetType: 'member',
      targetId: member.id,
      metadata: { role: body.role },
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

workspaceRouter.delete(
  '/:id/members/:memberId',
  route(async (req, res) => {
    const actorRole = assertWorkspaceAccess(req.user!.id, req.params.id, 'admin');
    const member = db
      .prepare('SELECT * FROM workspace_members WHERE id = ? AND workspace_id = ?')
      .get(req.params.memberId, req.params.id) as any;
    if (!member) throw notFound('Member not found');
    if (member.role === 'owner') throw forbidden('The workspace owner cannot be removed');
    if (actorRole === 'admin' && member.role === 'admin') {
      throw forbidden('Admins cannot remove other admins');
    }
    db.prepare('DELETE FROM workspace_members WHERE id = ?').run(member.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(member.user_id);
    audit({
      workspaceId: req.params.id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'workspace.member_removed',
      targetType: 'member',
      targetId: member.id,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

workspaceRouter.get(
  '/:id/activity',
  route(async (req, res) => {
    assertWorkspaceAccess(req.user!.id, req.params.id, 'viewer');
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const rows = db
      .prepare(
        `SELECT a.*, p.name AS project_name FROM activity_logs a
           LEFT JOIN projects p ON p.id = a.project_id
          WHERE a.workspace_id = ? ORDER BY a.created_at DESC LIMIT ?`,
      )
      .all(req.params.id, limit);
    res.json({ activity: rows });
  }),
);

workspaceRouter.get(
  '/:id/audit',
  route(async (req, res) => {
    assertWorkspaceAccess(req.user!.id, req.params.id, 'admin');
    const rows = db
      .prepare(
        `SELECT * FROM audit_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 200`,
      )
      .all(req.params.id);
    res.json({ audit: rows });
  }),
);

workspaceRouter.get(
  '/:id/usage',
  route(async (req, res) => {
    assertWorkspaceAccess(req.user!.id, req.params.id, 'viewer');
    const totals = db
      .prepare(
        `SELECT metric, SUM(value) AS total, unit, COUNT(*) AS samples
           FROM usage_records WHERE workspace_id = ? GROUP BY metric, unit`,
      )
      .all(req.params.id);
    const series = db
      .prepare(
        `SELECT substr(recorded_at, 1, 10) AS day, metric, SUM(value) AS total
           FROM usage_records WHERE workspace_id = ?
          GROUP BY day, metric ORDER BY day ASC`,
      )
      .all(req.params.id);
    const counts = {
      projects: (db.prepare('SELECT COUNT(*) AS c FROM projects WHERE workspace_id = ?').get(req.params.id) as any).c,
      services: (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM services s JOIN projects p ON p.id = s.project_id WHERE p.workspace_id = ?`,
          )
          .get(req.params.id) as any
      ).c,
      databases: (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM databases d JOIN projects p ON p.id = d.project_id WHERE p.workspace_id = ?`,
          )
          .get(req.params.id) as any
      ).c,
      deployments: (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM deployments d JOIN projects p ON p.id = d.project_id WHERE p.workspace_id = ?`,
          )
          .get(req.params.id) as any
      ).c,
    };
    const plan = db.prepare('SELECT plan FROM workspaces WHERE id = ?').get(req.params.id) as any;
    res.json({
      totals,
      series,
      counts,
      plan: plan?.plan ?? 'free',
      billing: {
        paymentProvider: 'not_configured',
        message:
          'Billing is not connected. POMP NET does not charge anything; usage is tracked so a payment provider can be attached later.',
      },
      providerUsage: {
        available: false,
        message:
          'Resource-level usage (CPU/RAM/disk) is only shown when the connected infrastructure provider exposes it. Nothing is estimated.',
      },
    });
  }),
);
