import { Link } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { Button, Card, Icon } from '../lib/ui';

const FEATURES = [
  {
    icon: 'rocket',
    fa: ['استقرار واقعی', 'از مخزن GitHub یا ایمیج داکر با شناسایی خودکار زبان، لاگ زنده و تاریخچه کامل استقرار.'],
    en: ['Real deployments', 'Deploy from GitHub or a Docker image with automatic language detection, live logs and full history.'],
  },
  {
    icon: 'git',
    fa: ['اتصال گیت‌هاب', 'اتصال امن OAuth، انتخاب مخزن و شاخه، استقرار خودکار روی هر push با تأیید امضای وب‌هوک.'],
    en: ['GitHub integration', 'Secure OAuth, repository and branch selection, auto-deploy on push with verified webhook signatures.'],
  },
  {
    icon: 'database',
    fa: ['دیتابیس مدیریت‌شده', 'PostgreSQL، MySQL، Redis و MongoDB از طریق ارائه‌دهنده متصل خودتان، بدون نمونه ساختگی.'],
    en: ['Managed databases', 'PostgreSQL, MySQL, Redis and MongoDB through your own provider account — never simulated.'],
  },
  {
    icon: 'chart',
    fa: ['پایش و مشاهده‌پذیری', 'لاگ‌های ساخت و سیستم، فیلتر و جستجو، و معیارهای واقعی یا اعلام صریح نبود آن‌ها.'],
    en: ['Observability', 'Build and system logs with filters, plus real metrics or an explicit statement when unavailable.'],
  },
  {
    icon: 'users',
    fa: ['تیم و دسترسی‌ها', 'نقش‌های Owner، Admin، Developer و Viewer با بررسی مجوز در سمت سرور و گزارش رویدادها.'],
    en: ['Teams and access', 'Owner, Admin, Developer and Viewer roles with server-side permission checks and audit events.'],
  },
  {
    icon: 'shield',
    fa: ['امنیت از پایه', 'توکن ارائه‌دهنده فقط روی سرور و رمزنگاری‌شده، سکرت‌ها ماسک‌شده، نشست‌های قابل ابطال.'],
    en: ['Secure by design', 'Provider tokens stay encrypted server-side, secrets are masked and sessions can be revoked.'],
  },
];

export default function Landing() {
  const { t, lang, toggle } = useLang();

  return (
    <div className="pn-app-bg min-h-screen overflow-hidden">
      <div className="pointer-events-none fixed inset-0 pn-grid-lines opacity-70" />
      <div className="relative">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-[#8B35FF] to-[#168CFF] text-sm font-black text-white">P</span>
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">POMP NET CLOUD</p>
              <p className="text-[10px] text-[#A9A2BA]">POMP NET MOHAMMAD</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={toggle} className="rounded-lg px-2.5 py-1.5 text-xs text-[#A9A2BA] hover:text-white">
              {lang === 'fa' ? 'English' : 'فارسی'}
            </button>
            <Link to="/login">
              <Button variant="ghost" size="sm">{t('ورود', 'Sign in')}</Button>
            </Link>
            <Link to="/register">
              <Button size="sm">{t('شروع کنید', 'Get started')}</Button>
            </Link>
          </div>
        </header>

        <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-16">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-[#8B35FF]/30 bg-[#8B35FF]/10 px-3 py-1 text-[11px] text-[#C9A7FF]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8B35FF] pulse-dot" />
              {t('پلتفرم ابری توسعه‌دهندگان', 'A developer cloud platform')}
            </span>
            <h1 className="mt-5 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              {t('قدرت ساخت، آزادی انتخاب،', 'Build with power, choose freely,')}
              <span className="mt-1 block bg-gradient-to-r from-[#8B35FF] via-[#A855F7] to-[#168CFF] bg-clip-text text-transparent">
                {t('کنترل در دستان تو', 'control in your hands')}
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-sm leading-relaxed text-[#A9A2BA] sm:text-base">
              {t(
                'POMP NET CLOUD پروژه‌ها، سرویس‌ها و دیتابیس‌های شما را روی حساب ارائه‌دهنده زیرساخت خودتان مستقر و مدیریت می‌کند. هیچ استقرار، لاگ یا معیار ساختگی وجود ندارد.',
                'POMP NET CLOUD deploys and manages your projects, services and databases in your own infrastructure provider account. No deployment, log or metric is ever fabricated.',
              )}
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link to="/register">
                <Button size="lg" icon="rocket">{t('ساخت حساب و شروع', 'Create account and start')}</Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="secondary" icon="arrow">{t('ورود به پنل', 'Open dashboard')}</Button>
              </Link>
            </div>
            <p className="mt-4 text-[11px] text-[#7E7790]">
              {t('POMP NET مالک زیرساخت ارائه‌دهنده نیست؛ استقرار در حساب شما اجرا می‌شود.', 'POMP NET does not own the provider infrastructure; workloads run in your account.')}
            </p>
          </div>

          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <Card key={feature.icon} className="p-4 transition hover:border-[#8B35FF]/35">
                <div className="mb-2.5 grid h-9 w-9 place-items-center rounded-xl border border-[#8B35FF]/25 bg-[#8B35FF]/10 text-[#C9A7FF]">
                  <Icon name={feature.icon} className="h-4 w-4" />
                </div>
                <h3 className="text-sm font-semibold text-white">{t(feature.fa[0], feature.en[0])}</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#A9A2BA]">{t(feature.fa[1], feature.en[1])}</p>
              </Card>
            ))}
          </div>

          <Card className="mt-10 overflow-hidden">
            <div className="grid gap-0 md:grid-cols-3">
              {[
                { k: t('ارائه‌دهنده', 'Provider'), v: 'Railway API' },
                { k: t('وضعیت اتصال', 'Connection'), v: t('نیازمند توکن شما', 'Requires your token') },
                { k: t('اجرای بار کاری', 'Workload runs in'), v: t('حساب خودتان', 'Your own account') },
              ].map((row, i) => (
                <div key={row.k} className={i > 0 ? 'border-t border-white/[0.07] p-4 md:border-s md:border-t-0' : 'p-4'}>
                  <p className="text-[10px] uppercase tracking-wider text-[#7E7790]">{row.k}</p>
                  <p className="mt-1 text-sm text-[#E7E2F5]">{row.v}</p>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <footer className="border-t border-white/[0.06] px-4 py-6 text-center text-[11px] text-[#7E7790]">
          Powered by POMP NET MOHAMMAD · POMP NET CLOUD
        </footer>
      </div>
    </div>
  );
}
