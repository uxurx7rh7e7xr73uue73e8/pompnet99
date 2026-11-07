#!/usr/bin/env node
/**
 * POMP NET CLOUD — end-to-end regression check against a real server process.
 *
 * Starts the API on a temporary SQLite database and exercises the authenticated
 * workflow: registration, session handling, workspace/project/service creation,
 * provider gating (no fake deployments), templates, dashboard and admin access.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 18000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const workdir = mkdtempSync(path.join(tmpdir(), 'pompnet-'));
const dbPath = path.join(workdir, 'test.db');
const checks = [];

function ok(name, detail = '') {
  checks.push({ name, passed: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail) {
  checks.push({ name, passed: false, detail });
  console.log(`  ✗ ${name} — ${detail}`);
}

class Client {
  constructor() {
    this.cookie = '';
  }
  async request(method, url, body) {
    const headers = { 'content-type': 'application/json' };
    if (this.cookie) headers.cookie = this.cookie;
    const res = await fetch(`${BASE}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const raw of setCookie) {
      const pair = raw.split(';')[0];
      if (pair.startsWith('pn_session=')) this.cookie = pair;
    }
    let json = null;
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }
    return { status: res.status, body: json };
  }
  get(url) {
    return this.request('GET', url);
  }
  post(url, body) {
    return this.request('POST', url, body ?? {});
  }
  patch(url, body) {
    return this.request('PATCH', url, body ?? {});
  }
  del(url) {
    return this.request('DELETE', url);
  }
}

async function waitForServer(timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATABASE_PATH: dbPath,
    APP_SECRET: 'regression-secret-value-used-only-for-tests-32b',
    NODE_ENV: 'test',
    APP_URL: BASE,
    PLATFORM_OWNER_EMAIL: 'owner@pompnet.test',
    GITHUB_CLIENT_ID: '',
    GITHUB_CLIENT_SECRET: '',
    SMTP_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (d) => {
  serverLog += d.toString();
});
server.stderr.on('data', (d) => {
  serverLog += d.toString();
});

function finish(code) {
  server.kill('SIGKILL');
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
  const failed = checks.filter((c) => !c.passed);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('\nServer log tail:\n' + serverLog.split('\n').slice(-25).join('\n'));
  }
  process.exit(code);
}

try {
  const ready = await waitForServer();
  if (!ready) {
    fail('server started', 'health endpoint never responded');
    finish(1);
  }
  ok('server started', BASE);

  const health = await new Client().get('/api/health');
  health.status === 200 ? ok('health endpoint') : fail('health endpoint', `status ${health.status}`);

  const anon = new Client();
  const anonProjects = await anon.get('/api/projects');
  anonProjects.status === 401
    ? ok('unauthenticated access rejected', '401')
    : fail('unauthenticated access rejected', `status ${anonProjects.status}`);

  const owner = new Client();
  const register = await owner.post('/api/auth/register', {
    name: 'Owner Test',
    email: 'owner@pompnet.test',
    password: 'Sup3rSecretPass!',
  });
  register.status === 201
    ? ok('registration', register.body?.user?.email)
    : fail('registration', `status ${register.status} ${JSON.stringify(register.body)}`);

  const me = await owner.get('/api/auth/me');
  me.status === 200 && me.body?.user
    ? ok('session established', me.body.user.email)
    : fail('session established', `status ${me.status}`);

  const workspaces = me.body?.workspaces ?? [];
  workspaces.length
    ? ok('personal workspace created', workspaces[0].name)
    : fail('personal workspace created', 'no workspace returned');
  const workspaceId = workspaces[0]?.id;

  const weak = await new Client().post('/api/auth/register', {
    name: 'Weak',
    email: 'weak@pompnet.test',
    password: 'short',
  });
  weak.status === 400 ? ok('weak password rejected', '400') : fail('weak password rejected', `status ${weak.status}`);

  const project = await owner.post('/api/projects', {
    workspaceId,
    name: 'Regression App',
    description: 'created by regression script',
  });
  project.status === 201
    ? ok('project created', project.body?.project?.name)
    : fail('project created', `status ${project.status} ${JSON.stringify(project.body)}`);
  const projectId = project.body?.project?.id;

  const detail = await owner.get(`/api/projects/${projectId}`);
  const environments = detail.body?.environments ?? [];
  environments.length
    ? ok('default environments provisioned', environments.map((e) => e.name).join(', '))
    : fail('default environments provisioned', 'none');
  const environmentId = environments[0]?.id;

  const service = await owner.post('/api/services', {
    projectId,
    environmentId,
    name: 'api',
    sourceType: 'github',
    repoFullName: 'pompnet/demo-api',
    branch: 'main',
  });
  service.status === 201
    ? ok('service created', service.body?.service?.name)
    : fail('service created', `status ${service.status} ${JSON.stringify(service.body)}`);
  const serviceId = service.body?.service?.id;

  const deploy = await owner.post(`/api/services/${serviceId}/deploy`, {});
  deploy.status === 409 && deploy.body?.error?.code === 'integration_required'
    ? ok('deployment blocked without provider', 'integration_required (no fake deploy)')
    : fail('deployment blocked without provider', `status ${deploy.status} ${JSON.stringify(deploy.body)}`);

  const metrics = await owner.get(`/api/services/${serviceId}/metrics`);
  metrics.status === 200 && metrics.body?.available === false
    ? ok('metrics honestly unavailable', metrics.body?.reason)
    : fail('metrics honestly unavailable', `status ${metrics.status} ${JSON.stringify(metrics.body)}`);

  const logs = await owner.get(`/api/services/${serviceId}/logs`);
  logs.status === 200 && Array.isArray(logs.body?.logs)
    ? ok('log endpoint returns recorded lines only', `${logs.body.logs.length} lines`)
    : fail('log endpoint', `status ${logs.status}`);

  const variables = await owner.post(`/api/services/${serviceId}/variables`, {
    variables: [{ key: 'API_TOKEN', value: 'super-secret-value', isSecret: true }],
  });
  variables.status === 200 || variables.status === 201
    ? ok('secret variable stored')
    : fail('secret variable stored', `status ${variables.status} ${JSON.stringify(variables.body)}`);

  const readVars = await owner.get(`/api/services/${serviceId}/variables`);
  const leaked = JSON.stringify(readVars.body ?? {}).includes('super-secret-value');
  !leaked ? ok('secret value masked in API response') : fail('secret value masked in API response', 'plaintext leaked');

  const providers = await owner.get(`/api/providers?workspaceId=${workspaceId}`);
  providers.status === 200 && providers.body?.railway?.connected === false
    ? ok('provider reported as not connected', providers.body?.railway?.note ? 'with note' : '')
    : fail('provider reported as not connected', `status ${providers.status}`);

  const railwayConnect = await owner.post('/api/providers/railway/connect', {
    workspaceId,
    token: 'invalid-token-for-test',
    label: 'Test',
  });
  railwayConnect.status >= 400
    ? ok('invalid provider token rejected', `status ${railwayConnect.status}`)
    : fail('invalid provider token rejected', `status ${railwayConnect.status}`);

  const templates = await owner.get('/api/templates');
  const templateList = templates.body?.templates ?? [];
  templateList.length ? ok('templates seeded', `${templateList.length} templates`) : fail('templates seeded', 'none');

  const dashboard = await owner.get(`/api/dashboard?workspaceId=${workspaceId}`);
  dashboard.status === 200 && dashboard.body?.counts
    ? ok('dashboard aggregates real rows', `projects=${dashboard.body.counts.projects}`)
    : fail('dashboard aggregates real rows', `status ${dashboard.status}`);

  const search = await owner.get(`/api/dashboard/search?workspaceId=${workspaceId}&q=Regression`);
  Array.isArray(search.body?.results) && search.body.results.length
    ? ok('global search finds project')
    : fail('global search finds project', JSON.stringify(search.body));

  const adminDenied = await owner.get('/api/admin/overview');
  // The first account is the platform owner by configuration, so this must succeed.
  adminDenied.status === 200
    ? ok('platform owner can read admin overview')
    : fail('platform owner can read admin overview', `status ${adminDenied.status}`);

  const other = new Client();
  await other.post('/api/auth/register', {
    name: 'Other User',
    email: 'other@pompnet.test',
    password: 'An0therSecretPass!',
  });
  const otherAdmin = await other.get('/api/admin/overview');
  otherAdmin.status === 403
    ? ok('non-owner blocked from admin panel', '403')
    : fail('non-owner blocked from admin panel', `status ${otherAdmin.status}`);

  const crossAccess = await other.get(`/api/projects/${projectId}`);
  crossAccess.status === 403 || crossAccess.status === 404
    ? ok('cross-workspace project access denied', `status ${crossAccess.status}`)
    : fail('cross-workspace project access denied', `status ${crossAccess.status}`);

  const badDelete = await owner.del(`/api/services/${serviceId}?confirm=wrong`);
  badDelete.status === 409
    ? ok('service deletion requires name confirmation', '409')
    : fail('service deletion requires name confirmation', `status ${badDelete.status}`);

  const logout = await owner.post('/api/auth/logout', {});
  const afterLogout = await owner.get('/api/auth/me');
  logout.status === 200 && afterLogout.body?.user === null
    ? ok('logout invalidates session')
    : fail('logout invalidates session', `status ${afterLogout.status}`);

  const webhook = await fetch(`${BASE}/api/webhooks/github/${serviceId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
    body: JSON.stringify({ ref: 'refs/heads/main' }),
  });
  webhook.status === 401 || webhook.status === 403
    ? ok('webhook signature verified', `status ${webhook.status}`)
    : fail('webhook signature verified', `status ${webhook.status}`);

  finish(checks.every((c) => c.passed) ? 0 : 1);
} catch (err) {
  fail('regression run', err?.stack ?? String(err));
  finish(1);
}
