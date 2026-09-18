import { useState } from 'react';
import { Copy, Replace } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '@/components/ui';
import { useCreateCatalogObject, useCreateItem } from '@/data/warehouse';
import { CatalogObjectModal } from '@/features/warehouse/CatalogObjectModal';
import { ItemFormModal } from '@/features/warehouse/ItemsTab';
import type { CatalogObject, PlanObject, WarehouseItem } from '@/lib/types';

/**
 * EDITAR LA TEXTURA DE UN OBJETO YA COLOCADO EN EL PLANO
 *
 * La textura no vive en el objeto del plano, sino en su ficha de origen (el
 * material del almacén o el objeto de la biblioteca). Cambiarla afecta, por
 * tanto, a TODAS las copias de ese objeto en todos los planos. Como eso no
 * siempre es lo que se quiere, antes de abrir el editor se pregunta:
 *
 *   · Cambiar el original  -> se edita la ficha; se actualizan todas las copias.
 *   · Crear una copia      -> se duplica la ficha, este objeto del plano pasa a
 *                             apuntar a la copia y el resto se queda como está.
 */
export function ObjectTextureFlow({
  open,
  object,
  item,
  catalogObject,
  onClose,
  onRelink,
}: {
  open: boolean;
  object: PlanObject;
  item: WarehouseItem | null;
  catalogObject: CatalogObject | null;
  onClose: () => void;
  onRelink: (link: { warehouse_item_id?: string | null; catalog_id?: string | null }) => void;
}) {
  const createItem = useCreateItem();
  const createCatalog = useCreateCatalogObject();

  const [editItem, setEditItem] = useState<WarehouseItem | null>(null);
  const [editCatalog, setEditCatalog] = useState<CatalogObject | null>(null);
  const [busy, setBusy] = useState(false);

  const source = item ?? catalogObject;

  function openEditor(target: WarehouseItem | CatalogObject) {
    if (item && 'quantity' in target) setEditItem(target as WarehouseItem);
    else setEditCatalog(target as CatalogObject);
    onClose();
  }

  async function makeCopy() {
    if (!source) return;
    setBusy(true);
    try {
      if (item) {
        const { id, created_at, updated_at, internal_code, photo_path, name, ...rest } = item;
        void id;
        void created_at;
        void updated_at;
        void internal_code;
        void photo_path;
        const copy = await createItem.mutateAsync({
          ...rest,
          name: `${name} (variante)`,
          quantity: 1,
        });
        onRelink({ warehouse_item_id: copy.id, catalog_id: null });
        toast.success('Copia creada. Ajusta sus unidades y súbele la nueva textura.');
        openEditor(copy);
      } else if (catalogObject) {
        const { id, created_at, updated_at, name, ...rest } = catalogObject;
        void id;
        void created_at;
        void updated_at;
        const copy = await createCatalog.mutateAsync({ ...rest, name: `${name} (variante)` });
        onRelink({ catalog_id: copy.id, warehouse_item_id: null });
        toast.success('Copia creada. Súbele la nueva textura.');
        openEditor(copy);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido crear la copia');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal
        open={open && Boolean(source)}
        onClose={onClose}
        size="sm"
        title="Textura del objeto"
        description={`«${source?.name ?? object.label}» se usa a partir de su ficha ${item ? 'del almacén' : 'de la biblioteca'}. ¿Qué quieres hacer?`}
      >
        <div className="space-y-2.5">
          <Choice
            icon={<Replace className="size-4" />}
            title="Cambiar la imagen original"
            text="Se edita la ficha. La nueva textura se verá en todas las copias de este objeto, en este plano y en los demás eventos."
            disabled={busy}
            onClick={() => source && openEditor(source)}
          />
          <Choice
            icon={<Copy className="size-4" />}
            title="Crear una copia con la nueva textura"
            text="Se duplica la ficha, este objeto pasa a usar la copia y todo lo demás se queda igual."
            disabled={busy}
            onClick={() => void makeCopy()}
          />
        </div>
      </Modal>

      <ItemFormModal open={Boolean(editItem)} item={editItem} onClose={() => setEditItem(null)} />

      <CatalogObjectModal
        open={Boolean(editCatalog)}
        object={editCatalog}
        onClose={() => setEditCatalog(null)}
      />
    </>
  );
}

function Choice({
  icon,
  title,
  text,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full gap-3 rounded-xl border border-line bg-surface-2 p-3.5 text-left transition-colors hover:border-accent-soft hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
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
