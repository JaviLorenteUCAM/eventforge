import { useEffect, useState } from 'react';
import { Palette, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Checkbox,
  ColorPicker,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  NumberInput,
  Select,
} from '@/components/ui';
import { useDeleteVariant, useItemVariants, useUpsertVariant } from '@/data/warehouse';
import { BUCKETS, resolveUrl } from '@/lib/storage';
import { fmtNum } from '@/lib/utils';
import type { TextureMode, Unit, WarehouseItem, WarehouseItemVariant } from '@/lib/types';
import { TextureSection, type TextureFields } from './TextureSection';

const UNITS: { value: Unit; label: string }[] = [
  { value: 'ud', label: 'unidades' },
  { value: 'm', label: 'metros' },
  { value: 'kg', label: 'kilos' },
  { value: 'l', label: 'litros' },
  { value: 'pack', label: 'packs' },
];

/**
 * ESTILOS DE UN MATERIAL
 *
 * Mismo objeto, distinto acabado. Dos casos que parecen iguales y no lo son:
 *
 *   · Cinco photocalls, cada uno con su dibujo. Son cinco photocalls: el
 *     estilo solo dice CUÁL es el que se ha puesto en el plano.
 *   · Siete mesas, seis con mantel negro y una con mantel rojo. Aquí el estilo
 *     SÍ añade material: además de la mesa hay que cargar el mantel.
 *
 * Esa diferencia es la casilla «cuenta como material aparte».
 */
export function VariantsSection({ item }: { item: WarehouseItem | null }) {
  const variants = useItemVariants();
  const remove = useDeleteVariant();

  const [editing, setEditing] = useState<WarehouseItemVariant | null>(null);
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<WarehouseItemVariant | null>(null);

  const list = (variants.data ?? []).filter((v) => v.item_id === item?.id);

  if (!item) {
    return (
      <div className="rounded-xl border border-line bg-surface-2 p-3.5">
        <p className="mb-1 text-[12px] font-medium uppercase tracking-[0.1em] text-dim">Estilos</p>
        <p className="text-[11.5px] leading-relaxed text-dim">
          Guarda primero el material y vuelve a abrirlo para darle estilos (dibujos distintos,
          manteles, fundas…). Cada estilo lleva sus propias unidades.
        </p>
      </div>
    );
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast.success('Estilo eliminado');
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-dim">Estilos</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">
            Mismo objeto, distinto acabado. Al colocarlo en el plano se elige cuál.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          icon={<Plus className="size-3.5" />}
          onClick={() => setCreating(true)}
        >
          Añadir estilo
        </Button>
      </div>

      {list.length === 0 ? (
        <p className="py-2 text-[12px] leading-relaxed text-dim">
          Sin estilos. Añade uno si tienes varias versiones de este material: cinco photocalls con
          cinco dibujos, mesas con mantel negro y con mantel rojo…
        </p>
      ) : (
        <div className="space-y-1.5">
          {list.map((v) => (
            <VariantRow
              key={v.id}
              variant={v}
              item={item}
              onEdit={() => setEditing(v)}
              onDelete={() => setToDelete(v)}
            />
          ))}
        </div>
      )}

      <VariantModal
        open={creating || Boolean(editing)}
        item={item}
        variant={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void handleDelete()}
        loading={remove.isPending}
        title="Eliminar estilo"
        message={
          <>
            Se eliminará «{toDelete?.name}». Los objetos que ya estén colocados en un plano con ese
            estilo se quedan, pero vuelven al acabado base del material.
          </>
        }
      />
    </div>
  );
}

function VariantRow({
  variant,
  item,
  onEdit,
  onDelete,
}: {
  variant: WarehouseItemVariant;
  item: WarehouseItem;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void resolveUrl(BUCKETS.textures, variant.texture_path).then((u) => {
      if (alive) setThumb(u);
    });
    return () => {
      alive = false;
    };
  }, [variant.texture_path]);

  return (
    <div className="group flex items-center gap-2.5 rounded-lg border border-line bg-surface px-2.5 py-2">
      <span
        className="size-8 shrink-0 overflow-hidden rounded border border-line"
        style={{ background: variant.color || item.color }}
      >
        {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : null}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink">{variant.name}</p>
        <p className="num truncate text-[11px] text-dim">
          {fmtNum(Number(variant.quantity), 0)} {item.unit}
          {variant.adds_material
            ? ` · suma «${variant.material_name.trim() || variant.name}» al material`
            : ''}
        </p>
      </div>

      {variant.adds_material ? <Badge color="#34d399">material aparte</Badge> : null}

      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Editar estilo"
          title="Editar"
          className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-ink"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Eliminar estilo"
          title="Eliminar"
          className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-danger"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

const EMPTY = {
  name: '',
  quantity: 1,
  color: '',
  adds_material: false,
  material_name: '',
  material_unit: 'ud' as Unit,
  texture_mode: 'atlas' as TextureMode,
  texture_scale: 1,
  texture_offset_x: 0,
  texture_offset_y: 0,
  texture_rotation: 0,
  notes: '',
};

function VariantModal({
  open,
  item,
  variant,
  onClose,
}: {
  open: boolean;
  item: WarehouseItem;
  variant: WarehouseItemVariant | null;
  onClose: () => void;
}) {
  const save = useUpsertVariant();
  const [form, setForm] = useState(EMPTY);
  const [texturePath, setTexturePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      variant
        ? {
            name: variant.name,
            quantity: Number(variant.quantity),
            color: variant.color ?? '',
            adds_material: variant.adds_material,
            material_name: variant.material_name,
            material_unit: variant.material_unit,
            texture_mode: variant.texture_mode,
            texture_scale: Number(variant.texture_scale),
            texture_offset_x: Number(variant.texture_offset_x),
            texture_offset_y: Number(variant.texture_offset_y),
            texture_rotation: Number(variant.texture_rotation),
            notes: variant.notes,
          }
        : EMPTY,
    );
    setTexturePath(variant?.texture_path ?? null);
    setError(null);
  }, [open, variant]);

  async function submit() {
    if (!form.name.trim()) return setError('El estilo necesita un nombre.');
    if (form.quantity < 0) return setError('Las unidades no pueden ser negativas.');

    try {
      await save.mutateAsync({
        id: variant?.id,
        values: {
          item_id: item.id,
          ...form,
          name: form.name.trim(),
          color: form.color || null,
          material_name: form.material_name.trim(),
          texture_path: texturePath,
        },
      });
      toast.success(variant ? 'Estilo actualizado' : 'Estilo añadido');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={variant ? 'Editar estilo' : `Nuevo estilo de ${item.name}`}
      description="Un acabado concreto de este material, con sus propias unidades y su propia imagen."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => void submit()}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre del estilo" required error={error} className="sm:col-span-2">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Mantel rojo · Photocall Feria 2026"
            autoFocus
          />
        </Field>

        <Field
          label="Unidades de este estilo"
          required
          hint={`De «${item.name}» hay ${fmtNum(Number(item.quantity), 0)} ${item.unit} en total.`}
        >
          <NumberInput
            value={form.quantity}
            onChange={(v) => setForm({ ...form, quantity: v })}
            step={1}
            min={0}
          />
        </Field>

        <Field label="Color en el plano" hint="Vacío = el mismo color que el material.">
          <div className="flex items-center gap-2">
            <ColorPicker
              value={form.color || item.color}
              onChange={(c) => setForm({ ...form, color: c })}
            />
            {form.color ? (
              <button
                type="button"
                onClick={() => setForm({ ...form, color: '' })}
                className="shrink-0 text-[11.5px] text-accent-soft hover:underline"
              >
                heredar
              </button>
            ) : null}
          </div>
        </Field>

        <div className="rounded-xl border border-line bg-surface-2 p-3.5 sm:col-span-2">
          <Checkbox
            label="Cuenta como material aparte"
            checked={form.adds_material}
            onChange={(e) => setForm({ ...form, adds_material: e.target.checked })}
          />
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-dim">
            Márcalo cuando el estilo sea algo que además hay que cargar: el mantel de la mesa, la
            funda de la silla. Si solo cambia el dibujo —cada photocall con el suyo— déjalo sin
            marcar: no es un bulto más.
          </p>

          {form.adds_material ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Cómo se llama en el listado" hint="Vacío = el nombre del estilo.">
                <Input
                  value={form.material_name}
                  onChange={(e) => setForm({ ...form, material_name: e.target.value })}
                  placeholder={form.name || 'Mantel rojo'}
                />
              </Field>
              <Field label="Unidad">
                <Select
                  value={form.material_unit}
                  onChange={(e) => setForm({ ...form, material_unit: e.target.value as Unit })}
                >
                  {UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
        </div>

        <div className="sm:col-span-2">
          <TextureSection
            name={form.name || item.name}
            shape={item.shape}
            lengthM={Number(item.length_m)}
            widthM={Number(item.width_m)}
            heightM={Number(item.height_m)}
            path={texturePath}
            mode={form.texture_mode}
            scale={form.texture_scale}
            offsetX={form.texture_offset_x}
            offsetY={form.texture_offset_y}
            rotation={form.texture_rotation}
            folder="estilos"
            onPathChange={setTexturePath}
            onFieldChange={(patch: Partial<TextureFields>) => setForm((f) => ({ ...f, ...patch }))}
          />
        </div>

        <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-[11.5px] leading-relaxed text-muted sm:col-span-2">
          <Palette className="mt-0.5 size-3.5 shrink-0 text-accent-soft" />
          Sin imagen propia, el estilo usa la textura del material y solo cambia el color y las
          unidades.
        </p>
      </div>
    </Modal>
  );
}
