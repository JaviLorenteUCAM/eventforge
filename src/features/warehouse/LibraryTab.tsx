import { useMemo, useState } from 'react';
import { Cable, Copy, Network, Pencil, Plus, Shapes, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  LoadingState,
  SearchInput,
  Select,
} from '@/components/ui';
import {
  useCatalog,
  useCategories,
  useCreateCatalogObject,
  useDeleteCatalogObject,
} from '@/data/warehouse';
import { OBJECT_KIND_LABEL, type CatalogObject } from '@/lib/types';
import { fmtNum, normalize } from '@/lib/utils';
import { CatalogObjectModal } from './CatalogObjectModal';

export function LibraryTab() {
  const catalog = useCatalog();
  const categories = useCategories();
  const remove = useDeleteCatalogObject();
  const duplicate = useCreateCatalogObject();

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<CatalogObject | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CatalogObject | null>(null);

  const categoryById = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c])),
    [categories.data],
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    return (catalog.data ?? []).filter((o) => {
      if (category !== 'all' && o.category_id !== category) return false;
      if (q && !normalize(`${o.name} ${o.material} ${o.notes}`).includes(q)) return false;
      return true;
    });
  }, [catalog.data, search, category]);

  /** Copia un objeto de la biblioteca con todas sus características. */
  async function handleDuplicate(o: CatalogObject) {
    const { id, created_at, updated_at, name, ...rest } = o;
    void id;
    void created_at;
    void updated_at;
    try {
      await duplicate.mutateAsync({ ...rest, name: `${name} (copia)` });
      toast.success('Objeto duplicado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido duplicar');
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await remove.mutateAsync(toDelete.id);
      toast.success('Objeto eliminado de la biblioteca');
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
          placeholder="Buscar en la biblioteca…"
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
        <Button
          variant="primary"
          icon={<Plus className="size-4" />}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Crear objeto
        </Button>
      </div>

      {catalog.isLoading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={catalog.data?.length ? 'Nada coincide con la búsqueda' : 'La biblioteca está vacía'}
          message="Aquí solo van los objetos puntuales de un evento: una alfombra a medida, un cartel, una estructura prestada. El material del que dispones habitualmente va en el Almacén, con sus unidades."
          icon={<Shapes className="size-5" />}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((o) => {
            const cat = categoryById.get(o.category_id ?? '');
            return (
              <Card key={o.id} className="group p-3.5">
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 size-8 shrink-0 rounded-lg border border-line"
                    style={{ background: o.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{o.name}</p>
                    <p className="truncate text-[11.5px] text-dim">{OBJECT_KIND_LABEL[o.kind]}</p>
                  </div>
                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditing(o);
                        setOpen(true);
                      }}
                      aria-label="Editar"
                      title="Editar"
                      className="rounded-md p-1 text-dim hover:text-ink"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void handleDuplicate(o)}
                      aria-label="Duplicar"
                      title="Duplicar"
                      className="rounded-md p-1 text-dim hover:text-ink"
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      onClick={() => setToDelete(o)}
                      aria-label="Eliminar"
                      title="Eliminar"
                      className="rounded-md p-1 text-dim hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                <p className="num mt-2.5 text-[11.5px] text-muted">
                  {fmtNum(Number(o.length_m), 2)} × {fmtNum(Number(o.width_m), 2)} ×{' '}
                  {fmtNum(Number(o.height_m), 2)} m
                </p>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {cat ? (
                    <Badge color={cat.color} dot>
                      {cat.name}
                    </Badge>
                  ) : null}
                  {o.requires_power ? (
                    <Badge color="#f59e0b">
                      <Zap className="size-3" />
                      {Number(o.power_w) > 0 ? `${fmtNum(Number(o.power_w), 0)} W` : 'Corriente'}
                    </Badge>
                  ) : null}
                  {o.requires_network ? (
                    <Badge color="#22d3ee">
                      <Network className="size-3" /> Red
                    </Badge>
                  ) : null}
                  {o.outlet_count > 0 ? (
                    <Badge color="#fbbf24">
                      <Cable className="size-3" /> {o.outlet_count} tomas
                    </Badge>
                  ) : null}
                  {o.port_count > 0 ? (
                    <Badge color="#06b6d4">
                      <Network className="size-3" /> {o.port_count} puertos
                    </Badge>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CatalogObjectModal
        open={open}
        object={editing}
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
        title="Eliminar objeto de la biblioteca"
        message={
          <>
            Se eliminará «{toDelete?.name}». Los objetos ya colocados en planos se mantienen, pero
            pierden el enlace con la biblioteca.
          </>
        }
      />
    </>
  );
}
