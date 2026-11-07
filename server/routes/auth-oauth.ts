import { Router } from 'express';
import type { Request, Response } from 'express';
import { db, getSetting, setSetting } from '../db.js';
import { z } from 'zod';
import { createSession, requireAuth, requirePlatformOwner } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ApiError, nowIso, parse, route } from '../lib/http.js';
import { decryptSecret, encryptSecret, randomToken } from '../lib/crypto.js';
import { rateLimit } from '../lib/rateLimit.js';

export const oauthRouter = Router();

type Provider = 'github' | 'google';
const PROVIDERS: Provider[] = ['github', 'google'];
const STATE_COOKIE = 'pn_oauth_state';
const STATE_PATH = '/api/auth/oauth';

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  configured: boolean;
}

interface OAuthProfile {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string | null;
}

function envValue(provider: Provider, kind: 'id' | 'secret'): string {
  const name =
    kind === 'id'
      ? provider === 'github'
        ? 'GITHUB_CLIENT_ID'
        : 'GOOGLE_CLIENT_ID'
      : provider === 'github'
        ? 'GITHUB_CLIENT_SECRET'
        : 'GOOGLE_CLIENT_SECRET';
  return (process.env[name] || '').trim();
}

function storedSecret(provider: Provider): string {
  const encrypted = getSetting(`oauth:${provider}:client_secret`, '');
  if (!encrypted) return '';
  try {
    return decryptSecret(encrypted);
  } catch {
    return '';
  }
}

/** Credentials saved by the platform owner win over environment variables. */
function config(provider: Provider): ProviderConfig {
  const clientId = getSetting(`oauth:${provider}:client_id`, '').trim() || envValue(provider, 'id');
  const clientSecret = storedSecret(provider) || envValue(provider, 'secret');
  return { clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function baseUrl(req: Request): string {
  const configured = (process.env.APP_URL || '').replace(/\/+$/, '');
  if (configured) return configured;
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return `${forwarded || req.protocol}://${req.get('host')}`;
}

function callbackUrl(req: Request, provider: Provider): string {
  return `${baseUrl(req)}${STATE_PATH}/${provider}/callback`;
}

function isProvider(value: string): value is Provider {
  return (PROVIDERS as string[]).includes(value);
}

async function githubProfile(cfg: ProviderConfig, code: string, redirectUri: string): Promise<OAuthProfile> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenJson: any = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || 'GitHub token exchange failed');
  }
  const headers = {
    Authorization: `Bearer ${tokenJson.access_token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pomp-net-cloud',
  };
  const userRes = await fetch('https://api.github.com/user', { headers });
  if (!userRes.ok) throw new Error('GitHub user request failed');
  const user: any = await userRes.json();

  let email: string | null = null;
  let verified = false;
  const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
  if (emailsRes.ok) {
    const emails: any[] = await emailsRes.json();
    const primary = emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified);
    if (primary) {
      email = primary.email;
      verified = true;
    }
  }
  return {
    providerUserId: String(user.id),
    email: String(email || user.email || '').toLowerCase(),
    emailVerified: verified,
    name: user.name || user.login || 'GitHub user',
    avatarUrl: user.avatar_url ?? null,
  };
}

async function googleProfile(cfg: ProviderConfig, code: string, redirectUri: string): Promise<OAuthProfile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenJson: any = await tokenRes.json();
  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(tokenJson.error_description || 'Google token exchange failed');
  }
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!infoRes.ok) throw new Error('Google profile request failed');
  const info: any = await infoRes.json();
  return {
    providerUserId: String(info.sub),
    email: String(info.email || '').toLowerCase(),
    emailVerified: Boolean(info.email_verified),
    name: info.name || String(info.email || 'Google user').split('@')[0],
    avatarUrl: info.picture ?? null,
  };
}

/** Links an OAuth identity to an existing account by email, or provisions a new user + workspace. */
function resolveUser(provider: Provider, profile: OAuthProfile) {
  const now = nowIso();
  const linked = db
    .prepare('SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?')
    .get(provider, profile.providerUserId) as { user_id: string } | undefined;
  let userId = linked?.user_id ?? null;

  if (!userId) {
    const byEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(profile.email) as
      | { id: string }
      | undefined;
    userId = byEmail?.id ?? null;
  }

  if (!userId) {
    userId = randomToken(12);
    const ownerEmail = (process.env.PLATFORM_OWNER_EMAIL || '').toLowerCase().trim();
    const ownerExists = db.prepare('SELECT id FROM users WHERE is_platform_owner = 1 LIMIT 1').get();
    const bootstrapped = getSetting('owner_bootstrapped', '0') === '1';
    const isOwner = ownerEmail ? profile.email === ownerEmail : !ownerExists && !bootstrapped;

    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, avatar_url, email_verified_at, is_platform_owner,
         last_login_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      profile.email,
      `oauth:${randomToken(24)}`,
      profile.name,
      profile.avatarUrl,
      profile.emailVerified ? now : null,
      isOwner ? 1 : 0,
      now,
      now,
      now,
    );
    if (isOwner && !ownerEmail) setSetting('owner_bootstrapped', '1');

    const workspaceId = randomToken(12);
    db.prepare(
      `INSERT INTO workspaces (id, name, slug, owner_id, plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free', ?, ?)`,
    ).run(
      workspaceId,
      `${profile.name.split(' ')[0]}'s workspace`,
      `ws-${randomToken(5).toLowerCase()}`,
      userId,
      now,
      now,
    );
    db.prepare(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES (?, ?, ?, 'owner', ?)`,
    ).run(randomToken(12), workspaceId, userId, now);
  }

  db.prepare(
    `INSERT INTO oauth_accounts (id, user_id, provider, provider_user_id, email, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (provider, provider_user_id) DO UPDATE SET email = excluded.email`,
  ).run(randomToken(12), userId, provider, profile.providerUserId, profile.email, now);

  db.prepare(
    `UPDATE users SET avatar_url = COALESCE(avatar_url, ?), last_login_at = ?,
       email_verified_at = CASE WHEN ? = 1 THEN COALESCE(email_verified_at, ?) ELSE email_verified_at END
     WHERE id = ?`,
  ).run(profile.avatarUrl, now, profile.emailVerified ? 1 : 0, now, userId);

  return db
    .prepare('SELECT id, email, suspended_at, suspended_reason FROM users WHERE id = ?')
    .get(userId) as { id: string; email: string; suspended_at: string | null; suspended_reason: string | null };
}

/** Public capability probe so the UI can show honest enabled/disabled buttons. */
oauthRouter.get('/providers', (_req, res) => {
  res.json({
    github: { configured: config('github').configured, label: 'GitHub' },
    google: { configured: config('google').configured, label: 'Google' },
  });
});

/* ------------------------- Owner-managed credentials ------------------------ */

function describeProvider(provider: Provider, req: Request) {
  const storedId = getSetting(`oauth:${provider}:client_id`, '').trim();
  const storedHasSecret = Boolean(getSetting(`oauth:${provider}:client_secret`, ''));
  const cfg = config(provider);
  return {
    provider,
    clientId: cfg.clientId,
    clientIdSource: storedId ? 'settings' : envValue(provider, 'id') ? 'env' : null,
    hasSecret: Boolean(cfg.clientSecret),
    secretSource: storedHasSecret ? 'settings' : envValue(provider, 'secret') ? 'env' : null,
    configured: cfg.configured,
    callbackUrl: callbackUrl(req, provider),
  };
}

function describeAll(req: Request) {
  return {
    github: describeProvider('github', req),
    google: describeProvider('google', req),
    authorizeUrls: {
      github: 'https://github.com/settings/developers',
      google: 'https://console.cloud.google.com/apis/credentials',
    },
  };
}

oauthRouter.get('/settings', requireAuth, requirePlatformOwner, (req, res) => {
  res.json(describeAll(req));
});

oauthRouter.put(
  '/settings',
  requireAuth,
  requirePlatformOwner,
  route(async (req, res) => {
    const body = parse(
      z.object({
        provider: z.enum(['github', 'google']),
        clientId: z.string().trim().min(6).max(200),
        clientSecret: z.string().trim().max(400).optional(),
      }),
      req.body,
    );
    setSetting(`oauth:${body.provider}:client_id`, body.clientId);
    if (body.clientSecret) {
      setSetting(`oauth:${body.provider}:client_secret`, encryptSecret(body.clientSecret));
    }
    audit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: `oauth.credentials.updated`,
      targetType: 'provider',
      targetId: body.provider,
      metadata: { secretUpdated: Boolean(body.clientSecret) },
      ip: req.ip,
    });
    res.json(describeAll(req));
  }),
);

oauthRouter.delete(
  '/settings/:provider',
  requireAuth,
  requirePlatformOwner,
  route(async (req, res) => {
    const provider = String(req.params.provider || '');
    if (!isProvider(provider)) throw new ApiError(404, 'not_found', 'Unsupported sign-in provider');
    db.prepare('DELETE FROM platform_settings WHERE key IN (?, ?)').run(
      `oauth:${provider}:client_id`,
      `oauth:${provider}:client_secret`,
    );
    audit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'oauth.credentials.cleared',
      targetType: 'provider',
      targetId: provider,
      ip: req.ip,
    });
    res.json(describeAll(req));
  }),
);

oauthRouter.get('/:provider/start', (req: Request, res: Response) => {
  const provider = String(req.params.provider || '');
  if (!isProvider(provider)) {
    res.status(404).json({ error: { code: 'not_found', message: 'Unsupported sign-in provider' } });
    return;
  }
  const cfg = config(provider);
  if (!cfg.configured) {
    res.status(503).json({
      error: {
        code: 'integration_required',
        message: `${provider} sign-in is not configured on this deployment yet.`,
      },
    });
    return;
  }
  rateLimit(`oauth-start:${req.ip}`, 30, 5 * 60_000);

  const state = randomToken(24);
  res.cookie(STATE_COOKIE, `${provider}:${state}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: baseUrl(req).startsWith('https://'),
    path: STATE_PATH,
    maxAge: 10 * 60_000,
  });

  const url = new URL(
    provider === 'github'
      ? 'https://github.com/login/oauth/authorize'
      : 'https://accounts.google.com/o/oauth2/v2/auth',
  );
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', callbackUrl(req, provider));
  url.searchParams.set('state', state);
  if (provider === 'github') {
    url.searchParams.set('scope', 'read:user user:email');
  } else {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
  }
  res.redirect(url.toString());
});

oauthRouter.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = String(req.params.provider || '');
  const fail = (code: string, message: string) => {
    res.redirect(`/login?oauth_error=${encodeURIComponent(code)}&oauth_message=${encodeURIComponent(message)}`);
  };

  try {
    if (!isProvider(provider)) return fail('unsupported', 'Unsupported sign-in provider.');
    const cfg = config(provider);
    if (!cfg.configured) return fail('not_configured', `${provider} sign-in is not configured on this deployment.`);

    const state = String(req.query.state || '');
    const code = String(req.query.code || '');
    const stored = String((req as any).cookies?.[STATE_COOKIE] || '');
    res.clearCookie(STATE_COOKIE, { path: STATE_PATH });

    if (String(req.query.error || '').length > 0) {
      return fail('denied', 'Sign-in was cancelled at the provider.');
    }
    if (!code || !state || stored !== `${provider}:${state}`) {
      return fail('state', 'This sign-in attempt expired or could not be verified. Please try again.');
    }
    rateLimit(`oauth-callback:${req.ip}`, 30, 5 * 60_000);

    const redirectUri = callbackUrl(req, provider);
    const profile =
      provider === 'github'
        ? await githubProfile(cfg, code, redirectUri)
        : await googleProfile(cfg, code, redirectUri);

    if (!profile.email) return fail('email', 'The provider did not share an email address for this account.');

    const user = resolveUser(provider, profile);
    if (user.suspended_at) {
      return fail('suspended', user.suspended_reason || 'This account is suspended.');
    }

    createSession(user.id, req, res);
    audit({
      actorId: user.id,
      actorEmail: user.email,
      action: `auth.oauth.${provider}`,
      targetType: 'user',
      targetId: user.id,
      ip: req.ip,
    });
    res.redirect('/dashboard');
  } catch (error: any) {
    fail('provider', String(error?.message || 'Provider sign-in failed').slice(0, 200));
  }
});
