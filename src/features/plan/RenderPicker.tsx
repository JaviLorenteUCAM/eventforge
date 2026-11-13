import { useEffect, useState } from 'react';
import { Check, ImageOff } from 'lucide-react';
import { BUCKETS, resolveUrl } from '@/lib/storage';
import { cn } from '@/lib/utils';
import type { Snapshot } from '@/lib/types';

/** Máximo de fotos del render en la muestra. */
export const MAX_RENDERS = 20;

/**
 * Elegir las capturas del render que van en la muestra. Se marcan con un
 * clic, en el orden en que se quieren en el PDF (el número de cada una lo
 * dice), hasta {@link MAX_RENDERS}.
 */
export function RenderPicker({
  snapshots,
  selected,
  onChange,
}: {
  snapshots: Snapshot[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [urls, setUrls] = useState<Map<string, string | null>>(new Map());

  useEffect(() => {
    let alive = true;
    void Promise.all(
      snapshots.map(
        async (s) => [s.id, await resolveUrl(BUCKETS.captures, s.storage_path).catch(() => null)] as const,
      ),
    ).then((list) => {
      if (alive) setUrls(new Map(list));
    });
    return () => {
      alive = false;
    };
  }, [snapshots]);

  if (snapshots.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-3 text-[11.5px] leading-relaxed text-dim">
        Aún no hay capturas. En el plano, pasa a la vista 3D, encuadra y pulsa <b>Captura</b>: cada
        una aparece aquí para elegirla.
      </p>
    );
  }

  const full = selected.length >= MAX_RENDERS;
  return (
    <div className="grid max-h-[300px] grid-cols-2 gap-1.5 overflow-y-auto pr-0.5">
      {snapshots.map((s) => {
        const at = selected.indexOf(s.id);
        const on = at >= 0;
        const url = urls.get(s.id);
        return (
          <button
            key={s.id}
            type="button"
            disabled={!on && full}
            onClick={() => onChange(on ? selected.filter((id) => id !== s.id) : [...selected, s.id])}
            title={s.title}
            aria-pressed={on}
            className={cn(
              'relative aspect-video overflow-hidden rounded-md border bg-surface-2 transition',
              on ? 'border-[var(--ef-cyan)] ring-2 ring-[var(--ef-cyan)]' : 'border-line hover:border-line-strong',
              !on && full && 'cursor-not-allowed opacity-40',
            )}
          >
            {url ? (
              <img src={url} alt="" className="size-full object-cover" loading="lazy" />
            ) : (
              <span className="grid size-full place-items-center text-dim">
                <ImageOff className="size-4" />
              </span>
            )}
            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9.5px] font-semibold uppercase text-white">
              {s.kind}
            </span>
            {on ? (
              <span className="num absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-[var(--ef-cyan)] text-[10.5px] font-bold text-black">
                {at + 1}
              </span>
            ) : null}
            {on ? <Check className="absolute bottom-1 right-1 size-3.5 text-[var(--ef-cyan)]" /> : null}
          </button>
        );
      })}
    </div>
  );
}
