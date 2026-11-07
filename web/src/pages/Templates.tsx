import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { errorMessage, get, post } from '../lib/api';
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
  Textarea,
  useToast,
} from '../lib/ui';

export default function Templates() {
  const { workspaceId } = useAuth();
  const { t } = useLang();
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<{ templates: any[]; categories?: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState<any>(null);
  const [form, setForm] = useState({ projectName: '', environment: 'production' });
  const [vars, setVars] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await get('/templates'));
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => ['all', ...(data?.categories ?? [])], [data]);

  const templates = useMemo(() => {
    const list = data?.templates ?? [];
    return category === 'all' ? list : list.filter((tpl) => tpl.category === category);
  }, [data, category]);

  const openDeploy = (tpl: any) => {
    setSelected(tpl);
    setResult(null);
    setForm({ projectName: tpl.name, environment: 'production' });
    const required: string[] = Array.isArray(tpl.required_env) ? tpl.required_env : [];
    setVars(Object.fromEntries(required.map((key) => [key, ''])));
  };

  const deploy = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const payload = {
        workspaceId,
        projectName: form.projectName.trim(),
        environment: form.environment,
        variables: Object.fromEntries(Object.entries(vars).filter(([, v]) => v.trim())),
      };
      const res = await post<any>(`/templates/${selected.id}/deploy`, payload);
      setResult(res);
      toast.success(t('درخواست استقرار ثبت شد', 'Deployment requested'));
    } catch (err) {
      toast.error(t('استقرار ناموفق بود', 'Deployment failed'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">{t('قالب‌ها', 'Templates')}</h1>
        <p className="mt-1 text-sm text-[#A9A2BA]">
          {t(
            'فقط قالب‌هایی نمایش داده می‌شوند که پیکربندی استقرار واقعی دارند.',
            'Only templates with a real deployment configuration are listed.',
          )}
        </p>
      </div>

      {error ? <Alert tone="error" title={t('خطا', 'Error')}>{error}</Alert> : null}

      <div className="flex flex-wrap gap-1.5">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={
              category === c
                ? 'rounded-lg border border-[#8B35FF]/40 bg-[#8B35FF]/15 px-2.5 py-1 text-xs text-[#E7E2F5]'
                : 'rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1 text-xs text-[#A9A2BA] hover:text-white'
            }
          >
            {c === 'all' ? t('همه', 'All') : c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36" />)}
        </div>
      ) : templates.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <Card key={tpl.id} className="flex flex-col p-4">
              <div className="flex items-start gap-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#168CFF]/25 bg-[#168CFF]/10 text-[#9CD2FF]">
                  <Icon name="layers" className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{tpl.name}</p>
                  <p className="text-[10px] uppercase tracking-wider text-[#7E7790]">{tpl.category ?? 'template'}</p>
                </div>
              </div>
              <p className="mt-2 line-clamp-3 min-h-[3rem] text-xs leading-relaxed text-[#A9A2BA]">{tpl.description}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(Array.isArray(tpl.providers) ? tpl.providers : []).map((p: string) => (
                  <Badge key={p} status="info">{p}</Badge>
                ))}
                {(Array.isArray(tpl.required_env) ? tpl.required_env : []).length ? (
                  <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-[#A9A2BA]">
                    {(tpl.required_env as string[]).length} {t('متغیر لازم', 'required vars')}
                  </span>
                ) : null}
              </div>
              <div className="mt-auto flex items-center justify-between border-t border-white/[0.06] pt-2.5">
                <span className="text-[10px] text-[#7E7790]">
                  {tpl.resources ? `${tpl.resources}` : t('منابع پیش‌فرض', 'Default resources')}
                </span>
                <Button size="sm" variant="outline" icon="rocket" onClick={() => openDeploy(tpl)} disabled={!workspaceId}>
                  {t('استقرار', 'Deploy')}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon="layers"
            title={t('قالبی در این دسته نیست', 'No templates in this category')}
            description={t('قالب‌ها از جدول templates خوانده می‌شوند.', 'Templates are read from the templates table.')}
          />
        </Card>
      )}

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? t(`استقرار ${selected.name}`, `Deploy ${selected.name}`) : ''}
        description={t('این عملیات یک پروژه واقعی می‌سازد و استقرار را به ارائه‌دهنده متصل شما می‌فرستد.', 'This creates a real project and submits the deployment to your connected provider.')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setSelected(null)}>{t('بستن', 'Close')}</Button>
            {result ? (
              <Button icon="arrow" onClick={() => navigate(result.serviceId ? `/services/${result.serviceId}` : '/projects')}>
                {t('مشاهده استقرار', 'View deployment')}
              </Button>
            ) : (
              <Button onClick={deploy} loading={busy} icon="rocket">{t('استقرار', 'Deploy')}</Button>
            )}
          </div>
        }
      >
        {result ? (
          <div className="space-y-2">
            <Alert tone="success" title={t('درخواست ثبت شد', 'Request submitted')}>
              {t('وضعیت واقعی استقرار را در صفحه سرویس ببینید.', 'Follow the real deployment status on the service page.')}
            </Alert>
            <pre className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-[#07050D] p-2.5 font-mono text-[11px] text-[#A9A2BA]" dir="ltr">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="space-y-3">
            <Field label={t('نام پروژه', 'Project name')} required>
              <Input value={form.projectName} onChange={(e) => setForm({ ...form, projectName: e.target.value })} />
            </Field>
            <Field label={t('محیط', 'Environment')}>
              <Select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                <option value="production">production</option>
                <option value="staging">staging</option>
                <option value="development">development</option>
              </Select>
            </Field>
            {Object.keys(vars).length ? (
              <div className="space-y-2 rounded-xl border border-white/[0.07] bg-white/[0.02] p-2.5">
                <p className="text-[11px] text-[#A9A2BA]">{t('متغیرهای لازم', 'Required variables')}</p>
                {Object.keys(vars).map((key) => (
                  <Field key={key} label={key}>
                    <Input
                      value={vars[key]}
                      onChange={(e) => setVars({ ...vars, [key]: e.target.value })}
                      dir="ltr"
                      className="font-mono text-xs"
                      placeholder={t('مقدار', 'value')}
                    />
                  </Field>
                ))}
              </div>
            ) : null}
            {selected?.instructions ? (
              <div>
                <p className="mb-1 text-[11px] text-[#7E7790]">{t('دستورالعمل', 'Instructions')}</p>
                <Textarea readOnly rows={3} value={selected.instructions} className="text-xs" />
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      <Card>
        <SectionTitle title={t('قالب‌های شخصی', 'Your own templates')} subtitle={t('قالب‌های ذخیره‌شده در جدول templates', 'Saved in the templates table')} />
        <p className="text-xs text-[#7E7790]">
          {t('قالب‌های ساخته‌شده توسط شما با همان ساختار در این فهرست نمایش داده می‌شوند.', 'Templates you create appear here with the same structure.')}
        </p>
      </Card>
    </div>
  );
}
