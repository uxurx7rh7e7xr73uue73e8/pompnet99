import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { errorMessage, get, post } from '../lib/api';
import { Alert, Button, Card, CopyField, Field, Icon, Input, useToast } from '../lib/ui';

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

const COPY: Record<Mode, { fa: [string, string]; en: [string, string] }> = {
  login: { fa: ['ورود به POMP NET CLOUD', 'با ایمیل و رمز عبور خود وارد شوید.'], en: ['Sign in to POMP NET CLOUD', 'Use your email and password.'] },
  register: { fa: ['ساخت حساب', 'ورک‌اسپیس شخصی شما به‌صورت خودکار ساخته می‌شود.'], en: ['Create your account', 'Your personal workspace is created automatically.'] },
  verify: { fa: ['تأیید ایمیل', 'برای فعال‌سازی عملیات زیرساختی، ایمیل را تأیید کنید.'], en: ['Verify your email', 'Verify your email to unlock infrastructure actions.'] },
  forgot: { fa: ['فراموشی رمز عبور', 'لینک بازنشانی برای ایمیل شما صادر می‌شود.'], en: ['Reset your password', 'A reset link will be issued for your email.'] },
  reset: { fa: ['تعیین رمز عبور جدید', 'رمز جدید باید حداقل ۸ کاراکتر باشد.'], en: ['Set a new password', 'Use at least 8 characters.'] },
};

function tokenFrom(link?: string | null): string | null {
  if (!link) return null;
  const match = /[?&]token=([^&]+)/.exec(link);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function Auth({ mode }: { mode: Mode }) {
  const { t, lang, toggle } = useLang();
  const { refresh, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [form, setForm] = useState({ name: '', email: '', password: '', token: params.get('token') ?? '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [devLink, setDevLink] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<'sent' | 'not_configured' | null>(null);
  const [oauth, setOauth] = useState<{
    github: { configured: boolean };
    google: { configured: boolean };
  } | null>(null);
  const [ghToken, setGhToken] = useState('');
  const [tokenOpen, setTokenOpen] = useState(false);

  useEffect(() => {
    const token = params.get('token');
    if (token) setForm((f) => ({ ...f, token }));
  }, [params]);

  useEffect(() => {
    if (mode !== 'login' && mode !== 'register') return;
    get<{ github: { configured: boolean }; google: { configured: boolean } }>('/auth/oauth/providers')
      .then(setOauth)
      .catch(() => setOauth(null));
  }, [mode]);

  useEffect(() => {
    const message = params.get('oauth_message');
    if (message) setError(message);
  }, [params]);

  const startOauth = (provider: 'github' | 'google') => {
    window.location.href = `/api/auth/oauth/${provider}/start`;
  };

  const signInWithGithubToken = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await post('/auth/oauth/github/token', { token: ghToken.trim() });
      await refresh();
      toast.success(t('ورود با GitHub تأیید شد', 'Signed in with GitHub'));
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode];
  const heading = useMemo(() => t(copy.fa[0], copy.en[0]), [copy, t]);
  const sub = useMemo(() => t(copy.fa[1], copy.en[1]), [copy, t]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    setDevLink(null);
    try {
      if (mode === 'login') {
        await post('/auth/login', { email: form.email.trim(), password: form.password });
        await refresh();
        toast.success(t('خوش آمدید', 'Welcome back'));
        navigate('/dashboard', { replace: true });
      } else if (mode === 'register') {
        const res = await post<any>('/auth/register', {
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
        });
        await refresh();
        const link = res?.verification?.link ?? null;
        setDelivery(res?.verification?.emailDelivery ?? null);
        setDevLink(link);
        setNotice(
          link
            ? t(
                'حساب ساخته شد. سرویس ایمیل پلتفرم پیکربندی نشده است؛ لینک تأیید را از اینجا باز کنید.',
                'Account created. Platform email delivery is not configured; open the verification link below.',
              )
            : t('حساب ساخته شد. ایمیل تأیید ارسال شد.', 'Account created. A verification email was sent.'),
        );
      } else if (mode === 'verify') {
        await post('/auth/verify', { token: form.token.trim() });
        await refresh();
        toast.success(t('ایمیل تأیید شد', 'Email verified'));
        navigate('/dashboard', { replace: true });
      } else if (mode === 'forgot') {
        const res = await post<any>('/auth/forgot', { email: form.email.trim() });
        setDelivery(res?.emailDelivery ?? null);
        setDevLink(res?.link ?? null);
        setNotice(res?.message ?? t('اگر ایمیل وجود داشته باشد، لینک ارسال می‌شود.', 'If the account exists, a link was issued.'));
      } else if (mode === 'reset') {
        await post('/auth/reset', { token: form.token.trim(), password: form.password });
        toast.success(t('رمز عبور به‌روزرسانی شد', 'Password updated'));
        navigate('/login', { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const title = 'POMP NET CLOUD';

  return (
    <div className="pn-app-bg grid min-h-screen place-items-center px-4 py-10">
      <div className="pointer-events-none fixed inset-0 pn-grid-lines opacity-60" />
      <div className="relative w-full max-w-md">
        <div className="mb-5 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#8B35FF] to-[#168CFF] text-sm font-black text-white">P</span>
            <span>
              <span className="block text-sm font-semibold text-white">{title}</span>
              <span className="block text-[10px] text-[#A9A2BA]">POMP NET MOHAMMAD</span>
            </span>
          </Link>
          <button onClick={toggle} className="rounded-lg px-2 py-1 text-xs text-[#A9A2BA] hover:text-white">
            {lang === 'fa' ? 'EN' : 'فا'}
          </button>
        </div>

        <Card className="p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2 text-[#C9A7FF]">
            <Icon name="shield" className="h-4 w-4" />
            <span className="text-[10px] uppercase tracking-[0.18em]">{t('احراز هویت امن', 'Secure authentication')}</span>
          </div>
          <h1 className="text-lg font-semibold text-white">{heading}</h1>
          <p className="mt-1 text-xs leading-relaxed text-[#A9A2BA]">{sub}</p>

          {user && mode === 'login' ? (
            <Alert tone="info" title={t('شما وارد شده‌اید', 'You are already signed in')}>
              <Link to="/dashboard" className="text-[#C9A7FF] hover:underline">{t('رفتن به داشبورد', 'Open dashboard')}</Link>
            </Alert>
          ) : null}

          {error ? <div className="mt-4"><Alert tone="error" title={t('عملیات ناموفق بود', 'Request failed')}>{error}</Alert></div> : null}
          {notice ? (
            <div className="mt-4">
              <Alert tone="info" title={t('وضعیت', 'Status')}>
                <p>{notice}</p>
                {delivery === 'not_configured' ? (
                  <p className="mt-1 text-[11px] opacity-80">
                    {t('تحویل ایمیل پیکربندی نشده است (SMTP).', 'Email delivery is not configured (SMTP).')}
                  </p>
                ) : null}
                {devLink ? (
                  <div className="mt-2 space-y-2">
                    <CopyField value={devLink} label={t('لینک تأیید', 'Verification link')} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const token = tokenFrom(devLink);
                        navigate(token ? `/${mode === 'forgot' ? 'reset' : 'verify'}?token=${token}` : '/verify');
                      }}
                    >
                      {t('باز کردن لینک', 'Open link')}
                    </Button>
                  </div>
                ) : null}
              </Alert>
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-4 space-y-3">
            {mode === 'register' ? (
              <Field label={t('نام', 'Name')} required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" required minLength={2} />
              </Field>
            ) : null}

            {mode === 'login' || mode === 'register' || mode === 'forgot' ? (
              <Field label={t('ایمیل', 'Email')} required>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required dir="ltr" />
              </Field>
            ) : null}

            {mode === 'login' || mode === 'register' || mode === 'reset' ? (
              <Field
                label={t('رمز عبور', 'Password')}
                required
                hint={mode === 'register' || mode === 'reset' ? t('حداقل ۸ کاراکتر، شامل حرف و رقم', 'At least 8 characters with letters and digits') : undefined}
              >
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  dir="ltr"
                />
              </Field>
            ) : null}

            {mode === 'verify' || mode === 'reset' ? (
              <Field label={t('توکن', 'Token')} required hint={t('از لینک ایمیل یا پیام قبلی', 'From the email link or previous message')}>
                <Input value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} required dir="ltr" className="font-mono text-xs" />
              </Field>
            ) : null}

            <Button type="submit" loading={busy} className="w-full" icon={mode === 'login' ? 'arrow' : 'check'}>
              {mode === 'login'
                ? t('ورود', 'Sign in')
                : mode === 'register'
                  ? t('ساخت حساب', 'Create account')
                  : mode === 'verify'
                    ? t('تأیید ایمیل', 'Verify email')
                    : mode === 'forgot'
                      ? t('ارسال لینک بازنشانی', 'Send reset link')
                      : t('ذخیره رمز جدید', 'Save new password')}
            </Button>
          </form>

          {mode === 'login' || mode === 'register' ? (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-[#7E7790]">
                <span className="h-px flex-1 bg-white/10" />
                {t('یا ادامه با', 'or continue with')}
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => startOauth('github')}
                  disabled={!oauth?.github.configured}
                  title={
                    oauth?.github.configured
                      ? t('ورود با GitHub', 'Sign in with GitHub')
                      : t('نیاز به تنظیم GITHUB_CLIENT_ID و GITHUB_CLIENT_SECRET', 'Needs GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET')
                  }
                >
                  GitHub
                </Button>
                <Button
                  variant="outline"
                  onClick={() => startOauth('google')}
                  disabled={!oauth?.google.configured}
                  title={
                    oauth?.google.configured
                      ? t('ورود با Google', 'Sign in with Google')
                      : t('نیاز به تنظیم GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET', 'Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET')
                  }
                >
                  Google
                </Button>
              </div>
              {oauth && (!oauth.github.configured || !oauth.google.configured) ? (
                <p className="text-[11px] leading-relaxed text-[#7E7790]">
                  {t(
                    'دکمهٔ خاکستری تا زمانی که کلید OAuth آن ارائه‌دهنده تنظیم نشود غیرفعال می‌ماند؛ برای GitHub همین حالا می‌توانی با توکن وارد شوی.',
                    'A greyed button stays disabled until that provider OAuth client is configured; for GitHub you can sign in with a token right now.',
                  )}
                </p>
              ) : null}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setTokenOpen((v) => !v)}
                  className="text-[11px] text-[#168CFF] hover:underline"
                >
                  {tokenOpen
                    ? t('بستن ورود با توکن', 'Hide token sign-in')
                    : t('ورود با توکن GitHub (بدون OAuth App)', 'Sign in with a GitHub token (no OAuth app)')}
                </button>
                {tokenOpen ? (
                  <div className="mt-2 space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <Field
                      label={t('توکن GitHub', 'GitHub token')}
                      hint={t(
                        'هویت با API گیت‌هاب تأیید می‌شود؛ توکن ذخیره نمی‌شود.',
                        'Identity is verified through the GitHub API; the token is never stored.',
                      )}
                    >
                      <Input
                        type="password"
                        dir="ltr"
                        className="font-mono text-xs"
                        placeholder="ghp_…"
                        value={ghToken}
                        onChange={(e) => setGhToken(e.target.value)}
                      />
                    </Field>
                    <Button
                      size="sm"
                      onClick={signInWithGithubToken}
                      loading={busy}
                      disabled={ghToken.trim().length < 20}
                      icon="check"
                    >
                      {t('تأیید و ورود', 'Verify & sign in')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.07] pt-3 text-[11px] text-[#7E7790]">
            {mode === 'login' ? (
              <>
                <Link to="/forgot" className="hover:text-[#C9A7FF]">{t('رمز عبور را فراموش کرده‌اید؟', 'Forgot password?')}</Link>
                <Link to="/register" className="hover:text-[#C9A7FF]">{t('حساب ندارید؟ ثبت‌نام', 'No account? Sign up')}</Link>
              </>
            ) : (
              <>
                <Link to="/login" className="hover:text-[#C9A7FF]">{t('بازگشت به ورود', 'Back to sign in')}</Link>
                <Link to="/register" className="hover:text-[#C9A7FF]">{t('ساخت حساب جدید', 'Create account')}</Link>
              </>
            )}
          </div>
        </Card>

        <p className="mt-4 text-center text-[11px] text-[#7E7790]">
          Powered by POMP NET MOHAMMAD · {t('رمزها با scrypt ذخیره می‌شوند.', 'Passwords are stored with scrypt.')}
        </p>
      </div>
    </div>
  );
}
