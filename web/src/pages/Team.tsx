import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { del, errorMessage, formatDate, get, patch, post } from '../lib/api';
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
  useToast,
} from '../lib/ui';

const ROLES = [
  { value: 'admin', fa: 'مدیر', en: 'Admin' },
  { value: 'developer', fa: 'توسعه‌دهنده', en: 'Developer' },
  { value: 'viewer', fa: 'بازدیدکننده', en: 'Viewer' },
];

export default function Team() {
  const { workspaceId, workspace, refresh } = useAuth();
  const { t, lang } = useLang();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ email: '', role: 'developer' });
  const [busy, setBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<any>(null);
  const [renaming, setRenaming] = useState(false);
  const [wsName, setWsName] = useState('');

  const load = useCallback(async () => {
    if (!workspaceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await get(`/workspaces/${workspaceId}`);
      setData(res);
      setWsName(res.workspace?.name ?? '');
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

  const canManage = data?.role === 'owner' || data?.role === 'admin';

  const invite = async () => {
    setBusy(true);
    try {
      const res = await post<any>(`/workspaces/${workspaceId}/members/invite`, {
        email: form.email.trim(),
        role: form.role,
      });
      setInviteResult(res);
      toast.success(t('دعوت ثبت شد', 'Invitation recorded'), res?.invitation?.email ?? form.email.trim());
      setForm({ email: '', role: 'developer' });
      await load();
    } catch (err) {
      toast.error(t('دعوت ناموفق بود', 'Invitation failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (member: any, role: string) => {
    try {
      await patch(`/workspaces/${workspaceId}/members/${member.user_id}`, { role });
      toast.success(t('نقش به‌روزرسانی شد', 'Role updated'));
      await load();
    } catch (err) {
      toast.error(t('تغییر نقش ناموفق بود', 'Could not change role'), errorMessage(err));
    }
  };

  const removeMember = async (member: any) => {
    try {
      await del(`/workspaces/${workspaceId}/members/${member.user_id}`);
      toast.success(t('عضو حذف شد', 'Member removed'));
      await load();
    } catch (err) {
      toast.error(t('حذف ناموفق بود', 'Removal failed'), errorMessage(err));
    }
  };

  const renameWorkspace = async () => {
    setBusy(true);
    try {
      await patch(`/workspaces/${workspaceId}`, { name: wsName.trim() });
      toast.success(t('نام ورک‌اسپیس به‌روزرسانی شد', 'Workspace renamed'));
      setRenaming(false);
      await refresh();
      await load();
    } catch (err) {
      toast.error(t('تغییر نام ناموفق بود', 'Rename failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-white">{t('تیم و دسترسی‌ها', 'Team & access')}</h1>
          <p className="mt-1 text-sm text-[#A9A2BA]">
            {workspace?.name ?? '—'} · {t('بررسی مجوزها در سمت سرور انجام می‌شود.', 'Permission checks run on the server.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon="settings" onClick={() => setRenaming(true)} disabled={!canManage}>
            {t('تغییر نام', 'Rename')}
          </Button>
          <Button icon="users" onClick={() => setInviteOpen(true)} disabled={!canManage}>
            {t('دعوت عضو', 'Invite member')}
          </Button>
        </div>
      </div>

      {error ? <Alert tone="error" title={t('خطا', 'Error')}>{error}</Alert> : null}
      {!canManage && data ? (
        <Alert tone="warn" title={t('دسترسی محدود', 'Limited access')}>
          {t('فقط Owner و Admin می‌توانند اعضا را مدیریت کنند.', 'Only Owner and Admin can manage members.')}
        </Alert>
      ) : null}

      <Card>
        <SectionTitle title={t('اعضا', 'Members')} subtitle={`${data?.members?.length ?? 0} ${t('عضو', 'members')}`} />
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : data?.members?.length ? (
          <div className="divide-y divide-white/[0.06]">
            {data.members.map((m: any) => (
              <div key={m.id ?? m.user_id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#8B35FF] to-[#168CFF] text-[11px] font-bold text-white">
                  {(m.name ?? m.email ?? 'P').slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">{m.name ?? m.email}</p>
                  <p className="truncate text-[11px] text-[#7E7790]">{m.email}</p>
                </div>
                {canManage && m.role !== 'owner' ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole(m, e.target.value)}
                      className="w-32 py-1 text-xs"
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>{t(role.fa, role.en)}</option>
                      ))}
                    </Select>
                    <button onClick={() => removeMember(m)} className="rounded-lg p-1.5 text-[#5F5872] hover:bg-rose-500/10 hover:text-rose-300" aria-label="remove">
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <Badge status="active">{m.role}</Badge>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="users" title={t('عضوی یافت نشد', 'No members found')} />
        )}
      </Card>

      <Card>
        <SectionTitle title={t('دعوت‌های در انتظار', 'Pending invitations')} subtitle={t('پذیرش دعوت از طریق لینک', 'Invitations are accepted through a link')} />
        {data?.invitations?.length ? (
          <div className="space-y-2">
            {data.invitations.map((inv: any) => (
              <div key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[#E7E2F5]">{inv.email}</p>
                  <p className="text-[11px] text-[#7E7790]">{formatDate(inv.created_at, lang)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge status="pending">{inv.role}</Badge>
                  <Badge status={inv.status ?? 'pending'}>{inv.status ?? 'pending'}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#7E7790]">{t('دعوت در انتظاری وجود ندارد.', 'No pending invitations.')}</p>
        )}
      </Card>

      <Card>
        <SectionTitle title={t('گزارش رویدادها', 'Audit events')} subtitle={t('ثبت‌شده در audit_logs', 'Recorded in audit_logs')} />
        <p className="text-xs text-[#7E7790]">
          {t('عملیات حساس مثل حذف منابع و تغییر نقش‌ها در گزارش ممیزی ثبت می‌شود.', 'Sensitive actions such as deletions and role changes are written to the audit log.')}
        </p>
      </Card>

      <Modal
        open={inviteOpen}
        onClose={() => {
          setInviteOpen(false);
          setInviteResult(null);
        }}
        title={t('دعوت عضو جدید', 'Invite a new member')}
        description={t('دعوت فقط برای ایمیل ثبت‌شده قابل پذیرش است.', 'An invitation can only be accepted by a registered email.')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>{t('بستن', 'Close')}</Button>
            <Button onClick={invite} loading={busy} icon="users">{t('ثبت دعوت', 'Send invitation')}</Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('ایمیل', 'Email')} required>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
          </Field>
          <Field label={t('نقش', 'Role')}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>{t(role.fa, role.en)}</option>
              ))}
            </Select>
          </Field>
          {inviteResult ? (
            <Alert tone="info" title={t('نتیجه دعوت', 'Invitation result')}>
              {inviteResult.inviteLink ? (
                <span className="break-all font-mono text-[11px]" dir="ltr">{inviteResult.inviteLink}</span>
              ) : (
                t('دعوت ثبت شد؛ تحویل ایمیل به پیکربندی SMTP وابسته است.', 'Invitation recorded; delivery depends on SMTP configuration.')
              )}
            </Alert>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t('تغییر نام ورک‌اسپیس', 'Rename workspace')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRenaming(false)}>{t('انصراف', 'Cancel')}</Button>
            <Button onClick={renameWorkspace} loading={busy} icon="check">{t('ذخیره', 'Save')}</Button>
          </div>
        }
      >
        <Field label={t('نام', 'Name')} required>
          <Input value={wsName} onChange={(e) => setWsName(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}
