import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { assertWorkspaceAccess, requireAuth } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { ApiError, conflict, forbidden, notFound, nowIso, parse, route } from '../lib/http.js';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../lib/crypto.js';
import { rateLimit } from '../lib/rateLimit.js';
import { envProviderToken, getAdapter } from '../providers/index.js';

export const providerRouter = Router();
providerRouter.use(requireAuth);

const RAILWAY_DOCS = 'https://docs.railway.com/reference/public-api';
const GITHUB_SCOPES = 'read:user repo';

function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
}

function setSetting(key: string, value: unknown) {
  db.prepare(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}

function takeSetting<T>(key: string): T | null {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key) as any;
  if (!row) return null;
  db.prepare('DELETE FROM platform_settings WHERE key = ?').run(key);
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function connectionSummary(row: any) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    accountName: row.account_name,
    accountEmail: row.account_email,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  };
}

providerRouter.get(
  '/',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    const rows = db
      .prepare('SELECT * FROM provider_connections WHERE workspace_id = ?')
      .all(workspaceId) as any[];
    const railway = rows.find((r) => r.provider === 'railway') ?? null;
    const github = rows.find((r) => r.provider === 'github') ?? null;
    const adapter = getAdapter('railway');
    res.json({
      railway: {
        connected: Boolean(railway) || Boolean(envProviderToken('railway')),
        source: railway ? 'workspace' : envProviderToken('railway') ? 'server' : null,
        connection: railway
          ? connectionSummary(railway)
          : envProviderToken('railway')
            ? {
                id: 'server-env',
                provider: 'railway',
                label: 'Server environment token',
                accountName: null,
                accountEmail: null,
                status: 'connected',
                lastCheckedAt: null,
                createdAt: null,
              }
            : null,
        capabilities: adapter.capabilities,
        displayName: adapter.displayName,
        docsUrl: RAILWAY_DOCS,
        note:
          'POMP NET does not own or resell Railway infrastructure. Deployments run in the account whose API token you authorize here, and the token is encrypted server-side.',
      },
      github: {
        configured: githubConfigured(),
        connected: Boolean(github),
        connection: github ? connectionSummary(github) : null,
        note: githubConfigured()
          ? 'GitHub OAuth is configured on this deployment.'
          : 'GitHub OAuth needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET on the server before repositories can be listed.',
      },
    });
  }),
);

providerRouter.post(
  '/railway/connect',
  route(async (req, res) => {
    const body = parse(
      z.object({
        workspaceId: z.string().min(1),
        token: z.string().trim().min(10).max(400),
        label: z.string().trim().max(60).optional(),
      }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'admin');
    rateLimit(`railway-connect:${req.user!.id}`, 8, 60_000);
    const adapter = getAdapter('railway');
    const account = await adapter.validateConnection(body.token);
    const existing = db
      .prepare(`SELECT id FROM provider_connections WHERE workspace_id = ? AND provider = 'railway'`)
      .get(body.workspaceId) as any;
    const now = nowIso();
    if (existing) {
      db.prepare(
        `UPDATE provider_connections SET token_encrypted = ?, account_name = ?, account_email = ?, label = ?,
           status = 'connected', last_checked_at = ?, created_by = ? WHERE id = ?`,
      ).run(
        encryptSecret(body.token),
        account.name,
        account.email,
        body.label || 'Railway',
        now,
        req.user!.id,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO provider_connections (id, workspace_id, provider, label, token_encrypted, account_name,
           account_email, status, last_checked_at, created_by, created_at)
         VALUES (?, ?, 'railway', ?, ?, ?, ?, 'connected', ?, ?, ?)`,
      ).run(
        randomToken(12),
        body.workspaceId,
        body.label || 'Railway',
        encryptSecret(body.token),
        account.name,
        account.email,
        now,
        req.user!.id,
        now,
      );
    }
    audit({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'provider.connected',
      targetType: 'provider',
      targetId: 'railway',
      metadata: { account: account.name },
      ip: req.ip,
    });
    res.status(201).json({ account, note: 'Token stored encrypted on the server. It is never returned to the browser.' });
  }),
);

providerRouter.post(
  '/:id/verify',
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(req.params.id) as any;
    if (!row) throw notFound('Provider connection not found');
    assertWorkspaceAccess(req.user!.id, row.workspace_id, 'admin');
    if (row.provider !== 'railway') throw conflict('Only Railway connections are verified through this endpoint');
    const adapter = getAdapter('railway');
    try {
      const account = await adapter.validateConnection(decryptSecret(row.token_encrypted));
      db.prepare(
        `UPDATE provider_connections SET status = 'connected', account_name = ?, account_email = ?, last_checked_at = ? WHERE id = ?`,
      ).run(account.name, account.email, nowIso(), row.id);
      res.json({ ok: true, account });
    } catch (err: any) {
      db.prepare(`UPDATE provider_connections SET status = 'invalid', last_checked_at = ? WHERE id = ?`).run(
        nowIso(),
        row.id,
      );
      throw new ApiError(502, 'provider_rejected', `The provider rejected this token: ${err?.message ?? err}`);
    }
  }),
);

providerRouter.delete(
  '/:id',
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(req.params.id) as any;
    if (!row) throw notFound('Provider connection not found');
    assertWorkspaceAccess(req.user!.id, row.workspace_id, 'admin');
    db.prepare('DELETE FROM provider_connections WHERE id = ?').run(row.id);
    audit({
      workspaceId: row.workspace_id,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'provider.disconnected',
      targetType: 'provider',
      targetId: row.provider,
      ip: req.ip,
    });
    res.json({ ok: true });
  }),
);

providerRouter.get(
  '/:id/projects',
  route(async (req, res) => {
    const row = db.prepare('SELECT * FROM provider_connections WHERE id = ?').get(req.params.id) as any;
    if (!row) throw notFound('Provider connection not found');
    assertWorkspaceAccess(req.user!.id, row.workspace_id, 'viewer');
    if (row.provider !== 'railway') throw conflict('Only Railway connections expose projects');
    const adapter = getAdapter('railway');
    const projects = await adapter.listProjects(decryptSecret(row.token_encrypted));
    res.json({ projects });
  }),
);

/* --------------------- GitHub account connection (token) ------------------- */

/**
 * Connects the user's own GitHub account without requiring an OAuth app: the token is
 * verified against the GitHub API, then stored encrypted per workspace. Only the backend
 * ever decrypts it, so repository listing and deploys happen with the user's real access.
 */
providerRouter.post(
  '/github/connect',
  route(async (req, res) => {
    const body = parse(
      z.object({
        workspaceId: z.string().min(1),
        token: z.string().trim().min(20).max(512),
        label: z.string().trim().max(60).optional(),
      }),
      req.body,
    );
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'admin');
    rateLimit(`github-connect:${req.user!.id}`, 8, 60_000);

    const headers = {
      authorization: `Bearer ${body.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'pomp-net-cloud',
      'x-github-api-version': '2022-11-28',
    };

    const whoRes = await fetch('https://api.github.com/user', { headers });
    if (whoRes.status === 401 || whoRes.status === 403) {
      throw new ApiError(401, 'invalid_token', 'GitHub rejected this token.');
    }
    if (!whoRes.ok) {
      throw new ApiError(
        502,
        'provider_error',
        `GitHub returned ${whoRes.status} while verifying the token.`,
      );
    }
    const who = (await whoRes.json()) as any;

    // Count accessible repositories honestly (private ones included only if the token allows it).
    let accessibleRepos: number | null = null;
    const reposRes = await fetch('https://api.github.com/user/repos?per_page=1&sort=updated', { headers });
    if (reposRes.ok) {
      const link = reposRes.headers.get('link') ?? '';
      const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(link);
      accessibleRepos = last ? Number(last[1]) : ((await reposRes.json()) as any[]).length;
    }

    const accountName = String(who.login ?? 'GitHub');
    const existing = db
      .prepare(`SELECT id FROM provider_connections WHERE workspace_id = ? AND provider = 'github'`)
      .get(body.workspaceId) as any;
    const now = nowIso();
    if (existing) {
      db.prepare(
        `UPDATE provider_connections SET token_encrypted = ?, account_name = ?, account_email = ?, label = ?,
           status = 'connected', last_checked_at = ?, created_by = ? WHERE id = ?`,
      ).run(
        encryptSecret(body.token),
        accountName,
        who.email ?? null,
        body.label || 'GitHub',
        now,
        req.user!.id,
        existing.id,
      );
    } else {
      db.prepare(
        `INSERT INTO provider_connections (id, workspace_id, provider, label, token_encrypted, account_name,
           account_email, status, last_checked_at, created_by, created_at)
         VALUES (?, ?, 'github', ?, ?, ?, ?, 'connected', ?, ?, ?)`,
      ).run(
        randomToken(12),
        body.workspaceId,
        body.label || 'GitHub',
        encryptSecret(body.token),
        accountName,
        who.email ?? null,
        now,
        req.user!.id,
        now,
      );
    }

    audit({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'github.connected',
      targetType: 'provider',
      targetId: 'github',
      metadata: { account: accountName, method: 'token' },
      ip: req.ip,
    });

    res.status(201).json({
      account: {
        login: accountName,
        name: who.name ?? null,
        email: who.email ?? null,
        avatarUrl: who.avatar_url ?? null,
        accessibleRepos,
      },
      note: 'Token stored encrypted on the server. It is never returned to the browser.',
    });
  }),
);

/* ------------------------------- GitHub OAuth ------------------------------ */

providerRouter.get(
  '/github/authorize',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    assertWorkspaceAccess(req.user!.id, workspaceId, 'admin');
    if (!githubConfigured()) {
      throw new ApiError(
        501,
        'integration_not_configured',
        'GitHub OAuth is not configured on this server. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (callback: /api/providers/github/callback), then retry.',
      );
    }
    const state = randomToken(24);
    setSetting(`oauth_state:${sha256(state)}`, {
      workspaceId,
      userId: req.user!.id,
      expiresAt: Date.now() + 10 * 60_000,
    });
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID!,
      redirect_uri: `${process.env.APP_URL || ''}/api/providers/github/callback`,
      scope: GITHUB_SCOPES,
      state,
    });
    res.json({ url: `https://github.com/login/oauth/authorize?${params.toString()}` });
  }),
);

providerRouter.get(
  '/github/callback',
  route(async (req, res) => {
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    const appUrl = process.env.APP_URL || '';
    const stored = takeSetting<{ workspaceId: string; userId: string; expiresAt: number }>(
      `oauth_state:${sha256(state)}`,
    );
    if (!stored || stored.expiresAt < Date.now() || stored.userId !== req.user?.id) {
      res.redirect(`${appUrl}/#/settings?github=state_invalid`);
      return;
    }
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenJson = (await tokenRes.json()) as any;
    if (!tokenJson.access_token) {
      res.redirect(`${appUrl}/#/settings?github=exchange_failed`);
      return;
    }
    const userRes = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenJson.access_token}`, accept: 'application/vnd.github+json' },
    });
    const ghUser = (await userRes.json()) as any;
    const existing = db
      .prepare(`SELECT id FROM provider_connections WHERE workspace_id = ? AND provider = 'github'`)
      .get(stored.workspaceId) as any;
    const now = nowIso();
    if (existing) {
      db.prepare(
        `UPDATE provider_connections SET token_encrypted = ?, account_name = ?, account_email = ?, status = 'connected',
           last_checked_at = ? WHERE id = ?`,
      ).run(encryptSecret(tokenJson.access_token), ghUser.login ?? 'GitHub', ghUser.email ?? null, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO provider_connections (id, workspace_id, provider, label, token_encrypted, account_name,
           account_email, status, last_checked_at, created_by, created_at)
         VALUES (?, ?, 'github', 'GitHub', ?, ?, ?, 'connected', ?, ?, ?)`,
      ).run(
        randomToken(12),
        stored.workspaceId,
        encryptSecret(tokenJson.access_token),
        ghUser.login ?? 'GitHub',
        ghUser.email ?? null,
        now,
        stored.userId,
        now,
      );
    }
    audit({
      workspaceId: stored.workspaceId,
      actorId: stored.userId,
      action: 'github.connected',
      targetType: 'provider',
      targetId: 'github',
      metadata: { account: ghUser.login },
      ip: req.ip,
    });
    res.redirect(`${appUrl}/#/settings?github=connected`);
  }),
);

async function githubToken(workspaceId: string): Promise<string> {
  const row = db
    .prepare(`SELECT * FROM provider_connections WHERE workspace_id = ? AND provider = 'github'`)
    .get(workspaceId) as any;
  if (!row) {
    throw new ApiError(
      409,
      'integration_required',
      'Connect your GitHub account for this workspace before using repository features.',
    );
  }
  return decryptSecret(row.token_encrypted);
}

async function gh(path: string, token: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'pomp-net-cloud',
    },
  });
  if (!res.ok) {
    throw new ApiError(502, 'github_error', `GitHub API responded ${res.status} for ${path}`);
  }
  return res.json();
}

providerRouter.get(
  '/github/repos',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    const token = await githubToken(workspaceId);
    const repos = (await gh('/user/repos?per_page=100&sort=updated', token)) as any[];
    res.json({
      repos: repos.map((r) => ({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description,
        updatedAt: r.updated_at,
        language: r.language,
        htmlUrl: r.html_url,
      })),
    });
  }),
);

providerRouter.get(
  '/github/branches',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    const repo = String(req.query.repo || '');
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw conflict('Repository must be in owner/name form');
    const token = await githubToken(workspaceId);
    const branches = (await gh(`/repos/${repo}/branches?per_page=100`, token)) as any[];
    res.json({ branches: branches.map((b) => ({ name: b.name, sha: b.commit?.sha ?? null })) });
  }),
);

providerRouter.get(
  '/github/commits',
  route(async (req, res) => {
    const workspaceId = String(req.query.workspaceId || '');
    const repo = String(req.query.repo || '');
    const branch = String(req.query.branch || '');
    assertWorkspaceAccess(req.user!.id, workspaceId, 'viewer');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw conflict('Repository must be in owner/name form');
    const token = await githubToken(workspaceId);
    const commits = (await gh(
      `/repos/${repo}/commits?per_page=10${branch ? `&sha=${encodeURIComponent(branch)}` : ''}`,
      token,
    )) as any[];
    res.json({
      commits: commits.map((c) => ({
        sha: c.sha,
        shortSha: String(c.sha).slice(0, 7),
        message: c.commit?.message?.split('\n')[0] ?? '',
        author: c.commit?.author?.name ?? null,
        date: c.commit?.author?.date ?? null,
        htmlUrl: c.html_url,
      })),
    });
  }),
);

providerRouter.post(
  '/github/disconnect',
  route(async (req, res) => {
    const body = parse(z.object({ workspaceId: z.string().min(1) }), req.body);
    assertWorkspaceAccess(req.user!.id, body.workspaceId, 'admin');
    db.prepare(`DELETE FROM provider_connections WHERE workspace_id = ? AND provider = 'github'`).run(body.workspaceId);
    res.json({ ok: true });
  }),
);

export { forbidden };
