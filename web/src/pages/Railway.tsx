import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { del, errorMessage, formatDate, get, post } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  SectionTitle,
  Select,
  Spinner,
  Textarea,
  useToast,
} from '../lib/ui';

type Preset = {
  slug: string;
  name: string;
  image: string;
  port: number;
  category: string;
  fa: string;
  en: string;
  variables: Array<{ key: string; value: string; secret: boolean }>;
};

type Capabilities = {
  stopService: boolean;
  resourceMetrics: boolean;
  rollback: boolean;
  managedDatabases: boolean;
  reasons: Record<string, string>;
};

type Overview = {
  connection: {
    connected: boolean;
    status: string;
    accountName: string | null;
    accountEmail: string | null;
    lastCheckedAt: string | null;
  } | null;
  projects: Array<{ id: string; name: string; imported: boolean }>;
  projectsError: string | null;
  presets: Preset[];
  capabilities: Capabilities;
  note: string;
};

type RailService = {
  id: string;
  name: string;
  status: string;
  project_id: string;
  project_name: string;
  provider_project_id: string | null;
  provider_environment_id: string | null;
  provider_service_id: string | null;
  docker_image: string | null;
  repo_full_name: string | null;
  created_at: string;
  updated_at: string;
};

type DeploymentRow = {
  id: string;
  rawStatus: string;
  status: string;
  createdAt: string | null;
  staticUrl: string | null;
};

type StatusPayload = {
  deployments: DeploymentRow[];
  instance: {
    source: { image: string | null; repo: string | null; branch: string | null };
    startCommand: string | null;
    buildCommand: string | null;
    rootDirectory: string | null;
    domains: Array<{ id: string; domain: string; kind: string }>;
    partial: boolean;
  } | null;
  logs: Array<{ ts: string; stream: string; level: string; message: string }>;
  logsError: string | null;
  capabilities: Capabilities;
};

const EMPTY_FORM = {
  providerProjectId: '',
  providerEnvironmentId: '',
  name: '',
  image: '',
  port: '3000',
  vars: '',
  createDomain: true,
};

export default function Railway() {
  const { workspaceId } = useAuth();
  const { t } = useLang();
  const toast = useToast();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [services, setServices] = useState<RailService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [detail, setDetail] = useState<{
    id: string;
    name: string;
    environments: Array<{ id: string; name: string }>;
    services: Array<{ id: string; name: string }>;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [deploying, setDeploying] = useState(false);
  const [lastDeploy, setLastDeploy] = useState<any>(null);

  const [statusTarget, setStatusTarget] = useState<RailService | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState('');

  const [removing, setRemoving] = useState<RailService | null>(null);
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [ov, sv] = await Promise.all([
        get<Overview>('/railway/overview', { workspaceId }),
        get<{ services: RailService[] }>('/railway/services', { workspaceId }),
      ]);
      setOverview(ov);
      setServices(sv.services ?? []);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const presets = overview?.presets ?? [];
  const connected = overview?.connection?.connected ?? false;

  const selectedPreset = useMemo(
    () => presets.find((p) => p.image === form.image) ?? null,
    [presets, form.image],
  );

  const pickProject = async (providerProjectId: string) => {
    setForm((f) => ({ ...f, providerProjectId, providerEnvironmentId: '' }));
    setDetail(null);
    if (!providerProjectId || !workspaceId) return;
    setDetailLoading(true);
    try {
      const res = await get<{ project: NonNullable<typeof detail> }>(
        `/railway/projects/${providerProjectId}`,
        { workspaceId },
      );
      setDetail(res.project);
      const prod =
        res.project.environments.find((e) => e.name.toLowerCase() === 'production') ??
        res.project.environments[0];
      setForm((f) => ({ ...f, providerEnvironmentId: prod?.id ?? '' }));
    } catch (err) {
      toast.error(t('خواندن پروژه ناموفق بود', 'Could not read project'), errorMessage(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const applyPreset = (preset: Preset) => {
    setForm((f) => ({
      ...f,
      image: preset.image,
      port: String(preset.port),
      name: f.name || preset.slug,
      vars: preset.variables.map((v) => `${v.key}=${v.value}`).join('\n'),
    }));
  };

  const parseVars = (raw: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!key || !value) continue;
      out[key] = value;
    }
    return out;
  };

  const submitDeploy = async () => {
    if (!workspaceId) return;
    if (!form.providerProjectId || !form.providerEnvironmentId) {
      toast.error(t('پروژه و محیط را انتخاب کنید', 'Select a project and environment'));
      return;
    }
    if (!form.image.trim()) {
      toast.error(t('تصویر داکر را وارد کنید', 'Enter a Docker image'));
      return;
    }
    setDeploying(true);
    setLastDeploy(null);
    try {
      const res = await post<any>('/railway/deploy', {
        workspaceId,
        providerProjectId: form.providerProjectId,
        providerEnvironmentId: form.providerEnvironmentId,
        name: form.name.trim() || selectedPreset?.slug || 'panel',
        image: form.image.trim(),
        port: Number(form.port) || undefined,
        variables: parseVars(form.vars),
        createDomain: form.createDomain,
      });
      setLastDeploy(res);
      if (res.deployError) {
        toast.error(t('Railway دیپلوی را نپذیرفت', 'Railway rejected the deployment'), res.deployError);
      } else {
        toast.success(
          t('درخواست دیپلوی واقعی ارسال شد', 'Real deployment requested'),
          t('وضعیت را از بخش سرویس‌ها بررسی کنید.', 'Track progress in the services section.'),
        );
      }
      await load();
    } catch (err) {
      toast.error(t('دیپلوی ناموفق بود', 'Deployment failed'), errorMessage(err));
    } finally {
      setDeploying(false);
    }
  };

  const openStatus = async (service: RailService) => {
    if (!workspaceId) return;
    setStatusTarget(service);
    setStatus(null);
    setStatusError('');
    setStatusLoading(true);
    try {
      const res = await get<StatusPayload>(`/railway/services/${service.id}/status`, { workspaceId });
      setStatus(res);
    } catch (err) {
      setStatusError(errorMessage(err));
    } finally {
      setStatusLoading(false);
    }
  };

  const refreshStatus = async () => {
    if (statusTarget) await openStatus(statusTarget);
  };

  const redeploy = async (service: RailService) => {
    if (!workspaceId) return;
    setBusyId(service.id);
    try {
      const res = await post<{ deploymentId: string }>(`/railway/services/${service.id}/redeploy`, {
        workspaceId,
      });
      toast.success(t('دیپلوی مجدد ارسال شد', 'Redeploy requested'), res.deploymentId);
      await load();
      if (statusTarget?.id === service.id) await refreshStatus();
    } catch (err) {
      toast.error(t('دیپلوی مجدد ناموفق بود', 'Redeploy failed'), errorMessage(err));
    } finally {
      setBusyId('');
    }
  };

  const rollback = async (service: RailService, deploymentId: string) => {
    if (!workspaceId) return;
    setBusyId(service.id);
    try {
      await post(`/railway/services/${service.id}/rollback`, { workspaceId, deploymentId });
      toast.success(t('بازگردانی به نسخه قبلی ارسال شد', 'Rollback requested'));
      await refreshStatus();
      await load();
    } catch (err) {
      toast.error(t('بازگردانی ناموفق بود', 'Rollback failed'), errorMessage(err));
    } finally {
      setBusyId('');
    }
  };

  const createDomain = async (service: RailService) => {
    if (!workspaceId) return;
    setBusyId(service.id);
    try {
      const res = await post<{ domain: { domain: string } }>(
        `/railway/services/${service.id}/domain`,
        { workspaceId },
      );
      toast.success(t('دامنه Railway ساخته شد', 'Railway domain created'), res.domain?.domain);
      if (statusTarget?.id === service.id) await refreshStatus();
    } catch (err) {
      toast.error(t('ساخت دامنه ناموفق بود', 'Domain creation failed'), errorMessage(err));
    } finally {
      setBusyId('');
    }
  };

  const removeService = async () => {
    if (!removing || !workspaceId) return;
    setBusyId(removing.id);
    try {
      await del(`/railway/services/${removing.id}?workspaceId=${encodeURIComponent(workspaceId)}`);
      toast.success(t('سرویس از Railway حذف شد', 'Service deleted on Railway'));
      setRemoving(null);
      setStatusTarget(null);
      await load();
    } catch (err) {
      toast.error(t('حذف ناموفق بود', 'Delete failed'), errorMessage(err));
    } finally {
      setBusyId('');
    }
  };

  const stats = useMemo(
    () => ({
      projects: overview?.projects.length ?? 0,
      services: services.length,
      running: services.filter((s) => s.status === 'running').length,
      failed: services.filter((s) => s.status === 'failed').length,
    }),
    [overview, services],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-10 text-sm text-[#A9A2BA]">
        <Spinner className="h-5 w-5 text-[#8B35FF]" />
        {t('در حال خواندن حساب Railway…', 'Reading your Railway account…')}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SectionTitle
        title={t('Railway', 'Railway')}
        subtitle={t(
          'پنل‌ها و سرویس‌های خودت را واقعاً روی حساب Railway متصل دیپلوی و مدیریت کن.',
          'Deploy and manage your own panels on your connected Railway account.',
        )}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void load()}>
              {t('بروزرسانی', 'Refresh')}
            </Button>
            <Link to="/settings">
              <Button variant="outline">{t('اتصال حساب', 'Connect account')}</Button>
            </Link>
          </div>
        }
      />

      {error ? (
        <Card className="border-rose-500/30 p-4 text-sm text-rose-300">{error}</Card>
      ) : null}

      {!connected ? (
        <Card className="p-5">
          <h3 className="text-base font-semibold text-[#F5F2FF]">
            {t('اول حساب Railway خودت را وصل کن', 'Connect your Railway account first')}
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#A9A2BA]">
            {t(
              'برای دیپلوی واقعی، یک توکن Railway با دسترسی حساب بساز و در «تنظیمات ← ارائه‌دهنده‌ها» ذخیره کن. توکن فقط در سرور رمزنگاری می‌شود و هیچ‌وقت به مرورگر فرستاده نمی‌شود. زیرساخت در حساب خودت اجرا می‌شود و POMP NET مالک آن نیست.',
              'Create a Railway account token and store it in Settings → Providers. The token is encrypted server-side and never sent to the browser. Infrastructure runs in your account; POMP NET does not own it.',
            )}
          </p>
          <div className="mt-4">
            <Link to="/settings">
              <Button>{t('رفتن به تنظیمات', 'Open settings')}</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4">
              <p className="text-xs text-[#A9A2BA]">{t('پروژه‌های Railway', 'Railway projects')}</p>
              <p className="mt-1 text-2xl font-semibold text-[#F5F2FF]">{stats.projects}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-[#A9A2BA]">{t('سرویس‌های متصل', 'Linked services')}</p>
              <p className="mt-1 text-2xl font-semibold text-[#F5F2FF]">{stats.services}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-[#A9A2BA]">{t('در حال اجرا', 'Running')}</p>
              <p className="mt-1 text-2xl font-semibold text-emerald-300">{stats.running}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-[#A9A2BA]">{t('ناموفق', 'Failed')}</p>
              <p className="mt-1 text-2xl font-semibold text-rose-300">{stats.failed}</p>
            </Card>
          </div>

          <Card className="p-5">
            <SectionTitle
              title={t('پروژه‌های Railway', 'Railway projects')}
              subtitle={
                overview?.connection?.accountName
                  ? t(
                      `حساب متصل: ${overview.connection.accountName}`,
                      `Connected account: ${overview.connection.accountName}`,
                    )
                  : undefined
              }
            />
            {overview?.projectsError ? (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-300">
                {overview.projectsError}
              </p>
            ) : overview && overview.projects.length === 0 ? (
              <p className="text-sm text-[#A9A2BA]">
                {t(
                  'هیچ پروژه‌ای در حساب Railway پیدا نشد. یک پروژه در Railway بساز و صفحه را بروزرسانی کن.',
                  'No Railway project was found in your account. Create one in Railway and refresh.',
                )}
              </p>
            ) : (
              <div className="space-y-2">
                {overview?.projects.map((project) => (
                  <div
                    key={project.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[#F5F2FF]">{project.name}</p>
                      <p className="truncate font-mono text-[11px] text-[#7E7790]">{project.id}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {project.imported ? <Badge status="connected">{t('وارد شده', 'Imported')}</Badge> : null}
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void pickProject(project.id);
                          setForm((f) => ({ ...f, providerProjectId: project.id }));
                        }}
                      >
                        {t('انتخاب', 'Select')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            await post('/railway/import', {
                              workspaceId,
                              providerProjectId: project.id,
                            });
                            toast.success(t('پروژه وارد شد', 'Project imported'));
                            await load();
                          } catch (err) {
                            toast.error(t('ایمپورت ناموفق بود', 'Import failed'), errorMessage(err));
                          }
                        }}
                      >
                        {t('ایمپورت', 'Import')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle
              title={t('دیپلوی پنل / سرویس', 'Deploy a panel or service')}
              subtitle={t(
                'تصویر داکر واقعی روی سرویس Railway شما اجرا می‌شود؛ وضعیت از API خود Railway خوانده می‌شود.',
                'A real Docker image is deployed to your Railway service; status is read from Railway’s own API.',
              )}
            />

            <div className="mb-4 flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.slug}
                  onClick={() => applyPreset(preset)}
                  className={`rounded-xl border px-3 py-2 text-xs transition ${
                    form.image === preset.image
                      ? 'border-[#8B35FF]/60 bg-[#8B35FF]/15 text-[#E4D6FF]'
                      : 'border-white/10 bg-white/[0.02] text-[#A9A2BA] hover:text-white'
                  }`}
                  title={t(preset.fa, preset.en)}
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('پروژه Railway', 'Railway project')} required>
                <Select
                  value={form.providerProjectId}
                  onChange={(e) => void pickProject(e.target.value)}
                >
                  <option value="">{t('انتخاب کنید', 'Select')}</option>
                  {overview?.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t('محیط', 'Environment')} required hint={detailLoading ? t('در حال خواندن…', 'Loading…') : undefined}>
                <Select
                  value={form.providerEnvironmentId}
                  onChange={(e) => setForm((f) => ({ ...f, providerEnvironmentId: e.target.value }))}
                  disabled={!detail}
                >
                  <option value="">{t('انتخاب کنید', 'Select')}</option>
                  {detail?.environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t('نام سرویس', 'Service name')} required>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="3x-ui"
                />
              </Field>

              <Field
                label={t('تصویر داکر', 'Docker image')}
                required
                hint={t('مثال: ghcr.io/mhsanaei/3x-ui:latest', 'e.g. ghcr.io/mhsanaei/3x-ui:latest')}
              >
                <Input
                  value={form.image}
                  onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))}
                  className="font-mono text-[13px]"
                  placeholder="nginx:alpine"
                />
              </Field>

              <Field label={t('پورت', 'Port')} hint={t('پورت داخلی کانتینر', 'Container internal port')}>
                <Input
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                  inputMode="numeric"
                />
              </Field>

              <Field label={t('دامنه Railway', 'Railway domain')}>
                <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0C0718]/80 px-3 py-2.5 text-sm text-[#C9C3D8]">
                  <input
                    type="checkbox"
                    checked={form.createDomain}
                    onChange={(e) => setForm((f) => ({ ...f, createDomain: e.target.checked }))}
                  />
                  {t('بعد از دیپلوی دامنه ساخته شود', 'Create a domain after deploy')}
                </label>
              </Field>
            </div>

            <div className="mt-3">
              <Field
                label={t('متغیرهای محیطی', 'Environment variables')}
                hint={t(
                  'هر خط به شکل KEY=VALUE. مقادیر محرمانه در سرور ذخیره و به Railway ارسال می‌شوند.',
                  'One KEY=VALUE per line. Secret values are stored server-side and sent to Railway.',
                )}
              >
                <Textarea
                  value={form.vars}
                  onChange={(e) => setForm((f) => ({ ...f, vars: e.target.value }))}
                  placeholder={'SUDO_PASSWORD=change-me'}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => void submitDeploy()} loading={deploying}>
                {t('دیپلوی روی Railway', 'Deploy to Railway')}
              </Button>
              <span className="text-xs text-[#7E7790]">
                {t(
                  'این عملیات واقعاً روی حساب Railway شما اجرا می‌شود.',
                  'This action really runs on your Railway account.',
                )}
              </span>
            </div>

            {lastDeploy ? (
              <div className="mt-4 space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 text-xs">
                <p className="text-[#C9C3D8]">
                  {t('شناسه سرویس Railway', 'Railway service id')}:{' '}
                  <span className="font-mono text-[#E7E2F5]">{lastDeploy.service?.providerServiceId}</span>
                </p>
                {lastDeploy.deployment?.providerDeploymentId ? (
                  <p className="text-[#C9C3D8]">
                    {t('شناسه دیپلوی', 'Deployment id')}:{' '}
                    <span className="font-mono text-[#E7E2F5]">
                      {lastDeploy.deployment.providerDeploymentId}
                    </span>
                  </p>
                ) : null}
                {lastDeploy.domain?.domain ? (
                  <p className="text-[#C9C3D8]">
                    {t('دامنه', 'Domain')}:{' '}
                    <a
                      className="font-mono text-[#9CD2FF] underline"
                      href={`https://${lastDeploy.domain.domain}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {lastDeploy.domain.domain}
                    </a>
                  </p>
                ) : null}
                {lastDeploy.deployError ? (
                  <p className="text-rose-300">{lastDeploy.deployError}</p>
                ) : null}
                {lastDeploy.domainError ? (
                  <p className="text-amber-300">{lastDeploy.domainError}</p>
                ) : null}
              </div>
            ) : null}
          </Card>

          <Card className="p-5">
            <SectionTitle
              title={t('سرویس‌های Railway شما', 'Your Railway services')}
              subtitle={t(
                'وضعیت، تاریخچه دیپلوی، لاگ و بازگردانی — همه از API واقعی Railway.',
                'Status, deployment history, logs and rollback — all from the real Railway API.',
              )}
            />
            {services.length === 0 ? (
              <p className="text-sm text-[#A9A2BA]">
                {t(
                  'هنوز سرویسی از این پنل دیپلوی نشده است. یک پنل بالا انتخاب کن و دیپلوی کن.',
                  'No service has been deployed from this panel yet. Pick a panel above and deploy.',
                )}
              </p>
            ) : (
              <div className="space-y-2">
                {services.map((service) => (
                  <div
                    key={service.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-[#F5F2FF]">{service.name}</p>
                        <Badge status={service.status} />
                      </div>
                      <p className="truncate text-[11px] text-[#7E7790]">
                        {service.project_name} · {service.docker_image ?? service.repo_full_name ?? '—'} ·{' '}
                        {formatDate(service.created_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void openStatus(service)}>
                        {t('وضعیت و لاگ', 'Status & logs')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busyId === service.id}
                        onClick={() => void redeploy(service)}
                      >
                        {t('دیپلوی مجدد', 'Redeploy')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void createDomain(service)}>
                        {t('دامنه', 'Domain')}
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setRemoving(service)}>
                        {t('حذف', 'Delete')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <SectionTitle title={t('محدودیت‌های واقعی API', 'Real API limitations')} />
            <ul className="space-y-2 text-xs leading-relaxed text-[#A9A2BA]">
              <li>• {overview?.capabilities.reasons.stopService}</li>
              <li>• {overview?.capabilities.reasons.resourceMetrics}</li>
              <li>• {overview?.capabilities.reasons.managedDatabases}</li>
            </ul>
          </Card>
        </>
      )}

      <Modal
        open={Boolean(statusTarget)}
        onClose={() => {
          setStatusTarget(null);
          setStatus(null);
        }}
        title={statusTarget ? `${t('وضعیت سرویس', 'Service status')} · ${statusTarget.name}` : ''}
        description={t(
          'داده‌ها مستقیماً از Railway خوانده می‌شوند.',
          'Data is read directly from Railway.',
        )}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => void refreshStatus()} loading={statusLoading}>
              {t('بروزرسانی', 'Refresh')}
            </Button>
            <Button variant="ghost" onClick={() => setStatusTarget(null)}>
              {t('بستن', 'Close')}
            </Button>
          </>
        }
      >
        {statusLoading && !status ? (
          <div className="flex items-center gap-2 text-sm text-[#A9A2BA]">
            <Spinner className="h-4 w-4" /> {t('در حال خواندن…', 'Loading…')}
          </div>
        ) : statusError ? (
          <p className="text-sm text-rose-300">{statusError}</p>
        ) : status ? (
          <div className="space-y-4">
            {status.instance?.domains?.length ? (
              <div>
                <p className="mb-1 text-xs text-[#A9A2BA]">{t('دامنه‌ها', 'Domains')}</p>
                <div className="flex flex-wrap gap-2">
                  {status.instance.domains.map((d) => (
                    <a
                      key={d.id}
                      href={`https://${d.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[11px] text-[#9CD2FF]"
                    >
                      {d.domain}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <div>
              <p className="mb-1 text-xs text-[#A9A2BA]">{t('تاریخچه دیپلوی', 'Deployment history')}</p>
              <div className="space-y-1.5">
                {status.deployments.length === 0 ? (
                  <p className="text-xs text-[#7E7790]">
                    {t('دیپلویی ثبت نشده است.', 'No deployment recorded.')}
                  </p>
                ) : (
                  status.deployments.map((dep, index) => (
                    <div
                      key={dep.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge status={dep.status} />
                          <span className="font-mono text-[11px] text-[#7E7790]">
                            {dep.id.slice(0, 12)}
                          </span>
                          {index === 0 ? (
                            <span className="text-[10px] text-[#C9A7FF]">{t('آخرین', 'latest')}</span>
                          ) : null}
                        </div>
                        <p className="text-[11px] text-[#7E7790]">
                          {formatDate(dep.createdAt)} · {dep.rawStatus}
                        </p>
                      </div>
                      {statusTarget && dep.status !== 'queued' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={busyId === statusTarget.id}
                          onClick={() => void rollback(statusTarget, dep.id)}
                        >
                          {t('بازگردانی', 'Rollback')}
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs text-[#A9A2BA]">{t('لاگ دیپلوی', 'Deployment logs')}</p>
              {status.logsError ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-300">
                  {status.logsError}
                </p>
              ) : null}
              <pre className="max-h-64 overflow-auto rounded-lg border border-white/[0.07] bg-[#0A0614] p-3 font-mono text-[11px] leading-relaxed text-[#C9C3D8]">
{status.logs.length === 0
  ? t('لاگی برای این دیپلوی موجود نیست.', 'No log lines are available for this deployment.')
  : status.logs.map((l) => `[${l.stream}] ${l.message}`).join('\n')}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={t('حذف سرویس از Railway', 'Delete service on Railway')}
        description={t(
          'این عمل سرویس را واقعاً از حساب Railway شما حذف می‌کند و قابل بازگشت نیست.',
          'This really deletes the service from your Railway account and cannot be undone.',
        )}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              {t('انصراف', 'Cancel')}
            </Button>
            <Button
              variant="danger"
              loading={busyId === removing?.id}
              onClick={() => void removeService()}
            >
              {t('حذف قطعی', 'Delete permanently')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-[#C9C3D8]">{removing?.name}</p>
      </Modal>
    </div>
  );
}
