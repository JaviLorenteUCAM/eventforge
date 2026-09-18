import type {
  CatalogObject,
  MaterialNeed,
  PlanConnection,
  PlanObject,
  StockInfo,
  WarehouseItem,
  WarehouseItemVariant,
} from './types';
import { normalize, round } from './utils';

/**
 * PLANO → MATERIAL → ALMACÉN
 *
 * Desde el modelo «almacén primero», cada objeto del plano apunta normalmente a
 * un artículo concreto del almacén (`warehouse_item_id`). El listado agrupa por
 * ese artículo y compara lo que hace falta con las existencias:
 *
 *     necesarias 5 · en almacén 4 · FALTA 1  →  hay que conseguir o alquilar 1
 *
 * Los objetos sin artículo de almacén (figuras sueltas o piezas creadas para el
 * evento en la biblioteca) se agrupan por nombre y no tienen existencias: se
 * listan aparte como material propio del evento.
 *
 * ESTILOS
 * -------
 * Un artículo puede tener estilos (mantel negro / mantel rojo, cada photocall
 * con su dibujo). El objeto del plano recuerda con cuál se colocó, de modo que:
 *
 *   · las existencias se cuentan también por estilo, y
 *   · los estilos marcados como «material aparte» añaden su propia línea al
 *     listado: tres mesas, dos con mantel negro y una con rojo, piden 3 mesas,
 *     2 manteles negros y 1 mantel rojo.
 */

/** Unidades de cada artículo del almacén ya comprometidas en el plano. */
export function computeStock(
  items: WarehouseItem[],
  planObjects: PlanObject[],
): Map<string, StockInfo> {
  const used = new Map<string, number>();
  for (const o of planObjects) {
    if (!o.warehouse_item_id) continue;
    used.set(o.warehouse_item_id, (used.get(o.warehouse_item_id) ?? 0) + 1);
  }

  const stock = new Map<string, StockInfo>();
  for (const item of items) {
    const total = Number(item.quantity) || 0;
    const u = used.get(item.id) ?? 0;
    stock.set(item.id, { total, used: u, available: total - u });
  }
  return stock;
}

/** Lo mismo, pero por estilo: «quedan 2 de las 6 mesas con mantel negro». */
export function computeVariantStock(
  variants: WarehouseItemVariant[],
  planObjects: PlanObject[],
): Map<string, StockInfo> {
  const used = new Map<string, number>();
  for (const o of planObjects) {
    if (!o.variant_id) continue;
    used.set(o.variant_id, (used.get(o.variant_id) ?? 0) + 1);
  }

  const stock = new Map<string, StockInfo>();
  for (const v of variants) {
    const total = Number(v.quantity) || 0;
    const u = used.get(v.id) ?? 0;
    stock.set(v.id, { total, used: u, available: total - u });
  }
  return stock;
}

export function computeMaterialNeeds(
  objects: PlanObject[],
  connections: PlanConnection[],
  catalog: CatalogObject[],
  items: WarehouseItem[],
  variants: WarehouseItemVariant[] = [],
): MaterialNeed[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  const byName = new Map<string, WarehouseItem[]>();
  for (const it of items) {
    const key = normalize(it.name);
    byName.set(key, [...(byName.get(key) ?? []), it]);
  }

  const needs = new Map<string, MaterialNeed>();

  const add = (
    key: string,
    base: Omit<MaterialNeed, 'needed' | 'available' | 'missing' | 'totalWeightKg' | 'totalVolumeM3'>,
    qty: number,
    volume: number,
  ) => {
    const existing = needs.get(key);
    if (existing) {
      existing.needed = round(existing.needed + qty, 2);
      existing.totalVolumeM3 = round(existing.totalVolumeM3 + volume, 4);
      return;
    }
    needs.set(key, {
      ...base,
      needed: round(qty, 2),
      available: 0,
      missing: 0,
      totalWeightKg: 0,
      totalVolumeM3: round(volume, 4),
    });
  };

  // --- Objetos del plano ---------------------------------------------------
  for (const o of objects) {
    const item = o.warehouse_item_id ? itemById.get(o.warehouse_item_id) : undefined;
    const cat = o.catalog_id ? catalogById.get(o.catalog_id) : undefined;
    const variant = o.variant_id ? variantById.get(o.variant_id) : undefined;

    const name = item?.name || cat?.name || o.label || 'Objeto sin nombre';
    const key = item
      ? `item:${item.id}`
      : cat
        ? `cat:${cat.id}`
        : `free:${normalize(name)}`;

    add(
      key,
      {
        key,
        name,
        catalogId: o.catalog_id,
        categoryId: item?.category_id ?? cat?.category_id ?? o.category_id,
        unit: item?.unit ?? 'ud',
        warehouseItemId: item?.id ?? null,
      },
      1,
      (Number(o.length_m) || 0) * (Number(o.width_m) || 0) * (Number(o.height_m) || 0),
    );

    // El estilo puede ser algo que haya que llevar aparte: el mantel de la
    // mesa es un bulto más, el dibujo del photocall no.
    if (variant?.adds_material) {
      const extraKey = `variant:${variant.id}`;
      add(
        extraKey,
        {
          key: extraKey,
          name: variant.material_name.trim() || variant.name,
          catalogId: null,
          categoryId: item?.category_id ?? null,
          unit: variant.material_unit ?? 'ud',
          warehouseItemId: null,
          variantId: variant.id,
        },
        1,
        0,
      );
    }
  }

  // --- Cables (metros lineales) -------------------------------------------
  for (const c of connections) {
    const label =
      c.cable_type?.trim() || (c.kind === 'power' ? 'Cable eléctrico' : 'Cable Ethernet Cat6');
    const key = `cable:${c.kind}:${normalize(label)}`;
    add(
      key,
      { key, name: label, catalogId: null, categoryId: null, unit: 'm', warehouseItemId: null },
      Number(c.length_m) || 0,
      0,
    );
  }

  // --- Cruce con el almacén ------------------------------------------------
  return [...needs.values()]
    .map((need) => {
      let available = 0;

      if (need.variantId) {
        // Las unidades de un estilo son suyas: seis manteles negros no cubren
        // la necesidad de uno rojo.
        available = Number(variantById.get(need.variantId)?.quantity ?? 0);
      } else if (need.warehouseItemId) {
        available = Number(itemById.get(need.warehouseItemId)?.quantity ?? 0);
      } else {
        // Los cables y los objetos sueltos se intentan casar por nombre.
        const matches = byName.get(normalize(need.name));
        if (matches) available = matches.reduce((s, i) => s + Number(i.quantity), 0);
      }

      return {
        ...need,
        available: round(available, 2),
        missing: round(Math.max(0, need.needed - available), 2),
      };
    })
    .sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, 'es'));
}

export interface MaterialSummary {
  lines: number;
  totalNeeded: number;
  totalMissing: number;
  /** Referencias en las que no llega el stock (lo que habría que alquilar). */
  shortLines: number;
  coverage: number;
  totalVolumeM3: number;
}

export function summarizeMaterial(needs: MaterialNeed[]): MaterialSummary {
  const totalNeeded = needs.reduce((s, n) => s + n.needed, 0);
  const totalMissing = needs.reduce((s, n) => s + n.missing, 0);
  return {
    lines: needs.length,
    totalNeeded: round(totalNeeded, 2),
    totalMissing: round(totalMissing, 2),
    shortLines: needs.filter((n) => n.missing > 0).length,
    coverage: totalNeeded > 0 ? round(((totalNeeded - totalMissing) / totalNeeded) * 100, 1) : 100,
    totalVolumeM3: round(
      needs.reduce((s, n) => s + n.totalVolumeM3, 0),
      3,
    ),
  };
}

/** Exporta el listado a CSV (separador ';' para Excel en español). */
export function materialToCsv(needs: MaterialNeed[], categoryName: (id: string | null) => string) {
  const header = ['Categoría', 'Material', 'Necesario', 'Unidad', 'En almacén', 'Faltan'];
  const rows = needs.map((n) => [
    categoryName(n.categoryId),
    n.name,
    String(n.needed).replace('.', ','),
    n.unit,
    String(n.available).replace('.', ','),
    String(n.missing).replace('.', ','),
  ]);
  return [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\r\n');
}
