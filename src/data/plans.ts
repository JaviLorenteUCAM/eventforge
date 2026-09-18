import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Plan, PlanConnection, PlanObject, Snapshot } from '@/lib/types';
import { ApiError, deleteRow, insertRow, insertRows, selectAll, updateRow } from './api';
import { qk } from './keys';

export function usePlans(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.plans(eventId ?? 'none'),
    enabled: Boolean(eventId),
    queryFn: () =>
      selectAll<Plan>('plans', (q) =>
        q.eq('event_id', eventId!).order('created_at', { ascending: true }),
      ),
  });
}

export function usePlanObjects(planId: string | undefined) {
  return useQuery({
    queryKey: qk.planObjects(planId ?? 'none'),
    enabled: Boolean(planId),
    queryFn: () =>
      selectAll<PlanObject>('plan_objects', (q) =>
        q.eq('plan_id', planId!).order('created_at', { ascending: true }),
      ),
  });
}

export function usePlanConnections(planId: string | undefined) {
  return useQuery({
    queryKey: qk.planConnections(planId ?? 'none'),
    enabled: Boolean(planId),
    queryFn: () => selectAll<PlanConnection>('plan_connections', (q) => q.eq('plan_id', planId!)),
  });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Plan>) => insertRow<Plan>('plans', values),
    onSuccess: (plan) => {
      void qc.invalidateQueries({ queryKey: qk.plans(plan.event_id) });
    },
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<Plan> }) =>
      updateRow<Plan>('plans', input.id, input.patch),
    onSuccess: (plan) => {
      void qc.invalidateQueries({ queryKey: qk.plans(plan.event_id) });
    },
  });
}

// --- Objetos ---------------------------------------------------------------
export function useCreatePlanObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<PlanObject>) => insertRow<PlanObject>('plan_objects', values),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: qk.planObjects(o.plan_id) });
    },
  });
}

export function useCreatePlanObjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { planId: string; rows: Partial<PlanObject>[] }) =>
      insertRows<PlanObject>('plan_objects', input.rows),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planObjects(vars.planId) });
    },
  });
}

export function useUpdatePlanObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; planId: string; patch: Partial<PlanObject> }) =>
      updateRow<PlanObject>('plan_objects', input.id, input.patch),
    // Actualizacion optimista: el editor ya movio el objeto en pantalla.
    onMutate: async (input) => {
      const key = qk.planObjects(input.planId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PlanObject[]>(key);
      qc.setQueryData<PlanObject[]>(key, (old) =>
        (old ?? []).map((o) => (o.id === input.id ? { ...o, ...input.patch } : o)),
      );
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planObjects(vars.planId) });
    },
  });
}

/** Guarda varias posiciones a la vez (arrastre múltiple). */
export function useBulkUpdatePlanObjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      planId: string;
      updates: { id: string; patch: Partial<PlanObject> }[];
    }) => {
      for (const u of input.updates) {
        const { error } = await supabase.from('plan_objects').update(u.patch).eq('id', u.id);
        if (error) throw new ApiError(error);
      }
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planObjects(vars.planId) });
    },
  });
}

export function useDeletePlanObjects() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { planId: string; ids: string[] }) => {
      const { error } = await supabase.from('plan_objects').delete().in('id', input.ids);
      if (error) throw new ApiError(error);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planObjects(vars.planId) });
      void qc.invalidateQueries({ queryKey: qk.planConnections(vars.planId) });
    },
  });
}

// --- Conexiones ------------------------------------------------------------
export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<PlanConnection>) =>
      insertRow<PlanConnection>('plan_connections', values),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: qk.planConnections(c.plan_id) });
    },
  });
}

export function useUpdateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; planId: string; patch: Partial<PlanConnection> }) =>
      updateRow<PlanConnection>('plan_connections', input.id, input.patch),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planConnections(vars.planId) });
    },
  });
}

export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; planId: string }) => deleteRow('plan_connections', input.id),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planConnections(vars.planId) });
    },
  });
}

// --- Capturas --------------------------------------------------------------
export function useSnapshots(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.snapshots(eventId ?? 'none'),
    enabled: Boolean(eventId),
    queryFn: () =>
      selectAll<Snapshot>('snapshots', (q) =>
        q.eq('event_id', eventId!).order('created_at', { ascending: false }),
      ),
  });
}

export function useCreateSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Snapshot>) => insertRow<Snapshot>('snapshots', values),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: qk.snapshots(s.event_id) });
    },
  });
}

export function useDeleteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; eventId: string }) => deleteRow('snapshots', input.id),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.snapshots(vars.eventId) });
    },
  });
}
