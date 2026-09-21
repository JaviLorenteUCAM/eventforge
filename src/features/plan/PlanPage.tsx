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
  Scaling,
  MoreHorizontal,
  MonitorPlay,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
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
import { useCatalog, useCategories, useItemVariants, useWarehouseItems } from '@/data/warehouse';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { analyzePlan, powerBudget } from '@/lib/issues';
import { BUCKETS, resolveUrl, uploadBlob } from '@/lib/storage';
import { CONNECTION_COLOR, CONNECTION_DEFAULT_CABLE, CONNECTION_LABEL } from '@/lib/types';
import type {
  CatalogObject,
  Plan,
  PlanConnection,
  PlanIssue,
  PlanObject,
  WarehouseItem,
  WarehouseItemVariant,
  Waypoint,
} from '@/lib/types';
import { cableLength, restingZ } from '@/lib/geometry';
import { cn, fmtNum, round, uid } from '@/lib/utils';
import { Editor2D, type CalibrationLine, type CommitUpdate } from './Editor2D';
import { isCableTool, toolKind } from './cables';
import { Editor3D } from './Editor3D';
import { Inspector } from './Inspector';
import { ObjectLibrary, type AddPayload, type BasicShape, type DropPayload } from './ObjectLibrary';
import { BackgroundPanel } from './BackgroundPanel';
import { CalibrationModal, type CalibrationResult } from './CalibrationModal';
import { LoadScenarioModal, SaveScenarioModal } from './ScenarioModals';
import { ObjectTextureFlow } from './ObjectTextureFlow';
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
/**
 * Objetos que no salen del almacén: las figuras sueltas para marcar zonas y
 * los PUNTOS PRINCIPALES de la sala.
 *
 * Los dos puntos no son material que se compre: son la acometida del recinto,
 * de donde salen la corriente y la red. Por eso vienen de serie, se colocan
 * como cualquier otro objeto y se dibujan como un círculo con su símbolo.
 */
const BASIC_SHAPES: Record<
  BasicShape,
  {
    label: string;
    shape: PlanObject['shape'];
    length_m: number;
    width_m: number;
    height_m: number;
    kind?: PlanObject['kind'];
    color?: string;
    outlet_count?: number;
    port_count?: number;
  }
> = {
  box: { label: 'Rectángulo', shape: 'box', length_m: 1.5, width_m: 0.8, height_m: 0.75 },
  square: { label: 'Cuadrado', shape: 'box', length_m: 1, width_m: 1, height_m: 0.75 },
  cylinder: { label: 'Círculo', shape: 'cylinder', length_m: 1, width_m: 1, height_m: 0.75 },
  plane: { label: 'Superficie', shape: 'plane', length_m: 2, width_m: 1, height_m: 0.02 },
  line: { label: 'Línea', shape: 'line', length_m: 2, width_m: 0.05, height_m: 0.02 },
  text: { label: 'Texto', shape: 'text', length_m: 1.2, width_m: 0.35, height_m: 0.01 },
  'power-point': {
    label: 'Punto de luz',
    shape: 'cylinder',
    length_m: 0.4,
    width_m: 0.4,
    height_m: 0.3,
    kind: 'power_source',
    color: '#f59e0b',
    outlet_count: 2,
  },
  'network-point': {
    label: 'Punto de red',
    shape: 'cylinder',
    length_m: 0.4,
    width_m: 0.4,
    height_m: 0.3,
    kind: 'network_source',
    color: '#22d3ee',
    port_count: 1,
  },
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
  const variants = useItemVariants();
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
  const [textureFlowOpen, setTextureFlowOpen] = useState(false);
  /**
   * PANELES EN MÓVIL
   *
   * En pantalla pequeña no caben tres columnas: el plano se quedaba en una
   * franja inutilizable. Aquí el plano ocupa TODO el alto y la biblioteca, el
   * inspector y el resto de opciones se abren como hoja inferior, una cada vez.
   */
  const [sheet, setSheet] = useState<'none' | 'library' | 'inspector' | 'tools'>('none');
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
      ...new Set(
        [...(catalog.data ?? []), ...(items.data ?? []), ...(variants.data ?? [])]
          .map((c) => c.texture_path)
          .filter(Boolean as never),
      ),
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
  }, [catalog.data, items.data, variants.data]);

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

  /**
   * Textura efectiva de cada objeto.
   *
   * Manda el ESTILO con el que se colocó (el photocall de este año, el mantel
   * rojo); si no tiene, se hereda la de su ficha de origen. Las medidas del
   * atlas salen siempre de la ficha, que es para la que se exportó la
   * plantilla.
   */
  const textures = useMemo(() => {
    const byCatalog = new Map((catalog.data ?? []).map((c) => [c.id, c]));
    const byItem = new Map((items.data ?? []).map((i) => [i.id, i]));
    const byVariant = new Map((variants.data ?? []).map((v) => [v.id, v]));
    const map = new Map<string, TextureSpec>();
    for (const o of objectList) {
      const base =
        (o.warehouse_item_id ? byItem.get(o.warehouse_item_id) : undefined) ??
        (o.catalog_id ? byCatalog.get(o.catalog_id) : undefined);
      const variant = o.variant_id ? byVariant.get(o.variant_id) : undefined;
      const c =
        variant?.texture_path && base
          ? { ...base, texture_path: variant.texture_path, texture_mode: variant.texture_mode,
              texture_scale: variant.texture_scale, texture_offset_x: variant.texture_offset_x,
              texture_offset_y: variant.texture_offset_y, texture_rotation: variant.texture_rotation,
              texture_key_color: variant.texture_key_color,
              texture_key_tolerance: variant.texture_key_tolerance }
          : base;
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
        keyColor: c.texture_key_color,
        keyTolerance: Number(c.texture_key_tolerance ?? 0.12),
        // Medidas de la FICHA DE ORIGEN: son las que definen el reparto de
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
  }, [objectList, catalog.data, items.data, variants.data, textureUrls]);

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
    async (payload: AddPayload, at?: Waypoint) => {
      if (!plan) return;
      const center = at
        ? at
        : mode === '2d'
          ? viewportCenter()
          : { x: Number(plan.width_m) / 2, y: Number(plan.depth_m) / 2 };
      // Al soltarlo en un punto concreto no se desplaza; al añadirlo desde la
      // lista sí, para que no se apilen todos en el mismo sitio.
      const jitter = at ? 0 : (objectList.length % 5) * 0.25;
      const x = round(center.x + jitter, 2);
      const y = round(center.y + jitter, 2);

      const base = {
        plan_id: plan.id,
        x,
        y,
        // Si cae encima de una mesa, se apoya en la mesa en vez de atravesarla.
        z: restingZ(objectList, x, y),
        rotation: 0,
      };

      // Un objeto del plano se define igual venga del almacén o de la
      // biblioteca: lo único que cambia es a qué ficha queda enlazado.
      const fromSource = (
        src: WarehouseItem | CatalogObject,
        link: { warehouse_item_id: string | null; catalog_id: string | null; variant_id?: string | null },
        variant?: WarehouseItemVariant | null,
      ) => ({
        ...base,
        ...link,
        label: variant ? `${src.name} · ${variant.name}` : src.name,
        color: variant?.color || src.color,
        kind: src.kind,
        category_id: src.category_id,
        length_m: Number(src.length_m),
        width_m: Number(src.width_m),
        height_m: Number(src.height_m),
        shape: src.shape,
        requires_power: src.requires_power,
        requires_network: src.requires_network,
        requires_signal: src.requires_signal,
        power_w: Number(src.power_w),
        outlet_count: src.outlet_count,
        port_count: src.port_count,
        signal_out_count: src.signal_out_count,
      });

      const row =
        payload.source === 'shape'
          ? {
              ...base,
              kind: 'generic' as PlanObject['kind'],
              color: '#94a3b8',
              // El propio objeto manda: un punto de luz trae su tipo y su color.
              ...BASIC_SHAPES[payload.shape],
            }
          : payload.source === 'warehouse'
            ? fromSource(
                payload.item,
                {
                  warehouse_item_id: payload.item.id,
                  catalog_id: null,
                  variant_id: payload.variant?.id ?? null,
                },
                payload.variant,
              )
            : fromSource(payload.catalog, {
                warehouse_item_id: null,
                catalog_id: payload.catalog.id || null,
              });

      try {
        const { ids, history: entry } = await ops.addObjects([row]);
        history.push(entry);
        setSelection(ids);
        setSelectedConnectionId(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'No se ha podido añadir el objeto');
      }
    },
    [plan, mode, viewportCenter, objectList, ops, history, setSelection],
  );

  /**
   * Suelta de una ficha arrastrada desde el panel. Llega solo el id, así que
   * aquí se vuelve a buscar la ficha: el panel no manda objetos enteros por el
   * portapapeles del navegador.
   */
  const handleDropObject = useCallback(
    (raw: string, at: Waypoint) => {
      let payload: DropPayload;
      try {
        payload = JSON.parse(raw) as DropPayload;
      } catch {
        return;
      }

      if (payload.source === 'shape') {
        void handleAdd({ source: 'shape', shape: payload.shape }, at);
        return;
      }
      if (payload.source === 'catalog') {
        const c = catalog.data?.find((x) => x.id === payload.catalogId);
        if (c) void handleAdd({ source: 'catalog', catalog: c }, at);
        return;
      }
      const item = items.data?.find((i) => i.id === payload.itemId);
      if (!item) return;
      const variant = payload.variantId
        ? (variants.data?.find((v) => v.id === payload.variantId) ?? null)
        : null;
      void handleAdd({ source: 'warehouse', item, variant }, at);
    },
    [handleAdd, catalog.data, items.data, variants.data],
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
    async (fromId: string, toId: string, waypoints: Waypoint[] = []) => {
      if (!plan) return;
      const a = objectList.find((o) => o.id === fromId);
      const b = objectList.find((o) => o.id === toId);
      if (!a || !b) return;

      const kind = toolKind(tool);
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

      // Longitud estimada: el recorrido REAL del cable —el trazo que se ha
      // dibujado, o la recta si no se dibujó ninguno— más el desnivel entre los
      // dos aparatos, y un 20 % de holgura.
      const distance = cableLength(a, b, waypoints);
      const length = Math.max(1, Math.ceil(distance * 1.2));

      try {
        const entry = await ops.addConnection({
          plan_id: plan.id,
          kind,
          from_object_id: fromId,
          to_object_id: toId,
          cable_type: CONNECTION_DEFAULT_CABLE[kind],
          length_m: length,
          color: CONNECTION_COLOR[kind],
          waypoints,
        });
        history.push(entry);
        toast.success(`Cable de ${CONNECTION_LABEL[kind].toLowerCase()} añadido (${length} m)`);
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
  const singleObject = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const sourceItem = singleObject?.warehouse_item_id
    ? (items.data?.find((i) => i.id === singleObject.warehouse_item_id) ?? null)
    : null;
  const sourceCatalog =
    !sourceItem && singleObject?.catalog_id
      ? (catalog.data?.find((c) => c.id === singleObject.catalog_id) ?? null)
      : null;
  const warehouseName = sourceItem?.name;

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
          onChange={(t) => {
            // Medir y calibrar se hacen sobre la planta: si se eligen desde la
            // vista 3D, se cambia a 2D en vez de no hacer nada.
            if ((t === 'measure' || t === 'calibrate') && mode !== '2d') setMode('2d');
            setTool(t);
          }}
          size="sm"
          options={[
            {
              value: 'select',
              title: 'Seleccionar',
              label: <span className="hidden sm:inline">Seleccionar</span>,
              icon: <MousePointer2 className="size-3.5" />,
            },
            {
              value: 'power',
              title: 'Cable eléctrico',
              label: <span className="hidden sm:inline">Eléctrico</span>,
              icon: <Zap className="size-3.5" />,
            },
            {
              value: 'network',
              title: 'Cable de red',
              label: <span className="hidden sm:inline">Red</span>,
              icon: <Network className="size-3.5" />,
            },
            {
              value: 'signal',
              title: 'Cable de señal: HDMI, DisplayPort, USB-C…',
              label: <span className="hidden sm:inline">Señal</span>,
              icon: <MonitorPlay className="size-3.5" />,
            },
            {
              value: 'measure',
              title: 'Regla: mide una distancia',
              label: <span className="hidden sm:inline">Regla</span>,
              icon: <Ruler className="size-3.5" />,
            },
            {
              value: 'calibrate',
              title: 'Calibrar la imagen de fondo',
              label: <span className="hidden sm:inline">Calibrar</span>,
              icon: <Scaling className="size-3.5" />,
            },
          ]}
        />

        <div className="mx-1 hidden h-6 w-px bg-[var(--ef-line)] lg:block" />

        <div className="hidden items-center gap-2 lg:flex">
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
        <Toggle
          active={store.showSignal}
          onClick={() => store.toggle('showSignal')}
          label="Ver cableado de señal"
        >
          <MonitorPlay className="size-4" />
        </Toggle>
        </div>

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

          <div className="hidden items-center gap-2 lg:flex">
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
          </div>

          {/* Móvil: el resto de opciones, en una hoja desplegable. */}
          <IconButton
            label="Más opciones"
            className="lg:hidden"
            onClick={() => setSheet('tools')}
            icon={<MoreHorizontal className="size-4" />}
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

      {/* Qué hace la herramienta activa. Sin esto, el cable a mano y los
          puntos de acometida son invisibles hasta que alguien los descubre. */}
      {linkFrom ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-[color-mix(in_oklab,var(--ef-cyan)_12%,transparent)] px-3 py-1.5 text-[12.5px] text-ink">
          <Cable className="size-3.5" />
          Selecciona el segundo objeto para completar el cable.
          <button onClick={() => setLinkFrom(null)} className="ml-auto text-accent-soft hover:underline">
            Cancelar
          </button>
        </div>
      ) : isCableTool(tool) ? (
        <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-[color-mix(in_oklab,var(--ef-warn)_10%,transparent)] px-3 py-1.5 text-[12.5px] text-muted">
          <Cable className="size-3.5 shrink-0 text-warn" />
          <span className="text-ink">
            Arrastra de un aparato a otro para tirar el cable: pasa por donde lo lleves, no tiene
            que ser recto.
          </span>
          <span className="text-dim">
            {tool === 'signal'
              ? 'La imagen sale de las cámaras y los ordenadores: dales salidas de señal en su ficha.'
              : `¿No hay de dónde tirar? En «Del evento» tienes el punto de ${tool === 'power' ? 'luz' : 'red'}, la acometida de la sala.`}
          </span>
        </div>
      ) : tool === 'measure' ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-[color-mix(in_oklab,var(--ef-accent)_10%,transparent)] px-3 py-1.5 text-[12.5px] text-muted">
          <Ruler className="size-3.5 shrink-0 text-accent-soft" />
          <span className="text-ink">Arrastra para medir.</span>
          <span className="text-dim">Con Mayús la línea se queda recta.</span>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <div className="hidden w-[248px] shrink-0 border-r border-line bg-[color-mix(in_oklab,var(--ef-canvas)_60%,transparent)] lg:block">
            <ObjectLibrary onAdd={(p) => void handleAdd(p)} planObjects={objectList} />
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
              onLink={(a, b, w) => void handleLink(a, b, w)}
              onDropObject={handleDropObject}
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
                  onEditTexture={
                    sourceItem || sourceCatalog ? () => setTextureFlowOpen(true) : undefined
                  }
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

      {/* Móvil: barra inferior. El plano se queda con toda la pantalla. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-[color-mix(in_oklab,var(--ef-canvas)_85%,transparent)] px-3 py-2 backdrop-blur-xl lg:hidden">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 justify-center"
          icon={<Boxes className="size-3.5" />}
          onClick={() => setSheet('library')}
        >
          Objetos
        </Button>
        <Button
          size="sm"
          variant={selectedObjects.length || selectedConnection ? 'primary' : 'outline'}
          className="flex-1 justify-center"
          icon={<SlidersHorizontal className="size-3.5" />}
          onClick={() => {
            setRightTab('inspector');
            setSheet('inspector');
          }}
        >
          {selectedObjects.length > 1
            ? `${selectedObjects.length} objetos`
            : selectedObjects.length === 1
              ? 'Objeto'
              : selectedConnection
                ? 'Cable'
                : 'Plano'}
        </Button>
        <IconButton
          label="Imágenes de fondo"
          onClick={() => {
            setRightTab('background');
            setSheet('inspector');
          }}
          icon={<ImageIcon className="size-4" />}
        />
      </div>

      {/* Hojas inferiores (solo móvil) */}
      <MobileSheet open={sheet === 'library'} title="Añadir un objeto" onClose={() => setSheet('none')}>
        <div className="h-[70vh]">
          <ObjectLibrary
            planObjects={objectList}
            onAdd={(p) => {
              void handleAdd(p);
              // Se cierra para ver dónde ha caído el objeto.
              setSheet('none');
            }}
          />
        </div>
      </MobileSheet>

      <MobileSheet
        open={sheet === 'inspector'}
        title={rightTab === 'background' ? 'Imágenes de fondo' : 'Propiedades'}
        onClose={() => setSheet('none')}
      >
        <div className="border-b border-line p-2">
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
        <div className="max-h-[62vh] overflow-y-auto">
          {rightTab === 'inspector' ? (
            <Inspector
              plan={plan}
              selected={selectedObjects}
              connection={selectedConnection}
              issues={selectedObjects[0] ? (issuesByObject.get(selectedObjects[0].id) ?? []) : []}
              warehouseName={warehouseName}
              onEditTexture={
                sourceItem || sourceCatalog
                  ? () => {
                      setSheet('none');
                      setTextureFlowOpen(true);
                    }
                  : undefined
              }
              onCommit={(u, l) => void commit(u, l)}
              onCommitConnection={(p) => void handleUpdateConnection(p)}
              onDelete={() => {
                setSheet('none');
                setConfirmDelete(true);
              }}
              onDuplicate={() => void duplicateObjects(selectedObjects)}
              onDeleteConnection={() => void handleDeleteConnection()}
              onPlanChange={(patch: Partial<Plan>) => updatePlan.mutate({ id: plan.id, patch })}
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
      </MobileSheet>

      <MobileSheet open={sheet === 'tools'} title="Vista y herramientas" onClose={() => setSheet('none')}>
        <div className="space-y-4 p-4">
          <div>
            <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">
              Qué se ve en el plano
            </p>
            <div className="flex flex-wrap gap-2">
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
              <Toggle active={store.showPower} onClick={() => store.toggle('showPower')} label="Cableado eléctrico">
                <Zap className="size-4" />
              </Toggle>
              <Toggle active={store.showNetwork} onClick={() => store.toggle('showNetwork')} label="Red">
                <Cable className="size-4" />
              </Toggle>
              <Toggle active={store.showSignal} onClick={() => store.toggle('showSignal')} label="Señal">
                <MonitorPlay className="size-4" />
              </Toggle>
            </div>
          </div>

          <div className="grid gap-2">
            <Button
              variant="outline"
              icon={<Camera className="size-4" />}
              loading={capturing}
              onClick={() => {
                setSheet('none');
                void takeCapture();
              }}
            >
              Guardar captura {mode.toUpperCase()}
            </Button>
            <Button
              variant="ghost"
              icon={<ImageIcon className="size-4" />}
              onClick={() => {
                setSheet('none');
                setCapturesOpen(true);
              }}
            >
              Ver capturas
            </Button>
            <Button
              variant="ghost"
              icon={<Layers className="size-4" />}
              onClick={() => {
                setSheet('none');
                setLoadScenarioOpen(true);
              }}
            >
              Cargar un escenario
            </Button>
            <Button
              variant="ghost"
              icon={<Save className="size-4" />}
              disabled={objectList.length === 0 && backgroundList.length === 0}
              onClick={() => {
                setSheet('none');
                setSaveScenarioOpen(true);
              }}
            >
              Guardar como escenario
            </Button>
          </div>

          <p className="text-[12px] leading-relaxed text-dim">
            En el plano: un dedo para desplazarlo, dos para acercar y alejar. Toca un objeto para
            seleccionarlo y abre «Propiedades» para ajustarlo.
          </p>
        </div>
      </MobileSheet>

      {singleObject && (sourceItem || sourceCatalog) ? (
        <ObjectTextureFlow
          open={textureFlowOpen}
          object={singleObject}
          item={sourceItem}
          catalogObject={sourceCatalog}
          onClose={() => setTextureFlowOpen(false)}
          onRelink={(link) =>
            void commit(
              [
                {
                  id: singleObject.id,
                  patch: link,
                  previous: {
                    warehouse_item_id: singleObject.warehouse_item_id,
                    catalog_id: singleObject.catalog_id,
                  },
                },
              ],
              'Cambiar el origen del objeto',
            )
          }
        />
      ) : null}

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

/**
 * Hoja inferior para móvil.
 *
 * Se usa en lugar de las columnas laterales, que en pantalla pequeña dejaban
 * el plano reducido a una franja. Sube desde abajo, tapa como mucho el 85 % de
 * la pantalla y se cierra tocando fuera, con la X o con Escape.
 */
function MobileSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col justify-end lg:hidden">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
            className="relative max-h-[85vh] overflow-hidden rounded-t-2xl border-t border-line bg-[var(--ef-surface-solid)] shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="text-[13.5px] font-semibold text-ink">{title}</span>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="ml-auto rounded-lg p-1.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="min-h-0 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
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
