import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  Truck,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Meter,
  Modal,
  NumberInput,
  Segmented,
  Select,
  Stat,
} from '@/components/ui';
import {
  useAddLoadItems,
  useCreateLoad,
  useCreateVehicle,
  useDeleteLoad,
  useDeleteLoadItems,
  useLoadItems,
  useLoads,
  useUpdateLoad,
  useUpdateLoadItem,
  useVehicles,
} from '@/data/transport';
import { useBoxItems, useBoxes, useCatalog, useWarehouseItems } from '@/data/warehouse';
import { usePlanConnections, usePlanObjects, usePlans } from '@/data/plans';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { computeMaterialNeeds } from '@/lib/materials';
import { autoPack, computeLoadMetrics, footprintOf, restingHeight } from '@/lib/packing';
import type { TransportItem, TransportVehicle, VehicleType } from '@/lib/types';
import { fmtKg, fmtM3, fmtNum, fmtPct } from '@/lib/utils';
import { AddCargoModal, type CargoDraft } from './AddCargoModal';
import { LoadView2D } from './LoadView2D';
import { LoadView3D } from './LoadView3D';

export function TransportPage() {
  const { eventId } = useParams();

  const loads = useLoads(eventId);
  const vehicles = useVehicles();
  const createLoad = useCreateLoad();
  const updateLoad = useUpdateLoad();
  const deleteLoad = useDeleteLoad();
  const addItems = useAddLoadItems();
  const updateItem = useUpdateLoadItem();
  const deleteItems = useDeleteLoadItems();

  const boxes = useBoxes();
  const boxItems = useBoxItems();
  const items = useWarehouseItems();
  const catalog = useCatalog();

  const plans = usePlans(eventId);
  const planId = plans.data?.[0]?.id;
  const planObjects = usePlanObjects(planId);
  const planConnections = usePlanConnections(planId);

  const [loadId, setLoadId] = useState<string | null>(null);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [layer, setLayer] = useState<number | 'all'>('all');
  const [selection, setSelection] = useState<string[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [confirmDeleteLoad, setConfirmDeleteLoad] = useState(false);

  const currentLoad = loads.data?.find((l) => l.id === loadId) ?? loads.data?.[0] ?? null;
  const loadItems = useLoadItems(currentLoad?.id);

  useRealtime(
    `transport-${eventId}`,
    [
      { table: 'transport_loads', filter: `event_id=eq.${eventId}`, invalidate: [qk.loads(eventId ?? '')] },
      ...(currentLoad
        ? [
            {
              table: 'transport_items',
              filter: `load_id=eq.${currentLoad.id}`,
              invalidate: [qk.loadItems(currentLoad.id)],
            },
          ]
        : []),
    ],
    Boolean(eventId),
  );

  useEffect(() => {
    if (!loadId && loads.data?.[0]) setLoadId(loads.data[0].id);
  }, [loads.data, loadId]);

  const vehicle = vehicles.data?.find((v) => v.id === currentLoad?.vehicle_id) ?? null;
  const cargo = useMemo(() => loadItems.data ?? [], [loadItems.data]);
  const metrics = computeLoadMetrics(cargo, vehicle);
  const invalidIds = useMemo(
    () => new Set([...metrics.outOfBounds, ...metrics.overlapping]),
    [metrics.outOfBounds, metrics.overlapping],
  );

  const needs = useMemo(
    () =>
      computeMaterialNeeds(
        planObjects.data ?? [],
        planConnections.data ?? [],
        catalog.data ?? [],
        items.data ?? [],
      ),
    [planObjects.data, planConnections.data, catalog.data, items.data],
  );

  /** Peso real de cada caja = tara + contenido. */
  const boxWeights = useMemo(() => {
    const itemById = new Map((items.data ?? []).map((i) => [i.id, i]));
    const map = new Map<string, number>();
    for (const b of boxes.data ?? []) map.set(b.id, Number(b.empty_weight_kg));
    for (const bi of boxItems.data ?? []) {
      const it = itemById.get(bi.item_id);
      if (!it) continue;
      map.set(bi.box_id, (map.get(bi.box_id) ?? 0) + Number(it.weight_kg) * Number(bi.quantity));
    }
    return map;
  }, [boxes.data, boxItems.data, items.data]);

  const layers = useMemo(
    () => [...new Set(cargo.map((c) => Number(c.z)))].sort((a, b) => a - b),
    [cargo],
  );

  async function handleAddCargo(drafts: CargoDraft[]) {
    if (!currentLoad || !vehicle) return;
    // Colocamos cada bulto en el primer hueco libre de la fila actual.
    const placed: CargoDraft[] = [];
    const virtual: TransportItem[] = [...cargo];

    let cursorX = 0;
    let cursorY = 0;
    let rowDepth = 0;

    for (const d of drafts) {
      const fx = Number(d.length_m ?? 0.5);
      const fy = Number(d.width_m ?? 0.5);

      if (cursorX + fx > Number(vehicle.width_m)) {
        cursorX = 0;
        cursorY += rowDepth;
        rowDepth = 0;
      }
      let x = cursorX;
      let y = cursorY;
      if (y + fy > Number(vehicle.length_m)) {
        x = 0;
        y = 0;
      }
      const z = restingHeight(virtual, x, y, fx, fy);

      const row = { ...d, load_id: currentLoad.id, x, y, z, rotation: 0 };
      placed.push(row);
      virtual.push({
        ...(row as TransportItem),
        id: `tmp-${virtual.length}`,
        height_m: Number(d.height_m ?? 0.4),
      });

      cursorX += fx;
      rowDepth = Math.max(rowDepth, fy);
    }

    try {
      await addItems.mutateAsync({ loadId: currentLoad.id, rows: placed });
      toast.success(`${placed.length} bulto(s) añadidos a la carga`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se han podido añadir los bultos');
    }
  }

  async function handleAutoPack() {
    if (!vehicle || !currentLoad || cargo.length === 0) return;
    const result = autoPack(cargo, vehicle);
    try {
      for (const p of result.positions) {
        await updateItem.mutateAsync({
          id: p.id,
          loadId: currentLoad.id,
          patch: { x: p.x, y: p.y, z: p.z, rotation: p.rotation },
        });
      }
      if (result.unplaced.length) {
        toast.warning(`${result.unplaced.length} bulto(s) no caben en el vehículo.`);
      } else {
        toast.success('Carga reorganizada automáticamente');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido reorganizar');
    }
  }

  async function rotateSelected() {
    if (!currentLoad) return;
    for (const id of selection) {
      const item = cargo.find((c) => c.id === id);
      if (!item) continue;
      await updateItem.mutateAsync({
        id,
        loadId: currentLoad.id,
        patch: { rotation: (Number(item.rotation) + 90) % 180 },
      });
    }
  }

  async function removeSelected() {
    if (!currentLoad || selection.length === 0) return;
    try {
      await deleteItems.mutateAsync({ loadId: currentLoad.id, ids: selection });
      setSelection([]);
      toast.success('Bultos eliminados de la carga');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se han podido eliminar');
    }
  }

  async function handleMove(id: string, x: number, y: number) {
    if (!currentLoad) return;
    const item = cargo.find((c) => c.id === id);
    if (!item) return;
    const { fx, fy } = footprintOf(item);
    const others = cargo.filter((c) => c.id !== id);
    const z = restingHeight(others, x, y, fx, fy);
    await updateItem.mutateAsync({ id, loadId: currentLoad.id, patch: { x, y, z } });
  }

  if (loads.isLoading || vehicles.isLoading) return <LoadingState />;

  if (!currentLoad) {
    return (
      <Page>
        <PageHeader title="Transporte" subtitle="Simulación de carga del vehículo" />
        <EmptyState
          title="Todavía no hay ninguna carga"
          message="Crea una carga y elige el vehículo para empezar a colocar el material."
          icon={<Truck className="size-5" />}
          action={
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              loading={createLoad.isPending}
              onClick={async () => {
                const v = vehicles.data?.[1] ?? vehicles.data?.[0];
                const created = await createLoad.mutateAsync({
                  event_id: eventId!,
                  name: 'Carga 1',
                  vehicle_id: v?.id ?? null,
                });
                setLoadId(created.id);
              }}
            >
              Crear carga
            </Button>
          }
        />
      </Page>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-2.5">
          <Select
            value={currentLoad.id}
            onChange={(e) => {
              setLoadId(e.target.value);
              setSelection([]);
            }}
            className="h-9 w-auto min-w-[140px]"
          >
            {(loads.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>

          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={async () => {
              const created = await createLoad.mutateAsync({
                event_id: eventId!,
                name: `Carga ${(loads.data?.length ?? 0) + 1}`,
                vehicle_id: vehicle?.id ?? null,
              });
              setLoadId(created.id);
            }}
          >
            Nueva carga
          </Button>

          <div className="mx-1 h-6 w-px bg-[var(--ef-line)]" />

          <Select
            value={vehicle?.id ?? ''}
            onChange={(e) =>
              updateLoad.mutate({
                id: currentLoad.id,
                eventId: eventId!,
                patch: { vehicle_id: e.target.value || null },
              })
            }
            className="h-9 w-auto min-w-[190px]"
          >
            <option value="">Sin vehículo</option>
            {(vehicles.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · {fmtNum(Number(v.length_m), 1)}×{fmtNum(Number(v.width_m), 1)}×
                {fmtNum(Number(v.height_m), 1)} m
              </option>
            ))}
          </Select>

          <Button size="sm" variant="ghost" onClick={() => setVehicleOpen(true)}>
            Vehículo personalizado
          </Button>

          <div className="ml-auto flex items-center gap-2">
            <Segmented
              value={view}
              onChange={setView}
              size="sm"
              options={[
                { value: '2d', label: '2D', icon: <LayoutGrid className="size-3.5" /> },
                { value: '3d', label: '3D' },
              ]}
            />
            <Button
              size="sm"
              variant="outline"
              icon={<Sparkles className="size-3.5" />}
              onClick={() => void handleAutoPack()}
              disabled={!vehicle || cargo.length === 0}
            >
              Colocar automáticamente
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => setAddOpen(true)}
              disabled={!vehicle}
            >
              Añadir bultos
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[320px] flex-1">
          {vehicle ? (
            view === '2d' ? (
              <LoadView2D
                vehicle={vehicle}
                items={cargo}
                selection={selection}
                onSelect={setSelection}
                onMove={(id, x, y) => void handleMove(id, x, y)}
                invalidIds={invalidIds}
                layer={layer}
              />
            ) : (
              <LoadView3D
                vehicle={vehicle}
                items={cargo}
                selection={selection}
                onSelect={setSelection}
                invalidIds={invalidIds}
              />
            )
          ) : (
            <div className="grid size-full place-items-center p-8">
              <EmptyState
                title="Elige un vehículo"
                message="Selecciona una furgoneta o camión para calcular volumen, peso y ocupación."
                icon={<Truck className="size-5" />}
              />
            </div>
          )}

          {view === '2d' && layers.length > 1 ? (
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-lg border border-line bg-[color-mix(in_oklab,var(--ef-canvas)_85%,transparent)] px-2 py-1.5 backdrop-blur">
              <Layers className="size-3.5 text-dim" />
              <select
                value={String(layer)}
                onChange={(e) => setLayer(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="bg-transparent text-[12px] text-ink outline-none"
              >
                <option value="all">Todas las alturas</option>
                {layers.map((z) => (
                  <option key={z} value={z}>
                    Altura {fmtNum(z, 2)} m
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {selection.length ? (
            <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-xl border border-line bg-[color-mix(in_oklab,var(--ef-canvas)_88%,transparent)] p-1.5 backdrop-blur">
              <span className="px-1.5 text-[12px] text-muted">{selection.length} sel.</span>
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCw className="size-3.5" />}
                onClick={() => void rotateSelected()}
              >
                Rotar 90°
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => void removeSelected()}
              >
                Quitar
              </Button>
            </div>
          ) : null}
        </div>

        <aside className="w-full shrink-0 overflow-y-auto border-t border-line p-4 lg:w-[320px] lg:border-l lg:border-t-0">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat
              label="Volumen"
              value={fmtM3(metrics.usedVolumeM3)}
              hint={vehicle ? `de ${fmtM3(metrics.vehicleVolumeM3)}` : '—'}
              tone={metrics.occupancyPct > 100 ? 'danger' : 'default'}
            />
            <Stat
              label="Peso"
              value={fmtKg(metrics.totalWeightKg)}
              hint={vehicle ? `máx. ${fmtKg(Number(vehicle.max_weight_kg))}` : '—'}
              tone={metrics.overweight ? 'danger' : 'default'}
            />
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12px]">
                <span className="text-muted">Ocupación de volumen</span>
                <span className="num text-ink">{fmtPct(metrics.occupancyPct)}</span>
              </div>
              <Meter value={metrics.occupancyPct} height={9} />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[12px]">
                <span className="text-muted">Carga máxima</span>
                <span className="num text-ink">{fmtPct(metrics.weightPct)}</span>
              </div>
              <Meter value={metrics.weightPct} height={9} />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            {!vehicle ? null : metrics.occupancyPct > 100 ? (
              <StatusBox tone="danger">
                <AlertTriangle className="size-4" />
                La carga no cabe. Faltan {fmtM3(metrics.missingVolumeM3)} de espacio.
              </StatusBox>
            ) : metrics.outOfBounds.length ? (
              <StatusBox tone="warn">
                <AlertTriangle className="size-4" />
                {metrics.outOfBounds.length} bulto(s) sobresalen del vehículo.
              </StatusBox>
            ) : metrics.overlapping.length ? (
              <StatusBox tone="warn">
                <AlertTriangle className="size-4" />
                {metrics.overlapping.length} bulto(s) se solapan entre sí.
              </StatusBox>
            ) : (
              <StatusBox tone="ok">
                <CheckCircle2 className="size-4" />
                Todo cabe correctamente.
              </StatusBox>
            )}

            {metrics.overweight ? (
              <StatusBox tone="danger">
                <AlertTriangle className="size-4" />
                Se supera el peso máximo del vehículo.
              </StatusBox>
            ) : null}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">
                Bultos ({cargo.length})
              </h3>
              <button
                onClick={() => setConfirmDeleteLoad(true)}
                className="text-[11.5px] text-dim hover:text-danger"
              >
                Eliminar carga
              </button>
            </div>

            <div className="space-y-1">
              {cargo.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12.5px] text-dim">
                  Añade bultos desde el material del evento, las cajas o el almacén.
                </p>
              ) : (
                cargo.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelection([c.id])}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                      selection.includes(c.id)
                        ? 'border-accent-soft bg-surface-2'
                        : 'border-transparent hover:bg-surface-2'
                    }`}
                  >
                    <span className="size-3 shrink-0 rounded" style={{ background: c.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-ink">{c.label}</span>
                      <span className="num block text-[10.5px] text-dim">
                        {fmtNum(Number(c.length_m), 2)}×{fmtNum(Number(c.width_m), 2)}×
                        {fmtNum(Number(c.height_m), 2)} m · {fmtKg(Number(c.weight_kg))}
                      </span>
                    </span>
                    {c.source_kind === 'box' ? <Badge color="#f59e0b">caja</Badge> : null}
                    {invalidIds.has(c.id) ? <Badge color="#f87171">!</Badge> : null}
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>

      <AddCargoModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdd={(drafts) => void handleAddCargo(drafts)}
        needs={needs}
        boxes={boxes.data ?? []}
        items={items.data ?? []}
        boxWeights={boxWeights}
      />

      <VehicleModal open={vehicleOpen} onClose={() => setVehicleOpen(false)} onCreated={(v) =>
        updateLoad.mutate({ id: currentLoad.id, eventId: eventId!, patch: { vehicle_id: v.id } })
      } />

      <ConfirmDialog
        open={confirmDeleteLoad}
        onCancel={() => setConfirmDeleteLoad(false)}
        onConfirm={async () => {
          await deleteLoad.mutateAsync({ id: currentLoad.id, eventId: eventId! });
          setLoadId(null);
          setConfirmDeleteLoad(false);
          toast.success('Carga eliminada');
        }}
        loading={deleteLoad.isPending}
        title="Eliminar carga"
        message={<>Se eliminará «{currentLoad.name}» y todos sus bultos.</>}
      />
    </div>
  );
}

function StatusBox({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'ok' | 'warn' | 'danger';
}) {
  const color = tone === 'ok' ? 'var(--ef-ok)' : tone === 'warn' ? 'var(--ef-warn)' : 'var(--ef-danger)';
  return (
    <div
      className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[12.5px] text-ink"
      style={{
        borderColor: `color-mix(in oklab, ${color} 40%, transparent)`,
        background: `color-mix(in oklab, ${color} 10%, transparent)`,
      }}
    >
      <span style={{ color }} className="mt-px shrink-0">
        {Array.isArray(children) ? children[0] : null}
      </span>
      <span>{Array.isArray(children) ? children.slice(1) : children}</span>
    </div>
  );
}

function VehicleModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (v: TransportVehicle) => void;
}) {
  const create = useCreateVehicle();
  const [form, setForm] = useState({
    name: 'Vehículo personalizado',
    vehicle_type: 'custom' as VehicleType,
    length_m: 3,
    width_m: 1.7,
    height_m: 1.8,
    max_weight_kg: 1000,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Vehículo personalizado"
      description="Se guarda como plantilla reutilizable para futuros eventos."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            loading={create.isPending}
            onClick={async () => {
              try {
                const v = await create.mutateAsync({ ...form, is_template: true });
                onCreated(v);
                toast.success('Vehículo creado');
                onClose();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'No se ha podido crear');
              }
            }}
          >
            Crear
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Tipo">
          <Select
            value={form.vehicle_type}
            onChange={(e) => setForm({ ...form, vehicle_type: e.target.value as VehicleType })}
          >
            <option value="van">Furgoneta</option>
            <option value="truck">Camión</option>
            <option value="trailer">Remolque</option>
            <option value="custom">Personalizado</option>
          </Select>
        </Field>
        <Field label="Peso máximo">
          <NumberInput
            value={form.max_weight_kg}
            onChange={(v) => setForm({ ...form, max_weight_kg: v })}
            unit="kg"
            step={50}
          />
        </Field>
        <Field label="Largo">
          <NumberInput value={form.length_m} onChange={(v) => setForm({ ...form, length_m: v })} unit="m" />
        </Field>
        <Field label="Ancho">
          <NumberInput value={form.width_m} onChange={(v) => setForm({ ...form, width_m: v })} unit="m" />
        </Field>
        <Field label="Alto" className="sm:col-span-2">
          <NumberInput value={form.height_m} onChange={(v) => setForm({ ...form, height_m: v })} unit="m" />
        </Field>
      </div>
    </Modal>
  );
}
