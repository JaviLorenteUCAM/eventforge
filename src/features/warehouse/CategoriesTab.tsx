import { useEffect, useState } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
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
} from '@/components/ui';
import {
  useCategories,
  useDeleteCategory,
  useUpsertCategory,
  useWarehouseItems,
} from '@/data/warehouse';
import type { MaterialCategory } from '@/lib/types';
import { slugify } from '@/lib/utils';

export function CategoriesTab() {
  const categories = useCategories();
  const items = useWarehouseItems();
  const remove = useDeleteCategory();

  const [editing, setEditing] = useState<MaterialCategory | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<MaterialCategory | null>(null);

  const countByCategory = new Map<string, number>();
  for (const i of items.data ?? []) {
    if (i.category_id) countByCategory.set(i.category_id, (countByCategory.get(i.category_id) ?? 0) + 1);
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast.success('Categoría eliminada');
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Nueva categoría
        </Button>
      </div>

      {categories.isLoading ? (
        <LoadingState />
      ) : (categories.data ?? []).length === 0 ? (
        <EmptyState title="Sin categorías" icon={<Tags className="size-5" />} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(categories.data ?? []).map((c) => (
            <Card key={c.id} className="group flex items-center gap-3 p-4">
              <span
                className="size-10 shrink-0 rounded-xl"
                style={{ background: `linear-gradient(135deg, ${c.color}, color-mix(in oklab, ${c.color} 45%, black))` }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-ink">{c.name}</p>
                <p className="text-[12px] text-dim">
                  {countByCategory.get(c.id) ?? 0} referencias · {c.color}
                </p>
              </div>
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => {
                    setEditing(c);
                    setOpen(true);
                  }}
                  aria-label="Editar"
                  className="rounded-md p-1.5 text-dim hover:bg-surface-2 hover:text-ink"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={() => setToDelete(c)}
                  aria-label="Eliminar"
                  className="rounded-md p-1.5 text-dim hover:bg-surface-2 hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CategoryModal
        open={open}
        category={editing}
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
        title="Eliminar categoría"
        message={
          <>
            El material que la use quedará «sin categoría». No se borra ningún material.
          </>
        }
      />
    </>
  );
}

function CategoryModal({
  open,
  category,
  onClose,
}: {
  open: boolean;
  category: MaterialCategory | null;
  onClose: () => void;
}) {
  const upsert = useUpsertCategory();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setColor(category?.color ?? '#6366f1');
    setError(null);
  }, [open, category]);

  async function submit() {
    if (!name.trim()) return setError('El nombre es obligatorio.');
    try {
      await upsert.mutateAsync({
        id: category?.id,
        values: { name: name.trim(), color, slug: slugify(name) },
      });
      toast.success(category ? 'Categoría actualizada' : 'Categoría creada');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={category ? 'Editar categoría' : 'Nueva categoría'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={upsert.isPending}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" required error={error}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Color de representación" hint="Se usa en el plano y en los listados.">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
      </div>
    </Modal>
  );
}
