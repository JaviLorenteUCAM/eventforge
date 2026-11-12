import type {
  CatalogObject,
  MaterialNeed,
  PlanConnection,
  PlanObject,
  StockInfo,
  StyleMaterial,
  WarehouseItem,
  WarehouseItemVariant,
} from './types';
import { CABLING_LABEL, type ConnectionKind } from './types';
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
 *
 * MATERIALES PARA ESTILOS
 * -----------------------
 * Un estilo puede enlazarse a un material para estilos del almacén (el mantel
 * UCAM). Entonces su línea es la de ESE material, y todos los estilos
 * enlazados a él —de la mesa plegable, del mostrador— suman en ella y restan
 * de sus mismas existencias.
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

/**
 * Lo mismo, pero por estilo: «quedan 2 de las 6 mesas con mantel negro».
 *
 * Un estilo enlazado a un material para estilos da las existencias de ese
 * material, descontando lo que ya llevan TODOS los estilos enlazados a él
 * (el mantel puesto en el mostrador también cuenta para las mesas).
 */
export function computeVariantStock(
  variants: WarehouseItemVariant[],
  planObjects: PlanObject[],
  styleMaterials: StyleMaterial[] = [],
): Map<string, StockInfo> {
  const materialById = new Map(styleMaterials.map((m) => [m.id, m]));
  const linkOf = new Map(
    variants
      .filter((v) => v.style_material_id && materialById.has(v.style_material_id))
      .map((v) => [v.id, v.style_material_id as string]),
  );

  const used = new Map<string, number>();
  const usedMaterial = new Map<string, number>();
  for (const o of planObjects) {
    if (!o.variant_id) continue;
    used.set(o.variant_id, (used.get(o.variant_id) ?? 0) + 1);
    const m = linkOf.get(o.variant_id);
    if (m) usedMaterial.set(m, (usedMaterial.get(m) ?? 0) + 1);
  }

  const stock = new Map<string, StockInfo>();
  for (const v of variants) {
    const m = linkOf.get(v.id);
    if (m) {
      const total = Number(materialById.get(m)?.quantity) || 0;
      const u = usedMaterial.get(m) ?? 0;
      stock.set(v.id, { total, used: u, available: total - u });
      continue;
    }
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
  styleMaterials: StyleMaterial[] = [],
): MaterialNeed[] {
  const itemById = new Map(items.map((i) => [i.id, i]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const variantById = new Map(variants.map((v) => [v.id, v]));
  const styleMaterialById = new Map(styleMaterials.map((m) => [m.id, m]));

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
    // Los puntos de luz y de red son la acometida de la sala, no material que
    // haya que llevar; y un texto del plano es un rótulo, no un objeto.
    if (o.kind === 'power_source' || o.kind === 'network_source' || o.shape === 'text') continue;

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
    const linked = variant?.style_material_id
      ? styleMaterialById.get(variant.style_material_id)
      : undefined;
    if (linked) {
      // Enlazado a un material para estilos: una sola línea para ese material,
      // venga del objeto que venga.
      const extraKey = `style:${linked.id}`;
      add(
        extraKey,
        {
          key: extraKey,
          name: linked.name,
          catalogId: null,
          categoryId: linked.category_id ?? item?.category_id ?? null,
          unit: linked.unit ?? 'ud',
          warehouseItemId: null,
          styleMaterialId: linked.id,
        },
        1,
        0,
      );
    } else if (variant?.adds_material) {
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

  // --- Cableado -----------------------------------------------------------
  // Una línea por tipo, sin metros ni cantidades: «Cableado eléctrico»,
  // «Cableado de red»… Basta con saber qué cableado hay que llevar.
  const kinds = new Set<ConnectionKind>(connections.map((c) => c.kind));
  for (const kind of (['power', 'network', 'signal', 'usb'] as const).filter((k) => kinds.has(k))) {
    const key = `cabling:${kind}`;
    needs.set(key, {
      key,
      name: CABLING_LABEL[kind],
      catalogId: null,
      categoryId: null,
      unit: 'ud',
      warehouseItemId: null,
      cabling: kind,
      needed: 0,
      available: 0,
      missing: 0,
      totalWeightKg: 0,
      totalVolumeM3: 0,
    });
  }

  // --- Cruce con el almacén ------------------------------------------------
  return [...needs.values()]
    .map((need) => {
      // El cableado no se cuenta: ni existencias ni faltas.
      if (need.cabling) return need;
      let available = 0;

      if (need.styleMaterialId) {
        // Las del material para estilos, compartidas por todos sus estilos.
        available = Number(styleMaterialById.get(need.styleMaterialId)?.quantity ?? 0);
      } else if (need.variantId) {
        // Las unidades de un estilo son suyas: seis manteles negros no cubren
        // la necesidad de uno rojo.
        available = Number(variantById.get(need.variantId)?.quantity ?? 0);
      } else if (need.warehouseItemId) {
        available = Number(itemById.get(need.warehouseItemId)?.quantity ?? 0);
      } else {
        // Los objetos sueltos se intentan casar por nombre.
        const matches = byName.get(normalize(need.name));
        if (matches) available = matches.reduce((s, i) => s + Number(i.quantity), 0);
      }

      return {
        ...need,
        available: round(available, 2),
        missing: round(Math.max(0, need.needed - available), 2),
      };
    })
    // El cableado, al final.
    .sort(
      (a, b) =>
        Number(Boolean(a.cabling)) - Number(Boolean(b.cabling)) ||
        b.missing - a.missing ||
        a.name.localeCompare(b.name, 'es'),
    );
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

export function summarizeMaterial(all: MaterialNeed[]): MaterialSummary {
  const needs = all.filter((n) => !n.cabling);
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
  const rows = needs.map((n) =>
    n.cabling
      ? ['Cableado', n.name, '', '', '', '']
      : [
          categoryName(n.categoryId),
          n.name,
          String(n.needed).replace('.', ','),
          n.unit,
          String(n.available).replace('.', ','),
          String(n.missing).replace('.', ','),
        ],
  );
  return [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(';')).join('\r\n');
}
