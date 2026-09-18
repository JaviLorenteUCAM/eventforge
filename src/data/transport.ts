import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { TransportItem, TransportLoad, TransportVehicle } from '@/lib/types';
import { ApiError, deleteRow, insertRow, insertRows, selectAll, updateRow } from './api';
import { qk } from './keys';

export function useVehicles() {
  return useQuery({
    queryKey: qk.vehicles,
    queryFn: () =>
      selectAll<TransportVehicle>('transport_vehicles', (q) => q.order('length_m', { ascending: true })),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<TransportVehicle>) =>
      insertRow<TransportVehicle>('transport_vehicles', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.vehicles });
    },
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('transport_vehicles', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.vehicles });
    },
  });
}

export function useLoads(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.loads(eventId ?? 'none'),
    enabled: Boolean(eventId),
    queryFn: () =>
      selectAll<TransportLoad>('transport_loads', (q) =>
        q.eq('event_id', eventId!).order('created_at', { ascending: true }),
      ),
  });
}

export function useLoadItems(loadId: string | undefined) {
  return useQuery({
    queryKey: qk.loadItems(loadId ?? 'none'),
    enabled: Boolean(loadId),
    queryFn: () => selectAll<TransportItem>('transport_items', (q) => q.eq('load_id', loadId!)),
  });
}

export function useCreateLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<TransportLoad>) => insertRow<TransportLoad>('transport_loads', values),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: qk.loads(l.event_id) });
    },
  });
}

export function useUpdateLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; eventId: string; patch: Partial<TransportLoad> }) =>
      updateRow<TransportLoad>('transport_loads', input.id, input.patch),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.loads(vars.eventId) });
    },
  });
}

export function useDeleteLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; eventId: string }) => deleteRow('transport_loads', input.id),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.loads(vars.eventId) });
    },
  });
}

export function useAddLoadItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { loadId: string; rows: Partial<TransportItem>[] }) =>
      insertRows<TransportItem>('transport_items', input.rows),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.loadItems(vars.loadId) });
    },
  });
}

export function useUpdateLoadItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; loadId: string; patch: Partial<TransportItem> }) =>
      updateRow<TransportItem>('transport_items', input.id, input.patch),
    onMutate: async (input) => {
      const key = qk.loadItems(input.loadId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<TransportItem[]>(key);
      qc.setQueryData<TransportItem[]>(key, (old) =>
        (old ?? []).map((i) => (i.id === input.id ? { ...i, ...input.patch } : i)),
      );
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: qk.loadItems(vars.loadId) });
    },
  });
}

export function useDeleteLoadItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { loadId: string; ids: string[] }) => {
      const { error } = await supabase.from('transport_items').delete().in('id', input.ids);
      if (error) throw new ApiError(error);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.loadItems(vars.loadId) });
    },
  });
}
