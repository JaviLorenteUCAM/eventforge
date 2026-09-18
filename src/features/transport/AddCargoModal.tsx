import { useMemo, useState } from 'react';
import { Box, Layers, Package, Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  NumberInput,
  SearchInput,
  Segmented,
} from '@/components/ui';
import type { MaterialNeed, TransportItem, WarehouseBox, WarehouseItem } from '@/lib/types';
import { fmtKg, fmtM3, fmtNum, normalize, volumeOf } from '@/lib/utils';

export type CargoDraft = Partial<TransportItem>;

/**
 * Añadir bultos a una carga.
 *
 *   · Material del evento -> generado desde el plano (lo que hace falta llevar).
 *   · Cajas del almacén   -> la caja entera es la unidad de transporte.
 *   · Material suelto     -> cualquier referencia del inventario.
 *   · Bulto libre         -> medidas a mano (flightcase, estructura…).
 */
export function AddCargoModal({
  open,
  onClose,
  onAdd,
  needs,
  boxes,
  items,
  boxWeights,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (drafts: CargoDraft[]) => void;
  needs: MaterialNeed[];
  boxes: WarehouseBox[];
  items: WarehouseItem[];
  boxWeights: Map<string, number>;
}) {
  const [tab, setTab] = useState<'event' | 'boxes' | 'items' | 'custom'>('event');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Record<string, number>>({});

  const [custom, setCustom] = useState({
    label: 'Bulto',
    length_m: 0.6,
    width_m: 0.4,
    height_m: 0.4,
    weight_kg: 10,
    quantity: 1,
  });

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const eventRows = useMemo(() => {
    const q = normalize(search);
    return needs
      .filter((n) => n.unit === 'ud')
      .filter((n) => !q || normalize(n.name).includes(q))
      .map((n) => {
        const item = n.warehouseItemId
          ? itemById.get(n.warehouseItemId)
          : items.find((i) => i.catalog_id && i.catalog_id === n.catalogId);
        return { need: n, item };
      });
  }, [needs, search, items, itemById]);

  const boxRows = useMemo(() => {
    const q = normalize(search);
    return boxes.filter((b) => !q || normalize(`${b.code} ${b.name}`).includes(q));
  }, [boxes, search]);

  const itemRows = useMemo(() => {
    const q = normalize(search);
    return items.filter((i) => !q || normalize(i.name).includes(q));
  }, [items, search]);

  function toggle(key: string, qty: number) {
    setPicked((p) => {
      const next = { ...p };
      if (next[key]) delete next[key];
      else next[key] = qty;
      return next;
    });
  }

  function submit() {
    const drafts: CargoDraft[] = [];

    if (tab === 'custom') {
      for (let i = 0; i < custom.quantity; i++) {
        drafts.push({
          source_kind: 'custom',
          label: custom.quantity > 1 ? `${custom.label} ${i + 1}` : custom.label,
          quantity: 1,
          length_m: custom.length_m,
          width_m: custom.width_m,
          height_m: custom.height_m,
          weight_kg: custom.weight_kg,
          color: '#38bdf8',
        });
      }
    }

    for (const [key, qty] of Object.entries(picked)) {
      const [kind, id] = key.split(':');

      if (kind === 'box') {
        const box = boxes.find((b) => b.id === id);
        if (!box) continue;
        for (let i = 0; i < qty; i++) {
          drafts.push({
            source_kind: 'box',
            box_id: box.id,
            label: box.code,
            quantity: 1,
            length_m: Number(box.length_m),
            width_m: Number(box.width_m),
            height_m: Number(box.height_m),
            weight_kg: boxWeights.get(box.id) ?? Number(box.empty_weight_kg),
            color: box.color,
          });
        }
        continue;
      }

      const item = itemById.get(id);
      if (!item) continue;
      const l = Number(item.length_m) || 0.4;
      const w = Number(item.width_m) || 0.3;
      const h = Number(item.height_m) || 0.3;
      for (let i = 0; i < qty; i++) {
        drafts.push({
          source_kind: 'item',
          item_id: item.id,
          label: qty > 1 ? `${item.name} ${i + 1}` : item.name,
          quantity: 1,
          length_m: l,
          width_m: w,
          height_m: h,
          weight_kg: Number(item.weight_kg),
          color: '#38bdf8',
        });
      }
    }

    onAdd(drafts);
    setPicked({});
    onClose();
  }

  const total = Object.values(picked).reduce((s, n) => s + n, 0) + (tab === 'custom' ? custom.quantity : 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Añadir bultos a la carga"
      description="Cada bulto se guarda con sus dimensiones y peso reales."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} disabled={total === 0} icon={<Plus className="size-4" />}>
            Añadir {total > 0 ? `(${total})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Segmented
          value={tab}
          onChange={setTab}
          size="sm"
          className="w-full"
          options={[
            { value: 'event', label: 'Del evento', icon: <Layers className="size-3.5" /> },
            { value: 'boxes', label: 'Cajas', icon: <Box className="size-3.5" /> },
            { value: 'items', label: 'Material', icon: <Package className="size-3.5" /> },
            { value: 'custom', label: 'Libre' },
          ]}
        />

        {tab !== 'custom' ? <SearchInput value={search} onChange={setSearch} /> : null}

        {tab === 'event' ? (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {eventRows.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted">
                El plano del evento todavía no genera material transportable.
              </p>
            ) : (
              eventRows.map(({ need, item }) => {
                const key = `item:${item?.id ?? need.key}`;
                const disabled = !item;
                return (
                  <label
                    key={need.key}
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                      disabled ? 'border-line opacity-50' : 'cursor-pointer border-line hover:bg-surface-2'
                    }`}
                  >
                    <Checkbox
                      label=""
                      disabled={disabled}
                      checked={Boolean(picked[key])}
                      onChange={() => toggle(key, Math.max(1, Math.round(need.needed)))}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{need.name}</p>
                      <p className="num text-[11.5px] text-dim">
                        Necesarias {fmtNum(need.needed, 0)} · en almacén {fmtNum(need.available, 0)}
                        {item ? ` · ${fmtKg(Number(item.weight_kg))}/ud` : ' · sin ficha en almacén'}
                      </p>
                    </div>
                    {need.missing > 0 ? <Badge color="#f59e0b">faltan {fmtNum(need.missing, 0)}</Badge> : null}
                    {picked[key] ? (
                      <NumberInput
                        className="w-20"
                        value={picked[key]}
                        step={1}
                        min={1}
                        onChange={(v) => setPicked((p) => ({ ...p, [key]: Math.max(1, Math.round(v)) }))}
                      />
                    ) : null}
                  </label>
                );
              })
            )}
          </div>
        ) : null}

        {tab === 'boxes' ? (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {boxRows.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted">No hay cajas en el almacén.</p>
            ) : (
              boxRows.map((b) => {
                const key = `box:${b.id}`;
                return (
                  <label
                    key={b.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-surface-2"
                  >
                    <Checkbox label="" checked={Boolean(picked[key])} onChange={() => toggle(key, 1)} />
                    <span className="size-4 shrink-0 rounded" style={{ background: b.color }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[13px] text-ink">{b.code}</p>
                      <p className="num text-[11.5px] text-dim">
                        {fmtNum(Number(b.length_m) * 100, 0)}×{fmtNum(Number(b.width_m) * 100, 0)}×
                        {fmtNum(Number(b.height_m) * 100, 0)} cm ·{' '}
                        {fmtKg(boxWeights.get(b.id) ?? Number(b.empty_weight_kg))}
                      </p>
                    </div>
                    {picked[key] ? (
                      <NumberInput
                        className="w-20"
                        value={picked[key]}
                        step={1}
                        min={1}
                        onChange={(v) => setPicked((p) => ({ ...p, [key]: Math.max(1, Math.round(v)) }))}
                      />
                    ) : null}
                  </label>
                );
              })
            )}
          </div>
        ) : null}

        {tab === 'items' ? (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {itemRows.map((i) => {
              const key = `item:${i.id}`;
              return (
                <label
                  key={i.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-surface-2"
                >
                  <Checkbox label="" checked={Boolean(picked[key])} onChange={() => toggle(key, 1)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">{i.name}</p>
                    <p className="num text-[11.5px] text-dim">
                      {fmtM3(volumeOf(Number(i.length_m), Number(i.width_m), Number(i.height_m)))} ·{' '}
                      {fmtKg(Number(i.weight_kg))} · {fmtNum(Number(i.quantity), 0)} {i.unit}
                    </p>
                  </div>
                  {picked[key] ? (
                    <NumberInput
                      className="w-20"
                      value={picked[key]}
                      step={1}
                      min={1}
                      onChange={(v) => setPicked((p) => ({ ...p, [key]: Math.max(1, Math.round(v)) }))}
                    />
                  ) : null}
                </label>
              );
            })}
          </div>
        ) : null}

        {tab === 'custom' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" className="sm:col-span-2">
              <Input value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} />
            </Field>
            <Field label="Largo">
              <NumberInput value={custom.length_m} onChange={(v) => setCustom({ ...custom, length_m: v })} unit="m" />
            </Field>
            <Field label="Ancho">
              <NumberInput value={custom.width_m} onChange={(v) => setCustom({ ...custom, width_m: v })} unit="m" />
            </Field>
            <Field label="Alto">
              <NumberInput value={custom.height_m} onChange={(v) => setCustom({ ...custom, height_m: v })} unit="m" />
            </Field>
            <Field label="Peso">
              <NumberInput value={custom.weight_kg} onChange={(v) => setCustom({ ...custom, weight_kg: v })} unit="kg" />
            </Field>
            <Field label="Cantidad">
              <NumberInput
                value={custom.quantity}
                onChange={(v) => setCustom({ ...custom, quantity: Math.max(1, Math.round(v)) })}
                step={1}
                min={1}
              />
            </Field>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
