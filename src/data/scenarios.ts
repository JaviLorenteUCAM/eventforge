import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Scenario, ScenarioObject } from '@/lib/types';
import { ApiError, deleteRow, selectAll, updateRow } from './api';
import { qk } from './keys';

/**
 * Escenarios: plantillas de plano reutilizables entre eventos.
 * Guardar y cargar se hacen con funciones de PostgreSQL para que sean
 * atómicas (decenas de inserciones con remapeo de ids).
 */
export function useScenarios() {
  return useQuery({
    queryKey: qk.scenarios,
    queryFn: () => selectAll<Scenario>('scenarios', (q) => q.order('name', { ascending: true })),
    staleTime: 60_000,
  });
}

/** Objetos de un escenario, para la vista previa antes de cargarlo. */
export function useScenarioObjects(scenarioId: string | undefined) {
  return useQuery({
    queryKey: qk.scenarioPreview(scenarioId ?? 'none'),
    enabled: Boolean(scenarioId),
    queryFn: () =>
      selectAll<ScenarioObject>('scenario_objects', (q) => q.eq('scenario_id', scenarioId!)),
  });
}

export function useSaveScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      planId: string;
      name: string;
      description?: string;
      location?: string;
    }) => {
      const { data, error } = await supabase.rpc('save_plan_as_scenario', {
        p_plan: input.planId,
        p_name: input.name,
        p_description: input.description ?? '',
        p_location: input.location ?? '',
      });
      if (error) throw new ApiError(error);
      return data as string;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.scenarios });
    },
  });
}

export function useLoadScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { scenarioId: string; planId: string; replace: boolean }) => {
      const { data, error } = await supabase.rpc('load_scenario_into_plan', {
        p_scenario: input.scenarioId,
        p_plan: input.planId,
        p_replace: input.replace,
      });
      if (error) throw new ApiError(error);
      return data as number;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.planObjects(vars.planId) });
      void qc.invalidateQueries({ queryKey: qk.planConnections(vars.planId) });
      void qc.invalidateQueries({ queryKey: qk.planBackgrounds(vars.planId) });
      void qc.invalidateQueries({ queryKey: ['plans'] });
    },
  });
}

export function useUpdateScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<Scenario> }) =>
      updateRow<Scenario>('scenarios', input.id, input.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.scenarios });
    },
  });
}

export function useDeleteScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('scenarios', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.scenarios });
    },
  });
}
