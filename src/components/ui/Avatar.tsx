import { useState } from 'react';
import { BUCKETS, publicUrl } from '@/lib/storage';
import { cn, initials, readableOn } from '@/lib/utils';

const SIZES = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-[11px]',
  md: 'size-10 text-[13px]',
  lg: 'size-14 text-base',
  xl: 'size-24 text-2xl',
  '2xl': 'size-32 text-4xl',
} as const;

export function Avatar({
  name,
  avatarUrl,
  color = '#6366f1',
  size = 'md',
  className,
  ring,
}: {
  name: string;
  avatarUrl?: string | null;
  color?: string;
  size?: keyof typeof SIZES;
  className?: string;
  ring?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : publicUrl(BUCKETS.avatars, avatarUrl);

  return (
    <div
      className={cn(
        'relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold',
        SIZES[size],
        ring && 'ring-2 ring-offset-2 ring-offset-[var(--ef-canvas)]',
        className,
      )}
      style={{
        background: src ? undefined : `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 55%, black))`,
        color: readableOn(color),
        ...(ring ? { ['--tw-ring-color' as string]: color } : {}),
      }}
      title={name}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span>{initials(name) || '?'}</span>
      )}
    </div>
  );
}

export function AvatarStack({
  people,
  max = 4,
  size = 'sm',
}: {
  people: { id: string; name: string; avatar_url?: string | null; color?: string }[];
  max?: number;
  size?: keyof typeof SIZES;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((p) => (
        <Avatar
          key={p.id}
          name={p.name}
          avatarUrl={p.avatar_url}
          color={p.color}
          size={size}
          className="border-2 border-[var(--ef-canvas)]"
        />
      ))}
      {rest > 0 ? (
        <div
          className={cn(
            'grid place-items-center rounded-full border-2 border-[var(--ef-canvas)] bg-surface-2 text-[11px] font-semibold text-muted',
            SIZES[size],
          )}
        >
          +{rest}
        </div>
      ) : null}
    </div>
  );
}
