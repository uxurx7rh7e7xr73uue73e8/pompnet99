import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './lib/auth';
import { useLang } from './lib/i18n';
import { get, post } from './lib/api';
import { Badge, Button, Icon, Modal, Spinner, cn } from './lib/ui';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import ServiceDetail from './pages/ServiceDetail';
import Templates from './pages/Templates';
import Team from './pages/Team';
import Usage from './pages/Usage';
import Settings from './pages/Settings';
import Admin from './pages/Admin';

const NAV = [
  { to: '/dashboard', key: 'dashboard', fa: 'داشبورد', en: 'Dashboard', icon: 'grid' },
  { to: '/projects', key: 'projects', fa: 'پروژه‌ها', en: 'Projects', icon: 'box' },
  { to: '/templates', key: 'templates', fa: 'قالب‌ها', en: 'Templates', icon: 'layers' },
  { to: '/team', key: 'team', fa: 'تیم', en: 'Team', icon: 'users' },
  { to: '/usage', key: 'usage', fa: 'مصرف و صورتحساب', en: 'Usage & billing', icon: 'chart' },
  { to: '/settings', key: 'settings', fa: 'تنظیمات', en: 'Settings', icon: 'settings' },
];

function FullScreenLoader() {
  return (
    <div className="pn-app-bg grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-3 text-[#A9A2BA]">
        <Spinner className="h-7 w-7 text-[#8B35FF]" />
        <p className="text-xs tracking-wide">POMP NET CLOUD</p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { workspaceId } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<any>({ projects: [], services: [], deployments: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResult({ projects: [], services: [], deployments: [] });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !workspaceId) return;
    const handle = window.setTimeout(async () => {
      if (!query.trim()) {
        setResult({ projects: [], services: [], deployments: [] });
        return;
      }
      setBusy(true);
      try {
        setResult(await get('/dashboard/search', { workspaceId, q: query.trim() }));
      } catch {
        setResult({ projects: [], services: [], deployments: [] });
      } finally {
        setBusy(false);
      }
    }, 220);
    return () => window.clearTimeout(handle);
  }, [query, open, workspaceId]);

  const go = (path: string) => {
    onClose();
    navigate(path);
  };

  const hasResults = result.projects.length + result.services.length + result.deployments.length > 0;

  return (
    <Modal open={open} onClose={onClose} title={t('جستجوی سراسری', 'Command palette')} description={t('پروژه، سرویس یا استقرار را پیدا کنید', 'Jump to a project, service or deployment')}>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('جستجو…', 'Search…')}
        className="w-full rounded-xl border border-white/10 bg-[#0A0614] px-3 py-2.5 text-sm text-white outline-none focus:border-[#8B35FF]/60"
      />
      <div className="mt-3 space-y-3">
        {busy ? <div className="flex items-center gap-2 text-xs text-[#A9A2BA]"><Spinner className="h-3.5 w-3.5" /> {t('در حال جستجو…', 'Searching…')}</div> : null}
        {!busy && !hasResults && query.trim() ? (
          <p className="text-xs text-[#A9A2BA]">{t('نتیجه‌ای یافت نشد.', 'No matches found.')}</p>
        ) : null}
        {result.projects.length ? (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-[#7E7790]">{t('پروژه‌ها', 'Projects')}</p>
            {result.projects.map((p: any) => (
              <button key={p.id} onClick={() => go(`/projects/${p.id}`)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm text-[#E7E2F5] hover:bg-white/[0.06]">
                <Icon name="box" className="h-3.5 w-3.5 text-[#8B35FF]" /> {p.name}
              </button>
            ))}
          </div>
        ) : null}
        {result.services.length ? (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-[#7E7790]">{t('سرویس‌ها', 'Services')}</p>
            {result.services.map((s: any) => (
              <button key={s.id} onClick={() => go(`/services/${s.id}`)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm text-[#E7E2F5] hover:bg-white/[0.06]">
                <Icon name="rocket" className="h-3.5 w-3.5 text-[#168CFF]" /> {s.name}
                <span className="text-[11px] text-[#7E7790]">{s.project_name}</span>
              </button>
            ))}
          </div>
        ) : null}
        {result.deployments.length ? (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-[#7E7790]">{t('استقرارها', 'Deployments')}</p>
            {result.deployments.map((d: any) => (
              <button key={d.id} onClick={() => go(`/services/${d.service_id}`)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm text-[#E7E2F5] hover:bg-white/[0.06]">
                <Icon name="clock" className="h-3.5 w-3.5 text-[#C9A7FF]" /> {d.service_name}
                <Badge status={d.status}>{d.status}</Badge>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, workspaces, workspaceId, setWorkspaceId, workspace } = useAuth();
  const { t, lang, toggle } = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pn_sidebar') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('pn_sidebar', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      window.location.hash = '#/';
      window.location.reload();
    }
  }, []);

  const crumbs = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    const map: Record<string, string> = {
      dashboard: t('داشبورد', 'Dashboard'),
      projects: t('پروژه‌ها', 'Projects'),
      services: t('سرویس', 'Service'),
      templates: t('قالب‌ها', 'Templates'),
      team: t('تیم', 'Team'),
      usage: t('مصرف', 'Usage'),
      settings: t('تنظیمات', 'Settings'),
      admin: t('مدیریت پلتفرم', 'Platform admin'),
    };
    return parts.map((p) => map[p] ?? p.slice(0, 8));
  }, [location.pathname, t]);

  const sidebar = (
    <div className="flex h-full flex-col gap-2 p-3">
      <Link to="/dashboard" className="mb-2 flex items-center gap-2.5 rounded-xl px-2 py-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[#8B35FF] to-[#168CFF] text-sm font-black text-white shadow-[0_10px_30px_-12px_rgba(139,53,255,0.9)]">
          P
        </span>
        {!collapsed ? (
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold tracking-tight text-white">POMP NET CLOUD</span>
            <span className="block truncate text-[10px] text-[#A9A2BA]">POMP NET MOHAMMAD</span>
          </span>
        ) : null}
      </Link>

      {!collapsed && workspaces.length > 0 ? (
        <label className="mb-1 block px-1">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-[#7E7790]">{t('ورک‌اسپیس', 'Workspace')}</span>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#0C0718] px-2 py-1.5 text-xs text-[#E7E2F5] outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <nav className="flex-1 space-y-1">
        {NAV.map((item) => {
          const active = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              title={t(item.fa, item.en)}
              className={cn(
                'group flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition',
                active
                  ? 'bg-gradient-to-r from-[#8B35FF]/20 to-transparent text-white shadow-[inset_0_0_0_1px_rgba(139,53,255,0.25)]'
                  : 'text-[#A9A2BA] hover:bg-white/[0.05] hover:text-white',
                collapsed && 'justify-center px-2',
              )}
            >
              <Icon name={item.icon} className={cn('h-4 w-4', active ? 'text-[#C9A7FF]' : '')} />
              {!collapsed ? <span className="truncate">{t(item.fa, item.en)}</span> : null}
            </Link>
          );
        })}
        {user?.isPlatformOwner ? (
          <Link
            to="/admin"
            className={cn(
              'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition',
              location.pathname.startsWith('/admin') ? 'bg-rose-500/10 text-rose-200' : 'text-[#A9A2BA] hover:bg-white/[0.05] hover:text-white',
              collapsed && 'justify-center px-2',
            )}
          >
            <Icon name="shield" className="h-4 w-4" />
            {!collapsed ? <span>{t('مدیریت پلتفرم', 'Platform admin')}</span> : null}
          </Link>
        ) : null}
      </nav>

      {!collapsed ? (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
          <p className="text-[10px] leading-relaxed text-[#7E7790]">
            {t('زیرساخت واقعی از حساب ارائه‌دهنده متصل شما اجرا می‌شود.', 'Real infrastructure runs in your own connected provider account.')}
          </p>
        </div>
      ) : null}

      <button
        onClick={() => setCollapsed((v) => !v)}
        className="hidden items-center justify-center gap-2 rounded-xl px-2 py-2 text-xs text-[#7E7790] transition hover:bg-white/[0.05] hover:text-white md:flex"
      >
        <Icon name="chevron" className={cn('h-3.5 w-3.5 transition-transform', collapsed ? '' : 'rotate-180')} />
        {!collapsed ? t('جمع کردن', 'Collapse') : null}
      </button>
    </div>
  );

  return (
    <div className="pn-app-bg min-h-screen">
      <div className="pointer-events-none fixed inset-0 pn-grid-lines opacity-60" />
      <div className="relative flex min-h-screen">
        <aside
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 border-e border-white/[0.06] bg-[#0A0614]/70 backdrop-blur-xl md:block',
            collapsed ? 'w-[68px]' : 'w-64',
          )}
        >
          {sidebar}
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <div className="animate-in absolute inset-y-0 start-0 w-72 border-e border-white/10 bg-[#0A0614]">{sidebar}</div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#07050D]/80 backdrop-blur-xl">
            <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
              <button className="rounded-lg p-2 text-[#A9A2BA] hover:bg-white/[0.06] hover:text-white md:hidden" onClick={() => setMobileOpen(true)} aria-label="menu">
                <Icon name="grid" />
              </button>
              <nav className="hidden min-w-0 items-center gap-1.5 text-xs text-[#7E7790] sm:flex">
                <Link to="/dashboard" className="hover:text-[#C9C3D8]">POMP NET</Link>
                {crumbs.map((c, i) => (
                  <span key={`${c}-${i}`} className="flex items-center gap-1.5">
                    <Icon name="chevron" className="h-3 w-3 rtl:rotate-180" />
                    <span className={i === crumbs.length - 1 ? 'truncate text-[#E7E2F5]' : 'truncate'}>{c}</span>
                  </span>
                ))}
              </nav>

              <div className="ms-auto flex items-center gap-1.5">
                <button
                  onClick={() => setPaletteOpen(true)}
                  className="hidden items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-[#A9A2BA] transition hover:border-[#8B35FF]/40 hover:text-white sm:flex"
                >
                  <Icon name="search" className="h-3.5 w-3.5" />
                  {t('جستجو', 'Search')}
                  <kbd className="rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[10px]">⌘K</kbd>
                </button>
                <button onClick={toggle} className="rounded-lg px-2 py-1.5 text-xs text-[#A9A2BA] transition hover:bg-white/[0.06] hover:text-white" aria-label="language">
                  {lang === 'fa' ? 'EN' : 'فا'}
                </button>
                <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 sm:flex">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {t('آنلاین', 'Live')}
                </span>
                <div className="ms-1 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-1 pe-1 ps-2">
                  <div className="hidden text-end sm:block">
                    <p className="max-w-[130px] truncate text-xs font-medium text-white">{user?.name}</p>
                    <p className="max-w-[130px] truncate text-[10px] text-[#7E7790]">{workspace?.name ?? user?.email}</p>
                  </div>
                  <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-[#8B35FF] to-[#168CFF] text-[11px] font-bold text-white">
                    {(user?.name ?? 'P').slice(0, 1).toUpperCase()}
                  </span>
                  <button onClick={logout} className="rounded-lg p-1.5 text-[#7E7790] transition hover:bg-white/[0.06] hover:text-rose-300" aria-label="logout">
                    <Icon name="logout" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 px-3 py-5 sm:px-5 lg:px-7">{children}</main>

          <footer className="border-t border-white/[0.06] px-4 py-4 text-center text-[11px] text-[#7E7790]">
            <span>Powered by POMP NET MOHAMMAD</span>
            <span className="mx-2 text-[#3B3350]">•</span>
            <span>POMP NET CLOUD</span>
          </footer>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Auth mode="login" />} />
      <Route path="/register" element={<Auth mode="register" />} />
      <Route path="/verify" element={<Auth mode="verify" />} />
      <Route path="/forgot" element={<Auth mode="forgot" />} />
      <Route path="/reset" element={<Auth mode="reset" />} />
      {[
        { path: '/dashboard', el: <Dashboard /> },
        { path: '/projects', el: <Projects /> },
        { path: '/projects/:projectId', el: <ProjectDetail /> },
        { path: '/services/:serviceId', el: <ServiceDetail /> },
        { path: '/templates', el: <Templates /> },
        { path: '/team', el: <Team /> },
        { path: '/usage', el: <Usage /> },
        { path: '/settings', el: <Settings /> },
        { path: '/admin', el: <Admin /> },
      ].map((route) => (
        <Route
          key={route.path}
          path={route.path}
          element={
            <RequireAuth>
              <Shell>{route.el}</Shell>
            </RequireAuth>
          }
        />
      ))}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
