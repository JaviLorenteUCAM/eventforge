import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/data/api';
import { qk } from '@/data/keys';
import { supabase } from '@/lib/supabase';
import type { PlanConnection, PlanObject } from '@/lib/types';
import { uid } from '@/lib/utils';
import type { HistoryEntry } from './useHistory';

type NewObject = Partial<PlanObject> & { plan_id: string };

/** Columnas que se envian a la base de datos (se excluyen las generadas). */
function objectPayload(o: PlanObject) {
  const { created_at: _c, updated_at: _u, ...rest } = o;
  return rest;
}

function connectionPayload(c: PlanConnection) {
  const { created_at: _c, updated_at: _u, ...rest } = c;
  return rest;
}

/**
 * Operaciones del editor contra la base de datos.
 * Todas devuelven ademas la entrada de historial para deshacer/rehacer.
 */
export function usePlanOps(planId: string | undefined) {
  const qc = useQueryClient();

  const refresh = useCallback(() => {
    if (!planId) return;
    void qc.invalidateQueries({ queryKey: qk.planObjects(planId) });
    void qc.invalidateQueries({ queryKey: qk.planConnections(planId) });
  }, [qc, planId]);

  const insertObjects = useCallback(
    async (rows: Record<string, unknown>[]) => {
      const { error } = await supabase.from('plan_objects').insert(rows);
      if (error) throw new ApiError(error);
      refresh();
    },
    [refresh],
  );

  const removeObjects = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const { error } = await supabase.from('plan_objects').delete().in('id', ids);
      if (error) throw new ApiError(error);
      refresh();
    },
    [refresh],
  );

  const applyPatches = useCallback(
    async (updates: { id: string; patch: Partial<PlanObject> }[]) => {
      for (const u of updates) {
        const { error } = await supabase.from('plan_objects').update(u.patch).eq('id', u.id);
        if (error) throw new ApiError(error);
      }
      refresh();
    },
    [refresh],
  );

  /** Añade uno o varios objetos. Los ids se generan aquí para poder rehacer. */
  const addObjects = useCallback(
    async (values: NewObject[]): Promise<{ ids: string[]; history: HistoryEntry }> => {
      const rows = values.map((v) => ({ ...v, id: v.id ?? uid() }));
      await insertObjects(rows as Record<string, unknown>[]);
      const ids = rows.map((r) => r.id as string);

      return {
        ids,
        history: {
          label: rows.length > 1 ? `Añadir ${rows.length} objetos` : 'Añadir objeto',
          undo: () => removeObjects(ids),
          redo: () => insertObjects(rows as Record<string, unknown>[]),
        },
      };
    },
    [insertObjects, removeObjects],
  );

  /** Elimina objetos guardando las filas completas para poder restaurarlas. */
  const deleteObjects = useCallback(
    async (
      objects: PlanObject[],
      connections: PlanConnection[],
    ): Promise<HistoryEntry> => {
      const ids = objects.map((o) => o.id);
      const affectedCables = connections.filter(
        (c) => ids.includes(c.from_object_id) || ids.includes(c.to_object_id),
      );

      await removeObjects(ids); // las conexiones caen por ON DELETE CASCADE

      const restore = async () => {
        await insertObjects(objects.map(objectPayload) as Record<string, unknown>[]);
        if (affectedCables.length) {
          const { error } = await supabase
            .from('plan_connections')
            .insert(affectedCables.map(connectionPayload));
          if (error) throw new ApiError(error);
        }
        refresh();
      };

      return {
        label: objects.length > 1 ? `Eliminar ${objects.length} objetos` : 'Eliminar objeto',
        undo: restore,
        redo: () => removeObjects(ids),
      };
    },
    [insertObjects, removeObjects, refresh],
  );

  /** Modifica objetos (mover, rotar, redimensionar, editar propiedades). */
  const updateObjects = useCallback(
    async (
      updates: { id: string; patch: Partial<PlanObject>; previous: Partial<PlanObject> }[],
      label = 'Modificar objeto',
    ): Promise<HistoryEntry> => {
      await applyPatches(updates.map((u) => ({ id: u.id, patch: u.patch })));
      return {
        label,
        undo: () => applyPatches(updates.map((u) => ({ id: u.id, patch: u.previous }))),
        redo: () => applyPatches(updates.map((u) => ({ id: u.id, patch: u.patch }))),
      };
    },
    [applyPatches],
  );

  const addConnection = useCallback(
    async (values: Partial<PlanConnection> & { plan_id: string }): Promise<HistoryEntry> => {
      const row = { ...values, id: values.id ?? uid() };
      const { error } = await supabase.from('plan_connections').insert(row);
      if (error) throw new ApiError(error);
      refresh();

      const remove = async () => {
        const { error: delError } = await supabase
          .from('plan_connections')
          .delete()
          .eq('id', row.id);
        if (delError) throw new ApiError(delError);
        refresh();
      };
      const insert = async () => {
        const { error: insError } = await supabase.from('plan_connections').insert(row);
        if (insError) throw new ApiError(insError);
        refresh();
      };

      return { label: 'Añadir cable', undo: remove, redo: insert };
    },
    [refresh],
  );

  const deleteConnection = useCallback(
    async (connection: PlanConnection): Promise<HistoryEntry> => {
      const row = connectionPayload(connection);
      const remove = async () => {
        const { error } = await supabase.from('plan_connections').delete().eq('id', connection.id);
        if (error) throw new ApiError(error);
        refresh();
      };
      const insert = async () => {
        const { error } = await supabase.from('plan_connections').insert(row);
        if (error) throw new ApiError(error);
        refresh();
      };

      await remove();
      return { label: 'Eliminar cable', undo: insert, redo: remove };
    },
    [refresh],
  );

  const updateConnection = useCallback(
    async (
      connection: PlanConnection,
      patch: Partial<PlanConnection>,
    ): Promise<HistoryEntry> => {
      const previous: Partial<PlanConnection> = {};
      for (const key of Object.keys(patch) as (keyof PlanConnection)[]) {
        (previous as Record<string, unknown>)[key] = connection[key];
      }

      const apply = async (values: Partial<PlanConnection>) => {
        const { error } = await supabase
          .from('plan_connections')
          .update(values)
          .eq('id', connection.id);
        if (error) throw new ApiError(error);
        refresh();
      };

      await apply(patch);
      return { label: 'Modificar cable', undo: () => apply(previous), redo: () => apply(patch) };
    },
    [refresh],
  );

  return {
    addObjects,
    deleteObjects,
    updateObjects,
    addConnection,
    deleteConnection,
    updateConnection,
    refresh,
  };
}
