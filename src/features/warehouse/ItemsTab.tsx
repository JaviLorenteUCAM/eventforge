import { useEffect, useMemo, useState } from 'react';
import { MapPin, Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  ImageUpload,
  Input,
  LoadingState,
  Modal,
  NumberInput,
  SearchInput,
  Select,
  Textarea,
} from '@/components/ui';
import {
  useCatalog,
  useCategories,
  useCreateItem,
  useDeleteItem,
  useUpdateItem,
  useWarehouseItems,
} from '@/data/warehouse';
import { BUCKETS, resolveUrl } from '@/lib/storage';
import type { Unit, WarehouseItem } from '@/lib/types';
import { fmtKg, fmtNum, normalize, volumeOf } from '@/lib/utils';

const UNITS: { value: Unit; label: string }[] = [
  { value: 'ud', label: 'unidades' },
  { value: 'm', label: 'metros' },
  { value: 'kg', label: 'kilos' },
  { value: 'l', label: 'litros' },
  { value: 'pack', label: 'packs' },
];

type SortKey = 'name' | 'quantity' | 'category';

export function ItemsTab() {
  const items = useWarehouseItems();
  const categories = useCategories();
  const deleteItem = useDeleteItem();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [sort, setSort] = useState<SortKey>('name');
  const [editing, setEditing] = useState<WarehouseItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<WarehouseItem | null>(null);

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    const list = (items.data ?? []).filter((i) => {
      if (category !== 'all' && i.category_id !== category) return false;
      if (!q) return true;
      return normalize(`${i.name} ${i.internal_code ?? ''} ${i.location} ${i.description}`).includes(q);
    });
    return [...list].sort((a, b) => {
      if (sort === 'quantity') return Number(b.quantity) - Number(a.quantity);
      if (sort === 'category') {
        return (categoryById.get(a.category_id ?? '')?.name ?? '').localeCompare(
          categoryById.get(b.category_id ?? '')?.name ?? '',
          'es',
        );
      }
      return a.name.localeCompare(b.name, 'es');
    });
  }, [items.data, search, category, sort, categoryById]);

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await deleteItem.mutateAsync(toDelete.id);
      toast.success('Material eliminado');
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
          placeholder="Buscar material, código o ubicación…"
          className="min-w-[220px] flex-1"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto min-w-[150px]">
          <option value="all">Todas las categorías</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="w-auto">
          <option value="name">Nombre</option>
          <option value="quantity">Cantidad</option>
          <option value="category">Categoría</option>
        </Select>
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          Nuevo material
        </Button>
      </div>

      {items.isLoading ? (
        <LoadingState />
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={items.data?.length ? 'Nada coincide con la búsqueda' : 'El almacén está vacío'}
          message="Da de alta el material del que dispones para poder compararlo con lo que necesita cada evento."
          icon={<Package className="size-5" />}
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
              Nuevo material
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              categoryName={categoryById.get(item.category_id ?? '')?.name}
              categoryColor={categoryById.get(item.category_id ?? '')?.color}
              onEdit={() => {
                setEditing(item);
                setFormOpen(true);
              }}
              onDelete={() => setToDelete(item)}
            />
          ))}
        </div>
      )}

      <ItemFormModal
        open={formOpen}
        item={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void handleDelete()}
        loading={deleteItem.isPending}
        title="Eliminar material"
        message={<>Se eliminará «{toDelete?.name}» del inventario y de todas las cajas.</>}
      />
    </>
  );
}

function ItemCard({
  item,
  categoryName,
  categoryColor,
  onEdit,
  onDelete,
}: {
  item: WarehouseItem;
  categoryName?: string;
  categoryColor?: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void resolveUrl(BUCKETS.warehousePhotos, item.photo_path).then((u) => {
      if (alive) setPhoto(u);
    });
    return () => {
      alive = false;
    };
  }, [item.photo_path]);

  const vol = volumeOf(Number(item.length_m), Number(item.width_m), Number(item.height_m));

  return (
    <Card className="group flex gap-3 p-3">
      <div className="size-20 shrink-0 overflow-hidden rounded-xl border border-line bg-surface-2">
        {photo ? (
          <img src={photo} alt={item.name} className="size-full object-cover" loading="lazy" />
        ) : (
          <div className="grid size-full place-items-center text-dim">
            <Package className="size-6" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium text-ink">{item.name}</p>
            {item.internal_code ? (
              <p className="font-mono text-[11px] text-dim">{item.internal_code}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={onEdit}
              aria-label="Editar"
              className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-ink"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={onDelete}
              aria-label="Eliminar"
              className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-danger"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {categoryName ? (
            <Badge color={categoryColor} dot>
              {categoryName}
            </Badge>
          ) : null}
          <span className="num text-[12.5px] font-medium text-accent-soft">
            {fmtNum(Number(item.quantity), 0)} {item.unit}
          </span>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-dim">
          {vol > 0 ? (
            <span className="num">
              {fmtNum(Number(item.length_m), 2)}×{fmtNum(Number(item.width_m), 2)}×
              {fmtNum(Number(item.height_m), 2)} m
            </span>
          ) : null}
          {Number(item.weight_kg) > 0 ? <span className="num">{fmtKg(Number(item.weight_kg))}</span> : null}
          {item.location ? (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" />
              {item.location}
            </span>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function ItemFormModal({
  open,
  item,
  onClose,
}: {
  open: boolean;
  item: WarehouseItem | null;
  onClose: () => void;
}) {
  const categories = useCategories();
  const catalog = useCatalog();
  const create = useCreateItem();
  const update = useUpdateItem();

  const [form, setForm] = useState({
    name: '',
    category_id: '',
    catalog_id: '',
    quantity: 0,
    unit: 'ud' as Unit,
    length_m: 0,
    width_m: 0,
    height_m: 0,
    weight_kg: 0,
    description: '',
    location: '',
    internal_code: '',
  });
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: item?.name ?? '',
      category_id: item?.category_id ?? '',
      catalog_id: item?.catalog_id ?? '',
      quantity: Number(item?.quantity ?? 0),
      unit: item?.unit ?? 'ud',
      length_m: Number(item?.length_m ?? 0),
      width_m: Number(item?.width_m ?? 0),
      height_m: Number(item?.height_m ?? 0),
      weight_kg: Number(item?.weight_kg ?? 0),
      description: item?.description ?? '',
      location: item?.location ?? '',
      internal_code: item?.internal_code ?? '',
    });
    setPhotoPath(item?.photo_path ?? null);
    setError(null);
  }, [open, item]);

  /** Al elegir un objeto de la biblioteca, copiamos sus dimensiones. */
  function applyCatalog(id: string) {
    const c = catalog.data?.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      catalog_id: id,
      name: f.name || (c?.name ?? ''),
      category_id: f.category_id || (c?.category_id ?? ''),
      length_m: c ? Number(c.length_m) : f.length_m,
      width_m: c ? Number(c.width_m) : f.width_m,
      height_m: c ? Number(c.height_m) : f.height_m,
      weight_kg: c ? Number(c.weight_kg) : f.weight_kg,
    }));
  }

  async function submit() {
    if (!form.name.trim()) return setError('El nombre es obligatorio.');
    if (form.quantity < 0) return setError('La cantidad no puede ser negativa.');

    const values = {
      ...form,
      name: form.name.trim(),
      category_id: form.category_id || null,
      catalog_id: form.catalog_id || null,
      internal_code: form.internal_code.trim() || null,
      photo_path: photoPath,
    };

    try {
      if (item) await update.mutateAsync({ id: item.id, patch: values });
      else await create.mutateAsync(values);
      toast.success(item ? 'Material actualizado' : 'Material creado');
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
      title={item ? 'Editar material' : 'Nuevo material'}
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
        <Field label="Nombre" required error={error} className="sm:col-span-2">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Regleta 6 tomas"
            autoFocus
          />
        </Field>

        <Field label="Categoría">
          <Select
            value={form.category_id}
            onChange={(e) => setForm({ ...form, category_id: e.target.value })}
          >
            <option value="">Sin categoría</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Objeto de biblioteca"
          hint="Enlaza el inventario con la biblioteca para cruzarlo con el plano."
        >
          <Select value={form.catalog_id} onChange={(e) => applyCatalog(e.target.value)}>
            <option value="">Sin enlazar</option>
            {(catalog.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Cantidad" required>
          <NumberInput
            value={form.quantity}
            onChange={(v) => setForm({ ...form, quantity: v })}
            step={1}
            min={0}
          />
        </Field>

        <Field label="Unidad">
          <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as Unit })}>
            {UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.label}
              </option>
            ))}
          </Select>
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
        <Field label="Peso">
          <NumberInput value={form.weight_kg} onChange={(v) => setForm({ ...form, weight_kg: v })} unit="kg" />
        </Field>

        <Field label="Ubicación" hint="Estantería, pasillo, nave…">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="Código interno">
          <Input
            value={form.internal_code}
            onChange={(e) => setForm({ ...form, internal_code: e.target.value })}
            placeholder="ELE-REG-006"
          />
        </Field>

        <Field label="Descripción" className="sm:col-span-2">
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
          />
        </Field>

        <div className="sm:col-span-2">
          <ImageUpload
            bucket={BUCKETS.warehousePhotos}
            folder={item?.id ?? 'nuevos'}
            path={photoPath}
            onChange={setPhotoPath}
            label="Foto del material"
            aspect="video"
          />
        </div>
      </div>
    </Modal>
  );
}
