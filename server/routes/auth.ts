import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import {
  SESSION_COOKIE,
  attachUser,
  createSession,
  destroySession,
  publicUser,
  requireAuth,
  userWorkspaces,
} from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ApiError, conflict, nowIso, parse, route, unauthorized } from '../lib/http.js';
import { rateLimit } from '../lib/rateLimit.js';
import { mailConfigured, sendMail } from '../lib/mailer.js';
import { getSetting, setSetting } from '../db.js';

export const authRouter = Router();
authRouter.use(attachUser);

const emailSchema = z.string().trim().toLowerCase().email().max(190);
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), 'Use letters and numbers');

const devLinksAllowed = () => process.env.NODE_ENV !== 'production';

function appUrl(): string {
  return (process.env.APP_URL || 'http://localhost:8080').replace(/\/$/, '');
}

function createToken(userId: string, type: 'email_verify' | 'password_reset', ttlMs: number): string {
  const token = randomToken(32);
  db.prepare(
    `INSERT INTO tokens (id, user_id, type, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    randomToken(12),
    userId,
    type,
    sha256(token),
    new Date(Date.now() + ttlMs).toISOString(),
    nowIso(),
  );
  return token;
}

function defaultWorkspaceName(name: string): string {
  return `${name.split(' ')[0]}'s workspace`;
}

async function issueVerification(userId: string, email: string, name: string) {
  const token = createToken(userId, 'email_verify', 24 * 3600_000);
  const link = `${appUrl()}/verify-email?token=${token}`;
  const mail = await sendMail(
    email,
    'Verify your POMP NET CLOUD account',
    `Hello ${name},\n\nVerify your email to unlock deployments:\n${link}\n\nThis link expires in 24 hours.`,
  );
  return { mail, link, token };
}

authRouter.post(
  '/register',
  route(async (req, res) => {
    rateLimit(`register:${req.ip}`, 8, 10 * 60_000);
    const body = parse(
      z.object({
        email: emailSchema,
        password: passwordSchema,
        name: z.string().trim().min(2).max(80),
      }),
      req.body,
    );

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email);
    if (existing) throw conflict('An account with this email already exists');

    const id = randomToken(12);
    const now = nowIso();
    const ownerEmail = (process.env.PLATFORM_OWNER_EMAIL || '').toLowerCase().trim();
    const ownerAlreadyExists = db
      .prepare('SELECT id FROM users WHERE is_platform_owner = 1 LIMIT 1')
      .get() as { id: string } | undefined;
    const bootstrapped = getSetting('owner_bootstrapped', '0') === '1';
    const isPlatformOwner =
      ownerEmail.length > 0
        ? body.email === ownerEmail
        : !ownerAlreadyExists && !bootstrapped;

    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, is_platform_owner, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, body.email, hashPassword(body.password), body.name, isPlatformOwner ? 1 : 0, now, now);

    if (isPlatformOwner && !ownerEmail) setSetting('owner_bootstrapped', '1');

    const workspaceId = randomToken(12);
    db.prepare(
      `INSERT INTO workspaces (id, name, slug, owner_id, plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free', ?, ?)`,
    ).run(workspaceId, defaultWorkspaceName(body.name), `ws-${randomToken(5).toLowerCase()}`, id, now, now);
    db.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`,
    ).run(randomToken(12), workspaceId, id, now);

    createSession(id, req, res);
    const verification = await issueVerification(id, body.email, body.name);
    audit({
      workspaceId,
      actorId: id,
      actorEmail: body.email,
      action: 'auth.register',
      targetType: 'user',
      targetId: id,
      ip: req.ip,
    });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    res.status(201).json({
      user: publicUser({
        id,
        email: user.email,
        name: user.name,
        avatarUrl: null,
        emailVerified: false,
        isPlatformOwner,
        suspended: false,
        createdAt: now,
      }),
      workspaces: userWorkspaces(id),
      verification: {
        emailDelivery: mailConfigured() ? 'sent' : 'not_configured',
        link: !mailConfigured() && devLinksAllowed() ? verification.link : undefined,
        reason: mailConfigured() ? undefined : verification.mail.reason,
      },
    });
  }),
);

authRouter.post(
  '/login',
  route(async (req, res) => {
    rateLimit(`login:${req.ip}`, 12, 5 * 60_000);
    const body = parse(
      z.object({ email: emailSchema, password: z.string().min(1).max(200) }),
      req.body,
    );
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email) as any;
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      throw unauthorized('Incorrect email or password');
    }
    if (user.suspended_at) {
      throw new ApiError(403, 'account_suspended', user.suspended_reason || 'This account is suspended');
    }
    createSession(user.id, req, res);
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), user.id);
    audit({ actorId: user.id, actorEmail: user.email, action: 'auth.login', ip: req.ip });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatar_url,
        emailVerified: Boolean(user.email_verified_at),
        isPlatformOwner: Boolean(user.is_platform_owner),
        suspended: false,
        createdAt: user.created_at,
      },
      workspaces: userWorkspaces(user.id),
    });
  }),
);

authRouter.post(
  '/logout',
  route(async (req, res) => {
    if (req.user) {
      audit({ actorId: req.user.id, actorEmail: req.user.email, action: 'auth.logout', ip: req.ip });
    }
    destroySession(req, res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  route(async (req, res) => {
    if (!req.user) return res.status(200).json({ user: null, workspaces: [] });
    res.json({
      user: publicUser(req.user),
      workspaces: userWorkspaces(req.user.id),
      mailConfigured: mailConfigured(),
    });
  }),
);

authRouter.post(
  '/verify-email',
  route(async (req, res) => {
    rateLimit(`verify:${req.ip}`, 20, 10 * 60_000);
    const { token } = parse(z.object({ token: z.string().min(10) }), req.body);
    const row = db
      .prepare(`SELECT * FROM tokens WHERE token_hash = ? AND type = 'email_verify'`)
      .get(sha256(token)) as any;
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      throw new ApiError(400, 'invalid_token', 'This verification link is invalid or has expired');
    }
    db.prepare('UPDATE users SET email_verified_at = ?, updated_at = ? WHERE id = ?').run(
      nowIso(),
      nowIso(),
      row.user_id,
    );
    db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
    audit({ actorId: row.user_id, action: 'auth.email_verified', ip: req.ip });
    res.json({ ok: true, message: 'Email verified. Infrastructure actions are now unlocked.' });
  }),
);

authRouter.post(
  '/resend-verification',
  route(async (req, res) => {
    if (!req.user) throw unauthorized();
    rateLimit(`resend:${req.user.id}`, 4, 15 * 60_000);
    if (req.user.emailVerified) throw conflict('Email is already verified');
    const verification = await issueVerification(req.user.id, req.user.email, req.user.name);
    res.json({
      ok: true,
      emailDelivery: mailConfigured() ? 'sent' : 'not_configured',
      link: !mailConfigured() && devLinksAllowed() ? verification.link : undefined,
      reason: mailConfigured() ? undefined : verification.mail.reason,
    });
  }),
);

authRouter.post(
  '/forgot-password',
  route(async (req, res) => {
    rateLimit(`forgot:${req.ip}`, 6, 15 * 60_000);
    const { email } = parse(z.object({ email: emailSchema }), req.body);
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    const generic = {
      ok: true,
      message: 'If an account exists for that address, a reset link has been sent.',
    };
    if (!user) return res.json(generic);

    const token = createToken(user.id, 'password_reset', 60 * 60_000);
    const link = `${appUrl()}/reset-password?token=${token}`;
    const mail = await sendMail(
      email,
      'Reset your POMP NET CLOUD password',
      `Reset your password (valid 60 minutes):\n${link}`,
    );
    res.json({
      ...generic,
      emailDelivery: mailConfigured() ? 'sent' : 'not_configured',
      link: !mailConfigured() && devLinksAllowed() ? link : undefined,
      reason: mailConfigured() ? undefined : mail.reason,
    });
  }),
);

authRouter.post(
  '/reset-password',
  route(async (req, res) => {
    rateLimit(`reset:${req.ip}`, 10, 15 * 60_000);
    const body = parse(
      z.object({ token: z.string().min(10), password: passwordSchema }),
      req.body,
    );
    const row = db
      .prepare(`SELECT * FROM tokens WHERE token_hash = ? AND type = 'password_reset'`)
      .get(sha256(body.token)) as any;
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      throw new ApiError(400, 'invalid_token', 'This reset link is invalid or has expired');
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(body.password),
      nowIso(),
      row.user_id,
    );
    db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id);
    audit({ actorId: row.user_id, action: 'auth.password_reset', ip: req.ip });
    res.json({ ok: true, message: 'Password updated. Sign in with your new password.' });
  }),
);

authRouter.patch(
  '/profile',
  requireAuth,
  route(async (req, res) => {
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(80).optional(),
        avatarUrl: z.string().trim().url().max(500).nullable().optional(),
      }),
      req.body,
    );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
    db.prepare('UPDATE users SET name = ?, avatar_url = ?, updated_at = ? WHERE id = ?').run(
      body.name ?? user.name,
      body.avatarUrl === undefined ? user.avatar_url : body.avatarUrl,
      nowIso(),
      req.user!.id,
    );
    res.json({ ok: true });
  }),
);

authRouter.patch(
  '/password',
  requireAuth,
  route(async (req, res) => {
    const body = parse(
      z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }),
      req.body,
    );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as any;
    if (!verifyPassword(body.currentPassword, user.password_hash)) {
      throw unauthorized('Current password is incorrect');
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(body.newPassword),
      nowIso(),
      req.user!.id,
    );
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(
      req.user!.id,
      req.sessionId ?? '',
    );
    audit({ actorId: req.user!.id, actorEmail: req.user!.email, action: 'auth.password_changed', ip: req.ip });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  route(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT id, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions
          WHERE user_id = ? ORDER BY last_seen_at DESC`,
      )
      .all(req.user!.id) as any[];
    res.json({
      sessions: rows.map((r) => ({ ...r, current: r.id === req.sessionId })),
      cookieName: SESSION_COOKIE,
    });
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  route(async (req, res) => {
    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(
      req.params.id,
      req.user!.id,
    );
    res.json({ ok: true });
  }),
);
