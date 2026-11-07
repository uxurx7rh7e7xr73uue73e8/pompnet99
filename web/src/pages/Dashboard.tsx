import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { errorMessage, formatDate, get, post, relativeTime } from '../lib/api';
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
  Skeleton,
  StatCard,
  Textarea,
  useToast,
} from '../lib/ui';

export default function Dashboard() {
  const { workspaceId, workspace, user, mailConfigured } = useAuth();
  const { t, lang } = useLang();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await get('/dashboard', { workspaceId }));
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

  const createProject = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const res = await post<{ project: any }>('/projects', {
        workspaceId,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      });
      toast.success(t('پروژه ساخته شد', 'Project created'), res.project?.name);
      setCreateOpen(false);
      setForm({ name: '', description: '' });
      await load();
    } catch (err) {
      toast.error(t('ساخت پروژه ناموفق بود', 'Could not create project'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const counts = data?.counts ?? {};

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#7E7790]">POMP NET CLOUD</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
            {t('به POMP NET CLOUD خوش آمدید', 'Welcome to POMP NET CLOUD')}
          </h1>
          <p className="mt-1 text-sm text-[#A9A2BA]">
            {t('به پنل ابری پمپ نت محمد خوش آمدید', 'Welcome to the POMP NET MOHAMMAD cloud panel')}
            {workspace ? ` · ${workspace.name}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon="plus" onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
            {t('پروژه جدید', 'New project')}
          </Button>
          <Link to="/templates">
            <Button variant="secondary" icon="rocket">{t('استقرار سریع', 'Quick deploy')}</Button>
          </Link>
          <Link to="/settings">
            <Button variant="ghost" icon="git">{t('اتصال گیت‌هاب', 'Connect GitHub')}</Button>
          </Link>
        </div>
      </div>

      {!mailConfigured && user && !user.emailVerified ? (
        <Alert tone="warn" title={t('ایمیل شما هنوز تأیید نشده است', 'Your email is not verified yet')}>
          {t(
            'عملیات زیرساختی تا تأیید ایمیل قفل است. سرویس ایمیل پلتفرم پیکربندی نشده، بنابراین لینک تأیید در همان صفحه ثبت‌نام نمایش داده شد.',
            'Infrastructure actions stay locked until your email is verified. Platform email delivery is not configured, so the verification link was shown on the sign-up screen.',
          )}
        </Alert>
      ) : null}

      {data?.platformNotice ? (
        <Alert tone="info" title={t('اطلاعیه پلتفرم', 'Platform notice')}>{data.platformNotice}</Alert>
      ) : null}

      {error ? (
        <Alert tone="error" title={t('خطا در بارگذاری داشبورد', 'Could not load dashboard')}>{error}</Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard label={t('پروژه‌ها', 'Projects')} value={counts.projects ?? 0} icon="box" hint={`${counts.environments ?? 0} ${t('محیط', 'environments')}`} />
            <StatCard label={t('سرویس‌ها', 'Services')} value={counts.services ?? 0} icon="rocket" tone="blue" hint={`${counts.members ?? 0} ${t('عضو', 'members')}`} />
            <StatCard label={t('استقرار در حال اجرا', 'Running deployments')} value={counts.running ?? 0} icon="play" tone="green" hint={`${counts.inProgress ?? 0} ${t('در صف/در حال ساخت', 'queued or building')}`} />
            <StatCard label={t('استقرار ناموفق', 'Failed deployments')} value={counts.failed ?? 0} icon="alert" tone="red" hint={`${counts.databases ?? 0} ${t('دیتابیس', 'databases')}`} />
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <SectionTitle
            title={t('استقرارهای اخیر', 'Recent deployments')}
            subtitle={t('وضعیت‌ها مستقیماً از اجرای واقعی خوانده می‌شوند.', 'Statuses come from the actual deployment run.')}
            action={<Link to="/projects" className="text-xs text-[#C9A7FF] hover:underline">{t('همه پروژه‌ها', 'All projects')}</Link>}
          />
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : data?.recentDeployments?.length ? (
            <div className="divide-y divide-white/[0.06]">
              {data.recentDeployments.map((d: any) => (
                <Link key={d.id} to={`/services/${d.service_id}`} className="flex items-center gap-3 py-2.5 transition hover:bg-white/[0.02]">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-[#C9A7FF]">
                    <Icon name="rocket" className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{d.service_name}</span>
                    <span className="block truncate text-[11px] text-[#7E7790]">
                      {d.project_name} · {d.environment_name ?? '—'} · {d.commit_sha ? d.commit_sha.slice(0, 7) : d.trigger}
                    </span>
                  </span>
                  <span className="hidden text-[11px] text-[#7E7790] sm:block">{relativeTime(d.created_at, lang)}</span>
                  <Badge status={d.status}>{d.status}</Badge>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon="rocket"
              title={t('هنوز استقراری ثبت نشده', 'No deployments yet')}
              description={t('ابتدا پروژه بسازید، یک ارائه‌دهنده متصل کنید و سپس سرویس را مستقر کنید.', 'Create a project, connect a provider, then deploy a service.')}
              action={<Button size="sm" onClick={() => setCreateOpen(true)}>{t('ساخت پروژه', 'Create project')}</Button>}
            />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <SectionTitle title={t('وضعیت زیرساخت', 'Infrastructure')} subtitle={t('اتصال ارائه‌دهنده شما', 'Your provider connection')} />
            <div className="space-y-2">
              {[
                { key: 'railway', label: 'Railway' },
                { key: 'github', label: 'GitHub' },
              ].map((p) => {
                const info = data?.connections?.[p.key];
                return (
                  <div key={p.key} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm text-white">{p.label}</p>
                      <p className="truncate text-[11px] text-[#7E7790]">
                        {info?.connected ? info.connection?.account_name || t('متصل', 'Connected') : t('متصل نیست', 'Not connected')}
                      </p>
                    </div>
                    <Badge status={info?.connected ? 'connected' : 'stopped'}>
                      {info?.connected ? t('متصل', 'Connected') : t('قطع', 'Offline')}
                    </Badge>
                  </div>
                );
              })}
              <Link to="/settings" className="mt-1 block">
                <Button variant="outline" size="sm" className="w-full" icon="settings">{t('مدیریت اتصال‌ها', 'Manage connections')}</Button>
              </Link>
            </div>
          </Card>

          <Card>
            <SectionTitle title={t('مصرف این ماه', 'This month usage')} subtitle={t('از جدول usage_records', 'From usage_records')} />
            {loading ? (
              <Skeleton className="h-16" />
            ) : data?.usage?.length ? (
              <ul className="space-y-2">
                {data.usage.map((u: any) => (
                  <li key={`${u.metric}-${u.unit}`} className="flex items-center justify-between text-sm">
                    <span className="text-[#A9A2BA]">{u.metric.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-xs text-white">{u.total} {u.unit}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#7E7790]">{t('مصرفی ثبت نشده است.', 'No usage recorded yet.')}</p>
            )}
            <Link to="/usage" className="mt-3 block text-xs text-[#C9A7FF] hover:underline">{t('جزئیات مصرف', 'Usage details')}</Link>
          </Card>
        </div>
      </div>

      <Card>
        <SectionTitle title={t('فعالیت‌های اخیر', 'Recent activity')} subtitle={t('گزارش رویدادهای واقعی ورک‌اسپیس', 'Real workspace activity log')} />
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : data?.activity?.length ? (
          <ol className="space-y-3">
            {data.activity.map((a: any) => (
              <li key={a.id} className="flex items-start gap-3">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8B35FF]" />
                <div className="min-w-0">
                  <p className="text-sm text-[#E7E2F5]">
                    <span className="font-medium">{a.actor_name ?? t('سیستم', 'System')}</span>{' '}
                    <span className="text-[#A9A2BA]">{a.action.replace(/_/g, ' ')}</span>
                    {a.target_type ? <span className="text-[#7E7790]"> · {a.target_type}</span> : null}
                  </p>
                  <p className="text-[11px] text-[#7E7790]">{formatDate(a.created_at, lang)}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-[#7E7790]">{t('فعالیتی ثبت نشده است.', 'No activity recorded yet.')}</p>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('ساخت پروژه جدید', 'Create a new project')}
        description={t('هر پروژه محیط‌ها، سرویس‌ها و دسترسی مستقل خود را دارد.', 'Each project has isolated environments, services and access.')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={createProject} loading={busy} icon="plus">{t('ساخت پروژه', 'Create project')}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('نام پروژه', 'Project name')} required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('مثلاً api-prod', 'e.g. api-prod')} />
          </Field>
          <Field label={t('توضیحات', 'Description')} hint={t('اختیاری', 'Optional')}>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
