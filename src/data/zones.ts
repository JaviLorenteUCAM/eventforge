import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlanZone } from '@/lib/types';
import { deleteRow, insertRow, selectAll, updateRow } from './api';
import { qk } from './keys';

/** Zonas marcadas en un plano («1 - Zona Fripozo»). */
export function usePlanZones(planId: string | undefined) {
  return useQuery({
    queryKey: qk.planZones(planId ?? 'none'),
    enabled: Boolean(planId),
    queryFn: () =>
      selectAll<PlanZone>('plan_zones', (q) =>
        q.eq('plan_id', planId!).order('number', { ascending: true }),
      ),
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<PlanZone> & { plan_id: string }) =>
      insertRow<PlanZone>('plan_zones', values),
    onSuccess: (z) => {
      void qc.invalidateQueries({ queryKey: qk.planZones(z.plan_id) });
    },
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; planId: string; patch: Partial<PlanZone> }) =>
      updateRow<PlanZone>('plan_zones', input.id, input.patch),
    // Optimista: arrastrar un pin o renombrar debe notarse al instante.
    onMutate: async (input) => {
      const key = qk.planZones(input.planId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PlanZone[]>(key);
      qc.setQueryData<PlanZone[]>(key, (old) =>
        (old ?? []).map((z) => (z.id === input.id ? { ...z, ...input.patch } : z)),
      );
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planZones(vars.planId) });
    },
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; planId: string }) => deleteRow('plan_zones', input.id),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planZones(vars.planId) });
    },
  });
}
