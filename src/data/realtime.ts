import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isConfigured } from '@/lib/env';

export interface RealtimeBinding {
  table: string;
  /** Filtro PostgREST, p.ej. `event_id=eq.<uuid>`. */
  filter?: string;
  /** Claves de React Query que deben refrescarse cuando cambie la tabla. */
  invalidate: QueryKey[];
}

/**
 * Suscripcion a cambios de PostgreSQL via Supabase Realtime.
 *
 * En lugar de mezclar el payload en la cache (fragil), invalidamos las queries
 * afectadas: React Query vuelve a pedir los datos y la UI queda consistente.
 * Es suficientemente rapido para un equipo pequeño y mucho mas robusto.
 */
export function useRealtime(channelName: string, bindings: RealtimeBinding[], enabled = true) {
  const qc = useQueryClient();

  // Serializamos las bindings para no re-suscribir en cada render.
  const signature = JSON.stringify(
    bindings.map((b) => [b.table, b.filter ?? '', b.invalidate.map((k) => JSON.stringify(k))]),
  );

  useEffect(() => {
    if (!enabled || !isConfigured) return;

    const parsed: RealtimeBinding[] = JSON.parse(signature).map(
      ([table, filter, invalidate]: [string, string, string[]]) => ({
        table,
        filter: filter || undefined,
        invalidate: invalidate.map((k) => JSON.parse(k) as QueryKey),
      }),
    );

    const channel = supabase.channel(channelName);

    for (const b of parsed) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: b.table, ...(b.filter ? { filter: b.filter } : {}) },
        () => {
          for (const key of b.invalidate) {
            void qc.invalidateQueries({ queryKey: key });
          }
        },
      );
    }

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName, signature, enabled, qc]);
}
