import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /**
   * Nombre en texto plano. Se usa como título y como nombre accesible cuando
   * la etiqueta se oculta (por ejemplo en móvil, donde solo cabe el icono).
   */
  title?: string;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  layoutId,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  className?: string;
  size?: 'sm' | 'md';
  layoutId?: string;
}) {
  const id = layoutId ?? `seg-${options.map((o) => o.value).join('-')}`;
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            title={opt.title}
            aria-label={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {active ? (
              <motion.span
                layoutId={id}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                className="absolute inset-0 rounded-lg border border-line-strong bg-surface-2"
              />
            ) : null}
            <span className="relative flex items-center gap-1.5">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
