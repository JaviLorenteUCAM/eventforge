import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Camera,
  Cable,
  Eye,
  Grid3x3,
  Magnet,
  Network,
  PanelLeftClose,
  PanelRightClose,
  Redo2,
  Ruler,
  Undo2,
  MousePointer2,
  Zap,
  Boxes,
  ImageIcon,
  Trash2,
  Layers,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, ConfirmDialog, IconButton, LoadingState, Modal, Segmented } from '@/components/ui';
import {
  useCreateSnapshot,
  useDeleteSnapshot,
  usePlanConnections,
  usePlanObjects,
  usePlans,
  useSnapshots,
  useUpdatePlan,
} from '@/data/plans';
import { useCatalog, useCategories, useWarehouseItems } from '@/data/warehouse';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { analyzePlan, powerBudget } from '@/lib/issues';
import { BUCKETS, resolveUrl, uploadBlob } from '@/lib/storage';
import type { Plan, PlanConnection, PlanIssue, PlanObject } from '@/lib/types';
import { cn, fmtNum, round, uid } from '@/lib/utils';
import { Editor2D, type CalibrationLine, type CommitUpdate } from './Editor2D';
import { Editor3D } from './Editor3D';
import { Inspector } from './Inspector';
import { ObjectLibrary, type AddPayload, type BasicShape } from './ObjectLibrary';
import { BackgroundPanel } from './BackgroundPanel';
import { CalibrationModal, type CalibrationResult } from './CalibrationModal';
import { LoadScenarioModal, SaveScenarioModal } from './ScenarioModals';
import type { TextureSpec } from './TexturedMesh';
import { usePlanStore } from './planStore';
import { usePlanOps } from './usePlanOps';
import { useHistory } from './useHistory';
import { captureCanvas, captureSvg } from './capture';
import {
  useCreateBackground,
  useDeleteBackground,
  usePlanBackgrounds,
  useUpdateBackground,
} from '@/data/backgrounds';

/** Medidas por defecto de las figuras básicas, en metros. */
const BASIC_SHAPES: Record<
  BasicShape,
  { label: string; shape: PlanObject['shape']; length_m: number; width_m: number; height_m: number }
> = {
  box: { label: 'Rectángulo', shape: 'box', length_m: 1.5, width_m: 0.8, height_m: 0.75 },
  square: { label: 'Cuadrado', shape: 'box', length_m: 1, width_m: 1, height_m: 0.75 },
  cylinder: { label: 'Círculo', shape: 'cylinder', length_m: 1, width_m: 1, height_m: 0.75 },
  plane: { label: 'Superficie', shape: 'plane', length_m: 2, width_m: 1, height_m: 0.02 },
  line: { label: 'Línea', shape: 'line', length_m: 2, width_m: 0.05, height_m: 0.02 },
  text: { label: 'Texto', shape: 'text', length_m: 1.2, width_m: 0.35, height_m: 0.01 },
};

export function PlanPage() {
  const { eventId } = useParams();
  const [params, setParams] = useSearchParams();
  const { profile } = useAuth();

  const plans = usePlans(eventId);
  const plan = plans.data?.[0];
  const objects = usePlanObjects(plan?.id);
  const connections = usePlanConnections(plan?.id);
  const catalog = useCatalog();
  const categories = useCategories();
  const items = useWarehouseItems();
  const updatePlan = useUpdatePlan();
  const snapshots = useSnapshots(eventId);
  const createSnapshot = useCreateSnapshot();
  const deleteSnapshot = useDeleteSnapshot();

  const ops = usePlanOps(plan?.id);
  const history = useHistory();

  const store = usePlanStore();
  const {
    mode,
    setMode,
    tool,
    setTool,
    selection,
    setSelection,
    clearSelection,
    linkFrom,
    setLinkFrom,
    clipboard,
    setClipboard,
    snap,
  } = store;

  const backgrounds = usePlanBackgrounds(plan?.id);
  const createBackground = useCreateBackground();
  const updateBackground = useUpdateBackground();
  const deleteBackground = useDeleteBackground();

  const svgRef = useRef<SVGSVGElement | null>(null);
  const glRef = useRef<{ canvas: HTMLCanvasElement; render: () => void } | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<'inspector' | 'background'>('inspector');
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [selectedBackgroundId, setSelectedBackgroundId] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<CalibrationLine | null>(null);
  const [saveScenarioOpen, setSaveScenarioOpen] = useState(false);
  const [loadScenarioOpen, setLoadScenarioOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [capturesOpen, setCapturesOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);

  // --- URLs firmadas de las imágenes de fondo y de las texturas -------------
  const [backgroundUrls, setBackgroundUrls] = useState<Map<string, string>>(new Map());
  const [textureUrls, setTextureUrls] = useState<Map<string, string>>(new Map());

  const backgroundList = useMemo(() => backgrounds.data ?? [], [backgrounds.data]);

  useEffect(() => {
    let alive = true;
    void Promise.all(
      backgroundList.map(
        async (b) => [b.id, await resolveUrl(BUCKETS.planBackgrounds, b.storage_path)] as const,
      ),
    ).then((pairs) => {
      if (!alive) return;
      const map = new Map<string, string>();
      for (const [id, url] of pairs) if (url) map.set(id, url);
      setBackgroundUrls(map);
    });
    return () => {
      alive = false;
    };
  }, [backgroundList]);

  useEffect(() => {
    const paths = [
      ...new Set((catalog.data ?? []).map((c) => c.texture_path).filter(Boolean as never)),
    ] as string[];
    if (paths.length === 0) {
      setTextureUrls(new Map());
      return;
    }
    let alive = true;
    void Promise.all(
      paths.map(async (p) => [p, await resolveUrl(BUCKETS.textures, p)] as const),
    ).then((pairs) => {
      if (!alive) return;
      const map = new Map<string, string>();
      for (const [p, url] of pairs) if (url) map.set(p, url);
      setTextureUrls(map);
    });
    return () => {
      alive = false;
    };
  }, [catalog.data]);

  useRealtime(
    `plan-${plan?.id}`,
    plan
      ? [
          {
            table: 'plan_objects',
            filter: `plan_id=eq.${plan.id}`,
            invalidate: [qk.planObjects(plan.id)],
          },
          {
            table: 'plan_connections',
            filter: `plan_id=eq.${plan.id}`,
            invalidate: [qk.planConnections(plan.id)],
          },
          {
            table: 'plan_backgrounds',
            filter: `plan_id=eq.${plan.id}`,
            invalidate: [qk.planBackgrounds(plan.id)],
          },
        ]
      : [],
    Boolean(plan),
  );

  const objectList = useMemo(() => objects.data ?? [], [objects.data]);
  const connectionList = useMemo(() => connections.data ?? [], [connections.data]);

  const issues = useMemo(
    () => analyzePlan(objectList, connectionList),
    [objectList, connectionList],
  );

  const issuesByObject = useMemo(() => {
    const map = new Map<string, PlanIssue[]>();
    for (const i of issues) {
      if (!i.objectId) continue;
      map.set(i.objectId, [...(map.get(i.objectId) ?? []), i]);
    }
    return map;
  }, [issues]);

  // Selección desde una incidencia enlazada (?sel=<id>)
  useEffect(() => {
    const sel = params.get('sel');
    if (sel && objectList.some((o) => o.id === sel)) {
      setSelection([sel]);
      params.delete('sel');
      setParams(params, { replace: true });
    }
  }, [params, setParams, objectList, setSelection]);

  const selectedObjects = useMemo(
    () => objectList.filter((o) => selection.includes(o.id)),
    [objectList, selection],
  );
  const selectedConnection = connectionList.find((c) => c.id === selectedConnectionId) ?? null;
  const selectedBackground = backgroundList.find((b) => b.id === selectedBackgroundId) ?? null;

  /** Textura efectiva de cada objeto, heredada de su entrada de biblioteca. */
  const textures = useMemo(() => {
    const byCatalog = new Map((catalog.data ?? []).map((c) => [c.id, c]));
    const map = new Map<string, TextureSpec>();
    for (const o of objectList) {
      const c = o.catalog_id ? byCatalog.get(o.catalog_id) : undefined;
      if (!c?.texture_path) continue;
      const url = textureUrls.get(c.texture_path);
      if (!url) continue;
      map.set(o.id, {
        url,
        mode: c.texture_mode,
        scale: Number(c.texture_scale) || 1,
        offsetX: Number(c.texture_offset_x) || 0,
        offsetY: Number(c.texture_offset_y) || 0,
        rotation: Number(c.texture_rotation) || 0,
        // Medidas del objeto de BIBLIOTECA: son las que definen el reparto de
        // caras dentro de la plantilla, aunque la copia del plano se haya
        // redimensionado.
        atlas: {
          length: Number(c.length_m),
          width: Number(c.width_m),
          height: Number(c.height_m),
        },
      });
    }
    return map;
  }, [objectList, catalog.data, textureUrls]);

  // --- Imágenes de fondo ----------------------------------------------------
  const handleBackgroundUploaded = useCallback(
    (path: string, ratio: number) => {
      if (!plan) return;
      // Sin calibrar todavía: la colocamos ocupando el ancho del recinto y
      // respetando la proporción real de la imagen.
      const width = Number(plan.width_m);
      createBackground.mutate(
        {
          plan_id: plan.id,
          storage_path: path,
          label: `Capa ${backgroundList.length + 1}`,
          opacity: 0.6,
          x: 0,
          y: 0,
          width_m: round(width, 3),
          height_m: round(width / Math.max(0.05, ratio), 3),
          z_index: backgroundList.length,
        },
        {
          onSuccess: (b) => {
            setSelectedBackgroundId(b.id);
            setRightTab('background');
          },
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : 'No se ha podido añadir la capa'),
        },
      );
    },
    [plan, backgroundList.length, createBackground],
  );

  const handleBackgroundChange = useCallback(
    (id: string, patch: Partial<typeof backgroundList[number]>) => {
      if (!plan) return;
      updateBackground.mutate({ id, planId: plan.id, patch });
    },
    [plan, updateBackground],
  );

  const applyCalibration = useCallback(
    (result: CalibrationResult) => {
      if (!plan || !selectedBackground) return;
      updateBackground.mutate({
        id: selectedBackground.id,
        planId: plan.id,
        patch: result.background,
      });
      if (result.plan) {
        updatePlan.mutate({ id: plan.id, patch: result.plan });
      }
      setCalibration(null);
      setTool('select');
      toast.success(
        result.plan
          ? `Escala aplicada. El escenario mide ahora ${fmtNum(result.plan.width_m, 2)} × ${fmtNum(result.plan.depth_m, 2)} m.`
          : 'Escala aplicada a la imagen.',
      );
    },
    [plan, selectedBackground, updateBackground, updatePlan, setTool],
  );

  // --- Acciones -------------------------------------------------------------
  const commit = useCallback(
    async (updates: CommitUpdate[], label: string) => {
      try {
        const entry = await ops.updateObjects(updates, label);
        history.push(entry);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se ha podido guardar el cambio');
      }
    },
    [ops, history],
  );

  /** Centro visible del lienzo, en metros. */
  const viewportCenter = useCallback(() => {
    const svg = svgRef.current;
    const { zoom, panX, panY } = usePlanStore.getState();
    if (!svg || !plan) return { x: 2, y: 2 };
    const w = svg.width.baseVal.value || 800;
    const h = svg.height.baseVal.value || 600;
    return {
      x: round((w / 2 - panX) / zoom, 2),
      y: round((h / 2 - panY) / zoom, 2),
    };
  }, [plan]);

  const handleAdd = useCallback(
    async (payload: AddPayload) => {
      if (!plan) return;
      const center = mode === '2d' ? viewportCenter() : { x: Number(plan.width_m) / 2, y: Number(plan.depth_m) / 2 };
      const jitter = (objectList.length % 5) * 0.25;

      const base = {
        plan_id: plan.id,
        x: round(center.x + jitter, 2),
        y: round(center.y + jitter, 2),
        z: 0,
        rotation: 0,
      };

      const row =
        payload.source === 'shape'
          ? { ...base, ...BASIC_SHAPES[payload.shape], kind: 'generic' as const, color: '#94a3b8' }
          : {
              ...base,
              catalog_id: payload.catalog.id || null,
              warehouse_item_id: payload.warehouseItem?.id ?? null,
              label: payload.warehouseItem?.name ?? payload.catalog.name,
              kind: payload.catalog.kind,
              category_id: payload.catalog.category_id,
              length_m: Number(payload.catalog.length_m),
              width_m: Number(payload.catalog.width_m),
              height_m: Number(payload.catalog.height_m),
              weight_kg: Number(payload.catalog.weight_kg),
              color: payload.catalog.color,
              shape: payload.catalog.shape,
              requires_power: payload.catalog.requires_power,
              requires_network: payload.catalog.requires_network,
              power_w: Number(payload.catalog.power_w),
              outlet_count: payload.catalog.outlet_count,
              port_count: payload.catalog.port_count,
            };

      try {
        const { ids, history: entry } = await ops.addObjects([row]);
        history.push(entry);
        setSelection(ids);
        setSelectedConnectionId(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se ha podido añadir el objeto');
      }
    },
    [plan, mode, viewportCenter, objectList.length, ops, history, setSelection],
  );

  const handleDelete = useCallback(async () => {
    if (!selectedObjects.length) return;
    try {
      const entry = await ops.deleteObjects(selectedObjects, connectionList);
      history.push(entry);
      clearSelection();
      setConfirmDelete(false);
      toast.success(selectedObjects.length > 1 ? 'Objetos eliminados' : 'Objeto eliminado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }, [selectedObjects, connectionList, ops, history, clearSelection]);

  const duplicateObjects = useCallback(
    async (source: PlanObject[]) => {
      if (!plan || !source.length) return;
      const rows = source.map((o) => {
        const { id: _id, created_at: _c, updated_at: _u, ...rest } = o;
        return { ...rest, id: uid(), x: Number(o.x) + 0.4, y: Number(o.y) + 0.4 };
      });
      try {
        const { ids, history: entry } = await ops.addObjects(rows);
        history.push(entry);
        setSelection(ids);
        toast.success(rows.length > 1 ? `${rows.length} objetos duplicados` : 'Objeto duplicado');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se ha podido duplicar');
      }
    },
    [plan, ops, history, setSelection],
  );

  const handleLink = useCallback(
    async (fromId: string, toId: string) => {
      if (!plan) return;
      const a = objectList.find((o) => o.id === fromId);
      const b = objectList.find((o) => o.id === toId);
      if (!a || !b) return;

      const kind = tool === 'network' ? 'network' : 'power';
      const exists = connectionList.some(
        (c) =>
          c.kind === kind &&
          ((c.from_object_id === fromId && c.to_object_id === toId) ||
            (c.from_object_id === toId && c.to_object_id === fromId)),
      );
      if (exists) {
        toast.info('Esos dos objetos ya están conectados.');
        return;
      }

      // Longitud estimada: distancia en planta + un 20 % de holgura, redondeado.
      const distance = Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
      const length = Math.max(1, Math.ceil(distance * 1.2));

      try {
        const entry = await ops.addConnection({
          plan_id: plan.id,
          kind,
          from_object_id: fromId,
          to_object_id: toId,
          cable_type: kind === 'power' ? 'Manguera 3G1.5' : 'Cat6 U/UTP',
          length_m: length,
          color: kind === 'power' ? '#f59e0b' : '#22d3ee',
        });
        history.push(entry);
        toast.success(`Cable ${kind === 'power' ? 'eléctrico' : 'de red'} añadido (${length} m)`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se ha podido crear el cable');
      }
    },
    [plan, objectList, connectionList, tool, ops, history],
  );

  const handleDeleteConnection = useCallback(async () => {
    if (!selectedConnection) return;
    try {
      const entry = await ops.deleteConnection(selectedConnection);
      history.push(entry);
      setSelectedConnectionId(null);
      toast.success('Cable eliminado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar el cable');
    }
  }, [selectedConnection, ops, history]);

  const handleUpdateConnection = useCallback(
    async (patch: Partial<PlanConnection>) => {
      if (!selectedConnection) return;
      try {
        const entry = await ops.updateConnection(selectedConnection, patch);
        history.push(entry);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
      }
    },
    [selectedConnection, ops, history],
  );

  // --- Capturas -------------------------------------------------------------
  const takeCapture = useCallback(async () => {
    if (!plan || !eventId) return;
    setCapturing(true);
    try {
      let blob: Blob;
      if (mode === '2d') {
        if (!svgRef.current) throw new Error('El lienzo no está listo.');
        blob = await captureSvg(svgRef.current);
      } else {
        const bridge = glRef.current;
        if (!bridge) throw new Error('La vista 3D no está lista.');
        bridge.render();
        blob = await captureCanvas(bridge.canvas);
      }

      const path = `${eventId}/plano-${mode}-${Date.now()}.png`;
      await uploadBlob(BUCKETS.captures, path, blob);
      await createSnapshot.mutateAsync({
        event_id: eventId,
        plan_id: plan.id,
        kind: mode,
        storage_path: path,
        title: `Captura ${mode.toUpperCase()} · ${new Date().toLocaleString('es-ES')}`,
        created_by: profile?.id ?? null,
      });
      toast.success('Captura guardada en el almacenamiento remoto');
      setCapturesOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido generar la captura');
    } finally {
      setCapturing(false);
    }
  }, [plan, eventId, mode, createSnapshot, profile?.id]);

  // --- Atajos de teclado ----------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;

      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        void history.undo();
        return;
      }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        void history.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        void duplicateObjects(selectedObjects);
        return;
      }
      if (mod && e.key.toLowerCase() === 'c') {
        setClipboard(selectedObjects);
        if (selectedObjects.length) toast.success(`${selectedObjects.length} objeto(s) copiados`);
        return;
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void duplicateObjects(clipboard);
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelection(objectList.map((o) => o.id));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedConnection) {
          e.preventDefault();
          void handleDeleteConnection();
        } else if (selectedObjects.length) {
          e.preventDefault();
          setConfirmDelete(true);
        }
        return;
      }
      if (e.key === 'Escape') {
        clearSelection();
        setSelectedConnectionId(null);
        setLinkFrom(null);
        setTool('select');
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedObjects.length) {
        e.preventDefault();
        const step = e.shiftKey ? 0.05 : Number(plan?.grid_size_m ?? 0.5);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        void commit(
          selectedObjects
            .filter((o) => !o.locked)
            .map((o) => ({
              id: o.id,
              patch: { x: round(Number(o.x) + dx, 3), y: round(Number(o.y) + dy, 3) },
              previous: { x: Number(o.x), y: Number(o.y) },
            })),
          'Mover objeto',
        );
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    history,
    selectedObjects,
    selectedConnection,
    clipboard,
    objectList,
    plan,
    commit,
    duplicateObjects,
    handleDeleteConnection,
    clearSelection,
    setClipboard,
    setSelection,
    setLinkFrom,
    setTool,
  ]);

  if (plans.isLoading || !plan) return <LoadingState label="Cargando plano…" />;

  const budget = powerBudget(objectList);
  const warehouseName = selectedObjects[0]?.warehouse_item_id
    ? items.data?.find((i) => i.id === selectedObjects[0].warehouse_item_id)?.name
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barra de herramientas */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-[color-mix(in_oklab,var(--ef-canvas)_78%,transparent)] px-3 py-2 backdrop-blur-xl">
        <Segmented
          value={mode}
          onChange={setMode}
          size="sm"
          options={[
            { value: '2d', label: '2D' },
            { value: '3d', label: '3D' },
          ]}
        />

        <div className="mx-1 h-6 w-px bg-[var(--ef-line)]" />

        <Segmented
          value={tool}
          onChange={setTool}
          size="sm"
          options={[
            { value: 'select', label: 'Seleccionar', icon: <MousePointer2 className="size-3.5" /> },
            { value: 'power', label: 'Eléctrico', icon: <Zap className="size-3.5" /> },
            { value: 'network', label: 'Red', icon: <Network className="size-3.5" /> },
            { value: 'calibrate', label: 'Calibrar', icon: <Ruler className="size-3.5" /> },
          ]}
        />

        <div className="mx-1 h-6 w-px bg-[var(--ef-line)]" />

        <Toggle active={store.showGrid} onClick={() => store.toggle('showGrid')} label="Rejilla">
          <Grid3x3 className="size-4" />
        </Toggle>
        <Toggle active={snap} onClick={() => store.toggle('snap')} label="Ajuste a rejilla">
          <Magnet className="size-4" />
        </Toggle>
        <Toggle active={store.showLabels} onClick={() => store.toggle('showLabels')} label="Etiquetas">
          <Eye className="size-4" />
        </Toggle>
        <Toggle active={store.showMeasures} onClick={() => store.toggle('showMeasures')} label="Medidas">
          <Ruler className="size-4" />
        </Toggle>
        <Toggle active={store.showPower} onClick={() => store.toggle('showPower')} label="Ver cableado eléctrico">
          <Zap className="size-4" />
        </Toggle>
        <Toggle active={store.showNetwork} onClick={() => store.toggle('showNetwork')} label="Ver red">
          <Cable className="size-4" />
        </Toggle>

        <div className="mx-1 h-6 w-px bg-[var(--ef-line)]" />

        <IconButton
          label="Deshacer (Ctrl+Z)"
          disabled={!history.canUndo}
          onClick={() => void history.undo()}
          icon={<Undo2 className="size-4" />}
        />
        <IconButton
          label="Rehacer (Ctrl+Y)"
          disabled={!history.canRedo}
          onClick={() => void history.redo()}
          icon={<Redo2 className="size-4" />}
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-2 text-[11.5px] text-dim sm:flex">
            <Boxes className="size-3.5" />
            <span className="num">{objectList.length} objetos</span>
            <Cable className="size-3.5" />
            <span className="num">{connectionList.length} cables</span>
            <Zap className="size-3.5" />
            <span className="num">{budget.totalW} W</span>
          </span>

          <Button
            size="sm"
            variant="ghost"
            icon={<Layers className="size-3.5" />}
            onClick={() => setLoadScenarioOpen(true)}
          >
            Escenarios
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Save className="size-3.5" />}
            onClick={() => setSaveScenarioOpen(true)}
            disabled={objectList.length === 0 && backgroundList.length === 0}
          >
            Guardar escenario
          </Button>

          <Button
            size="sm"
            variant="outline"
            icon={<Camera className="size-3.5" />}
            loading={capturing}
            onClick={() => void takeCapture()}
          >
            Captura {mode.toUpperCase()}
          </Button>
          <IconButton
            label="Ver capturas"
            onClick={() => setCapturesOpen(true)}
            icon={<ImageIcon className="size-4" />}
          />
          <IconButton
            label={leftOpen ? 'Ocultar biblioteca' : 'Mostrar biblioteca'}
            className="hidden lg:inline-flex"
            onClick={() => setLeftOpen((v) => !v)}
            icon={<PanelLeftClose className={cn('size-4', !leftOpen && 'rotate-180')} />}
          />
          <IconButton
            label={rightOpen ? 'Ocultar inspector' : 'Mostrar inspector'}
            className="hidden lg:inline-flex"
            onClick={() => setRightOpen((v) => !v)}
            icon={<PanelRightClose className={cn('size-4', !rightOpen && 'rotate-180')} />}
          />
        </div>
      </div>

      {linkFrom ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-[color-mix(in_oklab,var(--ef-cyan)_12%,transparent)] px-3 py-1.5 text-[12.5px] text-ink">
          <Cable className="size-3.5" />
          Selecciona el segundo objeto para completar el cable.
          <button onClick={() => setLinkFrom(null)} className="ml-auto text-accent-soft hover:underline">
            Cancelar
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <div className="hidden w-[248px] shrink-0 border-r border-line bg-[color-mix(in_oklab,var(--ef-canvas)_60%,transparent)] lg:block">
            <ObjectLibrary onAdd={(p) => void handleAdd(p)} />
          </div>
        ) : null}

        <div className="relative min-w-0 flex-1">
          {mode === '2d' ? (
            <Editor2D
              plan={plan}
              objects={objectList}
              connections={connectionList}
              backgrounds={backgroundList}
              backgroundUrls={backgroundUrls}
              selectedBackgroundId={selectedBackgroundId}
              onSelectBackground={(id) => {
                setSelectedBackgroundId(id);
                if (id) setRightTab('background');
              }}
              onBackgroundCommit={handleBackgroundChange}
              onCalibrate={(line) => {
                if (!selectedBackgroundId && backgroundList.length === 1) {
                  setSelectedBackgroundId(backgroundList[0].id);
                }
                setCalibration(line);
              }}
              issuesByObject={issuesByObject}
              selectedConnectionId={selectedConnectionId}
              onSelectConnection={setSelectedConnectionId}
              onCommit={(u, l) => void commit(u, l)}
              onLink={(a, b) => void handleLink(a, b)}
              svgRef={svgRef}
            />
          ) : (
            <Editor3D
              plan={plan}
              objects={objectList}
              connections={connectionList}
              backgrounds={backgroundList}
              backgroundUrls={backgroundUrls}
              textures={textures}
              issuesByObject={issuesByObject}
              onCommit={(u, l) => void commit(u, l)}
              onGlReady={(gl, scene, camera) => {
                glRef.current = { canvas: gl.domElement, render: () => gl.render(scene, camera) };
              }}
            />
          )}

          <IssuesOverlay issues={issues} onSelect={(id) => id && setSelection([id])} />
        </div>

        {rightOpen ? (
          <div className="hidden w-[300px] shrink-0 flex-col border-l border-line bg-[color-mix(in_oklab,var(--ef-canvas)_60%,transparent)] lg:flex">
            <div className="shrink-0 border-b border-line p-2">
              <Segmented
                className="w-full"
                size="sm"
                value={rightTab}
                onChange={setRightTab}
                options={[
                  { value: 'inspector', label: 'Inspector' },
                  {
                    value: 'background',
                    label: `Fondo${backgroundList.length ? ` (${backgroundList.length})` : ''}`,
                  },
                ]}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {rightTab === 'inspector' ? (
                <Inspector
                  plan={plan}
                  selected={selectedObjects}
                  connection={selectedConnection}
                  issues={selectedObjects[0] ? (issuesByObject.get(selectedObjects[0].id) ?? []) : []}
                  warehouseName={warehouseName}
                  onCommit={(u, l) => void commit(u, l)}
                  onCommitConnection={(p) => void handleUpdateConnection(p)}
                  onDelete={() => setConfirmDelete(true)}
                  onDuplicate={() => void duplicateObjects(selectedObjects)}
                  onDeleteConnection={() => void handleDeleteConnection()}
                  onPlanChange={(patch: Partial<Plan>) =>
                    updatePlan.mutate(
                      { id: plan.id, patch },
                      { onError: (e) => toast.error(e instanceof Error ? e.message : 'Error') },
                    )
                  }
                />
              ) : (
                <BackgroundPanel
                  plan={plan}
                  backgrounds={backgroundList}
                  urls={backgroundUrls}
                  selectedId={selectedBackgroundId}
                  onSelect={setSelectedBackgroundId}
                  onChange={handleBackgroundChange}
                  onDelete={(b) =>
                    deleteBackground.mutate(
                      { id: b.id, planId: plan.id, storagePath: b.storage_path },
                      {
                        onSuccess: () => {
                          setSelectedBackgroundId(null);
                          toast.success('Capa eliminada');
                        },
                      },
                    )
                  }
                  onUploaded={handleBackgroundUploaded}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Panel móvil: biblioteca + inspector apilados */}
      <div className="border-t border-line lg:hidden">
        <div className="max-h-[42vh] overflow-y-auto">
          <Inspector
            plan={plan}
            selected={selectedObjects}
            connection={selectedConnection}
            issues={selectedObjects[0] ? (issuesByObject.get(selectedObjects[0].id) ?? []) : []}
            warehouseName={warehouseName}
            onCommit={(u, l) => void commit(u, l)}
            onCommitConnection={(p) => void handleUpdateConnection(p)}
            onDelete={() => setConfirmDelete(true)}
            onDuplicate={() => void duplicateObjects(selectedObjects)}
            onDeleteConnection={() => void handleDeleteConnection()}
            onPlanChange={(patch: Partial<Plan>) => updatePlan.mutate({ id: plan.id, patch })}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
        title="Eliminar objetos"
        message={
          <>
            Se eliminarán {selectedObjects.length} objeto(s) y los cables conectados a ellos. Puedes
            deshacerlo con Ctrl+Z.
          </>
        }
      />

      <CapturesModal
        open={capturesOpen}
        onClose={() => setCapturesOpen(false)}
        eventId={eventId!}
        snapshots={snapshots.data ?? []}
        onDelete={(id) => deleteSnapshot.mutate({ id, eventId: eventId! })}
      />

      <CalibrationModal
        line={calibration}
        background={selectedBackground}
        onClose={() => setCalibration(null)}
        onApply={applyCalibration}
      />

      <SaveScenarioModal
        open={saveScenarioOpen}
        plan={plan}
        objectCount={objectList.length}
        onClose={() => setSaveScenarioOpen(false)}
      />

      <LoadScenarioModal
        open={loadScenarioOpen}
        planId={plan.id}
        hasContent={objectList.length > 0 || backgroundList.length > 0}
        onClose={() => setLoadScenarioOpen(false)}
      />

      {catalog.isError || categories.isError ? (
        <p className="border-t border-line px-3 py-1.5 text-[12px] text-danger">
          No se ha podido cargar la biblioteca de objetos.
        </p>
      ) : null}
    </div>
  );
}

function Toggle({
  children,
  active,
  onClick,
  label,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'grid size-8 place-items-center rounded-lg border transition-colors',
        active
          ? 'border-line-strong bg-surface-2 text-accent-soft'
          : 'border-transparent text-dim hover:bg-surface-2 hover:text-muted',
      )}
    >
      {children}
    </button>
  );
}

function IssuesOverlay({
  issues,
  onSelect,
}: {
  issues: PlanIssue[];
  onSelect: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(true);
  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="absolute right-3 top-3 w-[268px] overflow-hidden rounded-xl border border-line bg-[color-mix(in_oklab,var(--ef-canvas)_88%,transparent)] shadow-xl backdrop-blur-xl">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left"
      >
        <AlertTriangle className={cn('size-4', errors ? 'text-danger' : 'text-warn')} />
        <span className="text-[12.5px] font-medium text-ink">Incidencias</span>
        <Badge color={errors ? '#f87171' : '#fbbf24'} className="ml-auto">
          {issues.length}
        </Badge>
      </button>

      {open ? (
        <div className="max-h-56 divide-y divide-[var(--ef-line)] overflow-y-auto">
          {issues.map((i) => (
            <button
              key={i.id}
              onClick={() => onSelect(i.objectId)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <span
                className={cn(
                  'mt-1 size-1.5 shrink-0 rounded-full',
                  i.severity === 'error' ? 'bg-danger' : 'bg-warn',
                )}
              />
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-ink">{i.title}</span>
                <span className="block truncate text-[11px] text-dim">{i.detail}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CapturesModal({
  open,
  onClose,
  snapshots,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  snapshots: { id: string; storage_path: string; title: string; kind: string; created_at: string }[];
  onDelete: (id: string) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void Promise.all(
      snapshots.map(async (s) => [s.id, await resolveUrl(BUCKETS.captures, s.storage_path)] as const),
    ).then((pairs) => {
      if (!alive) return;
      const map: Record<string, string> = {};
      for (const [id, url] of pairs) if (url) map[id] = url;
      setUrls(map);
    });
    return () => {
      alive = false;
    };
  }, [open, snapshots]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Capturas del plano"
      description="Guardadas en Supabase Storage (bucket privado `captures`)."
      footer={
        <Button variant="primary" onClick={onClose}>
          Cerrar
        </Button>
      }
    >
      {snapshots.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">
          Todavía no hay capturas. Usa el botón «Captura» de la barra de herramientas.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {snapshots.map((s) => (
            <div key={s.id} className="overflow-hidden rounded-xl border border-line">
              {urls[s.id] ? (
                <a href={urls[s.id]} target="_blank" rel="noreferrer">
                  <img src={urls[s.id]} alt={s.title} className="aspect-video w-full object-cover" />
                </a>
              ) : (
                <div className="aspect-video w-full animate-pulse bg-surface-2" />
              )}
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] text-ink">{s.title}</p>
                  <p className="num text-[11px] text-dim">
                    {s.kind.toUpperCase()} · {new Date(s.created_at).toLocaleString('es-ES')}
                  </p>
                </div>
                <button
                  onClick={() => onDelete(s.id)}
                  aria-label="Eliminar captura"
                  className="rounded-md p-1.5 text-dim hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-4 text-[12px] text-dim">
        Total: {fmtNum(snapshots.length, 0)} capturas.
      </p>
    </Modal>
  );
}
