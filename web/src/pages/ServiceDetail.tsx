import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { del, errorMessage, formatDate, get, patch, post, relativeTime } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CopyField,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  SectionTitle,
  Select,
  Skeleton,
  Tabs,
  useToast,
} from '../lib/ui';

const LEVELS = ['', 'error', 'warn', 'info'];
const STREAMS = ['', 'build', 'system', 'deploy'];

export default function ServiceDetail() {
  const { serviceId } = useParams();
  const { t, lang } = useLang();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [logNote, setLogNote] = useState('');
  const [logFilter, setLogFilter] = useState({ level: '', stream: '', q: '' });
  const [metrics, setMetrics] = useState<any>(null);
  const [variables, setVariables] = useState<any[]>([]);
  const [varOpen, setVarOpen] = useState(false);
  const [varForm, setVarForm] = useState({ key: '', value: '', isSecret: true });
  const [domainForm, setDomainForm] = useState('');
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState<any>({});
  const [deployments, setDeployments] = useState<any[]>([]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [rollbackTarget, setRollbackTarget] = useState<any>(null);

  const load = useCallback(async () => {
    if (!serviceId) return;
    setLoading(true);
    try {
      const res = await get(`/services/${serviceId}`);
      setData(res);
      setDeployments(res.deployments ?? []);
      setSettings({
        name: res.service?.name ?? '',
        branch: res.service?.branch ?? '',
        repoFullName: res.service?.repo_full_name ?? '',
        dockerImage: res.service?.docker_image ?? '',
        buildCommand: res.service?.build_command ?? '',
        startCommand: res.service?.start_command ?? '',
        rootDirectory: res.service?.root_directory ?? '',
        healthcheckPath: res.service?.healthcheck_path ?? '',
        autoDeploy: Boolean(res.service?.auto_deploy),
      });
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadLogs = useCallback(async () => {
    if (!serviceId) return;
    try {
      const qs = new URLSearchParams();
      if (logFilter.level) qs.set('level', logFilter.level);
      if (logFilter.stream) qs.set('stream', logFilter.stream);
      if (logFilter.q) qs.set('q', logFilter.q);
      const res = await get<any>(`/services/${serviceId}/logs?${qs.toString()}`);
      setLogs(res.logs ?? []);
      setLogNote(res.note ?? '');
    } catch (err) {
      toast.error(t('دریافت لاگ ناموفق بود', 'Could not load logs'), errorMessage(err));
    }
  }, [serviceId, logFilter, toast, t]);

  useEffect(() => {
    if (tab === 'logs') void loadLogs();
  }, [tab, loadLogs]);

  useEffect(() => {
    if (tab !== 'metrics' || !serviceId) return;
    void get<any>(`/services/${serviceId}/metrics`)
      .then(setMetrics)
      .catch((err) => setMetrics({ available: false, message: errorMessage(err), series: [] }));
  }, [tab, serviceId]);

  const loadVariables = useCallback(async () => {
    if (!serviceId) return;
    try {
      const res = await get<any>(`/services/${serviceId}/variables`);
      setVariables(res.variables ?? []);
    } catch (err) {
      toast.error(t('دریافت متغیرها ناموفق بود', 'Could not load variables'), errorMessage(err));
    }
  }, [serviceId, toast, t]);

  useEffect(() => {
    if (tab === 'variables') void loadVariables();
  }, [tab, loadVariables]);

  const canWrite = data?.role !== 'viewer';

  const action = async (path: string, label: [string, string], body?: any) => {
    setBusy(true);
    try {
      const res = await post<any>(`/services/${serviceId}/${path}`, body);
      toast.success(t(label[0], label[1]), res?.deployment?.status ?? res?.message);
      await load();
      if (tab === 'deployments' || tab === 'logs') await loadLogs();
    } catch (err) {
      toast.error(t('عملیات ناموفق بود', 'Action failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      await patch(`/services/${serviceId}`, {
        name: settings.name,
        branch: settings.branch || null,
        repoFullName: settings.repoFullName || null,
        dockerImage: settings.dockerImage || null,
        buildCommand: settings.buildCommand || null,
        startCommand: settings.startCommand || null,
        rootDirectory: settings.rootDirectory || null,
        healthcheckPath: settings.healthcheckPath || null,
        autoDeploy: settings.autoDeploy,
      });
      toast.success(t('تنظیمات ذخیره شد', 'Settings saved'));
      setEditing(false);
      await load();
    } catch (err) {
      toast.error(t('ذخیره ناموفق بود', 'Save failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const addVariable = async () => {
    setBusy(true);
    try {
      await post(`/services/${serviceId}/variables`, {
        variables: [{ key: varForm.key.trim(), value: varForm.value, isSecret: varForm.isSecret }],
      });
      toast.success(t('متغیر ذخیره شد', 'Variable saved'));
      setVarOpen(false);
      setVarForm({ key: '', value: '', isSecret: true });
      await loadVariables();
    } catch (err) {
      toast.error(t('ذخیره متغیر ناموفق بود', 'Could not save variable'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeVariable = async (key: string) => {
    try {
      await del(`/services/${serviceId}/variables/${encodeURIComponent(key)}`);
      toast.success(t('متغیر حذف شد', 'Variable deleted'));
      await loadVariables();
    } catch (err) {
      toast.error(t('حذف ناموفق بود', 'Delete failed'), errorMessage(err));
    }
  };

  const addDomain = async () => {
    setBusy(true);
    try {
      const res = await post<any>(`/services/${serviceId}/domains`, { domain: domainForm.trim() });
      toast.success(t('دامنه ثبت شد', 'Domain added'), res?.domain?.status);
      setDomainForm('');
      await load();
    } catch (err) {
      toast.error(t('ثبت دامنه ناموفق بود', 'Could not add domain'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const removeDomain = async (id: string) => {
    try {
      await del(`/services/${serviceId}/domains/${id}`);
      toast.success(t('دامنه حذف شد', 'Domain removed'));
      await load();
    } catch (err) {
      toast.error(t('حذف ناموفق بود', 'Delete failed'), errorMessage(err));
    }
  };

  const syncDeployment = async (id: string) => {
    try {
      const res = await post<any>(`/services/deployments/${id}/sync`);
      toast.success(t('وضعیت همگام شد', 'Status synchronized'), res?.deployment?.status);
      await load();
    } catch (err) {
      toast.error(t('همگام‌سازی ناموفق بود', 'Sync failed'), errorMessage(err));
    }
  };

  const rollback = async () => {
    if (!rollbackTarget) return;
    setBusy(true);
    try {
      const res = await post<any>(`/services/deployments/${rollbackTarget.id}/rollback`);
      toast.success(t('بازگردانی آغاز شد', 'Rollback started'), res?.deployment?.status);
      setRollbackTarget(null);
      await load();
    } catch (err) {
      toast.error(t('بازگردانی ناموفق بود', 'Rollback failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteService = async () => {
    setBusy(true);
    try {
      await del(`/services/${serviceId}?confirm=${encodeURIComponent(deleteConfirm)}`);
      toast.success(t('سرویس حذف شد', 'Service deleted'));
      window.location.hash = '#/projects';
    } catch (err) {
      toast.error(t('حذف ناموفق بود', 'Delete failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-20" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (error || !data?.service) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="error" title={t('سرویس بارگذاری نشد', 'Service could not be loaded')}>{error}</Alert>
      </div>
    );
  }

  const { service, project, provider, domains, webhookUrl } = data;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-[#7E7790]">
            <Link to="/projects" className="hover:text-[#C9A7FF]">{t('پروژه‌ها', 'Projects')}</Link>
            <Icon name="chevron" className="h-3 w-3 rtl:rotate-180" />
            <Link to={`/projects/${project?.id}`} className="hover:text-[#C9A7FF]">{project?.name}</Link>
          </div>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
            {service.name}
            <Badge status={service.status ?? 'queued'}>{service.status ?? 'queued'}</Badge>
          </h1>
          <p className="mt-1 font-mono text-[11px] text-[#7E7790]" dir="ltr">
            {service.source_type === 'github'
              ? `${service.repo_full_name ?? '—'}@${service.branch ?? 'main'}`
              : service.docker_image ?? service.source_type}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="refresh" onClick={() => action('restart', ['ری‌استارت', 'Restart'])} disabled={!canWrite || busy}>
            {t('ری‌استارت', 'Restart')}
          </Button>
          <Button icon="rocket" onClick={() => action('deploy', ['استقرار جدید', 'New deployment'])} disabled={!canWrite || busy}>
            {t('استقرار', 'Deploy')}
          </Button>
        </div>
      </div>

      {provider && !provider.connected ? (
        <Alert tone="warn" title={t('ارائه‌دهنده متصل نیست', 'Provider not connected')}>
          {provider.message ?? t('برای استقرار واقعی، حساب ارائه‌دهنده خود را در تنظیمات متصل کنید.', 'Connect your provider account in settings to deploy for real.')}{' '}
          <Link to="/settings" className="underline">{t('اتصال ارائه‌دهنده', 'Connect provider')}</Link>
        </Alert>
      ) : null}

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('نمای کلی', 'Overview') },
          { id: 'deployments', label: t('استقرارها', 'Deployments'), count: deployments.length },
          { id: 'logs', label: t('لاگ‌ها', 'Logs') },
          { id: 'metrics', label: t('متریک‌ها', 'Metrics') },
          { id: 'variables', label: t('متغیرها', 'Variables') },
          { id: 'networking', label: t('شبکه', 'Networking'), count: domains?.length ?? 0 },
          { id: 'settings', label: t('تنظیمات', 'Settings') },
        ]}
      />

      {tab === 'overview' ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <SectionTitle title={t('اطلاعات استقرار', 'Deployment configuration')} />
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                [t('منبع', 'Source'), service.source_type],
                [t('شاخه', 'Branch'), service.branch ?? '—'],
                [t('دستور ساخت', 'Build command'), service.build_command ?? t('خودکار', 'auto-detect')],
                [t('دستور اجرا', 'Start command'), service.start_command ?? t('خودکار', 'auto-detect')],
                [t('پوشه ریشه', 'Root directory'), service.root_directory ?? './'],
                [t('Healthcheck', 'Healthcheck'), service.healthcheck_path ?? '—'],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-[10px] uppercase tracking-wider text-[#7E7790]">{label}</dt>
                  <dd className="mt-0.5 break-all font-mono text-[11px] text-[#E7E2F5]" dir="ltr">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <SectionTitle title={t('آخرین استقرار', 'Latest deployment')} />
            {deployments[0] ? (
              <div className="space-y-2">
                <Badge status={deployments[0].status}>{deployments[0].status}</Badge>
                <p className="text-xs text-[#A9A2BA]">{relativeTime(deployments[0].created_at, lang)}</p>
                <p className="break-all font-mono text-[11px] text-[#7E7790]" dir="ltr">
                  {deployments[0].commit_sha?.slice(0, 12) ?? deployments[0].trigger}
                </p>
                {deployments[0].error_message ? (
                  <p className="text-[11px] text-rose-300">{deployments[0].error_message}</p>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => syncDeployment(deployments[0].id)} icon="refresh">
                  {t('همگام‌سازی با ارائه‌دهنده', 'Sync with provider')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-[#7E7790]">{t('استقراری ثبت نشده است.', 'No deployments yet.')}</p>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'deployments' ? (
        <Card>
          <SectionTitle
            title={t('تاریخچه استقرار', 'Deployment history')}
            subtitle={t('وضعیت‌ها فقط از پاسخ ارائه‌دهنده ثبت می‌شوند', 'Statuses are recorded only from provider responses')}
            action={<Button size="sm" variant="secondary" icon="refresh" onClick={() => load()}>{t('بازخوانی', 'Refresh')}</Button>}
          />
          {deployments.length ? (
            <div className="divide-y divide-white/[0.06]">
              {deployments.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm text-white">
                      <Badge status={d.status}>{d.status}</Badge>
                      <span className="font-mono text-[11px] text-[#7E7790]" dir="ltr">{d.commit_sha?.slice(0, 7) ?? d.trigger}</span>
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-[#7E7790]">
                      {d.commit_message ?? d.trigger} · {relativeTime(d.created_at, lang)}
                      {d.duration_ms ? ` · ${Math.round(d.duration_ms / 1000)}s` : ''}
                    </p>
                    {d.error_message ? <p className="mt-0.5 text-[11px] text-rose-300">{d.error_message}</p> : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="ghost" icon="refresh" onClick={() => syncDeployment(d.id)}>{t('همگام', 'Sync')}</Button>
                    {d.status === 'running' && service.source_type === 'github' ? (
                      <Button size="sm" variant="ghost" icon="rotate" onClick={() => setRollbackTarget(d)}>{t('بازگردانی', 'Rollback')}</Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="rocket" title={t('استقراری وجود ندارد', 'No deployments')} description={t('اولین استقرار را آغاز کنید.', 'Start the first deployment.')} />
          )}
        </Card>
      ) : null}

      {tab === 'logs' ? (
        <Card>
          <SectionTitle
            title={t('لاگ‌ها', 'Logs')}
            subtitle={t('جستجو، فیلتر و بازخوانی دستی', 'Search, filter and manual refresh')}
            action={<Button size="sm" icon="refresh" onClick={loadLogs}>{t('بازخوانی', 'Refresh')}</Button>}
          />
          <div className="mb-3 grid gap-2 sm:grid-cols-3">
            <Select value={logFilter.stream} onChange={(e) => setLogFilter({ ...logFilter, stream: e.target.value })}>
              {STREAMS.map((s) => (
                <option key={s || 'all'} value={s}>{s ? s : t('همه جریان‌ها', 'All streams')}</option>
              ))}
            </Select>
            <Select value={logFilter.level} onChange={(e) => setLogFilter({ ...logFilter, level: e.target.value })}>
              {LEVELS.map((l) => (
                <option key={l || 'all'} value={l}>{l ? l : t('همه سطوح', 'All levels')}</option>
              ))}
            </Select>
            <Input
              value={logFilter.q}
              onChange={(e) => setLogFilter({ ...logFilter, q: e.target.value })}
              placeholder={t('جستجو در لاگ‌ها', 'Search logs')}
            />
          </div>
          <div className="max-h-[28rem] overflow-auto rounded-xl border border-white/[0.07] bg-[#05030A] p-3 font-mono text-[11px] leading-relaxed" dir="ltr">
            {logs.length ? (
              logs.map((line) => (
                <div key={line.id} className={line.level === 'error' ? 'text-rose-300' : line.level === 'warn' ? 'text-amber-300' : 'text-[#C9C3D9]'}>
                  <span className="text-[#5F5872]">{new Date(line.ts).toISOString().slice(11, 19)}</span>{' '}
                  <span className="text-[#8B35FF]">[{line.stream}]</span> {line.message}
                </div>
              ))
            ) : (
              <p className="text-[#7E7790]">{t('خطی برای نمایش نیست.', 'No log lines to display.')}</p>
            )}
          </div>
          {logNote ? <p className="mt-2 text-[10px] text-[#7E7790]">{logNote}</p> : null}
        </Card>
      ) : null}

      {tab === 'metrics' ? (
        <Card>
          <SectionTitle title={t('متریک‌ها', 'Metrics')} subtitle={t('فقط داده واقعی ارائه‌دهنده', 'Provider data only')} />
          {metrics?.available ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(metrics.series ?? []).map((point: any, i: number) => (
                <div key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <p className="text-[10px] uppercase text-[#7E7790]">{point.metric}</p>
                  <p className="text-sm text-white">{point.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <Alert tone="info" title={t('متریک در دسترس نیست', 'Metrics unavailable')}>
              {metrics?.message ?? t('در حال بررسی…', 'Checking…')}
            </Alert>
          )}
        </Card>
      ) : null}

      {tab === 'variables' ? (
        <Card>
          <SectionTitle
            title={t('متغیرهای محیطی', 'Environment variables')}
            subtitle={t('مقادیر مخفی هرگز در پاسخ عمومی برگردانده نمی‌شوند', 'Secret values are never returned in plain responses')}
            action={<Button size="sm" icon="plus" onClick={() => setVarOpen(true)} disabled={!canWrite}>{t('متغیر جدید', 'New variable')}</Button>}
          />
          {variables.length ? (
            <div className="divide-y divide-white/[0.06]">
              {variables.map((v) => (
                <div key={v.key ?? v.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#E7E2F5]" dir="ltr">{v.key}</span>
                  <span className="max-w-[16rem] truncate font-mono text-[11px] text-[#7E7790]" dir="ltr">
                    {v.is_secret || v.isSecret ? '••••••••' : v.value ?? '—'}
                  </span>
                  <button onClick={() => removeVariable(v.key)} className="rounded-lg p-1.5 text-[#5F5872] hover:bg-rose-500/10 hover:text-rose-300" aria-label="delete">
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#7E7790]">{t('متغیری ثبت نشده است.', 'No variables recorded.')}</p>
          )}
        </Card>
      ) : null}

      {tab === 'networking' ? (
        <div className="space-y-3">
          <Card>
            <SectionTitle title={t('دامنه‌ها', 'Domains')} subtitle={t('دامنه تنها پس از تأیید ارائه‌دهنده فعال نمایش داده می‌شود', 'A domain is shown active only after provider verification')} />
            <div className="mb-3 flex flex-wrap gap-2">
              <Input value={domainForm} onChange={(e) => setDomainForm(e.target.value)} placeholder="app.example.com" dir="ltr" className="max-w-xs font-mono text-xs" />
              <Button size="sm" onClick={addDomain} loading={busy} disabled={!canWrite || !domainForm.trim()} icon="globe">{t('افزودن دامنه', 'Add domain')}</Button>
            </div>
            {domains?.length ? (
              <div className="divide-y divide-white/[0.06]">
                {domains.map((d: any) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[#E7E2F5]" dir="ltr">{d.domain}</span>
                    <Badge status={d.status}>{d.status}</Badge>
                    {d.ssl_status ? <Badge status={d.ssl_status === 'active' ? 'active' : 'pending'}>{d.ssl_status}</Badge> : null}
                    <button onClick={() => removeDomain(d.id)} className="rounded-lg p-1.5 text-[#5F5872] hover:bg-rose-500/10 hover:text-rose-300" aria-label="remove">
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#7E7790]">{t('دامنه‌ای ثبت نشده است.', 'No domains recorded.')}</p>
            )}
          </Card>
          <Card>
            <SectionTitle title={t('وب‌هوک استقرار خودکار', 'Auto-deploy webhook')} subtitle={t('HMAC با امضای GitHub', 'HMAC-verified GitHub signature')} />
            <CopyField value={webhookUrl ?? ''} />
            <p className="mt-2 text-[10px] text-[#7E7790]">
              {t('این آدرس را به‌عنوان webhook مخزن با رویداد push ثبت کنید و secret را در متغیرهای سرویس قرار دهید.', 'Register this URL as a repository push webhook and set its secret in the service variables.')}
            </p>
          </Card>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <div className="space-y-3">
          <Card>
            <SectionTitle
              title={t('تنظیمات سرویس', 'Service settings')}
              action={<Button size="sm" variant="secondary" icon="settings" onClick={() => setEditing((v) => !v)} disabled={!canWrite}>{editing ? t('انصراف', 'Cancel') : t('ویرایش', 'Edit')}</Button>}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['name', t('نام', 'Name')],
                ['repoFullName', t('مخزن', 'Repository')],
                ['branch', t('شاخه', 'Branch')],
                ['dockerImage', t('ایمیج داکر', 'Docker image')],
                ['buildCommand', t('دستور ساخت', 'Build command')],
                ['startCommand', t('دستور اجرا', 'Start command')],
                ['rootDirectory', t('پوشه ریشه', 'Root directory')],
                ['healthcheckPath', t('Healthcheck', 'Healthcheck')],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <Input
                    value={settings[key] ?? ''}
                    onChange={(e) => setSettings({ ...settings, [key]: e.target.value })}
                    disabled={!editing}
                    dir="ltr"
                    className="font-mono text-xs"
                  />
                </Field>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                id="autoDeploySvc"
                type="checkbox"
                checked={Boolean(settings.autoDeploy)}
                onChange={(e) => setSettings({ ...settings, autoDeploy: e.target.checked })}
                disabled={!editing}
                className="h-3.5 w-3.5 accent-[#8B35FF]"
              />
              <label htmlFor="autoDeploySvc" className="text-xs text-[#A9A2BA]">{t('استقرار خودکار روی push', 'Auto-deploy on push')}</label>
            </div>
            {editing ? (
              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={saveSettings} loading={busy} icon="check">{t('ذخیره تغییرات', 'Save changes')}</Button>
              </div>
            ) : null}
          </Card>
          <Card>
            <SectionTitle title={t('منطقه خطر', 'Danger zone')} />
            <p className="mb-3 text-xs text-[#A9A2BA]">
              {t('حذف سرویس رکوردهای محلی را پاک می‌کند؛ سرویس ارائه‌دهنده باید در پنل ارائه‌دهنده حذف شود.', 'Deleting removes local records; the provider service must be removed in your provider dashboard.')}
            </p>
            <Button size="sm" variant="danger" icon="trash" onClick={() => setDeleteOpen(true)} disabled={data?.role !== 'owner' && data?.role !== 'admin'}>
              {t('حذف سرویس', 'Delete service')}
            </Button>
          </Card>
        </div>
      ) : null}

      <Modal
        open={varOpen}
        onClose={() => setVarOpen(false)}
        title={t('متغیر جدید', 'New variable')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setVarOpen(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={addVariable} loading={busy} icon="check">{t('ذخیره', 'Save')}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('کلید', 'Key')} required>
            <Input value={varForm.key} onChange={(e) => setVarForm({ ...varForm, key: e.target.value.toUpperCase() })} dir="ltr" className="font-mono text-xs" placeholder="DATABASE_URL" />
          </Field>
          <Field label={t('مقدار', 'Value')} required>
            <Input value={varForm.value} onChange={(e) => setVarForm({ ...varForm, value: e.target.value })} dir="ltr" className="font-mono text-xs" />
          </Field>
          <div className="flex items-center gap-2">
            <input id="isSecret" type="checkbox" checked={varForm.isSecret} onChange={(e) => setVarForm({ ...varForm, isSecret: e.target.checked })} className="h-3.5 w-3.5 accent-[#8B35FF]" />
            <label htmlFor="isSecret" className="text-xs text-[#A9A2BA]">{t('مقدار مخفی (ماسک‌شده)', 'Secret value (masked)')}</label>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(rollbackTarget)}
        onClose={() => setRollbackTarget(null)}
        title={t('بازگردانی استقرار', 'Roll back deployment')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRollbackTarget(null)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={rollback} loading={busy} icon="rotate">{t('تأیید بازگردانی', 'Confirm rollback')}</Button>
          </div>
        }
      >
        <p className="text-xs text-[#A9A2BA]">
          {t('استقرار فعلی با نسخه انتخاب‌شده جایگزین می‌شود. این عملیات از API ارائه‌دهنده استفاده می‌کند.', 'The current deployment is replaced by the selected version using the provider API.')}
        </p>
        <p className="mt-2 font-mono text-[11px] text-[#E7E2F5]" dir="ltr">{rollbackTarget?.commit_sha?.slice(0, 12)}</p>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('حذف سرویس', 'Delete service')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button variant="danger" onClick={deleteService} loading={busy} icon="trash" disabled={deleteConfirm !== service.name}>
              {t('حذف قطعی', 'Delete permanently')}
            </Button>
          </div>
        }
      >
        <p className="text-xs text-[#A9A2BA]">{t('برای تأیید، نام سرویس را دقیقاً وارد کنید:', 'Type the exact service name to confirm:')}</p>
        <p className="mt-1 font-mono text-[11px] text-[#E7E2F5]">{service.name}</p>
        <Input className="mt-2" value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} />
      </Modal>
    </div>
  );
}
