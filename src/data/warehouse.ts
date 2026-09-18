import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CatalogObject,
  MaterialCategory,
  WarehouseBox,
  WarehouseBoxItem,
  WarehouseItem,
  WarehouseItemVariant,
} from '@/lib/types';
import { deleteRow, insertRow, selectAll, updateRow } from './api';
import { qk } from './keys';

// --- Categorias ------------------------------------------------------------
export function useCategories() {
  return useQuery({
    queryKey: qk.categories,
    queryFn: () =>
      selectAll<MaterialCategory>('material_categories', (q) =>
        q.order('sort_order', { ascending: true }),
      ),
    staleTime: 10 * 60 * 1000,
  });
}

export function useUpsertCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; values: Partial<MaterialCategory> }) =>
      input.id
        ? updateRow<MaterialCategory>('material_categories', input.id, input.values)
        : insertRow<MaterialCategory>('material_categories', input.values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.categories });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('material_categories', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.categories });
    },
  });
}

// --- Biblioteca de objetos -------------------------------------------------
export function useCatalog() {
  return useQuery({
    queryKey: qk.catalog,
    queryFn: () =>
      selectAll<CatalogObject>('object_catalog', (q) => q.order('name', { ascending: true })),
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCatalogObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<CatalogObject>) => insertRow<CatalogObject>('object_catalog', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
    },
  });
}

export function useUpdateCatalogObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<CatalogObject> }) =>
      updateRow<CatalogObject>('object_catalog', input.id, input.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
    },
  });
}

export function useDeleteCatalogObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('object_catalog', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.catalog });
    },
  });
}

// --- Inventario ------------------------------------------------------------
export function useWarehouseItems() {
  return useQuery({
    queryKey: qk.warehouseItems,
    queryFn: () =>
      selectAll<WarehouseItem>('warehouse_items', (q) => q.order('name', { ascending: true })),
  });
}

export function useCreateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<WarehouseItem>) => insertRow<WarehouseItem>('warehouse_items', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseItems });
    },
  });
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<WarehouseItem> }) =>
      updateRow<WarehouseItem>('warehouse_items', input.id, input.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseItems });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('warehouse_items', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseItems });
      void qc.invalidateQueries({ queryKey: qk.warehouseBoxItems });
    },
  });
}

// --- Estilos del material --------------------------------------------------
// Se cargan todos de una vez: son pocos y se necesitan a la vez en el almacén,
// en el panel del plano y en el listado de material.
export function useItemVariants() {
  return useQuery({
    queryKey: qk.itemVariants,
    queryFn: () =>
      selectAll<WarehouseItemVariant>('warehouse_item_variants', (q) =>
        q.order('sort_order', { ascending: true }).order('name', { ascending: true }),
      ),
  });
}

export function useUpsertVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; values: Partial<WarehouseItemVariant> }) =>
      input.id
        ? updateRow<WarehouseItemVariant>('warehouse_item_variants', input.id, input.values)
        : insertRow<WarehouseItemVariant>('warehouse_item_variants', input.values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.itemVariants });
    },
  });
}

export function useDeleteVariant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('warehouse_item_variants', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.itemVariants });
    },
  });
}

// --- Cajas -----------------------------------------------------------------
export function useBoxes() {
  return useQuery({
    queryKey: qk.warehouseBoxes,
    queryFn: () =>
      selectAll<WarehouseBox>('warehouse_boxes', (q) => q.order('code', { ascending: true })),
  });
}

export function useBoxItems() {
  return useQuery({
    queryKey: qk.warehouseBoxItems,
    queryFn: () => selectAll<WarehouseBoxItem>('warehouse_box_items'),
  });
}

export function useCreateBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<WarehouseBox>) => insertRow<WarehouseBox>('warehouse_boxes', values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseBoxes });
    },
  });
}

export function useUpdateBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<WarehouseBox> }) =>
      updateRow<WarehouseBox>('warehouse_boxes', input.id, input.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseBoxes });
    },
  });
}

export function useDeleteBox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('warehouse_boxes', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseBoxes });
      void qc.invalidateQueries({ queryKey: qk.warehouseBoxItems });
    },
  });
}

export function useSetBoxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; box_id: string; item_id: string; quantity: number }) =>
      input.id
        ? updateRow<WarehouseBoxItem>('warehouse_box_items', input.id, { quantity: input.quantity })
        : insertRow<WarehouseBoxItem>('warehouse_box_items', {
            box_id: input.box_id,
            item_id: input.item_id,
            quantity: input.quantity,
          }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseBoxItems });
    },
  });
}

export function useRemoveBoxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteRow('warehouse_box_items', id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.warehouseBoxItems });
    },
  });
}
