import { useState } from 'react';
import { Boxes, Package, Shapes, Tags } from 'lucide-react';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Segmented } from '@/components/ui';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { ItemsTab } from './ItemsTab';
import { BoxesTab } from './BoxesTab';
import { CategoriesTab } from './CategoriesTab';
import { LibraryTab } from './LibraryTab';

type Tab = 'items' | 'boxes' | 'library' | 'categories';

export function WarehousePage() {
  const [tab, setTab] = useState<Tab>('items');

  useRealtime('warehouse', [
    { table: 'warehouse_items', invalidate: [qk.warehouseItems] },
    { table: 'warehouse_boxes', invalidate: [qk.warehouseBoxes] },
    { table: 'warehouse_box_items', invalidate: [qk.warehouseBoxItems] },
    { table: 'object_catalog', invalidate: [qk.catalog] },
  ]);

  return (
    <Page>
      <PageHeader
        title="Almacén"
        subtitle="Inventario compartido: material, cajas y biblioteca de objetos"
        actions={
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'items', label: 'Material', icon: <Package className="size-3.5" /> },
              { value: 'boxes', label: 'Cajas', icon: <Boxes className="size-3.5" /> },
              { value: 'library', label: 'Biblioteca', icon: <Shapes className="size-3.5" /> },
              { value: 'categories', label: 'Categorías', icon: <Tags className="size-3.5" /> },
            ]}
          />
        }
      />

      {tab === 'items' ? <ItemsTab /> : null}
      {tab === 'boxes' ? <BoxesTab /> : null}
      {tab === 'library' ? <LibraryTab /> : null}
      {tab === 'categories' ? <CategoriesTab /> : null}
    </Page>
  );
}
