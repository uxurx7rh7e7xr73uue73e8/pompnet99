import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { del, errorMessage, get, post, relativeTime } from '../lib/api';
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
  Textarea,
  useToast,
} from '../lib/ui';

export default function Projects() {
  const { workspaceId, workspace } = useAuth();
  const { t, lang } = useLang();
  const toast = useToast();
  const [data, setData] = useState<{ projects: any[]; role?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<any>(null);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await get('/projects', { workspaceId }));
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

  const canWrite = !data?.role || data.role !== 'viewer';

  const create = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const res = await post<any>('/projects', {
        workspaceId,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
      });
      toast.success(t('پروژه ساخته شد', 'Project created'), res?.project?.name);
      setOpen(false);
      setForm({ name: '', description: '' });
      await load();
    } catch (err) {
      toast.error(t('ساخت پروژه ناموفق بود', 'Could not create project'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await del(`/projects/${removing.id}`);
      toast.success(t('پروژه حذف شد', 'Project deleted'));
      setRemoving(null);
      await load();
    } catch (err) {
      toast.error(t('حذف ناموفق بود', 'Delete failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">{t('پروژه‌ها', 'Projects')}</h1>
          <p className="mt-1 text-sm text-[#A9A2BA]">
            {workspace?.name ?? '—'} · {t('منابع هر پروژه از سایر پروژه‌ها جدا است.', 'Each project keeps isolated resources.')}
          </p>
        </div>
        <Button icon="plus" onClick={() => setOpen(true)} disabled={!canWrite}>
          {t('پروژه جدید', 'New project')}
        </Button>
      </div>

      {error ? <Alert tone="error" title={t('خطا', 'Error')}>{error}</Alert> : null}
      {!canWrite ? (
        <Alert tone="warn" title={t('دسترسی فقط‌خواندنی', 'Read-only access')}>
          {t('نقش شما Viewer است و امکان تغییر منابع را ندارید.', 'Your role is Viewer, so resource changes are disabled.')}
        </Alert>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : data?.projects?.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.projects.map((p) => (
            <Card key={p.id} className="group flex flex-col p-4 transition hover:border-[#8B35FF]/35">
              <div className="flex items-start justify-between gap-2">
                <Link to={`/projects/${p.id}`} className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg border border-[#8B35FF]/25 bg-[#8B35FF]/10 text-[#C9A7FF]">
                      <Icon name="box" className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate text-sm font-semibold text-white group-hover:text-[#E7E2F5]">{p.name}</span>
                  </div>
                  <p className="mt-2 line-clamp-2 min-h-[2rem] text-xs text-[#A9A2BA]">
                    {p.description || t('بدون توضیحات', 'No description')}
                  </p>
                </Link>
                {canWrite ? (
                  <button
                    onClick={() => setRemoving(p)}
                    className="rounded-lg p-1.5 text-[#5F5872] transition hover:bg-rose-500/10 hover:text-rose-300"
                    aria-label="delete"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[#A9A2BA]">
                  {p.service_count ?? 0} {t('سرویس', 'services')}
                </span>
                <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[#A9A2BA]">
                  {p.environment_count ?? 0} {t('محیط', 'envs')}
                </span>
                <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[#A9A2BA]">
                  {p.database_count ?? 0} {t('دیتابیس', 'DB')}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                <span className="text-[10px] text-[#7E7790]">{relativeTime(p.created_at, lang)}</span>
                <Link to={`/projects/${p.id}`} className="text-[11px] text-[#C9A7FF] hover:underline">
                  {t('باز کردن', 'Open')}
                </Link>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon="box"
            title={t('هنوز پروژه‌ای ندارید', 'No projects yet')}
            description={t('یک پروژه بسازید تا محیط‌ها، سرویس‌ها و دیتابیس‌ها را مدیریت کنید.', 'Create a project to manage environments, services and databases.')}
            action={<Button size="sm" icon="plus" onClick={() => setOpen(true)} disabled={!canWrite}>{t('ساخت پروژه', 'Create project')}</Button>}
          />
        </Card>
      )}

      <Card>
        <SectionTitle
          title={t('استقرار از قالب', 'Deploy from a template')}
          subtitle={t('قالب‌ها فقط زمانی نمایش داده می‌شوند که پیکربندی استقرار واقعی داشته باشند.', 'Templates are shown only when a real deployment configuration exists.')}
          action={<Link to="/templates" className="text-xs text-[#C9A7FF] hover:underline">{t('همه قالب‌ها', 'All templates')}</Link>}
        />
        <p className="text-xs text-[#7E7790]">
          {t('برای استقرار آماده، به بخش قالب‌ها بروید.', 'Visit the templates section to deploy a ready-made stack.')}
        </p>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('پروژه جدید', 'New project')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={create} loading={busy} icon="plus">{t('ساخت', 'Create')}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('نام پروژه', 'Project name')} required>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t('توضیحات', 'Description')}>
            <Textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title={t('حذف پروژه', 'Delete project')}
        description={t('این عملیات قابل بازگشت نیست.', 'This action cannot be undone.')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoving(null)}>{t('انصراف', 'Cancel')}</Button>
            <Button variant="danger" onClick={remove} loading={busy} icon="trash">{t('حذف قطعی', 'Delete permanently')}</Button>
          </div>
        }
      >
        <Alert tone="error" title={t('هشدار', 'Warning')}>
          {t('همه سرویس‌ها، دیتابیس‌ها و تاریخچه استقرار پروژه', 'All services, databases and deployment history of')} «{removing?.name}» {t('حذف می‌شود.', 'will be deleted.')}
        </Alert>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-[#7E7790]">
          <Badge status="stopped">{t('تأیید لازم است', 'Confirmation required')}</Badge>
        </div>
      </Modal>
    </div>
  );
}
