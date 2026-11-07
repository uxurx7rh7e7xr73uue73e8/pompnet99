import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/* ---------------------------------- icons --------------------------------- */

const ICONS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c4 0 6 2 6 6 0 4-4 8-8 8H8l-2-2v-4c0-4 4-8 8-8Z',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3ZM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
  users: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 20v-2a4 4 0 0 0-3-3.9M16 2.1a4 4 0 0 1 0 7.8',
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z',
  chart: 'M3 3v18h18M7 15l4-5 3 3 5-7',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  terminal: 'm4 17 6-6-6-6M12 19h8',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  chevron: 'm9 18 6-6-6-6',
  down: 'm6 9 6 6 6-6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z',
  copy: 'M9 9h10v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V9ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  play: 'm6 4 14 8-14 8V4Z',
  stop: 'M6 6h12v12H6z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  check: 'm4 12 5 5L20 6',
  x: 'M6 6l12 12M18 6 6 18',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0Z',
  layers: 'm12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5',
  git: 'M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.4 9.4 0 0 1 5 0c2-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2Z',
  key: 'M14 7a4 4 0 1 1-3.5 6L4 19.5V22H2v-3.5L8.5 12A4 4 0 0 1 14 7Z',
  command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
};

export function Icon({ name, className = 'h-4 w-4' }: { name: keyof typeof ICONS | string; className?: string }) {
  const path = ICONS[name] ?? ICONS.box;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/* --------------------------------- button --------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-gradient-to-r from-[#8B35FF] to-[#168CFF] text-white hover:brightness-110 shadow-[0_10px_30px_-12px_rgba(139,53,255,0.9)]',
  secondary: 'bg-white/[0.06] text-[#F5F2FF] hover:bg-white/[0.1] border border-white/10',
  ghost: 'text-[#A9A2BA] hover:text-white hover:bg-white/[0.06]',
  danger: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30',
  outline: 'border border-[#8B35FF]/40 text-[#C9A7FF] hover:bg-[#8B35FF]/10',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: string;
}) {
  const sizes = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-12 px-6 text-base gap-2.5' };
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cn(
        'btn-focus inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        sizes[size],
        className,
      )}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon ? <Icon name={icon} className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ---------------------------------- card ---------------------------------- */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('glass rounded-2xl', className)}>{children}</div>;
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-[#F5F2FF]">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-[#A9A2BA]">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'purple',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: string;
  tone?: 'purple' | 'blue' | 'green' | 'red';
}) {
  const tones = {
    purple: 'from-[#8B35FF]/25 to-transparent text-[#C9A7FF]',
    blue: 'from-[#168CFF]/25 to-transparent text-[#9CD2FF]',
    green: 'from-emerald-500/20 to-transparent text-emerald-300',
    red: 'from-rose-500/20 to-transparent text-rose-300',
  } as const;
  return (
    <Card className="relative overflow-hidden p-4">
      <div className={cn('pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70', tones[tone])} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-[#A9A2BA]">{label}</span>
          {icon ? <Icon name={icon} className="h-4 w-4 text-[#A9A2BA]" /> : null}
        </div>
        <div className="mt-2 text-2xl font-semibold tabular-nums text-[#F5F2FF]">{value}</div>
        {hint ? <div className="mt-1 text-xs text-[#A9A2BA]">{hint}</div> : null}
      </div>
    </Card>
  );
}

/* --------------------------------- badges --------------------------------- */

const STATUS_TONES: Record<string, string> = {
  running: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  connected: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  verified: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  ready: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  building: 'bg-[#168CFF]/15 text-[#9CD2FF] border-[#168CFF]/30',
  deploying: 'bg-[#168CFF]/15 text-[#9CD2FF] border-[#168CFF]/30',
  queued: 'bg-white/[0.06] text-[#C9C3D8] border-white/10',
  provisioning: 'bg-[#8B35FF]/15 text-[#C9A7FF] border-[#8B35FF]/30',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  pending_dns: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  invalid: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  stopped: 'bg-white/[0.06] text-[#A9A2BA] border-white/10',
  cancelled: 'bg-white/[0.06] text-[#A9A2BA] border-white/10',
  error: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  info: 'bg-[#168CFF]/15 text-[#9CD2FF] border-[#168CFF]/30',
  debug: 'bg-white/[0.06] text-[#A9A2BA] border-white/10',
};

export function Badge({ status, children }: { status?: string; children?: ReactNode }) {
  const key = (status ?? '').toLowerCase();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
        STATUS_TONES[key] ?? 'bg-white/[0.06] text-[#C9C3D8] border-white/10',
      )}
    >
      <span className={cn('status-dot h-1.5 w-1.5 rounded-full bg-current', key === 'building' || key === 'deploying' || key === 'provisioning' ? 'pulse-dot' : '')} />
      {children ?? status}
    </span>
  );
}

/* ---------------------------------- modal --------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#07050D]/80 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        className={cn(
          'animate-in relative w-full overflow-hidden rounded-t-3xl border border-[#8B35FF]/20 bg-[#120A22] shadow-[0_-20px_80px_-20px_rgba(139,53,255,0.5)] sm:rounded-2xl',
          wide ? 'max-w-3xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-[#F5F2FF]">{title}</h3>
            {description ? <p className="mt-1 text-sm text-[#A9A2BA]">{description}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[#A9A2BA] transition hover:bg-white/[0.06] hover:text-white" aria-label="close">
            <Icon name="x" />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-white/[0.07] px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ---------------------------------- form ---------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-[#C9C3D8]">
        {label}
        {required ? <span className="text-[#8B35FF]">*</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-300">{error}</span> : null}
      {!error && hint ? <span className="mt-1 block text-xs text-[#7E7790]">{hint}</span> : null}
    </label>
  );
}

const INPUT_CLASS =
  'w-full rounded-xl border border-white/10 bg-[#0C0718]/80 px-3 py-2.5 text-sm text-[#F5F2FF] placeholder:text-[#6B6480] outline-none transition focus:border-[#8B35FF]/60 focus:ring-2 focus:ring-[#8B35FF]/20';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(INPUT_CLASS, props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(INPUT_CLASS, 'min-h-[92px] resize-y font-mono text-[13px]', props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(INPUT_CLASS, 'appearance-none pe-8', props.className)} />;
}

/* ---------------------------------- toasts -------------------------------- */

type Toast = { id: number; title: string; description?: string; tone: 'success' | 'error' | 'info' };
interface ToastContextValue {
  push: (toast: Omit<Toast, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200);
  }, []);
  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (title, description) => push({ title, description, tone: 'success' }),
      error: (title, description) => push({ title, description, tone: 'error' }),
      info: (title, description) => push({ title, description, tone: 'info' }),
    }),
    [push],
  );
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:end-4 sm:items-end">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'animate-in pointer-events-auto w-full max-w-sm rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md',
              toast.tone === 'success'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                : toast.tone === 'error'
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-100'
                  : 'border-[#8B35FF]/30 bg-[#160B29]/90 text-[#EDE9FF]',
            )}
          >
            <div className="flex items-start gap-2.5">
              <Icon name={toast.tone === 'success' ? 'check' : toast.tone === 'error' ? 'alert' : 'bell'} className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{toast.title}</p>
                {toast.description ? <p className="mt-0.5 break-words text-xs opacity-80">{toast.description}</p> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

/* --------------------------------- misc ---------------------------------- */

export function EmptyState({
  icon = 'box',
  title,
  description,
  action,
}: {
  icon?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl border border-[#8B35FF]/25 bg-[#8B35FF]/10 text-[#C9A7FF]">
        <Icon name={icon} className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-[#F5F2FF]">{title}</p>
      {description ? <p className="mt-1 max-w-md text-xs leading-relaxed text-[#A9A2BA]">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={cn('shimmer rounded-md', className)} />;
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <div className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0A0614] px-3 py-2">
        {label ? <div className="text-[10px] uppercase tracking-wider text-[#7E7790]">{label}</div> : null}
        <code className="block truncate text-xs text-[#D9D2EE]">{value}</code>
      </div>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
        className="grid w-10 place-items-center rounded-lg border border-white/10 text-[#A9A2BA] transition hover:border-[#8B35FF]/40 hover:text-white"
        aria-label="copy"
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  title?: ReactNode;
  children?: ReactNode;
}) {
  const tones = {
    info: 'border-[#168CFF]/30 bg-[#168CFF]/10 text-[#BFE2FF]',
    warn: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    error: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
  } as const;
  return (
    <div className={cn('rounded-xl border px-3.5 py-3 text-xs leading-relaxed', tones[tone])}>
      {title ? <p className="mb-0.5 text-sm font-medium">{title}</p> : null}
      {children}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: string; label: string; count?: number }>;
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="scrollbar-none -mx-1 flex gap-1 overflow-x-auto border-b border-white/[0.07] px-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'relative shrink-0 whitespace-nowrap px-3.5 py-2.5 text-sm transition',
            active === tab.id ? 'text-white' : 'text-[#A9A2BA] hover:text-[#E7E2F5]',
          )}
        >
          <span className="flex items-center gap-1.5">
            {tab.label}
            {typeof tab.count === 'number' ? (
              <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[10px] text-[#C9C3D8]">{tab.count}</span>
            ) : null}
          </span>
          {active === tab.id ? (
            <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-[#8B35FF] to-[#168CFF]" />
          ) : null}
        </button>
      ))}
    </div>
  );
}
