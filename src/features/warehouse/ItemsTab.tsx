import { useEffect, useMemo, useState } from 'react';
import { Copy, MapPin, Package, Pencil, Plus, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ColorPicker,
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
  useBoxItems,
  useBoxes,
  useCategories,
  useCreateItem,
  useDeleteItem,
  useUpdateItem,
  useWarehouseItems,
} from '@/data/warehouse';
import { BUCKETS, resolveUrl } from '@/lib/storage';
import {
  OBJECT_KINDS,
  OBJECT_KIND_LABEL,
  type ObjectKind,
  type TextureMode,
  type Unit,
  type WarehouseItem,
} from '@/lib/types';
import { fmtNum, normalize, volumeOf } from '@/lib/utils';
import { TextureSection, type TextureFields } from './TextureSection';
import { exportItemsToSheet } from './sheetExport';

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
  const createItem = useCreateItem();
  const boxes = useBoxes();
  const boxItems = useBoxItems();

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

  /** Caja (o cajas) en las que está guardado cada material. */
  const boxByItem = useMemo(() => {
    const codeById = new Map((boxes.data ?? []).map((b) => [b.id, b.code || b.name]));
    const map = new Map<string, string[]>();
    for (const bi of boxItems.data ?? []) {
      const code = codeById.get(bi.box_id);
      if (!code) continue;
      map.set(bi.item_id, [...(map.get(bi.item_id) ?? []), code]);
    }
    return map;
  }, [boxes.data, boxItems.data]);

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

  /** Copia el material con todas sus características, sin la foto ni el código. */
  async function handleDuplicate(item: WarehouseItem) {
    const { id, created_at, updated_at, internal_code, photo_path, name, ...rest } = item;
    void id;
    void created_at;
    void updated_at;
    void internal_code;
    void photo_path;
    try {
      await createItem.mutateAsync({ ...rest, name: `${name} (copia)` });
      toast.success('Material duplicado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido duplicar');
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
          variant="outline"
          onClick={() =>
            void exportItemsToSheet(
              items.data ?? [],
              (id) => categoryById.get(id ?? '')?.name ?? '',
              (itemId) => (boxByItem.get(itemId) ?? []).join(', '),
            )
          }
          disabled={!items.data?.length}
        >
          Exportar a hoja de cálculo
        </Button>
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
          message="Da de alta el material del que dispones para poder colocarlo en los planos y compararlo con lo que necesita cada evento."
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
              onDuplicate={() => void handleDuplicate(item)}
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
  onDuplicate,
  onDelete,
}: {
  item: WarehouseItem;
  categoryName?: string;
  categoryColor?: string;
  onEdit: () => void;
  onDuplicate: () => void;
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
          <div
            className="grid size-full place-items-center"
            style={{ background: `${item.color}22`, color: item.color }}
          >
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
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              onClick={onEdit}
              aria-label="Editar"
              title="Editar"
              className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-ink"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              onClick={onDuplicate}
              aria-label="Duplicar"
              title="Duplicar"
              className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-ink"
            >
              <Copy className="size-3.5" />
            </button>
            <button
              onClick={onDelete}
              aria-label="Eliminar"
              title="Eliminar"
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
          {item.requires_power ? (
            <span className="inline-flex items-center gap-0.5 text-[11.5px] text-warn">
              <Zap className="size-3" />
              {fmtNum(Number(item.power_w), 0)} W
            </span>
          ) : null}
        </div>

        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-dim">
          {vol > 0 ? (
            <span className="num">
              {fmtNum(Number(item.length_m), 2)}×{fmtNum(Number(item.width_m), 2)}×
              {fmtNum(Number(item.height_m), 2)} m
            </span>
          ) : null}
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

const EMPTY_FORM = {
  name: '',
  category_id: '',
  quantity: 1,
  unit: 'ud' as Unit,
  length_m: 1,
  width_m: 1,
  height_m: 1,
  description: '',
  location: '',
  internal_code: '',
  kind: 'generic' as ObjectKind,
  shape: 'box' as 'box' | 'cylinder' | 'plane',
  color: '#94a3b8',
  requires_power: false,
  requires_network: false,
  power_w: 0,
  outlet_count: 0,
  port_count: 0,
  texture_mode: 'atlas' as TextureMode,
  texture_scale: 1,
  texture_offset_x: 0,
  texture_offset_y: 0,
  texture_rotation: 0,
};

/**
 * Alta y edición de material del almacén.
 *
 * Desde el modelo «almacén primero» este formulario define TAMBIÉN cómo se
 * dibuja el material en el plano (forma, color, textura) y cómo se comporta en
 * el análisis eléctrico y de red. Por eso no hay que enlazarlo con nada más:
 * el artículo del almacén es el objeto.
 */
export function ItemFormModal({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: WarehouseItem | null;
  onClose: () => void;
  onSaved?: (saved: WarehouseItem) => void;
}) {
  const categories = useCategories();
  const create = useCreateItem();
  const update = useUpdateItem();

  const [form, setForm] = useState(EMPTY_FORM);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [texturePath, setTexturePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(
      item
        ? {
            name: item.name,
            category_id: item.category_id ?? '',
            quantity: Number(item.quantity),
            unit: item.unit,
            length_m: Number(item.length_m),
            width_m: Number(item.width_m),
            height_m: Number(item.height_m),
            description: item.description ?? '',
            location: item.location ?? '',
            internal_code: item.internal_code ?? '',
            kind: item.kind,
            shape: item.shape,
            color: item.color,
            requires_power: item.requires_power,
            requires_network: item.requires_network,
            power_w: Number(item.power_w),
            outlet_count: Number(item.outlet_count),
            port_count: Number(item.port_count),
            texture_mode: item.texture_mode,
            texture_scale: Number(item.texture_scale),
            texture_offset_x: Number(item.texture_offset_x),
            texture_offset_y: Number(item.texture_offset_y),
            texture_rotation: Number(item.texture_rotation),
          }
        : EMPTY_FORM,
    );
    setPhotoPath(item?.photo_path ?? null);
    setTexturePath(item?.texture_path ?? null);
    setError(null);
  }, [open, item]);

  async function submit() {
    if (!form.name.trim()) return setError('El nombre es obligatorio.');
    if (form.quantity < 0) return setError('La cantidad no puede ser negativa.');
    if (form.length_m <= 0 || form.width_m <= 0 || form.height_m <= 0) {
      return setError('Las dimensiones deben ser mayores que cero.');
    }

    const values = {
      ...form,
      name: form.name.trim(),
      category_id: form.category_id || null,
      internal_code: form.internal_code.trim() || null,
      photo_path: photoPath,
      texture_path: texturePath,
    };

    try {
      const saved = item
        ? await update.mutateAsync({ id: item.id, patch: values })
        : await create.mutateAsync(values);
      toast.success(item ? 'Material actualizado' : 'Material creado');
      onSaved?.(saved);
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
      description="El material del almacén se coloca tal cual en los planos: su forma, color y textura son los que se verán en 2D y en 3D."
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
            placeholder="Mesa plegable 1,80 m"
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

        <Field label="Tipo" hint="Determina cómo se comporta en el análisis de conexiones.">
          <Select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as ObjectKind })}
          >
            {OBJECT_KINDS.map((k) => (
              <option key={k} value={k}>
                {OBJECT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Unidades de las que dispones" required>
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

        <Field label="Largo" required>
          <NumberInput value={form.length_m} onChange={(v) => setForm({ ...form, length_m: v })} unit="m" min={0.01} />
        </Field>
        <Field label="Ancho" required>
          <NumberInput value={form.width_m} onChange={(v) => setForm({ ...form, width_m: v })} unit="m" min={0.01} />
        </Field>
        <Field label="Alto" required>
          <NumberInput value={form.height_m} onChange={(v) => setForm({ ...form, height_m: v })} unit="m" min={0.01} />
        </Field>

        <Field label="Forma en el plano">
          <Select
            value={form.shape}
            onChange={(e) => setForm({ ...form, shape: e.target.value as 'box' | 'cylinder' | 'plane' })}
          >
            <option value="box">Caja / rectángulo</option>
            <option value="cylinder">Cilindro / círculo</option>
            <option value="plane">Plano (alfombra, tarima fina)</option>
          </Select>
        </Field>

        <Field label="Color en el plano" className="sm:col-span-2">
          <ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
        </Field>

        <Field label="Ubicación en el almacén" hint="Estantería, pasillo, nave…">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="Código interno">
          <Input
            value={form.internal_code}
            onChange={(e) => setForm({ ...form, internal_code: e.target.value })}
            placeholder="ELE-REG-006"
          />
        </Field>

        <div className="rounded-xl border border-line bg-surface-2 p-3.5 sm:col-span-2">
          <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.1em] text-dim">
            Electricidad y red
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox
              label="Necesita corriente"
              checked={form.requires_power}
              onChange={(e) => setForm({ ...form, requires_power: e.target.checked })}
            />
            <Checkbox
              label="Necesita red"
              checked={form.requires_network}
              onChange={(e) => setForm({ ...form, requires_network: e.target.checked })}
            />
            <Field label="Consumo">
              <NumberInput
                value={form.power_w}
                onChange={(v) => setForm({ ...form, power_w: v })}
                unit="W"
                step={5}
              />
            </Field>
            <div />
            <Field label="Tomas que ofrece" hint="Regletas, cuadros, alargaderas.">
              <NumberInput
                value={form.outlet_count}
                onChange={(v) => setForm({ ...form, outlet_count: Math.round(v) })}
                step={1}
              />
            </Field>
            <Field label="Puertos de red que ofrece" hint="Switches y routers.">
              <NumberInput
                value={form.port_count}
                onChange={(v) => setForm({ ...form, port_count: Math.round(v) })}
                step={1}
              />
            </Field>
          </div>
        </div>

        <div className="sm:col-span-2">
          <TextureSection
            name={form.name || 'Objeto'}
            shape={form.shape}
            lengthM={form.length_m}
            widthM={form.width_m}
            heightM={form.height_m}
            path={texturePath}
            mode={form.texture_mode}
            scale={form.texture_scale}
            offsetX={form.texture_offset_x}
            offsetY={form.texture_offset_y}
            rotation={form.texture_rotation}
            folder="almacen"
            onPathChange={setTexturePath}
            onFieldChange={(patch: Partial<TextureFields>) => setForm((f) => ({ ...f, ...patch }))}
          />
        </div>

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
