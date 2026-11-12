import { Avatar } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Profile } from '@/lib/types';

/**
 * Las caras de las personas de una tarea, solapadas. A partir de `max` se
 * resume en «+N», y al pasar el ratón se leen todos los nombres.
 */
export function TaskPeople({
  ids,
  profiles,
  max = 4,
  className,
}: {
  ids: string[];
  profiles: Map<string, Profile>;
  max?: number;
  className?: string;
}) {
  const people = ids.map((id) => profiles.get(id)).filter((p): p is Profile => Boolean(p));
  if (!people.length) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <div
      className={cn('flex items-center -space-x-1.5', className)}
      title={people.map((p) => p.name).join(', ')}
    >
      {shown.map((p) => (
        <Avatar
          key={p.id}
          name={p.name}
          avatarUrl={p.avatar_url}
          color={p.color}
          size="xs"
          className="border-2 border-[var(--ef-surface-solid)]"
        />
      ))}
      {rest > 0 ? (
        <span className="num grid size-6 place-items-center rounded-full border-2 border-[var(--ef-surface-solid)] bg-surface-2 text-[10px] font-semibold text-muted">
          +{rest}
        </span>
      ) : null}
    </div>
  );
}
