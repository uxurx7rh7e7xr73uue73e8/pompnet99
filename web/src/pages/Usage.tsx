import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { errorMessage, formatDate, get } from '../lib/api';
import { Alert, Badge, Card, EmptyState, Icon, SectionTitle, Skeleton, StatCard } from '../lib/ui';

const METRIC_LABELS: Record<string, [string, string]> = {
  deployments: ['استقرار', 'Deployments'],
  database_provisioned: ['دیتابیس ایجادشده', 'Databases provisioned'],
  build_minutes: ['دقیقه ساخت', 'Build minutes'],
  runtime_minutes: ['دقیقه اجرا', 'Runtime minutes'],
  bandwidth_gb: ['پهنای باند (GB)', 'Bandwidth (GB)'],
};

export default function Usage() {
  const { workspaceId, workspace } = useAuth();
  const { t, lang } = useLang();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const usage = data?.usage ?? [];
  const counts = data?.counts ?? {};
  const total = usage.reduce((sum: number, row: any) => sum + Number(row.total ?? 0), 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">{t('مصرف و صورتحساب', 'Usage & billing')}</h1>
        <p className="mt-1 text-sm text-[#A9A2BA]">
          {workspace?.name ?? '—'} · {t('مصرف از جدول usage_records خوانده می‌شود.', 'Usage is read from the usage_records table.')}
        </p>
      </div>

      <Alert tone="info" title={t('پرداخت فعال نیست', 'Payments are not active')}>
        {t(
          'هیچ درگاه پرداختی پیکربندی نشده است؛ این صفحه فقط مصرف واقعی ثبت‌شده را نمایش می‌دهد و مبلغی محاسبه یا دریافت نمی‌شود.',
          'No payment provider is configured. This page only shows recorded real usage; no amount is calculated or charged.',
        )}
      </Alert>

      {error ? <Alert tone="error" title={t('خطا', 'Error')}>{error}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <StatCard label={t('کل رویدادهای مصرف', 'Usage records')} value={usage.length} icon="chart" hint={t('این ماه', 'This month')} />
            <StatCard label={t('مجموع مقادیر', 'Total value')} value={total} icon="layers" tone="blue" hint={t('همه معیارها', 'All metrics')} />
            <StatCard label={t('استقرارها', 'Deployments')} value={counts.deployments ?? 0} icon="rocket" tone="green" hint={t('کل تاریخچه', 'All time')} />
            <StatCard label={t('دیتابیس‌ها', 'Databases')} value={counts.databases ?? 0} icon="database" tone="purple" hint={t('فعال', 'active')} />
          </>
        )}
      </div>

      <Card>
        <SectionTitle title={t('جزئیات مصرف', 'Usage breakdown')} subtitle={t('بر اساس معیار و واحد', 'Grouped by metric and unit')} />
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : usage.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-wider text-[#7E7790]">
                  <th className="py-2 text-start font-medium">{t('معیار', 'Metric')}</th>
                  <th className="py-2 text-start font-medium">{t('مقدار', 'Total')}</th>
                  <th className="py-2 text-start font-medium">{t('واحد', 'Unit')}</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((row: any) => {
                  const label = METRIC_LABELS[row.metric];
                  return (
                    <tr key={`${row.metric}-${row.unit}`} className="border-b border-white/[0.04]">
                      <td className="py-2.5 text-[#E7E2F5]">{label ? t(label[0], label[1]) : row.metric.replace(/_/g, ' ')}</td>
                      <td className="py-2.5 font-mono text-xs text-white">{row.total}</td>
                      <td className="py-2.5 text-[#A9A2BA]">{row.unit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="chart"
            title={t('مصرفی ثبت نشده است', 'No usage recorded')}
            description={t('پس از اولین استقرار موفق، رکوردهای مصرف اینجا نمایش داده می‌شوند.', 'After your first successful deployment, usage records appear here.')}
          />
        )}
      </Card>

      <Card>
        <SectionTitle title={t('تاریخچه صورتحساب', 'Billing history')} subtitle={t('ساختار آماده اتصال به درگاه پرداخت', 'Structure ready for a payment provider')} />
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-3 text-xs text-[#A9A2BA]">
          <Icon name="alert" className="h-4 w-4 text-amber-300" />
          {t('هیچ فاکتوری صادر نشده است، زیرا درگاه پرداخت پیکربندی نشده.', 'No invoice has been issued because no payment provider is configured.')}
        </div>
      </Card>

      {data?.connections ? (
        <Card>
          <SectionTitle title={t('وضعیت اتصال ارائه‌دهنده', 'Provider connection')} subtitle={t('مصرف در حساب ارائه‌دهنده شما ثبت می‌شود', 'Usage accrues in your provider account')} />
          <div className="flex flex-wrap gap-2">
            {['railway', 'github'].map((key) => (
              <Badge key={key} status={data.connections[key]?.connected ? 'connected' : 'stopped'}>
                {key}: {data.connections[key]?.connected ? t('متصل', 'connected') : t('قطع', 'not connected')}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[#7E7790]">
            {t('آخرین به‌روزرسانی:', 'Last updated:')} {formatDate(new Date().toISOString(), lang)}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
