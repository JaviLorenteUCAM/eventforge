import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { EventMember, EventRow } from '@/lib/types';
import { ApiError, deleteRow, insertRow, selectAll, updateRow } from './api';
import { qk } from './keys';

export function useEvents() {
  return useQuery({
    queryKey: qk.events,
    queryFn: () =>
      selectAll<EventRow>('events', (q) => q.order('starts_at', { ascending: true })),
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: qk.event(id ?? 'none'),
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from('events').select('*').eq('id', id!).maybeSingle();
      if (error) throw new ApiError(error);
      return (data as EventRow | null) ?? null;
    },
  });
}

export function useEventMembers(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.eventMembers(eventId ?? 'none'),
    enabled: Boolean(eventId),
    queryFn: () => selectAll<EventMember>('event_members', (q) => q.eq('event_id', eventId!)),
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<EventRow>) => insertRow<EventRow>('events', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.events });
    },
  });
}

export function useUpdateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<EventRow> }) =>
      updateRow<EventRow>('events', input.id, input.patch),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: qk.events });
      void qc.invalidateQueries({ queryKey: qk.event(vars.id) });
    },
  });
}

export function useDeleteEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('events', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.events });
    },
  });
}

/**
 * Duplica un evento completo (plano + objetos + conexiones + horarios + tareas)
 * mediante una funcion de PostgreSQL, para que sea atomico.
 */
export function useDuplicateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name: string; startsAt: string }) => {
      const { data, error } = await supabase.rpc('duplicate_event', {
        p_event: input.id,
        p_name: input.name,
        p_starts_at: input.startsAt,
      });
      if (error) throw new ApiError(error);
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.events });
    },
  });
}

export function useSetEventMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; profileIds: string[] }) => {
      const current = await selectAll<EventMember>('event_members', (q) =>
        q.eq('event_id', input.eventId),
      );
      const wanted = new Set(input.profileIds);
      const existing = new Set(current.map((m) => m.profile_id));

      // Nunca dejamos el evento sin responsables: el owner permanece siempre.
      const owner = current.find((m) => m.role === 'owner');
      if (owner) wanted.add(owner.profile_id);

      const toRemove = current.filter((m) => !wanted.has(m.profile_id)).map((m) => m.profile_id);
      const toAdd = [...wanted].filter((id) => !existing.has(id));

      if (toRemove.length) {
        const { error } = await supabase
          .from('event_members')
          .delete()
          .eq('event_id', input.eventId)
          .in('profile_id', toRemove);
        if (error) throw new ApiError(error);
      }
      if (toAdd.length) {
        const { error } = await supabase.from('event_members').insert(
          toAdd.map((profile_id) => ({ event_id: input.eventId, profile_id, role: 'member' })),
        );
        if (error) throw new ApiError(error);
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.eventMembers(vars.eventId) });
    },
  });
}
