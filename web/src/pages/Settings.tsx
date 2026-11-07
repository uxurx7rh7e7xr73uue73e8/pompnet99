import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { del, errorMessage, formatDate, get, patch, post, put } from '../lib/api';
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
  SectionTitle,
  Skeleton,
  Tabs,
  useToast,
} from '../lib/ui';

export default function Settings() {
  const { user, workspaceId, refresh, workspaces, setWorkspaceId } = useAuth();
  const { t, lang, lang: currentLang, setLang } = useLang();
  const toast = useToast();
  const [tab, setTab] = useState('profile');
  const [profile, setProfile] = useState({ name: user?.name ?? '', avatarUrl: user?.avatarUrl ?? '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [sessions, setSessions] = useState<any[]>([]);
  const [providers, setProviders] = useState<any>(null);
  const [railway, setRailway] = useState({ token: '', label: 'My Railway account' });
  const [busy, setBusy] = useState(false);
  const [githubNote, setGithubNote] = useState('');
  const [repos, setRepos] = useState<any[] | null>(null);
  const [oauthCfg, setOauthCfg] = useState<any>(null);
  const [oauthForm, setOauthForm] = useState({
    github: { clientId: '', clientSecret: '' },
    google: { clientId: '', clientSecret: '' },
  });

  const loadProviders = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const res = await get<any>(`/providers?workspaceId=${workspaceId}`);
      setProviders(res);
    } catch (err) {
      toast.error(t('دریافت وضعیت ارائه‌دهنده ناموفق بود', 'Could not read provider status'), errorMessage(err));
    }
  }, [workspaceId, toast, t]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await get<any>('/auth/sessions');
      setSessions(res.sessions ?? []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
    void loadSessions();
  }, [loadProviders, loadSessions]);

  const loadOauth = useCallback(async () => {
    try {
      const res = await get<any>('/auth/oauth/settings');
      setOauthCfg(res);
      setOauthForm({
        github: { clientId: res?.github?.clientId ?? '', clientSecret: '' },
        google: { clientId: res?.google?.clientId ?? '', clientSecret: '' },
      });
    } catch {
      setOauthCfg(null);
    }
  }, []);

  useEffect(() => {
    if (user?.isPlatformOwner) void loadOauth();
  }, [user?.isPlatformOwner, loadOauth]);

  const updateOauthForm = (
    provider: 'github' | 'google',
    patch: Partial<{ clientId: string; clientSecret: string }>,
  ) => {
    setOauthForm((f) =>
      provider === 'github'
        ? { ...f, github: { ...f.github, ...patch } }
        : { ...f, google: { ...f.google, ...patch } },
    );
  };

  const saveOauth = async (provider: 'github' | 'google') => {
    setBusy(true);
    try {
      const form = oauthForm[provider];
      const res = await put<any>('/auth/oauth/settings', {
        provider,
        clientId: form.clientId.trim(),
        clientSecret: form.clientSecret.trim() || undefined,
      });
      setOauthCfg(res);
      setOauthForm((f) =>
        provider === 'github'
          ? { ...f, github: { clientId: res?.github?.clientId ?? '', clientSecret: '' } }
          : { ...f, google: { clientId: res?.google?.clientId ?? '', clientSecret: '' } },
      );
      toast.success(
        t('تنظیمات ورود ذخیره شد', 'Sign-in settings saved'),
        res?.[provider]?.configured
          ? t('دکمهٔ ورود اکنون فعال است.', 'The sign-in button is now active.')
          : t('Client Secret را هم وارد کن.', 'Also provide the client secret.'),
      );
    } catch (err) {
      toast.error(t('ذخیره ناموفق بود', 'Save failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const clearOauth = async (provider: 'github' | 'google') => {
    setBusy(true);
    try {
      const res = await del<any>(`/auth/oauth/settings/${provider}`);
      setOauthCfg(res);
      setOauthForm((f) =>
        provider === 'github'
          ? { ...f, github: { clientId: res?.github?.clientId ?? '', clientSecret: '' } }
          : { ...f, google: { clientId: res?.google?.clientId ?? '', clientSecret: '' } },
      );
      toast.success(t('تنظیمات حذف شد', 'Settings cleared'));
    } catch (err) {
      toast.error(t('حذف ناموفق بود', 'Clear failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      await patch('/auth/profile', {
        name: profile.name.trim(),
        avatarUrl: profile.avatarUrl.trim() || null,
      });
      toast.success(t('پروفایل ذخیره شد', 'Profile saved'));
      await refresh();
    } catch (err) {
      toast.error(t('ذخیره ناموفق بود', 'Save failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async () => {
    setBusy(true);
    try {
      await patch('/auth/password', passwords);
      toast.success(t('گذرواژه تغییر کرد', 'Password changed'), t('نشست‌های دیگر بسته شدند.', 'Other sessions were closed.'));
      setPasswords({ currentPassword: '', newPassword: '' });
      await loadSessions();
    } catch (err) {
      toast.error(t('تغییر گذرواژه ناموفق بود', 'Password change failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const revokeSession = async (id: string) => {
    try {
      await del(`/auth/sessions/${id}`);
      toast.success(t('نشست بسته شد', 'Session revoked'));
      await loadSessions();
    } catch (err) {
      toast.error(t('بستن نشست ناموفق بود', 'Could not revoke session'), errorMessage(err));
    }
  };

  const connectRailway = async () => {
    setBusy(true);
    try {
      const res = await post<any>('/providers/railway/connect', {
        workspaceId,
        token: railway.token.trim(),
        label: railway.label.trim() || 'Railway',
      });
      toast.success(t('ارائه‌دهنده متصل شد', 'Provider connected'), res?.connection?.accountName ?? res?.connection?.account_name);
      setRailway({ token: '', label: 'My Railway account' });
      await loadProviders();
    } catch (err) {
      toast.error(t('اتصال ناموفق بود', 'Connection failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (provider: string) => {
    try {
      await del(`/providers/${provider}?workspaceId=${workspaceId}`);
      toast.success(t('اتصال حذف شد', 'Connection removed'));
      await loadProviders();
    } catch (err) {
      toast.error(t('حذف اتصال ناموفق بود', 'Could not remove connection'), errorMessage(err));
    }
  };

  const connectGithub = async () => {
    setBusy(true);
    try {
      const res = await get<any>(`/providers/github/authorize?workspaceId=${workspaceId}`);
      if (res?.url) {
        window.location.href = res.url;
      } else {
        setGithubNote(res?.message ?? t('GitHub OAuth پیکربندی نشده است.', 'GitHub OAuth is not configured.'));
      }
    } catch (err) {
      setGithubNote(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const loadRepos = async () => {
    try {
      const res = await get<any>(`/providers/github/repos?workspaceId=${workspaceId}`);
      setRepos(res.repos ?? []);
    } catch (err) {
      setRepos([]);
      setGithubNote(errorMessage(err));
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">{t('تنظیمات', 'Settings')}</h1>
        <p className="mt-1 text-sm text-[#A9A2BA]">
          {t('حساب، اتصال ارائه‌دهنده و ترجیحات نمایش', 'Account, provider connections and display preferences')}
        </p>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'profile', label: t('پروفایل', 'Profile') },
          { id: 'security', label: t('امنیت', 'Security') },
          { id: 'providers', label: t('ارائه‌دهنده‌ها', 'Providers') },
          ...(user?.isPlatformOwner ? [{ id: 'login', label: t('ورودها', 'Sign-in') }] : []),
          { id: 'workspace', label: t('ورک‌اسپیس', 'Workspace') },
        ]}
      />

      {tab === 'profile' ? (
        <Card>
          <SectionTitle title={t('پروفایل کاربری', 'User profile')} subtitle={user?.email} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('نام', 'Name')} required>
              <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </Field>
            <Field label={t('آدرس آواتار', 'Avatar URL')} hint={t('اختیاری', 'Optional')}>
              <Input value={profile.avatarUrl ?? ''} onChange={(e) => setProfile({ ...profile, avatarUrl: e.target.value })} dir="ltr" />
            </Field>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge status={user?.emailVerified ? 'active' : 'pending'}>
                {user?.emailVerified ? t('ایمیل تأیید شده', 'Email verified') : t('ایمیل تأیید نشده', 'Email not verified')}
              </Badge>
              <span className="text-[11px] text-[#7E7790]">{user?.createdAt ? formatDate(user.createdAt, lang) : ''}</span>
            </div>
            <Button size="sm" onClick={saveProfile} loading={busy} icon="check">{t('ذخیره', 'Save')}</Button>
          </div>
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-[#7E7790]">{t('زبان رابط', 'Interface language')}</p>
            <div className="flex gap-2">
              <Button size="sm" variant={currentLang === 'fa' ? 'primary' : 'secondary'} onClick={() => setLang('fa')}>فارسی</Button>
              <Button size="sm" variant={currentLang === 'en' ? 'primary' : 'secondary'} onClick={() => setLang('en')}>English</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'security' ? (
        <div className="space-y-3">
          <Card>
            <SectionTitle title={t('تغییر گذرواژه', 'Change password')} subtitle={t('با scrypt هش می‌شود', 'Hashed with scrypt')} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('گذرواژه فعلی', 'Current password')} required>
                <Input type="password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} dir="ltr" />
              </Field>
              <Field label={t('گذرواژه جدید', 'New password')} required hint={t('حداقل ۸ کاراکتر', 'Minimum 8 characters')}>
                <Input type="password" value={passwords.newPassword} onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })} dir="ltr" />
              </Field>
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={changePassword} loading={busy} icon="shield">{t('به‌روزرسانی گذرواژه', 'Update password')}</Button>
            </div>
          </Card>
          <Card>
            <SectionTitle title={t('نشست‌های فعال', 'Active sessions')} subtitle={t('نشست‌ها در پایگاه داده نگهداری می‌شوند', 'Sessions are stored server-side')} />
            {sessions.length ? (
              <div className="divide-y divide-white/[0.06]">
                {sessions.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-[#E7E2F5]" dir="ltr">{s.user_agent ?? s.userAgent ?? 'unknown device'}</p>
                      <p className="text-[10px] text-[#7E7790]">{formatDate(s.created_at ?? s.createdAt, lang)}</p>
                    </div>
                    <Button size="sm" variant="ghost" icon="trash" onClick={() => revokeSession(s.id)}>{t('بستن', 'Revoke')}</Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#7E7790]">{t('نشست دیگری یافت نشد.', 'No sessions found.')}</p>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'providers' ? (
        <div className="space-y-3">
          <Card>
            <SectionTitle
              title={t('ارائه‌دهنده زیرساخت (Railway)', 'Infrastructure provider (Railway)')}
              subtitle={t('توکن فقط در سرور و رمزنگاری‌شده ذخیره می‌شود', 'The token is stored encrypted, server-side only')}
              action={providers?.railway?.connected ? <Badge status="active">{t('متصل', 'connected')}</Badge> : <Badge status="pending">{t('متصل نیست', 'not connected')}</Badge>}
            />
            {providers === null ? (
              <Skeleton className="h-16" />
            ) : providers?.railway?.connected ? (
              <div className="space-y-2">
                <p className="text-sm text-white">{providers.railway.connection?.account_name ?? providers.railway.connection?.label}</p>
                <p className="text-[11px] text-[#7E7790]">
                  {t('قابلیت‌ها:', 'Capabilities:')}{' '}
                  {Object.entries(providers.railway.capabilities ?? {})
                    .map(([key, value]) => `${key}=${value ? 'yes' : 'no'}`)
                    .join(' · ')}
                </p>
                {providers.railway.note ? <p className="text-[11px] text-[#A9A2BA]">{providers.railway.note}</p> : null}
                <Button size="sm" variant="danger" icon="trash" onClick={() => disconnect('railway')}>{t('قطع اتصال', 'Disconnect')}</Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Field
                  label={t('توکن API حساب Railway', 'Railway account API token')}
                  required
                  hint={t(
                    'Account Token بسازید (نه Project Token) — railway.com/account/tokens',
                    'Create an Account Token (not a Project Token) at railway.com/account/tokens',
                  )}
                >
                  <Input type="password" value={railway.token} onChange={(e) => setRailway({ ...railway, token: e.target.value })} dir="ltr" className="font-mono text-xs" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </Field>
                <p className="text-[11px] text-[#A9A2BA]">
                  {t(
                    'در railway.com ← Account Settings ← Tokens یک توکن با نام دلخواه بساز و همان را اینجا وارد کن. توکن Project فقط به همان پروژه دسترسی دارد و برای لیست پروژه‌ها و دیپلوی پنل کار نمی‌کند.',
                    'Open railway.com → Account Settings → Tokens, create a token and paste it here. A project token only reaches one project and cannot list projects or deploy new services.',
                  )}{' '}
                  <a href="https://railway.com/account/tokens" target="_blank" rel="noreferrer" className="text-[#168CFF] underline">
                    {t('ساخت توکن', 'Create token')}
                  </a>
                </p>
                <Field label={t('برچسب', 'Label')}>
                  <Input value={railway.label} onChange={(e) => setRailway({ ...railway, label: e.target.value })} />
                </Field>
                <Alert tone="info" title={t('مالکیت زیرساخت', 'Infrastructure ownership')}>
                  {t('زیرساخت در حساب Railway خود شما اجرا می‌شود؛ POMP NET مالک آن نیست.', 'Infrastructure runs in your own Railway account; POMP NET does not own it.')}
                </Alert>
                <Button size="sm" onClick={connectRailway} loading={busy} disabled={!railway.token.trim()} icon="plug">{t('اتصال و اعتبارسنجی', 'Connect & validate')}</Button>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle
              title={t('GitHub', 'GitHub')}
              subtitle={t('OAuth رسمی GitHub برای دسترسی به مخازن', 'Official GitHub OAuth for repository access')}
              action={providers?.github?.connected ? <Badge status="active">{t('متصل', 'connected')}</Badge> : <Badge status="pending">{t('متصل نیست', 'not connected')}</Badge>}
            />
            {providers?.github?.connected ? (
              <div className="space-y-2">
                <p className="text-sm text-white">{providers.github.connection?.account_name ?? 'GitHub'}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" icon="refresh" onClick={loadRepos}>{t('نمایش مخازن', 'Load repositories')}</Button>
                  <Button size="sm" variant="danger" icon="trash" onClick={() => disconnect('github')}>{t('قطع اتصال', 'Disconnect')}</Button>
                </div>
                {repos ? (
                  repos.length ? (
                    <div className="max-h-64 space-y-1 overflow-auto">
                      {repos.map((r) => (
                        <div key={r.full_name} className="flex items-center justify-between rounded-lg border border-white/[0.06] px-2 py-1.5">
                          <span className="truncate font-mono text-[11px] text-[#E7E2F5]" dir="ltr">{r.full_name}</span>
                          <span className="text-[10px] text-[#7E7790]">{r.private ? t('خصوصی', 'private') : t('عمومی', 'public')}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[#7E7790]">{t('مخزنی یافت نشد.', 'No repositories found.')}</p>
                  )
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <Button size="sm" onClick={connectGithub} loading={busy} icon="github">{t('اتصال با GitHub', 'Connect with GitHub')}</Button>
                {providers?.github?.configured === false ? (
                  <Alert tone="warn" title={t('OAuth پیکربندی نشده', 'OAuth not configured')}>
                    {t('کلیدهای GITHUB_CLIENT_ID و GITHUB_CLIENT_SECRET باید روی سرور تنظیم شوند.', 'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be set on the server.')}
                  </Alert>
                ) : null}
                {githubNote ? <p className="text-[11px] text-[#A9A2BA]">{githubNote}</p> : null}
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'workspace' ? (
        <Card>
          <SectionTitle title={t('ورک‌اسپیس فعال', 'Active workspace')} subtitle={t('منابع هر ورک‌اسپیس جداگانه است', 'Resources are isolated per workspace')} />
          {workspaces.length ? (
            <div className="space-y-2">
              {workspaces.map((ws) => (
                <div key={ws.id} className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{ws.name}</p>
                    <p className="font-mono text-[10px] text-[#7E7790]">{ws.role ?? ws.id}</p>
                  </div>
                  {ws.id === workspaceId ? (
                    <Badge status="active">{t('فعال', 'active')}</Badge>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setWorkspaceId(ws.id)}>{t('انتخاب', 'Select')}</Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="users" title={t('ورک‌اسپیس یافت نشد', 'No workspace found')} />
          )}
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <p className="mb-2 text-[10px] uppercase tracking-wider text-[#7E7790]">{t('شناسه ورک‌اسپیس', 'Workspace ID')}</p>
            <CopyField value={workspaceId ?? ''} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
