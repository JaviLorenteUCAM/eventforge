import { useMemo, useState } from 'react';
import { ChevronDown, Package, Plus, Shapes, Warehouse } from 'lucide-react';
import { Badge, Button, SearchInput, Segmented, Select } from '@/components/ui';
import { useCatalog, useCategories, useWarehouseItems } from '@/data/warehouse';
import { CatalogObjectModal } from '@/features/warehouse/CatalogObjectModal';
import type { CatalogObject, WarehouseItem } from '@/lib/types';
import { cn, fmtNum, normalize } from '@/lib/utils';

export type AddPayload =
  | { source: 'catalog'; catalog: CatalogObject; warehouseItem?: WarehouseItem }
  | { source: 'shape'; shape: BasicShape };

export type BasicShape = 'box' | 'square' | 'cylinder' | 'plane' | 'text' | 'line';

/**
 * Biblioteca de objetos del editor.
 *
 * ORIGEN de cada objeto que se añade al plano:
 *   · Objeto genérico  -> figura o entrada de la biblioteca.
 *   · Material del almacén -> además queda enlazado a una unidad concreta del
 *     inventario (warehouse_item_id), de modo que el listado de material sabe
 *     que ese objeto del plano es "PC Control 01" y no un PC cualquiera.
 */
export function ObjectLibrary({ onAdd }: { onAdd: (payload: AddPayload) => void }) {
  const catalog = useCatalog();
  const categories = useCategories();
  const items = useWarehouseItems();

  const [origin, setOrigin] = useState<'generic' | 'warehouse'>('generic');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );

  const grouped = useMemo(() => {
    const q = normalize(search);
    const list = (catalog.data ?? []).filter((o) => {
      if (category !== 'all' && o.category_id !== category) return false;
      return !q || normalize(o.name).includes(q);
    });

    const map = new Map<string, CatalogObject[]>();
    for (const o of list) {
      const key = categoryById.get(o.category_id ?? '')?.name ?? 'Otros';
      map.set(key, [...(map.get(key) ?? []), o]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [catalog.data, search, category, categoryById]);

  const warehouseList = useMemo(() => {
    const q = normalize(search);
    return (items.data ?? []).filter((i) => {
      if (category !== 'all' && i.category_id !== category) return false;
      return !q || normalize(`${i.name} ${i.internal_code ?? ''}`).includes(q);
    });
  }, [items.data, search, category]);

  const catalogById = useMemo(
    () => new Map((catalog.data ?? []).map((c) => [c.id, c])),
    [catalog.data],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b border-line p-3">
        <Segmented
          className="w-full"
          value={origin}
          onChange={setOrigin}
          size="sm"
          options={[
            { value: 'generic', label: 'Biblioteca', icon: <Shapes className="size-3.5" /> },
            { value: 'warehouse', label: 'Almacén', icon: <Warehouse className="size-3.5" /> },
          ]}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar objeto…" />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 text-[13px]">
          <option value="all">Todas las categorías</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {origin === 'generic' ? (
          <>
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">
              Figuras básicas
            </p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              <ShapeButton label="Rectángulo" onClick={() => onAdd({ source: 'shape', shape: 'box' })}>
                <span className="block h-5 w-7 rounded-[3px] border-2 border-current" />
              </ShapeButton>
              <ShapeButton label="Círculo" onClick={() => onAdd({ source: 'shape', shape: 'cylinder' })}>
                <span className="block size-6 rounded-full border-2 border-current" />
              </ShapeButton>
              <ShapeButton label="Superficie" onClick={() => onAdd({ source: 'shape', shape: 'plane' })}>
                <span className="block h-4 w-7 rounded-[3px] border-2 border-dashed border-current" />
              </ShapeButton>
              <ShapeButton label="Cuadrado" onClick={() => onAdd({ source: 'shape', shape: 'square' })}>
                <span className="block size-5 rounded-[3px] border-2 border-current" />
              </ShapeButton>
              <ShapeButton label="Línea" onClick={() => onAdd({ source: 'shape', shape: 'line' })}>
                <span className="block h-0.5 w-7 rounded bg-current" />
              </ShapeButton>
              <ShapeButton label="Texto" onClick={() => onAdd({ source: 'shape', shape: 'text' })}>
                <span className="text-[15px] font-bold leading-none">T</span>
              </ShapeButton>
            </div>

            {grouped.map(([name, list]) => (
              <div key={name} className="mb-3">
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}
                  className="mb-1.5 flex w-full items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim hover:text-muted"
                >
                  <span>
                    {name} <span className="num text-dim/70">({list.length})</span>
                  </span>
                  <ChevronDown
                    className={cn('size-3.5 transition-transform', collapsed[name] && '-rotate-90')}
                  />
                </button>

                {!collapsed[name] ? (
                  <div className="space-y-1">
                    {list.map((o) => (
                      <button
                        key={o.id}
                        onClick={() => onAdd({ source: 'catalog', catalog: o })}
                        className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-line hover:bg-surface-2"
                      >
                        <span
                          className="size-5 shrink-0 rounded border border-line"
                          style={{ background: o.color }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{o.name}</span>
                          <span className="num block text-[10.5px] text-dim">
                            {fmtNum(Number(o.length_m), 2)}×{fmtNum(Number(o.width_m), 2)}×
                            {fmtNum(Number(o.height_m), 2)} m
                          </span>
                        </span>
                        <Plus className="size-3.5 shrink-0 text-dim opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}

            {grouped.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-dim">Sin resultados.</p>
            ) : null}
          </>
        ) : (
          <div className="space-y-1">
            {warehouseList.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-dim">
                No hay material en el almacén que coincida.
              </p>
            ) : (
              warehouseList.map((item) => {
                const cat = item.catalog_id ? catalogById.get(item.catalog_id) : undefined;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      if (cat) onAdd({ source: 'catalog', catalog: cat, warehouseItem: item });
                      else
                        onAdd({
                          source: 'catalog',
                          warehouseItem: item,
                          catalog: {
                            id: '',
                            name: item.name,
                            category_id: item.category_id,
                            kind: 'generic',
                            length_m: Number(item.length_m) || 0.5,
                            width_m: Number(item.width_m) || 0.5,
                            height_m: Number(item.height_m) || 0.5,
                            weight_kg: Number(item.weight_kg),
                            color: '#94a3b8',
                            material: '',
                            notes: '',
                            shape: 'box',
                            requires_power: false,
                            requires_network: false,
                            power_w: 0,
                            outlet_count: 0,
                            port_count: 0,
                            is_system: false,
                            texture_path: null,
                            texture_mode: 'atlas',
                            texture_scale: 1,
                            texture_offset_x: 0,
                            texture_offset_y: 0,
                            texture_rotation: 0,
                            created_by: null,
                            created_at: '',
                            updated_at: '',
                          },
                        });
                    }}
                    className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-line hover:bg-surface-2"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded border border-line bg-surface text-dim">
                      <Package className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{item.name}</span>
                      <span className="block truncate text-[10.5px] text-dim">
                        {item.internal_code ? `${item.internal_code} · ` : ''}
                        {fmtNum(Number(item.quantity), 0)} {item.unit} disponibles
                      </span>
                    </span>
                    {cat ? <Badge color="#34d399">enlazado</Badge> : null}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="border-t border-line p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center"
          icon={<Plus className="size-3.5" />}
          onClick={() => setCreateOpen(true)}
        >
          Crear objeto personalizado
        </Button>
      </div>

      <CatalogObjectModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(created) => onAdd({ source: 'catalog', catalog: created })}
      />
    </div>
  );
}

function ShapeButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex flex-col items-center gap-1.5 rounded-xl border border-line bg-surface-2 py-2.5 text-dim transition-colors hover:border-line-strong hover:text-accent-soft"
    >
      {children}
      <span className="text-[10.5px]">{label}</span>
    </button>
  );
}
