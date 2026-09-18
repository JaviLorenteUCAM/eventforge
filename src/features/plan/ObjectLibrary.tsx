import { useMemo, useState } from 'react';
import { ChevronDown, Package, Plus, Shapes, Warehouse } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Modal, SearchInput, Segmented, Select } from '@/components/ui';
import { useCatalog, useCategories, useWarehouseItems } from '@/data/warehouse';
import { CatalogObjectModal } from '@/features/warehouse/CatalogObjectModal';
import { ItemFormModal } from '@/features/warehouse/ItemsTab';
import { computeStock } from '@/lib/materials';
import type { CatalogObject, PlanObject, WarehouseItem } from '@/lib/types';
import { cn, fmtNum, normalize } from '@/lib/utils';

export type AddPayload =
  | { source: 'warehouse'; item: WarehouseItem }
  | { source: 'catalog'; catalog: CatalogObject }
  | { source: 'shape'; shape: BasicShape };

export type BasicShape = 'box' | 'square' | 'cylinder' | 'plane' | 'text' | 'line';

/**
 * PANEL DE OBJETOS DEL EDITOR
 *
 * Dos orígenes, y solo dos:
 *
 *   · ALMACÉN — el material real del que se dispone. Cada ficha dice cuántas
 *     unidades quedan libres frente al total («1/4 uds»), contando las que ya
 *     están puestas en ESTE plano. Se puede colocar aunque no queden: entonces
 *     avisa, y el listado de material lo recoge como algo que hay que
 *     conseguir o alquilar.
 *
 *   · DEL EVENTO — lo puntual: figuras sueltas para marcar zonas y objetos
 *     creados a medida para este montaje. Empieza vacío a propósito.
 */
export function ObjectLibrary({
  onAdd,
  planObjects,
}: {
  onAdd: (payload: AddPayload) => void;
  planObjects: PlanObject[];
}) {
  const catalog = useCatalog();
  const categories = useCategories();
  const items = useWarehouseItems();

  const [origin, setOrigin] = useState<'warehouse' | 'event'>('warehouse');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [createChoice, setCreateChoice] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newCatalogOpen, setNewCatalogOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );

  const stock = useMemo(
    () => computeStock(items.data ?? [], planObjects),
    [items.data, planObjects],
  );

  const warehouseGroups = useMemo(() => {
    const q = normalize(search);
    const list = (items.data ?? []).filter((i) => {
      if (category !== 'all' && i.category_id !== category) return false;
      return !q || normalize(`${i.name} ${i.internal_code ?? ''}`).includes(q);
    });
    const map = new Map<string, WarehouseItem[]>();
    for (const i of list) {
      const key = categoryById.get(i.category_id ?? '')?.name ?? 'Sin categoría';
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [items.data, search, category, categoryById]);

  const eventObjects = useMemo(() => {
    const q = normalize(search);
    return (catalog.data ?? []).filter((o) => {
      if (category !== 'all' && o.category_id !== category) return false;
      return !q || normalize(o.name).includes(q);
    });
  }, [catalog.data, search, category]);

  function addFromWarehouse(item: WarehouseItem) {
    const info = stock.get(item.id);
    if (info && info.available <= 0) {
      toast.warning(
        `No quedan unidades de «${item.name}» (${fmtNum(info.total, 0)} en almacén, ${fmtNum(info.used, 0)} ya en el plano). Se coloca igualmente y aparecerá en «falta material».`,
        { duration: 6000 },
      );
    }
    onAdd({ source: 'warehouse', item });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2.5 border-b border-line p-3">
        <Segmented
          className="w-full"
          value={origin}
          onChange={setOrigin}
          size="sm"
          options={[
            { value: 'warehouse', label: 'Almacén', icon: <Warehouse className="size-3.5" /> },
            { value: 'event', label: 'Del evento', icon: <Shapes className="size-3.5" /> },
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
        {origin === 'warehouse' ? (
          warehouseGroups.length === 0 ? (
            <p className="py-6 text-center text-[12.5px] leading-relaxed text-dim">
              {items.data?.length
                ? 'Nada coincide con la búsqueda.'
                : 'El almacén está vacío. Da de alta tu material para poder colocarlo en los planos.'}
            </p>
          ) : (
            warehouseGroups.map(([name, list]) => (
              <Group
                key={name}
                name={name}
                count={list.length}
                collapsed={Boolean(collapsed[name])}
                onToggle={() => setCollapsed((c) => ({ ...c, [name]: !c[name] }))}
              >
                {list.map((item) => {
                  const info = stock.get(item.id);
                  const available = info?.available ?? Number(item.quantity);
                  const total = info?.total ?? Number(item.quantity);
                  const out = available <= 0;
                  return (
                    <button
                      key={item.id}
                      onClick={() => addFromWarehouse(item)}
                      title={
                        out
                          ? 'No quedan unidades libres: se colocará igualmente y saldrá en «falta material»'
                          : `Colocar ${item.name}`
                      }
                      className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-line hover:bg-surface-2"
                    >
                      <span
                        className="grid size-7 shrink-0 place-items-center rounded border border-line"
                        style={{ background: `${item.color}22`, color: item.color }}
                      >
                        <Package className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">{item.name}</span>
                        <span className="num block truncate text-[10.5px] text-dim">
                          {fmtNum(Number(item.length_m), 2)}×{fmtNum(Number(item.width_m), 2)}×
                          {fmtNum(Number(item.height_m), 2)} m
                        </span>
                      </span>
                      <span
                        className={cn(
                          'num shrink-0 rounded-md border px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums',
                          out
                            ? 'border-[color-mix(in_oklab,var(--ef-danger)_45%,transparent)] bg-[color-mix(in_oklab,var(--ef-danger)_12%,transparent)] text-danger'
                            : 'border-line bg-surface-2 text-muted',
                        )}
                      >
                        {fmtNum(available, 0)}/{fmtNum(total, 0)} {item.unit}
                      </span>
                    </button>
                  );
                })}
              </Group>
            ))
          )
        ) : (
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

            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">
              Objetos propios
            </p>
            {eventObjects.length === 0 ? (
              <p className="py-4 text-center text-[12px] leading-relaxed text-dim">
                Sin objetos propios. Aquí van las piezas hechas a medida para un montaje concreto;
                el material del que tienes existencias va en el Almacén.
              </p>
            ) : (
              <div className="space-y-1">
                {eventObjects.map((o) => (
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
            )}
          </>
        )}
      </div>

      <div className="border-t border-line p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center"
          icon={<Plus className="size-3.5" />}
          onClick={() => setCreateChoice(true)}
        >
          Crear objeto
        </Button>
      </div>

      {/* Dónde guardarlo: es la diferencia entre tener existencias o no. */}
      <Modal
        open={createChoice}
        onClose={() => setCreateChoice(false)}
        size="sm"
        title="¿Dónde guardas este objeto?"
        description="De esto depende si el objeto lleva unidades y se cruza con el listado de material."
      >
        <div className="space-y-2.5">
          <ChoiceCard
            icon={<Warehouse className="size-4" />}
            title="En el almacén, con unidades"
            text="Material del que dispones y vas a reutilizar. Dirás cuántas unidades tienes y EventForge avisará cuando un plano pida más de las que hay."
            onClick={() => {
              setCreateChoice(false);
              setNewItemOpen(true);
            }}
          />
          <ChoiceCard
            icon={<Shapes className="size-4" />}
            title="Solo para este evento"
            text="Algo puntual: una alfombra a medida, un cartel, una estructura prestada. No lleva existencias."
            onClick={() => {
              setCreateChoice(false);
              setNewCatalogOpen(true);
            }}
          />
        </div>
      </Modal>

      <ItemFormModal
        open={newItemOpen}
        item={null}
        onClose={() => setNewItemOpen(false)}
        onSaved={(item) => onAdd({ source: 'warehouse', item })}
      />

      <CatalogObjectModal
        open={newCatalogOpen}
        onClose={() => setNewCatalogOpen(false)}
        onCreated={(created) => onAdd({ source: 'catalog', catalog: created })}
      />
    </div>
  );
}

function Group({
  name,
  count,
  collapsed,
  onToggle,
  children,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <button
        onClick={onToggle}
        className="mb-1.5 flex w-full items-center justify-between gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim hover:text-muted"
      >
        <span>
          {name} <span className="num text-dim/70">({count})</span>
        </span>
        <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
      </button>
      {!collapsed ? <div className="space-y-1">{children}</div> : null}
    </div>
  );
}

function ChoiceCard({
  icon,
  title,
  text,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full gap-3 rounded-xl border border-line bg-surface-2 p-3.5 text-left transition-colors hover:border-accent-soft hover:bg-surface"
    >
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line text-accent-soft">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">{text}</span>
      </span>
    </button>
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
