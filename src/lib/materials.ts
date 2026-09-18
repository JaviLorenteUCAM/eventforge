import type {
  CatalogObject,
  MaterialNeed,
  PlanConnection,
  PlanObject,
  WarehouseItem,
} from './types';
import { normalize, round } from './utils';

/**
 * PLANO -> MATERIAL -> ALMACEN
 *
 * Genera el listado de material necesario a partir de los objetos del plano y
 * de los cables dibujados, y lo compara con las existencias del almacen.
 *
 * Emparejamiento con el almacen, por orden de prioridad:
 *   1. El objeto del plano apunta a una unidad concreta (warehouse_item_id).
 *   2. El articulo del almacen deriva del mismo objeto de biblioteca (catalog_id).
 *   3. Coincidencia por nombre normalizado (sin acentos ni mayusculas).
 */
export function computeMaterialNeeds(
  objects: PlanObject[],
  connections: PlanConnection[],
  catalog: CatalogObject[],
  items: WarehouseItem[],
): MaterialNeed[] {
  const catalogById = new Map(catalog.map((c) => [c.id, c]));

  const byCatalog = new Map<string, WarehouseItem[]>();
  const byName = new Map<string, WarehouseItem[]>();
  for (const it of items) {
    if (it.catalog_id) {
      const list = byCatalog.get(it.catalog_id) ?? [];
      list.push(it);
      byCatalog.set(it.catalog_id, list);
    }
    const key = normalize(it.name);
    const list = byName.get(key) ?? [];
    list.push(it);
    byName.set(key, list);
  }

  const needs = new Map<string, MaterialNeed>();

  const add = (
    key: string,
    base: Omit<MaterialNeed, 'needed' | 'available' | 'missing' | 'totalWeightKg' | 'totalVolumeM3'>,
    qty: number,
    weight: number,
    volume: number,
  ) => {
    const existing = needs.get(key);
    if (existing) {
      existing.needed = round(existing.needed + qty, 2);
      existing.totalWeightKg = round(existing.totalWeightKg + weight, 2);
      existing.totalVolumeM3 = round(existing.totalVolumeM3 + volume, 4);
      return;
    }
    needs.set(key, {
      ...base,
      needed: round(qty, 2),
      available: 0,
      missing: 0,
      totalWeightKg: round(weight, 2),
      totalVolumeM3: round(volume, 4),
    });
  };

  // --- Objetos del plano ---------------------------------------------------
  for (const o of objects) {
    const cat = o.catalog_id ? catalogById.get(o.catalog_id) : undefined;
    const name = cat?.name || o.label || 'Objeto sin nombre';
    const key = o.catalog_id ? `cat:${o.catalog_id}` : `free:${normalize(name)}`;

    add(
      key,
      {
        key,
        name,
        catalogId: o.catalog_id,
        categoryId: cat?.category_id ?? o.category_id,
        unit: 'ud',
        warehouseItemId: o.warehouse_item_id,
      },
      1,
      Number(o.weight_kg) || 0,
      (Number(o.length_m) || 0) * (Number(o.width_m) || 0) * (Number(o.height_m) || 0),
    );
  }

  // --- Cables (metros lineales) -------------------------------------------
  for (const c of connections) {
    const label =
      c.cable_type?.trim() ||
      (c.kind === 'power' ? 'Cable eléctrico' : 'Cable Ethernet Cat6');
    const key = `cable:${c.kind}:${normalize(label)}`;
    add(
      key,
      {
        key,
        name: label,
        catalogId: null,
        categoryId: null,
        unit: 'm',
        warehouseItemId: null,
      },
      Number(c.length_m) || 0,
      0,
      0,
    );
  }

  // --- Cruce con el almacen ------------------------------------------------
  const result = [...needs.values()].map((need) => {
    let available = 0;

    if (need.warehouseItemId) {
      const it = items.find((i) => i.id === need.warehouseItemId);
      available = it ? Number(it.quantity) : 0;
    } else if (need.catalogId && byCatalog.has(need.catalogId)) {
      available = byCatalog.get(need.catalogId)!.reduce((s, i) => s + Number(i.quantity), 0);
    } else {
      const matches = byName.get(normalize(need.name));
      if (matches) available = matches.reduce((s, i) => s + Number(i.quantity), 0);
    }

    return {
      ...need,
      available: round(available, 2),
      missing: round(Math.max(0, need.needed - available), 2),
    };
  });

  return result.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, 'es'));
}

export interface MaterialSummary {
  lines: number;
  totalNeeded: number;
  totalMissing: number;
  coverage: number;
  totalWeightKg: number;
  totalVolumeM3: number;
}

export function summarizeMaterial(needs: MaterialNeed[]): MaterialSummary {
  const totalNeeded = needs.reduce((s, n) => s + n.needed, 0);
  const totalMissing = needs.reduce((s, n) => s + n.missing, 0);
  return {
    lines: needs.length,
    totalNeeded: round(totalNeeded, 2),
    totalMissing: round(totalMissing, 2),
    coverage: totalNeeded > 0 ? round(((totalNeeded - totalMissing) / totalNeeded) * 100, 1) : 100,
    totalWeightKg: round(
      needs.reduce((s, n) => s + n.totalWeightKg, 0),
      2,
    ),
    totalVolumeM3: round(
      needs.reduce((s, n) => s + n.totalVolumeM3, 0),
      3,
    ),
  };
}

/** Exporta el listado a CSV (separador ';' para Excel en español). */
export function materialToCsv(needs: MaterialNeed[], categoryName: (id: string | null) => string) {
  const header = ['Categoría', 'Material', 'Necesario', 'Unidad', 'En almacén', 'Faltan', 'Peso (kg)'];
  const rows = needs.map((n) => [
    categoryName(n.categoryId),
    n.name,
    String(n.needed).replace('.', ','),
    n.unit,
    String(n.available).replace('.', ','),
    String(n.missing).replace('.', ','),
    String(n.totalWeightKg).replace('.', ','),
  ]);
  return [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\r\n');
}
