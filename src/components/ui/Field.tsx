import { forwardRef, useId } from 'react';
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cn } from '@/lib/utils';

const BASE =
  'w-full rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink placeholder:text-dim ' +
  'transition-colors focus:border-accent-soft focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--ef-accent)_35%,transparent)] ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-[12px] font-medium text-muted">
          {label}
          {required ? <span className="ml-0.5 text-danger">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <p className="text-[12px] text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-dim">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(BASE, 'h-10', className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(BASE, 'py-2 leading-relaxed', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(BASE, 'h-10 appearance-none bg-[length:16px] pr-8', className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2397a1bb' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 10px center',
        }}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export function Checkbox({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const id = useId();
  return (
    <label
      htmlFor={props.id ?? id}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 text-sm text-ink',
        props.disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <input
        id={props.id ?? id}
        type="checkbox"
        className="size-4 shrink-0 cursor-pointer rounded border-line-strong bg-surface-2 accent-[var(--ef-accent)]"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}

const SWATCHES = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#f43f5e',
  '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6',
  '#64748b', '#94a3b8', '#f87171',
];

export function ColorPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Color ${c}`}
          className={cn(
            'size-6 rounded-md border transition-transform hover:scale-110',
            value.toLowerCase() === c ? 'border-ink ring-2 ring-accent-soft' : 'border-line',
          )}
          style={{ background: c }}
        />
      ))}
      <label className="relative ml-1 inline-flex size-6 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-line-strong">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          aria-label="Color personalizado"
        />
        <span
          className="block size-full"
          style={{ background: `conic-gradient(from 180deg, #f87171, #fbbf24, #34d399, #22d3ee, #6366f1, #f472b6, #f87171)` }}
        />
      </label>
    </div>
  );
}

/** Input numerico con unidad a la derecha. */
export function NumberInput({
  value,
  onChange,
  unit,
  step = 0.01,
  min = 0,
  max,
  className,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className={cn('relative', className)}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const n = Number.parseFloat(e.target.value);
          onChange(Number.isFinite(n) ? n : 0);
        }}
        // Sin flechas nativas: en campos estrechos robaban el espacio del valor
        // y recortaban números como 0,75.
        className={cn(
          BASE,
          'num h-9 px-2 tabular-nums',
          '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
          unit && 'pr-6',
        )}
      />
      {unit ? (
        <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10.5px] text-dim">
          {unit}
        </span>
      ) : null}
    </div>
  );
}
