import { useEffect, useMemo, useState } from 'react';
import { Box, Boxes, Copy, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  NumberInput,
  SearchInput,
  Select,
  Textarea,
  ColorPicker,
  Meter,
} from '@/components/ui';
import {
  useBoxItems,
  useBoxes,
  useCreateBox,
  useDeleteBox,
  useRemoveBoxItem,
  useSetBoxItem,
  useUpdateBox,
  useWarehouseItems,
} from '@/data/warehouse';
import type { WarehouseBox } from '@/lib/types';
import { fmtKg, fmtM3, fmtNum, normalize, volumeOf } from '@/lib/utils';

export function BoxesTab() {
  const boxes = useBoxes();
  const boxItems = useBoxItems();
  const items = useWarehouseItems();
  const deleteBox = useDeleteBox();
  const createBox = useCreateBox();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<WarehouseBox | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [contentOf, setContentOf] = useState<WarehouseBox | null>(null);
  const [toDelete, setToDelete] = useState<WarehouseBox | null>(null);

  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);

  const contentByBox = useMemo(() => {
    const map = new Map<string, { id: string; itemId: string; quantity: number }[]>();
    for (const bi of boxItems.data ?? []) {
      map.set(bi.box_id, [
        ...(map.get(bi.box_id) ?? []),
        { id: bi.id, itemId: bi.item_id, quantity: Number(bi.quantity) },
      ]);
    }
    return map;
  }, [boxItems.data]);

  const filtered = useMemo(() => {
    const q = normalize(search);
    return (boxes.data ?? []).filter(
      (b) => !q || normalize(`${b.code} ${b.name} ${b.location}`).includes(q),
    );
  }, [boxes.data, search]);

  function boxStats(box: WarehouseBox) {
    const content = contentByBox.get(box.id) ?? [];
    let volume = 0;
    let weight = Number(box.empty_weight_kg);
    for (const c of content) {
      const it = itemById.get(c.itemId);
      if (!it) continue;
      volume += volumeOf(Number(it.length_m), Number(it.width_m), Number(it.height_m)) * c.quantity;
      weight += Number(it.weight_kg) * c.quantity;
    }
    const capacity = volumeOf(Number(box.length_m), Number(box.width_m), Number(box.height_m));
    return { content, volume, weight, capacity, fillPct: capacity ? (volume / capacity) * 100 : 0 };
  }

  /**
   * Duplica la caja (medidas, color, ubicación) pero NO su contenido: lo
   * normal es querer «otra caja igual», no otra copia del material.
   */
  async function handleDuplicate(box: WarehouseBox) {
    const { id, created_at, updated_at, code, name, ...rest } = box;
    void id;
    void created_at;
    void updated_at;
    const taken = new Set((boxes.data ?? []).map((b) => b.code));
    let newCode = `${code}-COPIA`;
    let n = 2;
    while (taken.has(newCode)) newCode = `${code}-COPIA${n++}`;
    try {
      await createBox.mutateAsync({ ...rest, code: newCode, name });
      toast.success('Caja duplicada (vacía). Ajusta su código y su contenido.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido duplicar');
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await deleteBox.mutateAsync(toDelete.id);
      toast.success('Caja eliminada');
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar caja por código o nombre…"
          className="min-w-[220px] flex-1"
        />
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nueva caja
        </Button>
      </div>

      {boxes.isLoading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={boxes.data?.length ? 'Ninguna caja coincide' : 'Todavía no hay cajas'}
          message="Las cajas agrupan material para saber dónde está guardado cada cosa."
          icon={<Boxes className="size-5" />}
          action={
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Nueva caja
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((box) => {
            const s = boxStats(box);
            return (
              <Card key={box.id} className="group p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div
                      className="grid size-9 shrink-0 place-items-center rounded-xl"
                      style={{ background: `color-mix(in oklab, ${box.color} 22%, transparent)`, color: box.color }}
                    >
                      <Box className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-[13px] font-semibold text-ink">{box.code}</p>
                      <p className="truncate text-[12px] text-muted">{box.name || 'Sin nombre'}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditing(box);
                        setFormOpen(true);
                      }}
                      aria-label="Editar caja"
                      className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-ink"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void handleDuplicate(box)}
                      aria-label="Duplicar caja"
                      title="Duplicar la caja sin su contenido"
                      className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-ink"
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setToDelete(box)}
                      aria-label="Eliminar caja"
                      className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                <p className="num mt-3 text-[12px] text-dim">
                  {fmtNum(Number(box.length_m) * 100, 0)} × {fmtNum(Number(box.width_m) * 100, 0)} ×{' '}
                  {fmtNum(Number(box.height_m) * 100, 0)} cm · {fmtKg(s.weight)}
                </p>

                <div className="mt-2.5">
                  <div className="mb-1 flex items-center justify-between text-[11.5px] text-dim">
                    <span>Ocupación</span>
                    <span className="num">
                      {fmtM3(s.volume)} / {fmtM3(s.capacity)}
                    </span>
                  </div>
                  <Meter value={s.fillPct} height={5} color={box.color} />
                </div>

                <div className="mt-3 space-y-1">
                  {s.content.slice(0, 3).map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                      <span className="min-w-0 truncate text-muted">
                        {itemById.get(c.itemId)?.name ?? 'Material eliminado'}
                      </span>
                      <span className="num shrink-0 text-ink">×{fmtNum(c.quantity, 0)}</span>
                    </div>
                  ))}
                  {s.content.length > 3 ? (
                    <p className="text-[11.5px] text-dim">+{s.content.length - 3} más</p>
                  ) : null}
                  {s.content.length === 0 ? <p className="text-[12px] text-dim">Caja vacía</p> : null}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full justify-center"
                  onClick={() => setContentOf(box)}
                >
                  Gestionar contenido
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <BoxFormModal
        open={formOpen}
        box={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <BoxContentModal box={contentOf} onClose={() => setContentOf(null)} />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void handleDelete()}
        loading={deleteBox.isPending}
        title="Eliminar caja"
        message={<>Se eliminará la caja «{toDelete?.code}» y su lista de contenido.</>}
      />
    </>
  );
}

function BoxFormModal({
  open,
  box,
  onClose,
}: {
  open: boolean;
  box: WarehouseBox | null;
  onClose: () => void;
}) {
  const create = useCreateBox();
  const update = useUpdateBox();

  const [form, setForm] = useState({
    code: '',
    name: '',
    length_m: 0.6,
    width_m: 0.4,
    height_m: 0.4,
    empty_weight_kg: 2,
    location: '',
    color: '#f59e0b',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      code: box?.code ?? '',
      name: box?.name ?? '',
      length_m: Number(box?.length_m ?? 0.6),
      width_m: Number(box?.width_m ?? 0.4),
      height_m: Number(box?.height_m ?? 0.4),
      empty_weight_kg: Number(box?.empty_weight_kg ?? 2),
      location: box?.location ?? '',
      color: box?.color ?? '#f59e0b',
      notes: box?.notes ?? '',
    });
    setError(null);
  }, [open, box]);

  async function submit() {
    if (!form.code.trim()) return setError('El código es obligatorio.');
    if (form.length_m <= 0 || form.width_m <= 0 || form.height_m <= 0) {
      return setError('Las dimensiones deben ser mayores que cero.');
    }
    try {
      const values = { ...form, code: form.code.trim().toUpperCase() };
      if (box) await update.mutateAsync({ id: box.id, patch: values });
      else await create.mutateAsync(values);
      toast.success(box ? 'Caja actualizada' : 'Caja creada');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={box ? 'Editar caja' : 'Nueva caja'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={create.isPending || update.isPending}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Código" required error={error}>
          <Input
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            placeholder="CABLES-01"
            autoFocus
          />
        </Field>
        <Field label="Nombre">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Cables y adaptadores"
          />
        </Field>
        <Field label="Largo">
          <NumberInput value={form.length_m} onChange={(v) => setForm({ ...form, length_m: v })} unit="m" />
        </Field>
        <Field label="Ancho">
          <NumberInput value={form.width_m} onChange={(v) => setForm({ ...form, width_m: v })} unit="m" />
        </Field>
        <Field label="Alto">
          <NumberInput value={form.height_m} onChange={(v) => setForm({ ...form, height_m: v })} unit="m" />
        </Field>
        <Field label="Peso en vacío">
          <NumberInput
            value={form.empty_weight_kg}
            onChange={(v) => setForm({ ...form, empty_weight_kg: v })}
            unit="kg"
          />
        </Field>
        <Field label="Ubicación">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="Color">
          <ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

function BoxContentModal({ box, onClose }: { box: WarehouseBox | null; onClose: () => void }) {
  const items = useWarehouseItems();
  const boxItems = useBoxItems();
  const setBoxItem = useSetBoxItem();
  const removeBoxItem = useRemoveBoxItem();

  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState(1);

  const content = (boxItems.data ?? []).filter((bi) => bi.box_id === box?.id);
  const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));

  async function add() {
    if (!box || !itemId) return;
    try {
      const existing = content.find((c) => c.item_id === itemId);
      await setBoxItem.mutateAsync({
        id: existing?.id,
        box_id: box.id,
        item_id: itemId,
        quantity: existing ? Number(existing.quantity) + qty : qty,
      });
      setItemId('');
      setQty(1);
      toast.success('Contenido actualizado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido añadir');
    }
  }

  return (
    <Modal
      open={Boolean(box)}
      onClose={onClose}
      title={`Contenido de ${box?.code ?? ''}`}
      description="La relación caja ↔ material se guarda en la base de datos."
      footer={
        <Button variant="primary" onClick={onClose}>
          Listo
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Material" className="min-w-[200px] flex-1">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Selecciona material…</option>
              {(items.data ?? []).map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Cantidad" className="w-28">
            <NumberInput value={qty} onChange={setQty} step={1} min={1} />
          </Field>
          <Button
            variant="primary"
            onClick={() => void add()}
            disabled={!itemId}
            loading={setBoxItem.isPending}
            icon={<Plus className="size-4" />}
          >
            Añadir
          </Button>
        </div>

        <div className="divide-y divide-[var(--ef-line)] rounded-xl border border-line">
          {content.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">La caja está vacía.</p>
          ) : (
            content.map((c) => {
              const it = itemById.get(c.item_id);
              return (
                <div key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] text-ink">{it?.name ?? 'Material eliminado'}</p>
                    {it ? (
                      <p className="num text-[11.5px] text-dim">
                        {fmtKg(Number(it.weight_kg) * Number(c.quantity))} ·{' '}
                        {fmtM3(
                          volumeOf(Number(it.length_m), Number(it.width_m), Number(it.height_m)) *
                            Number(c.quantity),
                        )}
                      </p>
                    ) : null}
                  </div>
                  <NumberInput
                    className="w-24"
                    value={Number(c.quantity)}
                    step={1}
                    min={1}
                    onChange={(v) =>
                      setBoxItem.mutate({
                        id: c.id,
                        box_id: c.box_id,
                        item_id: c.item_id,
                        quantity: Math.max(1, v),
                      })
                    }
                  />
                  <button
                    onClick={() => removeBoxItem.mutate(c.id)}
                    aria-label="Quitar de la caja"
                    className="rounded-md p-1.5 text-dim hover:text-danger"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Modal>
  );
}
