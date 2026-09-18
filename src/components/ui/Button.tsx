import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-ink hover:brightness-110 active:brightness-95 shadow-[0_8px_24px_-10px_var(--ef-accent)] border border-transparent',
  secondary:
    'bg-surface-2 text-ink hover:bg-[color-mix(in_oklab,var(--ef-text)_14%,transparent)] border border-line',
  outline: 'bg-transparent text-ink border border-line-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-muted hover:text-ink hover:bg-surface-2 border border-transparent',
  subtle: 'bg-surface text-muted hover:text-ink border border-line',
  danger:
    'bg-[color-mix(in_oklab,var(--ef-danger)_92%,black)] text-white hover:brightness-110 border border-transparent',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2.5 rounded-xl',
  icon: 'h-9 w-9 rounded-lg justify-center',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'secondary', size = 'md', loading, icon, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-45',
        'active:scale-[0.985]',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 shrink-0 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export function IconButton({
  className,
  label,
  ...props
}: ButtonProps & { label: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={label}
      title={label}
      className={cn('shrink-0', className)}
      {...props}
    />
  );
}
