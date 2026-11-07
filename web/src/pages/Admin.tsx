import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { errorMessage, formatDate, get, patch, relativeTime } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Input,
  SectionTitle,
  Skeleton,
  StatCard,
  Tabs,
  Textarea,
  useToast,
} from '../lib/ui';

export default function Admin() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const toast = useToast();
  const [tab, setTab] = useState('overview');
  const [overview, setOverview] = useState<any>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState({ maintenanceMode: false, signupEnabled: true, platformNotice: '' });
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    try {
      const res = await get<any>('/admin/overview');
      setOverview(res);
      if (res?.settings) {
        setSettings({
          maintenanceMode: Boolean(res.settings.maintenanceMode),
          signupEnabled: res.settings.signupEnabled !== false,
          platformNotice: res.settings.platformNotice ?? '',
        });
      }
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTab = useCallback(async () => {
    if (tab === 'overview' || tab === 'settings') return;
    setLoading(true);
    try {
      const res = await get<any>(`/admin/${tab}`);
      const key = tab;
      setRows(res?.[key] ?? res?.items ?? res?.rows ?? []);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadTab();
  }, [loadTab]);

  const saveSettings = async () => {
    setBusy(true);
    try {
      await patch('/admin/settings', settings);
      toast.success(t('تنظیمات پلتفرم ذخیره شد', 'Platform settings saved'));
      await loadOverview();
    } catch (err) {
      toast.error(t('ذخیره ناموفق بود', 'Save failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleUser = async (row: any) => {
    try {
      await patch(`/admin/users/${row.id}`, { suspended: !row.suspended });
      toast.success(t('وضعیت کاربر تغییر کرد', 'User status updated'));
      await loadTab();
    } catch (err) {
      toast.error(t('تغییر وضعیت ناموفق بود', 'Could not update user'), errorMessage(err));
    }
  };

  if (error && !overview) {
    return (
      <div className="mx-auto max-w-3xl">
        <Alert tone="error" title={t('دسترسی به پنل مالک', 'Platform owner access')}>{error}</Alert>
      </div>
    );
  }

  const counts = overview?.counts ?? {};

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-white">
          {t('پنل مالک پلتفرم', 'Platform owner panel')}
          <Badge status="active">{t('محدود', 'restricted')}</Badge>
        </h1>
        <p className="mt-1 text-sm text-[#A9A2BA]">
          {user?.email} · {t('این بخش فقط برای مالک واقعی پلتفرم قابل دسترسی است.', 'Only the actual platform owner can access this area.')}
        </p>
      </div>

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: t('نمای کلی', 'Overview') },
          { id: 'users', label: t('کاربران', 'Users') },
          { id: 'workspaces', label: t('ورک‌اسپیس‌ها', 'Workspaces') },
          { id: 'projects', label: t('پروژه‌ها', 'Projects') },
          { id: 'deployments', label: t('استقرارها', 'Deployments') },
          { id: 'audit', label: t('ممیزی', 'Audit') },
          { id: 'errors', label: t('خطاها', 'Errors') },
          { id: 'settings', label: t('تنظیمات', 'Settings') },
        ]}
      />

      {tab === 'overview' ? (
        loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t('کاربران', 'Users')} value={counts.users ?? 0} icon="users" />
            <StatCard label={t('ورک‌اسپیس‌ها', 'Workspaces')} value={counts.workspaces ?? 0} icon="layers" />
            <StatCard label={t('پروژه‌ها', 'Projects')} value={counts.projects ?? 0} icon="box" />
            <StatCard label={t('استقرارها', 'Deployments')} value={counts.deployments ?? 0} icon="rocket" />
          </div>
        )
      ) : null}

      {tab === 'settings' ? (
        <Card>
          <SectionTitle title={t('تنظیمات پلتفرم', 'Platform settings')} subtitle={t('در جدول platform_settings ذخیره می‌شود', 'Stored in platform_settings')} />
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input id="maintenance" type="checkbox" checked={settings.maintenanceMode} onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })} className="h-3.5 w-3.5 accent-[#8B35FF]" />
              <label htmlFor="maintenance" className="text-xs text-[#A9A2BA]">{t('حالت تعمیرات (دسترسی کاربران محدود می‌شود)', 'Maintenance mode (user access restricted)')}</label>
            </div>
            <div className="flex items-center gap-2">
              <input id="signup" type="checkbox" checked={settings.signupEnabled} onChange={(e) => setSettings({ ...settings, signupEnabled: e.target.checked })} className="h-3.5 w-3.5 accent-[#8B35FF]" />
              <label htmlFor="signup" className="text-xs text-[#A9A2BA]">{t('ثبت‌نام باز باشد', 'Allow new registrations')}</label>
            </div>
            <Field label={t('اعلان سراسری', 'Global notice')} hint={t('در داشبورد کاربران نمایش داده می‌شود', 'Shown on the dashboard')}>
              <Textarea value={settings.platformNotice} onChange={(e) => setSettings({ ...settings, platformNotice: e.target.value })} rows={3} />
            </Field>
            <div className="flex justify-end">
              <Button size="sm" onClick={saveSettings} loading={busy} icon="check">{t('ذخیره', 'Save')}</Button>
            </div>
          </div>
        </Card>
      ) : null}

      {['users', 'workspaces', 'projects', 'deployments', 'audit', 'errors'].includes(tab) ? (
        <Card>
          <SectionTitle
            title={tab.charAt(0).toUpperCase() + tab.slice(1)}
            subtitle={t('داده واقعی از پایگاه داده پلتفرم', 'Real platform database records')}
            action={<Button size="sm" variant="secondary" icon="refresh" onClick={loadTab}>{t('بازخوانی', 'Refresh')}</Button>}
          />
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : rows.length ? (
            <div className="divide-y divide-white/[0.06]">
              {rows.map((row, index) => (
                <div key={row.id ?? index} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[#E7E2F5]">
                      {row.email ?? row.name ?? row.slug ?? row.action ?? row.message ?? row.id}
                    </p>
                    <p className="truncate text-[10px] text-[#7E7790]">
                      {row.status ?? row.role ?? row.provider ?? row.kind ?? ''}
                      {row.created_at ? ` · ${relativeTime(row.created_at, lang)}` : ''}
                    </p>
                  </div>
                  {tab === 'users' ? (
                    <div className="flex items-center gap-2">
                      {row.suspended ? <Badge status="failed">{t('معلق', 'suspended')}</Badge> : <Badge status="active">{t('فعال', 'active')}</Badge>}
                      <Button size="sm" variant="ghost" onClick={() => toggleUser(row)}>
                        {row.suspended ? t('فعال‌سازی', 'Reactivate') : t('تعلیق', 'Suspend')}
                      </Button>
                    </div>
                  ) : row.status ? (
                    <Badge status={row.status}>{row.status}</Badge>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon="shield" title={t('رکوردی یافت نشد', 'No records found')} />
          )}
        </Card>
      ) : null}
    </div>
  );
}
