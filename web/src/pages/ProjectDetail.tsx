import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { errorMessage, get, post, relativeTime } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  SectionTitle,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  useToast,
} from '../lib/ui';

const ENGINES = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'redis', label: 'Redis' },
  { value: 'mongodb', label: 'MongoDB' },
];

export default function ProjectDetail() {
  const { projectId } = useParams();
  const { t, lang } = useLang();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('services');
  const [serviceOpen, setServiceOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serviceForm, setServiceForm] = useState({
    name: '',
    sourceType: 'github',
    repoFullName: '',
    branch: 'main',
    dockerImage: '',
    environmentId: '',
    buildCommand: '',
    startCommand: '',
    rootDirectory: '',
    healthcheckPath: '',
    autoDeploy: false,
  });
  const [dbForm, setDbForm] = useState({ name: '', engine: 'postgres', environmentId: '' });
  const [envForm, setEnvForm] = useState({ name: '' });

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await get(`/projects/${projectId}`);
      setData(res);
      setError('');
      setServiceForm((f) => ({ ...f, environmentId: f.environmentId || res.environments?.[0]?.id || '' }));
      setDbForm((f) => ({ ...f, environmentId: f.environmentId || res.environments?.[0]?.id || '' }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canWrite = data?.role !== 'viewer';

  const createService = async () => {
    setBusy(true);
    try {
      const body: any = {
        projectId,
        environmentId: serviceForm.environmentId,
        name: serviceForm.name.trim(),
        sourceType: serviceForm.sourceType,
        autoDeploy: serviceForm.autoDeploy,
      };
      if (serviceForm.sourceType === 'github') {
        body.repoFullName = serviceForm.repoFullName.trim();
        body.branch = serviceForm.branch.trim() || 'main';
      }
      if (serviceForm.sourceType === 'docker_image') body.dockerImage = serviceForm.dockerImage.trim();
      if (serviceForm.buildCommand.trim()) body.buildCommand = serviceForm.buildCommand.trim();
      if (serviceForm.startCommand.trim()) body.startCommand = serviceForm.startCommand.trim();
      if (serviceForm.rootDirectory.trim()) body.rootDirectory = serviceForm.rootDirectory.trim();
      if (serviceForm.healthcheckPath.trim()) body.healthcheckPath = serviceForm.healthcheckPath.trim();
      const res = await post<any>('/services', body);
      toast.success(t('سرویس ساخته شد', 'Service created'), res?.service?.name);
      setServiceOpen(false);
      setServiceForm((f) => ({ ...f, name: '', repoFullName: '', dockerImage: '' }));
      await load();
    } catch (err) {
      toast.error(t('ساخت سرویس ناموفق بود', 'Could not create service'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const createDatabase = async () => {
    setBusy(true);
    try {
      const res = await post<any>(`/projects/${projectId}/databases`, {
        name: dbForm.name.trim(),
        engine: dbForm.engine,
        environmentId: dbForm.environmentId,
      });
      toast.success(t('درخواست ایجاد دیتابیس ثبت شد', 'Database provisioning requested'), res?.note ?? res?.database?.status);
      setDbOpen(false);
      setDbForm((f) => ({ ...f, name: '' }));
      await load();
    } catch (err) {
      toast.error(t('ایجاد دیتابیس ناموفق بود', 'Database provisioning failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const createEnvironment = async () => {
    setBusy(true);
    try {
      await post(`/projects/${projectId}/environments`, { name: envForm.name.trim() });
      toast.success(t('محیط ساخته شد', 'Environment created'));
      setEnvOpen(false);
      setEnvForm({ name: '' });
      await load();
    } catch (err) {
      toast.error(t('ساخت محیط ناموفق بود', 'Could not create environment'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data?.project) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="error" title={t('پروژه بارگذاری نشد', 'Project could not be loaded')}>{error}</Alert>
        <Link to="/projects" className="mt-3 inline-block text-xs text-[#C9A7FF] hover:underline">{t('بازگشت به پروژه‌ها', 'Back to projects')}</Link>
      </div>
    );
  }

  const { project, environments, services, databases, recentDeployments } = data;

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-[#7E7790]">
            <Link to="/projects" className="hover:text-[#C9A7FF]">{t('پروژه‌ها', 'Projects')}</Link>
            <Icon name="chevron" className="h-3 w-3 rtl:rotate-180" />
            <span>{project.slug ?? project.name}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-white">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[#A9A2BA]">{project.description || t('بدون توضیحات', 'No description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon="plus" onClick={() => setEnvOpen(true)} disabled={!canWrite}>{t('محیط جدید', 'New environment')}</Button>
          <Button icon="rocket" onClick={() => setServiceOpen(true)} disabled={!canWrite}>{t('سرویس جدید', 'New service')}</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t('سرویس‌ها', 'Services'), value: services.length, icon: 'rocket' },
          { label: t('محیط‌ها', 'Environments'), value: environments.length, icon: 'layers' },
          { label: t('دیتابیس‌ها', 'Databases'), value: databases.length, icon: 'database' },
          { label: t('نقش شما', 'Your role'), value: data.role, icon: 'shield' },
        ].map((item) => (
          <Card key={item.label} className="flex items-center gap-3 p-3.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#8B35FF]/25 bg-[#8B35FF]/10 text-[#C9A7FF]">
              <Icon name={item.icon} className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-[#7E7790]">{item.label}</p>
              <p className="text-sm font-semibold text-white">{item.value}</p>
            </div>
          </Card>
        ))}
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'services', label: t('سرویس‌ها', 'Services'), count: services.length },
          { id: 'databases', label: t('دیتابیس‌ها', 'Databases'), count: databases.length },
          { id: 'environments', label: t('محیط‌ها', 'Environments'), count: environments.length },
          { id: 'deployments', label: t('استقرارها', 'Deployments'), count: recentDeployments.length },
        ]}
      />

      {tab === 'services' ? (
        services.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {services.map((s: any) => (
              <Card key={s.id} className="p-4 transition hover:border-[#8B35FF]/35">
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/services/${s.id}`} className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{s.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[#7E7790]">
                      {s.source_type === 'github' ? `${s.repo_full_name ?? ''}@${s.branch ?? ''}` : s.docker_image ?? s.template_slug ?? s.source_type}
                    </p>
                  </Link>
                  <Badge status={s.status ?? 'queued'}>{s.status ?? 'queued'}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                  <span className="text-[10px] text-[#7E7790]">{s.environment_name ?? ''}</span>
                  <Link to={`/services/${s.id}`} className="text-[11px] text-[#C9A7FF] hover:underline">{t('جزئیات', 'Details')}</Link>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <EmptyState
              icon="rocket"
              title={t('سرویسی وجود ندارد', 'No services yet')}
              description={t('از مخزن GitHub یا ایمیج داکر یک سرویس بسازید.', 'Create a service from a GitHub repository or Docker image.')}
              action={<Button size="sm" icon="plus" onClick={() => setServiceOpen(true)} disabled={!canWrite}>{t('سرویس جدید', 'New service')}</Button>}
            />
          </Card>
        )
      ) : null}

      {tab === 'databases' ? (
        <Card>
          <SectionTitle
            title={t('دیتابیس‌ها', 'Databases')}
            subtitle={t('ایجاد واقعی از طریق ارائه‌دهنده متصل شما', 'Provisioned in your connected provider account')}
            action={<Button size="sm" icon="plus" onClick={() => setDbOpen(true)} disabled={!canWrite}>{t('دیتابیس جدید', 'New database')}</Button>}
          />
          {databases.length ? (
            <div className="space-y-2">
              {databases.map((d: any) => (
                <div key={d.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{d.name}</p>
                      <p className="font-mono text-[11px] text-[#7E7790]">
                        {d.engine} · {d.connection_host ?? t('میزبان در دسترس نیست', 'host unavailable')}
                        {d.connection_port ? `:${d.connection_port}` : ''}
                      </p>
                    </div>
                    <Badge status={d.status}>{d.status}</Badge>
                  </div>
                  {d.error_message ? <p className="mt-2 text-[11px] text-rose-300">{d.error_message}</p> : null}
                  <p className="mt-2 text-[10px] text-[#7E7790]">
                    {t('گذرواژه فقط از متغیرهای محیطی همان سرویس قابل خواندن است.', 'The password is only readable through the service environment variables.')}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#7E7790]">{t('دیتابیسی ثبت نشده است.', 'No databases recorded yet.')}</p>
          )}
        </Card>
      ) : null}

      {tab === 'environments' ? (
        <Card>
          <SectionTitle title={t('محیط‌ها', 'Environments')} subtitle={t('پیکربندی جداگانه برای هر محیط', 'Isolated configuration per environment')} />
          <div className="space-y-2">
            {environments.map((env: any) => (
              <div key={env.id} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <div>
                  <p className="text-sm text-white">{env.name}</p>
                  <p className="font-mono text-[10px] text-[#7E7790]">{env.kind ?? 'custom'}</p>
                </div>
                <Badge status="active">{t('فعال', 'active')}</Badge>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {tab === 'deployments' ? (
        <Card>
          <SectionTitle title={t('استقرارهای اخیر', 'Recent deployments')} subtitle={t('تاریخچه واقعی اجراها', 'Real run history')} />
          {recentDeployments.length ? (
            <div className="divide-y divide-white/[0.06]">
              {recentDeployments.map((d: any) => (
                <Link key={d.id} to={`/services/${d.service_id}`} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{d.service_name}</span>
                    <span className="block truncate text-[11px] text-[#7E7790]">
                      {d.commit_sha ? d.commit_sha.slice(0, 7) : d.trigger} · {relativeTime(d.created_at, lang)}
                    </span>
                  </span>
                  <Badge status={d.status}>{d.status}</Badge>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#7E7790]">{t('استقراری ثبت نشده است.', 'No deployments recorded.')}</p>
          )}
        </Card>
      ) : null}

      <Modal
        open={serviceOpen}
        onClose={() => setServiceOpen(false)}
        title={t('سرویس جدید', 'New service')}
        description={t('منبع را انتخاب کنید؛ استقرار فقط با ارائه‌دهنده متصل انجام می‌شود.', 'Choose a source; deployment requires a connected provider.')}
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setServiceOpen(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={createService} loading={busy} icon="plus">{t('ساخت سرویس', 'Create service')}</Button>
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('نام سرویس', 'Service name')} required>
            <Input value={serviceForm.name} onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })} placeholder="api" />
          </Field>
          <Field label={t('محیط', 'Environment')} required>
            <Select value={serviceForm.environmentId} onChange={(e) => setServiceForm({ ...serviceForm, environmentId: e.target.value })}>
              {environments.map((env: any) => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('نوع منبع', 'Source type')}>
            <Select value={serviceForm.sourceType} onChange={(e) => setServiceForm({ ...serviceForm, sourceType: e.target.value })}>
              <option value="github">GitHub</option>
              <option value="docker_image">{t('ایمیج داکر', 'Docker image')}</option>
            </Select>
          </Field>
          {serviceForm.sourceType === 'github' ? (
            <>
              <Field label={t('مخزن (owner/name)', 'Repository (owner/name)')} required>
                <Input value={serviceForm.repoFullName} onChange={(e) => setServiceForm({ ...serviceForm, repoFullName: e.target.value })} dir="ltr" className="font-mono text-xs" placeholder="owner/repo" />
              </Field>
              <Field label={t('شاخه', 'Branch')}>
                <Input value={serviceForm.branch} onChange={(e) => setServiceForm({ ...serviceForm, branch: e.target.value })} dir="ltr" className="font-mono text-xs" />
              </Field>
            </>
          ) : (
            <Field label={t('ایمیج داکر', 'Docker image')} required>
              <Input value={serviceForm.dockerImage} onChange={(e) => setServiceForm({ ...serviceForm, dockerImage: e.target.value })} dir="ltr" className="font-mono text-xs" placeholder="nginx:alpine" />
            </Field>
          )}
          <Field label={t('دستور ساخت', 'Build command')} hint={t('اختیاری', 'Optional')}>
            <Input value={serviceForm.buildCommand} onChange={(e) => setServiceForm({ ...serviceForm, buildCommand: e.target.value })} dir="ltr" className="font-mono text-xs" placeholder="npm run build" />
          </Field>
          <Field label={t('دستور اجرا', 'Start command')} hint={t('اختیاری', 'Optional')}>
            <Input value={serviceForm.startCommand} onChange={(e) => setServiceForm({ ...serviceForm, startCommand: e.target.value })} dir="ltr" className="font-mono text-xs" placeholder="npm start" />
          </Field>
          <Field label={t('پوشه ریشه', 'Root directory')} hint={t('اختیاری', 'Optional')}>
            <Input value={serviceForm.rootDirectory} onChange={(e) => setServiceForm({ ...serviceForm, rootDirectory: e.target.value })} dir="ltr" className="font-mono text-xs" placeholder="./" />
          </Field>
          <Field label={t('مسیر Healthcheck', 'Healthcheck path')} hint={t('اختیاری', 'Optional')}>
            <Input value={serviceForm.healthcheckPath} onChange={(e) => setServiceForm({ ...serviceForm, healthcheckPath: e.target.value })} dir="ltr" className="font-mono text-xs" placeholder="/health" />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <input
              id="autoDeploy"
              type="checkbox"
              checked={serviceForm.autoDeploy}
              onChange={(e) => setServiceForm({ ...serviceForm, autoDeploy: e.target.checked })}
              className="h-3.5 w-3.5 accent-[#8B35FF]"
            />
            <label htmlFor="autoDeploy" className="text-xs text-[#A9A2BA]">
              {t('استقرار خودکار روی push (نیازمند وب‌هوک GitHub)', 'Auto-deploy on push (requires the GitHub webhook)')}
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={dbOpen}
        onClose={() => setDbOpen(false)}
        title={t('دیتابیس جدید', 'New database')}
        description={t('در حساب ارائه‌دهنده متصل شما ایجاد می‌شود؛ بدون اتصال، عملیات انجام نمی‌شود.', 'Provisioned in your connected provider account; without a connection nothing is created.')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDbOpen(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={createDatabase} loading={busy} icon="database">{t('ایجاد دیتابیس', 'Provision')}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('نام', 'Name')} required>
            <Input value={dbForm.name} onChange={(e) => setDbForm({ ...dbForm, name: e.target.value })} placeholder="main-db" />
          </Field>
          <Field label={t('موتور', 'Engine')}>
            <Select value={dbForm.engine} onChange={(e) => setDbForm({ ...dbForm, engine: e.target.value })}>
              {ENGINES.map((engine) => (
                <option key={engine.value} value={engine.value}>{engine.label}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('محیط', 'Environment')} required>
            <Select value={dbForm.environmentId} onChange={(e) => setDbForm({ ...dbForm, environmentId: e.target.value })}>
              {environments.map((env: any) => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </Select>
          </Field>
          <Alert tone="info" title={t('اطلاعات اتصال', 'Connection details')}>
            {t('اطلاعات اتصال پس از تأیید ارائه‌دهنده ثبت و در متغیرهای محیطی ماسک می‌شود.', 'Connection details are stored after provider confirmation and masked in environment variables.')}
          </Alert>
        </div>
      </Modal>

      <Modal
        open={envOpen}
        onClose={() => setEnvOpen(false)}
        title={t('محیط جدید', 'New environment')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEnvOpen(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={createEnvironment} loading={busy} icon="plus">{t('ساخت', 'Create')}</Button>
          </div>
        }
      >
        <Field label={t('نام محیط', 'Environment name')} required>
          <Input value={envForm.name} onChange={(e) => setEnvForm({ name: e.target.value })} placeholder="staging" />
        </Field>
      </Modal>
    </div>
  );
}
