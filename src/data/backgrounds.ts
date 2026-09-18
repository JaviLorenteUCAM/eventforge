import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlanBackground } from '@/lib/types';
import { deleteRow, insertRow, selectAll, updateRow } from './api';
import { qk } from './keys';
import { BUCKETS, removeFile } from '@/lib/storage';

/** Capas de imagen de un plano (foto aérea de referencia, texturas, etc.). */
export function usePlanBackgrounds(planId: string | undefined) {
  return useQuery({
    queryKey: qk.planBackgrounds(planId ?? 'none'),
    enabled: Boolean(planId),
    queryFn: () =>
      selectAll<PlanBackground>('plan_backgrounds', (q) =>
        q.eq('plan_id', planId!).order('z_index', { ascending: true }),
      ),
  });
}

export function useCreateBackground() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<PlanBackground> & { plan_id: string }) =>
      insertRow<PlanBackground>('plan_backgrounds', values),
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: qk.planBackgrounds(b.plan_id) });
    },
  });
}

export function useUpdateBackground() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; planId: string; patch: Partial<PlanBackground> }) =>
      updateRow<PlanBackground>('plan_backgrounds', input.id, input.patch),
    // Optimista: mover o cambiar la opacidad debe notarse al instante.
    onMutate: async (input) => {
      const key = qk.planBackgrounds(input.planId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PlanBackground[]>(key);
      qc.setQueryData<PlanBackground[]>(key, (old) =>
        (old ?? []).map((b) => (b.id === input.id ? { ...b, ...input.patch } : b)),
      );
      return { prev, key };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planBackgrounds(vars.planId) });
    },
  });
}

export function useDeleteBackground() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; planId: string; storagePath: string }) => {
      await deleteRow('plan_backgrounds', input.id);
      // La imagen deja de estar referenciada: la quitamos del almacenamiento.
      await removeFile(BUCKETS.planBackgrounds, input.storagePath);
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planBackgrounds(vars.planId) });
    },
  });
}
