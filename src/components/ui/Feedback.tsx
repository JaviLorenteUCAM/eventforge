import type { ReactNode } from 'react';
import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { cn, fmtPct, readableOn } from '@/lib/utils';
import { Button } from './Button';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-accent-soft', className)} />;
}

export function LoadingState({ label = 'Cargando…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-14 text-muted', className)}>
      <Spinner className="size-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Ha ocurrido un error.';
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-[color-mix(in_oklab,var(--ef-danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--ef-danger)_10%,transparent)] px-6 py-10 text-center',
        className,
      )}
    >
      <AlertCircle className="size-6 text-danger" />
      <div>
        <p className="text-sm font-medium text-ink">No se han podido cargar los datos</p>
        <p className="mt-1 max-w-md text-[13px] text-muted">{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="outline" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon,
  action,
  className,
}: {
  title: string;
  message?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center',
        className,
      )}
    >
      <div className="grid size-11 place-items-center rounded-2xl border border-line bg-surface-2 text-dim">
        {icon ?? <Inbox className="size-5" />}
      </div>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {message ? <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">{message}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  color,
  className,
  dot,
}: {
  children: ReactNode;
  color?: string;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium',
        className,
      )}
      style={
        color
          ? {
              borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
              background: `color-mix(in oklab, ${color} 16%, transparent)`,
              color: `color-mix(in oklab, ${color} 78%, var(--ef-text))`,
            }
          : undefined
      }
    >
      {dot && color ? <span className="size-1.5 rounded-full" style={{ background: color }} /> : null}
      {children}
    </span>
  );
}

export function SolidBadge({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold"
      style={{ background: color, color: readableOn(color) }}
    >
      {children}
    </span>
  );
}

export function Meter({
  value,
  max = 100,
  color,
  className,
  height = 8,
  showLabel,
}: {
  value: number;
  max?: number;
  color?: string;
  className?: string;
  height?: number;
  showLabel?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const auto = pct > 100 ? 'var(--ef-danger)' : pct > 85 ? 'var(--ef-warn)' : 'var(--ef-accent)';
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className="meter flex-1" style={{ height }}>
        <span
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${color ?? auto}, color-mix(in oklab, ${color ?? auto} 60%, white))`,
          }}
        />
      </div>
      {showLabel ? <span className="num w-10 text-right text-[12px] text-muted">{fmtPct(pct)}</span> : null}
    </div>
  );
}
