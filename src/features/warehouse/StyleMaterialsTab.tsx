import { useEffect, useMemo, useState } from 'react';
import { Link2, Pencil, Plus, Shirt, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Button,
  Card,
  ColorPicker,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  NumberInput,
  Select,
  Textarea,
} from '@/components/ui';
import {
  useCategories,
  useDeleteStyleMaterial,
  useItemVariants,
  useStyleMaterials,
  useUpsertStyleMaterial,
  useWarehouseItems,
} from '@/data/warehouse';
import { fmtNum } from '@/lib/utils';
import type { StyleMaterial, Unit } from '@/lib/types';
import { UNITS } from './units';

/**
 * MATERIALES PARA ESTILOS
 *
 * Manteles, fundas, vinilos: lo que se le pone a un objeto y hay que cargar
 * aparte. Se dan de alta aquí con sus unidades, y los estilos de cualquier
 * material del almacén se enlazan a ellos (en el estilo, «Cuenta como material
 * aparte»). Así el mismo mantel puede ir en las mesas plegables y en el
 * mostrador, y el listado del evento lo pide una sola vez contra sus
 * existencias.
 */
export function StyleMaterialsTab() {
  const materials = useStyleMaterials();
  const variants = useItemVariants();
  const items = useWarehouseItems();
  const categories = useCategories();
  const remove = useDeleteStyleMaterial();

  const [editing, setEditing] = useState<StyleMaterial | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<StyleMaterial | null>(null);

  /** Qué estilos (de qué materiales) usa cada uno. */
  const usedBy = useMemo(() => {
    const itemName = new Map((items.data ?? []).map((i) => [i.id, i.name]));
    const map = new Map<string, string[]>();
    for (const v of variants.data ?? []) {
      if (!v.style_material_id) continue;
      const label = `${itemName.get(v.item_id) ?? 'Material'} · ${v.name}`;
      map.set(v.style_material_id, [...(map.get(v.style_material_id) ?? []), label]);
    }
    return map;
  }, [variants.data, items.data]);

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data],
  );

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast.success('Material eliminado');
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }

  const list = materials.data ?? [];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[640px] text-[12.5px] leading-relaxed text-muted">
          Manteles, fundas, vinilos… lo que llevan puesto los objetos con estilo. Dalo de alta aquí
          con sus unidades y enlázalo desde el estilo de cada objeto (mesa plegable, mostrador…):
          todos restan de las mismas existencias y el listado lo pide una sola vez.
        </p>
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Nuevo material para estilos
        </Button>
      </div>

      {materials.isLoading ? (
        <LoadingState />
      ) : list.length === 0 ? (
        <EmptyState
          title="Sin materiales para estilos"
          message="Crea, por ejemplo, «Mantel UCAM Esports» con sus 6 unidades y enlázalo desde los estilos de las mesas y del mostrador."
          icon={<Shirt className="size-5" />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((m) => {
            const uses = usedBy.get(m.id) ?? [];
            return (
              <Card key={m.id} className="group flex items-start gap-3 p-4">
                <span
                  className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-line"
                  style={{ background: m.color ?? 'var(--ef-surface-2)' }}
                >
                  {m.color ? null : <Shirt className="size-4 text-dim" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-ink">{m.name}</p>
                  <p className="num text-[12px] text-dim">
                    {fmtNum(Number(m.quantity), m.unit === 'm' ? 1 : 0)} {m.unit}
                    {m.category_id ? ` · ${categoryName.get(m.category_id) ?? ''}` : ''}
                  </p>
                  {uses.length ? (
                    <div className="mt-1.5 space-y-0.5">
                      {uses.map((u) => (
                        <p key={u} className="flex items-center gap-1 truncate text-[11.5px] text-muted">
                          <Link2 className="size-3 shrink-0 text-accent-soft" />
                          <span className="truncate">{u}</span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[11.5px] text-dim">
                      Sin estilos enlazados todavía.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => {
                      setEditing(m);
                      setOpen(true);
                    }}
                    aria-label="Editar"
                    className="rounded-md p-1.5 text-dim hover:bg-surface-2 hover:text-ink"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => setToDelete(m)}
                    aria-label="Eliminar"
                    className="rounded-md p-1.5 text-dim hover:bg-surface-2 hover:text-danger"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <StyleMaterialModal
        open={open}
        material={editing}
        onClose={() => {
          setOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void handleDelete()}
        loading={remove.isPending}
        title="Eliminar material para estilos"
        message={
          <>
            Se eliminará «{toDelete?.name}».
            {(usedBy.get(toDelete?.id ?? '') ?? []).length
              ? ' Los estilos enlazados no se borran: se quedan sin enlace y vuelven a contar sus propias unidades.'
              : ''}
          </>
        }
      />
    </>
  );
}

function StyleMaterialModal({
  open,
  material,
  onClose,
}: {
  open: boolean;
  material: StyleMaterial | null;
  onClose: () => void;
}) {
  const save = useUpsertStyleMaterial();
  const categories = useCategories();
  const [form, setForm] = useState({
    name: '',
    quantity: 1,
    unit: 'ud' as Unit,
    category_id: '',
    color: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: material?.name ?? '',
      quantity: Number(material?.quantity ?? 1),
      unit: material?.unit ?? 'ud',
      category_id: material?.category_id ?? '',
      color: material?.color ?? '',
      notes: material?.notes ?? '',
    });
    setError(null);
  }, [open, material]);

  async function submit() {
    if (!form.name.trim()) return setError('El nombre es obligatorio.');
    if (form.quantity < 0) return setError('Las unidades no pueden ser negativas.');
    try {
      await save.mutateAsync({
        id: material?.id,
        values: {
          name: form.name.trim(),
          quantity: form.quantity,
          unit: form.unit,
          category_id: form.category_id || null,
          color: form.color || null,
          notes: form.notes.trim(),
        },
      });
      toast.success(material ? 'Material actualizado' : 'Material creado');
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(
        /duplicate|unique/i.test(msg)
          ? 'Ya hay un material para estilos con ese nombre.'
          : msg || 'No se ha podido guardar',
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={material ? 'Editar material para estilos' : 'Nuevo material para estilos'}
      description="Lo que llevan puesto los objetos con estilo, con unidades compartidas entre todos los estilos enlazados."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={save.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required error={error} className="sm:col-span-2">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Mantel UCAM Esports"
            autoFocus
          />
        </Field>
        <Field label="Unidades en el almacén" required>
          <NumberInput
            value={form.quantity}
            onChange={(v) => setForm({ ...form, quantity: v })}
            step={1}
            min={0}
          />
        </Field>
        <Field label="Unidad">
          <Select
            value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}
          >
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Categoría" hint="Para agruparlo en el listado de material.">
          <Select
            value={form.category_id}
            onChange={(e) => setForm({ ...form, category_id: e.target.value })}
          >
            <option value="">La del objeto que lo lleva</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Color de muestra" hint="Opcional, para reconocerlo en las listas.">
          <div className="flex items-center gap-2">
            <ColorPicker
              value={form.color || '#64748b'}
              onChange={(c) => setForm({ ...form, color: c })}
            />
            {form.color ? (
              <button
                type="button"
                onClick={() => setForm({ ...form, color: '' })}
                className="shrink-0 text-[11.5px] text-accent-soft hover:underline"
              >
                quitar
              </button>
            ) : null}
          </div>
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            maxLength={1000}
            placeholder="Dónde se guarda, cómo se lava…"
          />
        </Field>
      </div>
    </Modal>
  );
}
