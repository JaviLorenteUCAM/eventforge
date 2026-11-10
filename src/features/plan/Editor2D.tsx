import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONNECTION_COLOR } from '@/lib/types';
import { dashFor, isCableTool, isFeed, toolKind } from './cables';
import type {
  Plan,
  PlanBackground,
  PlanZone,
  PlanConnection,
  PlanIssue,
  PlanObject,
  Waypoint,
} from '@/lib/types';
import {
  cablePath,
  centroidOf,
  footprintOf,
  objectAt,
  pathD,
  polygonArea,
  polygonCentroid,
  restingZ,
  rotateAround,
  simplifyPath,
} from '@/lib/geometry';
import { clamp, fmtNum, round, snap as snapTo } from '@/lib/utils';
import { usePlanStore, ZOOM_MAX, ZOOM_MIN } from './planStore';
import {
  aroundCentre,
  footprintCentre,
  modelToPlan,
  placementOf,
  placementTransform,
  useFootprint,
  type Footprint,
  type ModelPlacement,
} from './modelFootprint';

/**
 * EDITOR 2D (vista cenital)
 *
 * Sistema de coordenadas: METROS reales.
 *   x -> izquierda a derecha
 *   y -> arriba a abajo
 *   (x, y) es el CENTRO del objeto; `rotation` gira alrededor de ese centro.
 *
 * El SVG dibuja directamente en metros dentro de un <g> con
 * transform="translate(pan) scale(zoom)", de modo que 1 unidad = 1 metro.
 * Los trazos usan vector-effect="non-scaling-stroke" y los textos
 * fontSize = px / zoom, para que el grosor y el tamaño de letra sean
 * constantes en pantalla a cualquier nivel de zoom.
 */

export interface CommitUpdate {
  id: string;
  patch: Partial<PlanObject>;
  previous: Partial<PlanObject>;
}

export interface CalibrationLine {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Longitud del trazo en las unidades ACTUALES del plano (metros «sin calibrar»). */
  measured: number;
}

interface Props {
  plan: Plan;
  objects: PlanObject[];
  connections: PlanConnection[];
  backgrounds: PlanBackground[];
  /** Rutas de Storage ya resueltas a URL firmada. */
  backgroundUrls: Map<string, string>;
  /** Modelo 3D del recinto de cada capa que lo tenga (para dibujar su planta). */
  backgroundModelUrls: Map<string, string>;
  selectedBackgroundId: string | null;
  onSelectBackground: (id: string | null) => void;
  onBackgroundCommit: (id: string, patch: Partial<PlanBackground>) => void;
  /** Se dispara al soltar el trazo de calibración. */
  onCalibrate: (line: CalibrationLine) => void;
  zones: PlanZone[];
  selectedZoneId: string | null;
  onSelectZone: (id: string | null) => void;
  /** Al cerrar una zona nueva (tres pines o más). */
  onCreateZone: (points: Waypoint[]) => void;
  /** Al soltar un pin o la zona entera tras moverla. */
  onZoneCommit: (id: string, points: Waypoint[]) => void;
  issuesByObject: Map<string, PlanIssue[]>;
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
  onCommit: (updates: CommitUpdate[], label: string) => void;
  /** Crea un cable. `waypoints` viene vacío cuando el trazo es recto. */
  onLink: (fromId: string, toId: string, waypoints: Waypoint[]) => void;
  /** Suelta de un objeto arrastrado desde el panel del almacén. */
  onDropObject: (payload: string, at: Waypoint) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

type DragState =
  | { kind: 'move'; ids: string[]; startX: number; startY: number; dx: number; dy: number }
  | { kind: 'resize'; id: string; startX: number; startY: number; length: number; width: number }
  /**
   * Giro de la selección. Funciona igual con uno que con veinte objetos: cada
   * uno gira sobre sí mismo Y alrededor del centro del grupo, que para un solo
   * objeto es su propio centro.
   */
  | { kind: 'rotate'; ids: string[]; cx: number; cy: number; start: number; delta: number }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number }
  | { kind: 'bg-move'; id: string; startX: number; startY: number; dx: number; dy: number }
  | {
      kind: 'bg-resize';
      id: string;
      startX: number;
      startY: number;
      width: number;
      height: number;
      ratio: number;
    }
  /**
   * Colocar el modelo del recinto sobre su foto: moverlo, girarlo o escalarlo.
   * Giro y escala van alrededor del centro de su planta (`pivot`), así que no
   * sale disparado; `patch` es lo que se guardará al soltar.
   */
  | {
      kind: 'model';
      id: string;
      mode: 'move' | 'rotate' | 'scale';
      base: ModelPlacement;
      fp: Footprint;
      pivot: Waypoint;
      startX: number;
      startY: number;
      /** Ángulo (giro) o distancia al centro (escala) al empezar. */
      start: number;
      patch: ModelPatch;
    }
  /** Un pin de una zona, o la zona entera agarrada por su rótulo. */
  | { kind: 'zone-pin'; id: string; index: number; points: Waypoint[] }
  | { kind: 'zone-move'; id: string; startX: number; startY: number; dx: number; dy: number }
  | { kind: 'calibrate'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'measure'; x0: number; y0: number; x1: number; y1: number }
  /** Cable dibujándose a mano: se van acumulando los puntos del trazo. */
  | { kind: 'cable'; fromId: string; points: Waypoint[]; overId: string | null }
  | null;

/**
 * Formato del portapapeles de arrastre entre el panel de objetos y el plano.
 * Se usa un tipo propio para que soltar cualquier otra cosa (una imagen, un
 * texto) no acabe creando un objeto por accidente.
 */
export const DROP_TYPE = 'application/x-eventforge-object';

/** Trazo de la regla que se queda en pantalla tras soltar. */
interface Measurement {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function Editor2D({
  plan,
  objects,
  connections,
  backgrounds,
  backgroundUrls,
  backgroundModelUrls,
  selectedBackgroundId,
  onSelectBackground,
  onBackgroundCommit,
  onCalibrate,
  zones,
  selectedZoneId,
  onSelectZone,
  onCreateZone,
  onZoneCommit,
  issuesByObject,
  selectedConnectionId,
  onSelectConnection,
  onCommit,
  onLink,
  onDropObject,
  svgRef,
}: Props) {
  const {
    zoom,
    panX,
    panY,
    setView,
    zoomBy,
    selection,
    setSelection,
    toggleInSelection,
    clearSelection,
    tool,
    linkFrom,
    setLinkFrom,
    showGrid,
    showLabels,
    showPower,
    showNetwork,
    showSignal,
    showUsb,
    showMeasures,
    showEnvironment,
    snap,
    bgEdit,
  } = usePlanStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [dropAt, setDropAt] = useState<Waypoint | null>(null);

  /**
   * GESTOS TÁCTILES
   *
   * En móvil no hay rueda, ni barra espaciadora, ni botón central, así que el
   * plano se quedaba sin zoom ni desplazamiento. Se resuelve con dos gestos:
   *
   *   · un dedo sobre el fondo  -> desplazar el plano (en ratón sigue siendo
   *     selección por marco, que en pantalla táctil apenas se usa);
   *   · dos dedos              -> pellizcar para hacer zoom y arrastrar a la vez.
   *
   * Se lleva la cuenta de los punteros activos porque el pellizco puede empezar
   * encima de un objeto: al aparecer el segundo dedo se cancela el arrastre.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{
    dist: number;
    cx: number;
    cy: number;
    zoom: number;
    panX: number;
    panY: number;
  } | null>(null);

  const pinchState = useCallback(() => {
    const pts = [...pointers.current.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
    };
  }, []);

  /** Registra el dedo y, si ya hay dos, arranca el pellizco. */
  const trackDown = useCallback(
    (e: React.PointerEvent): boolean => {
      if (e.pointerType !== 'touch') return false;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.current.size < 2) return false;
      const st = pinchState();
      if (st) {
        pinch.current = { ...st, zoom, panX, panY };
        setDrag(null);
      }
      return true;
    },
    [pinchState, zoom, panX, panY],
  );

  // La regla se borra al cambiar de herramienta.
  useEffect(() => {
    if (tool !== 'measure') setMeasurement(null);
  }, [tool]);

  const grid = Number(plan.grid_size_m) || 0.5;
  const objectById = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);

  // Tamaño real del lienzo -------------------------------------------------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Barra espaciadora = panear ---------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest('input, textarea')) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return { x: (clientX - rect.left - panX) / zoom, y: (clientY - rect.top - panY) / zoom };
    },
    [panX, panY, zoom],
  );

  // --- Zoom con rueda, centrado en el cursor -------------------------------
  function handleWheel(e: React.WheelEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView({
      zoom: newZoom,
      panX: mx - ((mx - panX) * newZoom) / zoom,
      panY: my - ((my - panY) * newZoom) / zoom,
    });
  }

  // --- Interacción sobre un objeto -----------------------------------------
  function handleObjectPointerDown(e: React.PointerEvent, obj: PlanObject) {
    // La regla y la calibración se trazan POR ENCIMA de los objetos: si se
    // tragaran el clic, en un plano lleno no habría dónde empezar a medir.
    if (tool === 'measure' || tool === 'calibrate' || tool === 'zone') return;

    e.stopPropagation();
    if (trackDown(e)) return;
    if (spaceDown || e.button === 1) return;

    // Cableado: se arrastra desde el aparato de origen hasta el de destino, y
    // el cable sigue el camino que dibuje la mano.
    if (isCableTool(tool)) {
      if (e.button !== 0) return;
      setLinkFrom(obj.id);
      onSelectConnection(null);
      setDrag({
        kind: 'cable',
        fromId: obj.id,
        points: [{ x: Number(obj.x), y: Number(obj.y) }],
        overId: null,
      });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }

    onSelectConnection(null);
    const alreadySelected = selection.includes(obj.id);

    if (e.shiftKey) {
      toggleInSelection(obj.id);
      return;
    }
    if (!alreadySelected) setSelection([obj.id]);

    if (obj.locked) return;

    const ids = alreadySelected && selection.length > 1 ? selection : [obj.id];
    const start = toWorld(e.clientX, e.clientY);
    setDrag({ kind: 'move', ids, startX: start.x, startY: start.y, dx: 0, dy: 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function handleCanvasPointerDown(e: React.PointerEvent) {
    if (trackDown(e)) return;
    if (spaceDown || e.button === 1) {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX, panY });
      return;
    }
    if (e.button !== 0) return;

    // Calibrar: se traza una línea sobre un elemento del que se conoce la medida.
    if (tool === 'calibrate') {
      const p = toWorld(e.clientX, e.clientY);
      setDrag({ kind: 'calibrate', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }

    // Zona: un clic por pin, tantos como haga falta. Se cierra pulsando el
    // primer pin, con doble clic (el segundo clic cae sobre el último pin) o
    // con Intro; hacen falta al menos tres.
    if (tool === 'zone') {
      const p = zonePoint(e);
      const near = 10 / zoom;
      const first = zoneDraft[0];
      const last = zoneDraft[zoneDraft.length - 1];
      const onFirst = first && Math.hypot(p.x - first.x, p.y - first.y) <= near;
      const onLast = last && Math.hypot(p.x - last.x, p.y - last.y) <= near * 0.6;
      if (zoneDraft.length >= 3 && (onFirst || onLast)) {
        finishZone();
        return;
      }
      if (onLast) return;
      setZoneDraft([...zoneDraft, p]);
      return;
    }

    // Regla: mide una distancia cualquiera sobre el plano.
    if (tool === 'measure') {
      const p = toWorld(e.clientX, e.clientY);
      setMeasurement(null);
      setDrag({ kind: 'measure', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }

    // Un clic en el vacío con una herramienta de cable cancela el cable a
    // medio hacer y no hace nada más.
    if (isCableTool(tool)) {
      setLinkFrom(null);
      return;
    }
    onSelectConnection(null);
    onSelectZone(null);
    if (!e.shiftKey) clearSelection();
    if (bgEdit) {
      onSelectBackground(null);
      return;
    }
    if (e.pointerType === 'touch') {
      setDrag({ kind: 'pan', startX: e.clientX, startY: e.clientY, panX, panY });
      return;
    }

    const p = toWorld(e.clientX, e.clientY);
    setDrag({ kind: 'marquee', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (e.pointerType === 'touch' && pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pinch.current) {
      const st = pinchState();
      if (!st) return;
      const start = pinch.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const newZoom = clamp((start.zoom * st.dist) / start.dist, ZOOM_MIN, ZOOM_MAX);
      // El punto del plano que había bajo el centro del pellizco se queda ahí.
      const mx = start.cx - rect.left;
      const my = start.cy - rect.top;
      setView({
        zoom: newZoom,
        panX: st.cx - rect.left - ((mx - start.panX) * newZoom) / start.zoom,
        panY: st.cy - rect.top - ((my - start.panY) * newZoom) / start.zoom,
      });
      return;
    }

    if (tool === 'zone' && zoneDraft.length) setZoneHover(zonePoint(e));

    if (!drag) return;

    if (drag.kind === 'zone-pin') {
      const p = zonePoint(e);
      const points = drag.points.map((q, i) => (i === drag.index ? p : q));
      setDrag({ ...drag, points });
      return;
    }
    if (drag.kind === 'zone-move') {
      const p = toWorld(e.clientX, e.clientY);
      setDrag({ ...drag, dx: p.x - drag.startX, dy: p.y - drag.startY });
      return;
    }

    if (drag.kind === 'cable') {
      const p = toWorld(e.clientX, e.clientY);
      const last = drag.points[drag.points.length - 1];
      // Un punto cada pocos centímetros: guardar todos los eventos del ratón
      // llenaría la fila de ruido sin cambiar el dibujo.
      const step = Math.max(0.05, 6 / zoom);
      const over = objectAt(objects, p.x, p.y, { ignore: new Set([drag.fromId]) });
      if (Math.hypot(p.x - last.x, p.y - last.y) >= step) {
        setDrag({ ...drag, points: [...drag.points, p], overId: over?.id ?? null });
      } else if ((over?.id ?? null) !== drag.overId) {
        setDrag({ ...drag, overId: over?.id ?? null });
      }
      return;
    }

    if (drag.kind === 'model') {
      const p = toWorld(e.clientX, e.clientY);
      const { base, fp, pivot } = drag;
      let patch: ModelPatch;
      if (drag.mode === 'move') {
        patch = {
          model_offset_x: round(base.offsetX + p.x - drag.startX, 3),
          model_offset_y: round(base.offsetY + p.y - drag.startY, 3),
          model_rotation: base.extraRotation,
          model_scale: base.scale,
        };
      } else if (drag.mode === 'rotate') {
        // Libre, para afinar; con Mayús, a saltos de 5°.
        let delta = (Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180) / Math.PI - drag.start;
        if (e.shiftKey) delta = Math.round(delta / 5) * 5;
        patch = aroundCentre(base, fp, base.extraRotation + delta, base.scale);
      } else {
        const dist = Math.max(0.01, Math.hypot(p.x - pivot.x, p.y - pivot.y));
        patch = aroundCentre(base, fp, base.extraRotation, clamp((base.scale * dist) / drag.start, 0.05, 20));
      }
      setDrag({ ...drag, patch });
      return;
    }

    if (drag.kind === 'pan') {
      setView({
        panX: drag.panX + (e.clientX - drag.startX),
        panY: drag.panY + (e.clientY - drag.startY),
      });
      return;
    }

    const p = toWorld(e.clientX, e.clientY);

    if (drag.kind === 'move') {
      let dx = p.x - drag.startX;
      let dy = p.y - drag.startY;
      // Mayús invierte el ajuste: con el imán apagado ajusta, y con el imán
      // encendido libera. Así se puede afinar sin ir a la barra.
      if (snap !== e.shiftKey) {
        const first = objectById.get(drag.ids[0]);
        if (first) {
          dx = snapTo(Number(first.x) + dx, grid) - Number(first.x);
          dy = snapTo(Number(first.y) + dy, grid) - Number(first.y);
        }
      } else {
        // Sin ajuste se guarda al milímetro, que es la precisión de la base de
        // datos: sin esto quedaban posiciones con quince decimales.
        dx = round(dx, 3);
        dy = round(dy, 3);
      }
      setDrag({ ...drag, dx, dy });
      return;
    }

    if (drag.kind === 'marquee') {
      setDrag({ ...drag, x1: p.x, y1: p.y });
      return;
    }

    if (drag.kind === 'resize') {
      const obj = objectById.get(drag.id);
      if (!obj) return;
      const rad = (-Number(obj.rotation) * Math.PI) / 180;
      const dxw = p.x - drag.startX;
      const dyw = p.y - drag.startY;
      // Llevamos el desplazamiento al espacio local del objeto.
      const dl = dxw * Math.cos(rad) - dyw * Math.sin(rad);
      const dw = dxw * Math.sin(rad) + dyw * Math.cos(rad);
      let length = Math.max(0.05, drag.length + dl * 2);
      let width = Math.max(0.05, drag.width + dw * 2);
      if (snap !== e.shiftKey) {
        length = Math.max(0.05, snapTo(length, grid / 2));
        width = Math.max(0.05, snapTo(width, grid / 2));
      }
      setDrag({ ...drag, length, width });
      return;
    }

    if (drag.kind === 'rotate') {
      const angle = (Math.atan2(p.y - drag.cy, p.x - drag.cx) * 180) / Math.PI;
      // A saltos de 15°, que es como se alinea todo en una sala. Mayús libera.
      const raw = angle - drag.start;
      setDrag({ ...drag, delta: e.shiftKey ? raw : Math.round(raw / 15) * 15 });
      return;
    }

    if (drag.kind === 'bg-move') {
      setDrag({ ...drag, dx: p.x - drag.startX, dy: p.y - drag.startY });
      return;
    }

    if (drag.kind === 'bg-resize') {
      // La imagen mantiene su proporción: solo cambia la escala.
      const width = Math.max(0.2, drag.width + (p.x - drag.startX));
      setDrag({ ...drag, width, height: Math.max(0.2, width / drag.ratio) });
      return;
    }

    if (drag.kind === 'calibrate' || drag.kind === 'measure') {
      // Con Mayús, el trazo se fuerza a horizontal o vertical.
      let x1 = p.x;
      let y1 = p.y;
      if (e.shiftKey) {
        if (Math.abs(p.x - drag.x0) > Math.abs(p.y - drag.y0)) y1 = drag.y0;
        else x1 = drag.x0;
      }
      setDrag({ ...drag, x1, y1 });
    }
  }

  function handlePointerUp(e?: React.PointerEvent) {
    if (e && e.pointerType === 'touch') {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      // Al levantar un dedo de un pellizco no hay nada que confirmar.
      if (pointers.current.size >= 1 && !drag) return;
    }
    if (!drag) return;

    if (drag.kind === 'move' && (drag.dx !== 0 || drag.dy !== 0)) {
      const updates: CommitUpdate[] = [];
      const moving = new Set(drag.ids);
      for (const id of drag.ids) {
        const o = objectById.get(id);
        if (!o || o.locked) continue;
        const x = Number(o.x) + drag.dx;
        const y = Number(o.y) + drag.dy;

        const patch: Partial<PlanObject> = { x: round(x, 3), y: round(y, 3) };
        const previous: Partial<PlanObject> = { x: Number(o.x), y: Number(o.y) };

        // Si el objeto estaba APOYADO (en el suelo o encima de algo), se sigue
        // apoyando en su nuevo sitio: soltarlo sobre una mesa lo sube a la mesa.
        // Si tenía una altura puesta a mano —un foco colgado a 2 m— no se toca.
        const wasResting = restingZ(objects, Number(o.x), Number(o.y), moving);
        if (Math.abs(Number(o.z) - wasResting) < 0.01) {
          const nowResting = restingZ(objects, x, y, moving);
          if (Math.abs(nowResting - Number(o.z)) > 0.001) {
            patch.z = nowResting;
            previous.z = Number(o.z);
          }
        }

        updates.push({ id, patch, previous });
      }
      if (updates.length) {
        onCommit(updates, updates.length > 1 ? `Mover ${updates.length} objetos` : 'Mover objeto');
      }
    }

    // ------------------------------------------------------------ cables --
    if (drag.kind === 'cable') {
      const from = objectById.get(drag.fromId);
      const last = drag.points[drag.points.length - 1];
      const target = from ? objectAt(objects, last.x, last.y, { ignore: new Set([drag.fromId]) }) : null;
      const drawn = drag.points.length > 1;

      if (from && target) {
        // El primer punto es el centro del objeto de origen y el último cae
        // dentro del de destino: ninguno de los dos hace falta guardarlo,
        // porque los extremos se recalculan a partir de los propios objetos.
        const middle = simplifyPath(drag.points.slice(1, -1));
        onLink(drag.fromId, target.id, middle);
        setLinkFrom(null);
      } else if (!drawn) {
        // Ha sido un clic seco: se queda a la espera del segundo aparato, que
        // es como funcionaba el cableado antes de poder dibujarlo.
        setLinkFrom(drag.fromId);
      } else {
        setLinkFrom(null);
      }
      setDrag(null);
      return;
    }



    if (drag.kind === 'resize') {
      const o = objectById.get(drag.id);
      if (o) {
        onCommit(
          [
            {
              id: drag.id,
              patch: { length_m: drag.length, width_m: drag.width },
              previous: { length_m: Number(o.length_m), width_m: Number(o.width_m) },
            },
          ],
          'Redimensionar objeto',
        );
      }
    }

    if (drag.kind === 'rotate' && drag.delta !== 0) {
      const updates: CommitUpdate[] = [];
      for (const id of drag.ids) {
        const o = objectById.get(id);
        if (!o || o.locked) continue;
        const p2 = rotateAround(
          { x: Number(o.x), y: Number(o.y) },
          { x: drag.cx, y: drag.cy },
          drag.delta,
        );
        updates.push({
          id,
          patch: {
            x: p2.x,
            y: p2.y,
            rotation: (((Number(o.rotation) + drag.delta) % 360) + 360) % 360,
          },
          previous: { x: Number(o.x), y: Number(o.y), rotation: Number(o.rotation) },
        });
      }
      if (updates.length) {
        onCommit(
          updates,
          updates.length > 1 ? `Rotar ${updates.length} objetos` : 'Rotar objeto',
        );
      }
    }

    if (drag.kind === 'bg-move' && (drag.dx !== 0 || drag.dy !== 0)) {
      const bg = backgrounds.find((b) => b.id === drag.id);
      if (bg) {
        onBackgroundCommit(drag.id, {
          x: round(Number(bg.x) + drag.dx, 3),
          y: round(Number(bg.y) + drag.dy, 3),
        });
      }
    }

    if (drag.kind === 'model') {
      onBackgroundCommit(drag.id, drag.patch);
    }

    if (drag.kind === 'zone-pin') {
      const z = zones.find((q) => q.id === drag.id);
      const before = JSON.stringify((z?.points ?? []).map((p) => [Number(p.x), Number(p.y)]));
      const after = JSON.stringify(drag.points.map((p) => [p.x, p.y]));
      if (before !== after) onZoneCommit(drag.id, drag.points);
    }
    if (drag.kind === 'zone-move' && (drag.dx !== 0 || drag.dy !== 0)) {
      const z = zones.find((q) => q.id === drag.id);
      if (z) {
        onZoneCommit(
          z.id,
          z.points.map((p) => ({ x: round(Number(p.x) + drag.dx, 3), y: round(Number(p.y) + drag.dy, 3) })),
        );
      }
    }

    if (drag.kind === 'bg-resize') {
      onBackgroundCommit(drag.id, {
        width_m: round(drag.width, 3),
        height_m: round(drag.height, 3),
      });
    }

    if (drag.kind === 'calibrate') {
      const measured = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0);
      if (measured > 0.01) {
        onCalibrate({ x0: drag.x0, y0: drag.y0, x1: drag.x1, y1: drag.y1, measured });
      }
    }

    if (drag.kind === 'measure') {
      const d = Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0);
      setMeasurement(d > 0.01 ? { x0: drag.x0, y0: drag.y0, x1: drag.x1, y1: drag.y1 } : null);
    }

    if (drag.kind === 'marquee') {
      const minX = Math.min(drag.x0, drag.x1);
      const maxX = Math.max(drag.x0, drag.x1);
      const minY = Math.min(drag.y0, drag.y1);
      const maxY = Math.max(drag.y0, drag.y1);
      if (maxX - minX > 0.05 || maxY - minY > 0.05) {
        const hit = objects
          .filter((o) => {
            const x = Number(o.x);
            const y = Number(o.y);
            return x >= minX && x <= maxX && y >= minY && y <= maxY;
          })
          .map((o) => o.id);
        setSelection(hit);
      }
    }

    setDrag(null);
  }

  // Posición efectiva durante el arrastre (sin escribir en la base de datos).
  const liveObject = useCallback(
    (o: PlanObject): PlanObject => {
      if (!drag) return o;
      if (drag.kind === 'move' && drag.ids.includes(o.id)) {
        return { ...o, x: Number(o.x) + drag.dx, y: Number(o.y) + drag.dy };
      }
      if (drag.kind === 'resize' && drag.id === o.id) {
        return { ...o, length_m: drag.length, width_m: drag.width };
      }
      if (drag.kind === 'rotate' && drag.ids.includes(o.id)) {
        const p = rotateAround(
          { x: Number(o.x), y: Number(o.y) },
          { x: drag.cx, y: drag.cy },
          drag.delta,
        );
        return {
          ...o,
          x: p.x,
          y: p.y,
          rotation: (((Number(o.rotation) + drag.delta) % 360) + 360) % 360,
        };
      }
      return o;
    },
    [drag],
  );

  // --- Zonas -----------------------------------------------------------------
  const [zoneDraft, setZoneDraft] = useState<Waypoint[]>([]);
  const [zoneHover, setZoneHover] = useState<Waypoint | null>(null);
  // Al cambiar de herramienta, la zona a medio marcar se descarta.
  const [draftTool, setDraftTool] = useState(tool);
  if (draftTool !== tool) {
    setDraftTool(tool);
    if (zoneDraft.length) setZoneDraft([]);
    if (zoneHover) setZoneHover(null);
  }

  function finishZone() {
    if (zoneDraft.length >= 3) onCreateZone(zoneDraft);
    setZoneDraft([]);
    setZoneHover(null);
  }

  // Intro cierra la zona y Retroceso quita el último pin. Se escucha antes que
  // los atajos de la página: Retroceso no debe borrar lo que esté seleccionado.
  const finishRef = useRef(finishZone);
  finishRef.current = finishZone;
  useEffect(() => {
    if (tool !== 'zone' || zoneDraft.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        finishRef.current();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setZoneDraft((d) => d.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [tool, zoneDraft.length]);

  /** Punto para un pin, con el ajuste a la rejilla si toca (Mayús lo invierte). */
  function zonePoint(e: React.PointerEvent): Waypoint {
    const p = toWorld(e.clientX, e.clientY);
    return snap !== e.shiftKey
      ? { x: snapTo(p.x, grid), y: snapTo(p.y, grid) }
      : { x: round(p.x, 3), y: round(p.y, 3) };
  }

  /** Vértices de una zona, con el arrastre en curso aplicado. */
  function liveZonePoints(z: PlanZone): Waypoint[] {
    if (drag?.kind === 'zone-pin' && drag.id === z.id) return drag.points;
    const pts = (z.points ?? []).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
    if (drag?.kind === 'zone-move' && drag.id === z.id) {
      return pts.map((p) => ({ x: p.x + drag.dx, y: p.y + drag.dy }));
    }
    return pts;
  }

  /** La capa con el ajuste del modelo que se está arrastrando, si es ella. */
  const liveModelBackground = (b: PlanBackground): PlanBackground =>
    drag?.kind === 'model' && drag.id === b.id ? { ...b, ...drag.patch } : b;

  /** Capa seleccionada cuyo modelo se puede colocar ahora. */
  const editableModel =
    backgrounds.find(
      (b) =>
        b.id === selectedBackgroundId &&
        b.visible &&
        !b.locked &&
        backgroundModelUrls.has(b.id),
    ) ?? null;

  function startModelDrag(
    b: PlanBackground,
    mode: 'move' | 'rotate' | 'scale',
    e: React.PointerEvent,
    fp: Footprint,
  ) {
    e.stopPropagation();
    const base = placementOf(b);
    const c = footprintCentre(fp);
    const pivot = modelToPlan(base, fp, c.x, c.z);
    const p = toWorld(e.clientX, e.clientY);
    const start =
      mode === 'rotate'
        ? (Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180) / Math.PI
        : mode === 'scale'
          ? Math.max(0.01, Math.hypot(p.x - pivot.x, p.y - pivot.y))
          : 0;
    setDrag({
      kind: 'model',
      id: b.id,
      mode,
      base,
      fp,
      pivot,
      startX: p.x,
      startY: p.y,
      start,
      patch: {
        model_offset_x: base.offsetX,
        model_offset_y: base.offsetY,
        model_rotation: base.extraRotation,
        model_scale: base.scale,
      },
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  const selectedObjects = objects.filter((o) => selection.includes(o.id)).map(liveObject);
  const single = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const strokePx = 1 / zoom;

  /** Caja que envuelve a toda la selección, para girarla como un bloque. */
  const selectionBox =
    selectedObjects.length > 1
      ? selectedObjects.reduce(
          (box, o) => {
            const f = footprintOf(o);
            // Las cuatro esquinas ya giradas: una mesa en diagonal ocupa más
            // ancho del que dice su ficha.
            const rad = (Number(o.rotation) * Math.PI) / 180;
            const ex =
              (Math.abs(Math.cos(rad)) * f.length + Math.abs(Math.sin(rad)) * f.width) / 2;
            const ey =
              (Math.abs(Math.sin(rad)) * f.length + Math.abs(Math.cos(rad)) * f.width) / 2;
            return {
              minX: Math.min(box.minX, Number(o.x) - ex),
              minY: Math.min(box.minY, Number(o.y) - ey),
              maxX: Math.max(box.maxX, Number(o.x) + ex),
              maxY: Math.max(box.maxY, Number(o.y) + ey),
            };
          },
          { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        )
      : null;

  /** Arranca el giro: el centro es el del grupo (el del objeto si va solo). */
  function startRotate(e: React.PointerEvent, group: PlanObject[]) {
    const usable = group.filter((o) => !o.locked);
    if (usable.length === 0) return;
    const c = centroidOf(usable);
    const p = toWorld(e.clientX, e.clientY);
    setDrag({
      kind: 'rotate',
      ids: usable.map((o) => o.id),
      cx: c.x,
      cy: c.y,
      start: (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI,
      delta: 0,
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  return (
    <div
      ref={containerRef}
      className="relative size-full overflow-hidden bg-[var(--ef-canvas-2)]"
      style={{ cursor: spaceDown ? 'grab' : tool !== 'select' ? 'crosshair' : 'default' }}
      onWheel={handleWheel}
      // Arrastrar y soltar desde el panel del almacén: el objeto cae justo
      // donde se suelta, en vez de aparecer en el centro de la vista.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DROP_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropAt(toWorld(e.clientX, e.clientY));
      }}
      onDragLeave={() => setDropAt(null)}
      onDrop={(e) => {
        const payload = e.dataTransfer.getData(DROP_TYPE);
        setDropAt(null);
        if (!payload) return;
        e.preventDefault();
        onDropObject(payload, toWorld(e.clientX, e.clientY));
      }}
    >
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="block touch-none select-none"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <defs>
          <pattern id="grid-minor" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path
              d={`M ${grid} 0 L 0 0 0 ${grid}`}
              fill="none"
              stroke="var(--ef-grid)"
              strokeWidth={strokePx}
            />
          </pattern>
          <pattern id="grid-major" width={grid * 10} height={grid * 10} patternUnits="userSpaceOnUse">
            <rect width={grid * 10} height={grid * 10} fill="url(#grid-minor)" />
            <path
              d={`M ${grid * 10} 0 L 0 0 0 ${grid * 10}`}
              fill="none"
              stroke="var(--ef-grid-strong)"
              strokeWidth={strokePx * 1.4}
            />
          </pattern>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
          </marker>
        </defs>

        <rect width={size.w} height={size.h} fill="var(--ef-canvas-2)" />

        <g transform={`translate(${panX},${panY}) scale(${zoom})`}>
          {/* Capas de imagen: referencia calibrada y texturas, bajo la rejilla */}
          <g>
            {backgrounds
              .filter((b) => b.visible)
              .map((b) => {
                const url = backgroundUrls.get(b.id);
                if (!url) return null;
                const live =
                  drag?.kind === 'bg-move' && drag.id === b.id
                    ? { x: Number(b.x) + drag.dx, y: Number(b.y) + drag.dy, w: Number(b.width_m), h: Number(b.height_m) }
                    : drag?.kind === 'bg-resize' && drag.id === b.id
                      ? { x: Number(b.x), y: Number(b.y), w: drag.width, h: drag.height }
                      : { x: Number(b.x), y: Number(b.y), w: Number(b.width_m), h: Number(b.height_m) };

                return (
                  <image
                    key={b.id}
                    href={url}
                    x={live.x}
                    y={live.y}
                    width={live.w}
                    height={live.h}
                    opacity={Number(b.opacity)}
                    preserveAspectRatio="none"
                    transform={
                      Number(b.rotation)
                        ? `rotate(${Number(b.rotation)}, ${live.x + live.w / 2}, ${live.y + live.h / 2})`
                        : undefined
                    }
                    style={{ imageRendering: 'auto' }}
                  />
                );
              })}

            {/* Planta del recinto 3D (cubiertas y pilares), para colocar el
                material sabiendo dónde caen los pilares. */}
            {showEnvironment
              ? backgrounds
                  .filter((b) => b.visible && backgroundModelUrls.has(b.id))
                  .map((b) => (
                    <ModelPlan
                      key={`planta-${b.id}`}
                      background={liveModelBackground(b)}
                      url={backgroundModelUrls.get(b.id)!}
                      zoom={zoom}
                    />
                  ))
              : null}
          </g>

          {/* Recinto */}
          {showGrid ? (
            <rect
              x={0}
              y={0}
              width={Number(plan.width_m)}
              height={Number(plan.depth_m)}
              fill="url(#grid-major)"
            />
          ) : null}
          <rect
            x={0}
            y={0}
            width={Number(plan.width_m)}
            height={Number(plan.depth_m)}
            fill="none"
            stroke="var(--ef-line-strong)"
            strokeWidth={strokePx * 2}
          />

          {/* Cotas del recinto */}
          {showMeasures ? (
            <g pointerEvents="none">
              <text
                x={Number(plan.width_m) / 2}
                y={-0.35}
                textAnchor="middle"
                fill="var(--ef-muted)"
                fontSize={12 / zoom}
              >
                {fmtNum(Number(plan.width_m), 2)} m
              </text>
              <text
                x={-0.35}
                y={Number(plan.depth_m) / 2}
                textAnchor="middle"
                fill="var(--ef-muted)"
                fontSize={12 / zoom}
                transform={`rotate(-90, ${-0.35}, ${Number(plan.depth_m) / 2})`}
              >
                {fmtNum(Number(plan.depth_m), 2)} m
              </text>
            </g>
          ) : null}

          {/* Zonas marcadas: velo de color, borde discontinuo y rótulo */}
          {zones.map((z) => {
            const points = liveZonePoints(z);
            if (points.length < 3) return null;
            const c = polygonCentroid(points);
            const isSel = z.id === selectedZoneId;
            const label = `${z.number} - ${z.name || 'Zona'}`;
            const fs = 12 / zoom;
            const chipW = (label.length * 6.6 + 14) / zoom;
            const chipH = 19 / zoom;
            return (
              <g key={z.id}>
                <polygon
                  points={points.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill={z.color}
                  fillOpacity={isSel ? 0.2 : 0.12}
                  stroke={z.color}
                  strokeWidth={strokePx * (isSel ? 2 : 1.4)}
                  strokeDasharray={`${strokePx * 7} ${strokePx * 4}`}
                  pointerEvents="none"
                />
                <g
                  className={isSel ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={(e) => {
                    if (e.button !== 0 || tool !== 'select') return;
                    e.stopPropagation();
                    onSelectZone(z.id);
                    clearSelection();
                    onSelectConnection(null);
                    const p = toWorld(e.clientX, e.clientY);
                    setDrag({ kind: 'zone-move', id: z.id, startX: p.x, startY: p.y, dx: 0, dy: 0 });
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                  }}
                >
                  <rect
                    x={c.x - chipW / 2}
                    y={c.y - chipH / 2}
                    width={chipW}
                    height={chipH}
                    rx={4 / zoom}
                    fill="var(--ef-canvas)"
                    fillOpacity={0.85}
                    stroke={z.color}
                    strokeWidth={strokePx * (isSel ? 2 : 1)}
                  />
                  <text
                    x={c.x}
                    y={c.y}
                    fontSize={fs}
                    fontWeight={600}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="var(--ef-text)"
                  >
                    {label}
                  </text>
                </g>
                {/* Punto medio de cada lado: arrastrarlo añade un pin ahí. */}
                {isSel && drag?.kind !== 'zone-pin'
                  ? points.map((p, i) => {
                      const q = points[(i + 1) % points.length];
                      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
                      return (
                        <circle
                          key={`m${i}`}
                          cx={m.x}
                          cy={m.y}
                          r={4 / zoom}
                          fill="var(--ef-canvas)"
                          stroke={z.color}
                          strokeWidth={strokePx * 1.5}
                          className="cursor-copy"
                          onPointerDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            const base = points.map((r) => ({ x: r.x, y: r.y }));
                            base.splice(i + 1, 0, { x: round(m.x, 3), y: round(m.y, 3) });
                            setDrag({ kind: 'zone-pin', id: z.id, index: i + 1, points: base });
                            (e.target as Element).setPointerCapture?.(e.pointerId);
                          }}
                        >
                          <title>Arrastra para añadir un punto</title>
                        </circle>
                      );
                    })
                  : null}
                {isSel
                  ? points.map((p, i) => (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={6 / zoom}
                        fill={z.color}
                        stroke="var(--ef-canvas)"
                        strokeWidth={strokePx * 1.5}
                        className="cursor-crosshair"
                        onPointerDown={(e) => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          setDrag({ kind: 'zone-pin', id: z.id, index: i, points: z.points.map((q) => ({ x: Number(q.x), y: Number(q.y) })) });
                          (e.target as Element).setPointerCapture?.(e.pointerId);
                        }}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          // Con doble clic se quita el pin; una zona no baja de tres.
                          if (z.points.length <= 3) return;
                          onZoneCommit(
                            z.id,
                            z.points
                              .filter((_, k) => k !== i)
                              .map((q) => ({ x: Number(q.x), y: Number(q.y) })),
                          );
                        }}
                      >
                        <title>Arrastra para mover · doble clic para quitarlo</title>
                      </circle>
                    ))
                  : null}
                {z.description ? (
                  <text
                    x={c.x}
                    y={c.y + chipH * 0.95}
                    fontSize={10.5 / zoom}
                    textAnchor="middle"
                    dominantBaseline="hanging"
                    fill="var(--ef-text)"
                    fillOpacity={0.8}
                    pointerEvents="none"
                  >
                    {z.description.length > 60 ? `${z.description.slice(0, 59)}…` : z.description}
                  </text>
                ) : null}
                {isSel ? (
                  <g transform={`translate(${c.x},${c.y + chipH * (z.description ? 1.9 : 1)})`}>
                    <MeasureChip zoom={zoom} rotation={0} text={`${fmtNum(polygonArea(points), 1)} m²`} />
                  </g>
                ) : null}
              </g>
            );
          })}

          {/* Zona a medio marcar: los pines puestos y el que sigue al ratón */}
          {tool === 'zone' && zoneDraft.length ? (
            <g pointerEvents="none">
              <polyline
                points={[...zoneDraft, ...(zoneHover ? [zoneHover] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
                fill="var(--ef-cyan)"
                fillOpacity={0.08}
                stroke="var(--ef-cyan)"
                strokeWidth={strokePx * 1.8}
                strokeDasharray={`${strokePx * 6} ${strokePx * 4}`}
              />
              {zoneDraft.map((p, i) => (
                <g key={i}>
                  {i === 0 && zoneDraft.length >= 3 ? (
                    <circle cx={p.x} cy={p.y} r={11 / zoom} fill="none" stroke="var(--ef-cyan)" strokeWidth={strokePx * 1.5} />
                  ) : null}
                  <circle cx={p.x} cy={p.y} r={6 / zoom} fill="var(--ef-cyan)" stroke="var(--ef-canvas)" strokeWidth={strokePx * 1.5} />
                  <text x={p.x} y={p.y} fontSize={8 / zoom} textAnchor="middle" dominantBaseline="central" fill="var(--ef-canvas)" fontWeight={700}>
                    {i + 1}
                  </text>
                </g>
              ))}
            </g>
          ) : null}

          {/* Cables */}
          <g>
            {connections.map((c) => {
              if (c.kind === 'power' && !showPower) return null;
              if (c.kind === 'network' && !showNetwork) return null;
              if (c.kind === 'signal' && !showSignal) return null;
              if (c.kind === 'usb' && !showUsb) return null;
              const a = objectById.get(c.from_object_id);
              const b = objectById.get(c.to_object_id);
              if (!a || !b) return null;
              const la = liveObject(a);
              const lb = liveObject(b);
              const isSelected = selectedConnectionId === c.id;
              // Los extremos son SIEMPRE los objetos: al moverlos el cable los
              // sigue sin tener que reescribir el trazo que se dibujó a mano.
              const d = pathD(cablePath(la, lb, c.waypoints));
              return (
                <g key={c.id}>
                  <path
                    d={d}
                    fill="none"
                    stroke={c.color}
                    strokeWidth={(isSelected ? 3.5 : 2) * strokePx}
                    strokeDasharray={dashFor(c.kind, strokePx)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.9}
                  />
                  {/* Zona de click más ancha */}
                  <path
                    d={d}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={10 * strokePx}
                    strokeLinecap="round"
                    className="cursor-pointer"
                    onPointerDown={(e) => {
                      if (tool !== 'select') return;
                      e.stopPropagation();
                      clearSelection();
                      onSelectConnection(c.id);
                    }}
                  />
                </g>
              );
            })}
          </g>

          {/* Objetos */}
          <g>
            {objects.map((raw) => {
              const o = liveObject(raw);
              // Lo que se pinta en planta es el hueco REAL: una tele puesta en
              // vertical ocupa distinto aunque siga midiendo lo mismo.
              const box = footprintOf(o);
              const l = box.length;
              const w = box.width;
              const isSelected = selection.includes(o.id);
              const isLinkSource = linkFrom === o.id;
              const objIssues = issuesByObject.get(o.id);
              const hasError = objIssues?.some((i) => i.severity === 'error');

              return (
                <g
                  key={o.id}
                  transform={`translate(${Number(o.x)},${Number(o.y)}) rotate(${Number(o.rotation)})`}
                  onPointerDown={(e) => handleObjectPointerDown(e, raw)}
                  className={o.locked ? 'cursor-not-allowed' : 'cursor-move'}
                >
                  {o.shape === 'cylinder' ? (
                    <ellipse
                      cx={0}
                      cy={0}
                      rx={l / 2}
                      ry={w / 2}
                      fill={`${o.color}55`}
                      stroke={o.color}
                      strokeWidth={strokePx * 1.6}
                    />
                  ) : o.shape === 'text' ? (
                    <>
                      {/* Zona de click invisible: el texto por sí solo es difícil de agarrar */}
                      <rect
                        x={-l / 2}
                        y={-w / 2}
                        width={l}
                        height={w}
                        fill="transparent"
                        stroke={isSelected ? o.color : 'transparent'}
                        strokeWidth={strokePx}
                        strokeDasharray={`${strokePx * 4} ${strokePx * 3}`}
                      />
                      <text
                        x={0}
                        y={0}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={o.color}
                        fontSize={Math.max(0.08, w * 0.72)}
                        fontWeight={600}
                        pointerEvents="none"
                      >
                        {o.label || 'Texto'}
                      </text>
                    </>
                  ) : o.shape === 'line' ? (
                    <line
                      x1={-l / 2}
                      y1={0}
                      x2={l / 2}
                      y2={0}
                      stroke={o.color}
                      strokeWidth={Math.max(strokePx * 2, w)}
                      strokeLinecap="round"
                    />
                  ) : (
                    <rect
                      x={-l / 2}
                      y={-w / 2}
                      width={l}
                      height={w}
                      rx={Math.min(0.06, l / 10)}
                      fill={`${o.color}${o.shape === 'plane' ? '33' : '55'}`}
                      stroke={o.color}
                      strokeWidth={strokePx * 1.6}
                    />
                  )}

                  {/* Punto de luz y punto de red: el símbolo dice qué son de
                      un vistazo, sin tener que leer la etiqueta. */}
                  <FeedSymbol kind={o.kind} size={Math.min(l, w)} color={o.color} zoom={zoom} />

                  {/* Marca de orientación (no aplica a texto ni líneas) */}
                  {o.shape !== 'text' && o.shape !== 'line' && !isFeed(o.kind) ? (
                    <line
                      x1={0}
                      y1={0}
                      x2={l / 2}
                      y2={0}
                      stroke={o.color}
                      strokeWidth={strokePx}
                      opacity={0.55}
                    />
                  ) : null}

                  {hasError ? (
                    <circle
                      cx={l / 2 - 0.08}
                      cy={-w / 2 + 0.08}
                      r={Math.max(0.07, 6 / zoom)}
                      fill="var(--ef-danger)"
                      stroke="var(--ef-canvas)"
                      strokeWidth={strokePx}
                    />
                  ) : null}

                  {isSelected || isLinkSource ? (
                    <rect
                      x={-l / 2 - 0.06}
                      y={-w / 2 - 0.06}
                      width={l + 0.12}
                      height={w + 0.12}
                      fill="none"
                      stroke={isLinkSource ? 'var(--ef-cyan)' : 'var(--ef-accent-soft)'}
                      strokeWidth={strokePx * 2}
                      strokeDasharray={`${strokePx * 5} ${strokePx * 3}`}
                    />
                  ) : null}

                  {showLabels && o.shape !== 'text' ? (
                    <text
                      x={0}
                      y={w / 2 + 14 / zoom}
                      textAnchor="middle"
                      fill="var(--ef-muted)"
                      fontSize={11 / zoom}
                      pointerEvents="none"
                      transform={`rotate(${-Number(o.rotation)})`}
                    >
                      {o.label}
                    </text>
                  ) : null}

                  {(showMeasures || isSelected) && o.shape !== 'text' ? (
                    <MeasureChip
                      zoom={zoom}
                      rotation={-Number(o.rotation)}
                      accent={isSelected}
                      // Mientras se arrastra importa DÓNDE va a quedar, no
                      // cuánto mide: es lo que hace falta para colocarlo fino.
                      text={
                        drag?.kind === 'move' && drag.ids.includes(o.id)
                          ? `x ${fmtNum(Number(o.x), 2)} · y ${fmtNum(Number(o.y), 2)} m`
                          : measureText(o)
                      }
                    />
                  ) : null}
                </g>
              );
            })}
          </g>

          {/* Manejadores del objeto seleccionado */}
          {single && !single.locked ? (
            <g
              transform={`translate(${Number(single.x)},${Number(single.y)}) rotate(${Number(single.rotation)})`}
            >
              <circle
                cx={footprintOf(single).length / 2}
                cy={footprintOf(single).width / 2}
                r={5 / zoom}
                fill="var(--ef-accent-soft)"
                stroke="var(--ef-canvas)"
                strokeWidth={strokePx * 1.5}
                className="cursor-nwse-resize"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const p = toWorld(e.clientX, e.clientY);
                  setDrag({
                    kind: 'resize',
                    id: single.id,
                    startX: p.x,
                    startY: p.y,
                    length: Number(single.length_m),
                    width: Number(single.width_m),
                  });
                }}
              />
              <line
                x1={0}
                y1={-Number(single.width_m) / 2}
                x2={0}
                y2={-Number(single.width_m) / 2 - 22 / zoom}
                stroke="var(--ef-accent-soft)"
                strokeWidth={strokePx * 1.5}
              />
              <circle
                cx={0}
                cy={-Number(single.width_m) / 2 - 22 / zoom}
                r={5 / zoom}
                fill="var(--ef-cyan)"
                stroke="var(--ef-canvas)"
                strokeWidth={strokePx * 1.5}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startRotate(e, [single]);
                }}
              />
            </g>
          ) : null}

          {/* Selección múltiple: caja de conjunto y tirador para girarla entera */}
          {selectionBox ? (
            <g>
              <rect
                x={selectionBox.minX}
                y={selectionBox.minY}
                width={selectionBox.maxX - selectionBox.minX}
                height={selectionBox.maxY - selectionBox.minY}
                fill="none"
                stroke="var(--ef-accent-soft)"
                strokeWidth={strokePx * 1.5}
                strokeDasharray={`${strokePx * 6} ${strokePx * 4}`}
                pointerEvents="none"
              />
              <line
                x1={(selectionBox.minX + selectionBox.maxX) / 2}
                y1={selectionBox.minY}
                x2={(selectionBox.minX + selectionBox.maxX) / 2}
                y2={selectionBox.minY - 24 / zoom}
                stroke="var(--ef-accent-soft)"
                strokeWidth={strokePx * 1.5}
                pointerEvents="none"
              />
              <circle
                cx={(selectionBox.minX + selectionBox.maxX) / 2}
                cy={selectionBox.minY - 24 / zoom}
                r={6 / zoom}
                fill="var(--ef-cyan)"
                stroke="var(--ef-canvas)"
                strokeWidth={strokePx * 1.5}
                className="cursor-grab"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  startRotate(e, selectedObjects);
                }}
              />
            </g>
          ) : null}

          {/* Cuánto se lleva girado, tanto de uno solo como del conjunto */}
          {drag?.kind === 'rotate' && drag.delta !== 0 ? (
            <g transform={`translate(${drag.cx},${drag.cy})`}>
              <MeasureChip zoom={zoom} rotation={0} accent text={`${fmtNum(drag.delta, 0)}°`} />
            </g>
          ) : null}

          {/* Ajuste de la imagen de fondo: superficie para arrastrar + tirador */}
          {bgEdit
            ? backgrounds
                .filter((b) => b.visible && !b.locked)
                .map((b) => {
                  const isSel = selectedBackgroundId === b.id;
                  const live =
                    drag?.kind === 'bg-move' && drag.id === b.id
                      ? { x: Number(b.x) + drag.dx, y: Number(b.y) + drag.dy, w: Number(b.width_m), h: Number(b.height_m) }
                      : drag?.kind === 'bg-resize' && drag.id === b.id
                        ? { x: Number(b.x), y: Number(b.y), w: drag.width, h: drag.height }
                        : { x: Number(b.x), y: Number(b.y), w: Number(b.width_m), h: Number(b.height_m) };

                  return (
                    <g key={`edit-${b.id}`}>
                      <rect
                        x={live.x}
                        y={live.y}
                        width={live.w}
                        height={live.h}
                        fill="transparent"
                        stroke={isSel ? 'var(--ef-cyan)' : 'var(--ef-line-strong)'}
                        strokeWidth={strokePx * (isSel ? 2 : 1)}
                        strokeDasharray={`${strokePx * 6} ${strokePx * 4}`}
                        className="cursor-move"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          onSelectBackground(b.id);
                          const p = toWorld(e.clientX, e.clientY);
                          setDrag({ kind: 'bg-move', id: b.id, startX: p.x, startY: p.y, dx: 0, dy: 0 });
                          (e.target as Element).setPointerCapture?.(e.pointerId);
                        }}
                      />
                      {isSel ? (
                        <circle
                          cx={live.x + live.w}
                          cy={live.y + live.h}
                          r={6 / zoom}
                          fill="var(--ef-cyan)"
                          stroke="var(--ef-canvas)"
                          strokeWidth={strokePx * 1.5}
                          className="cursor-nwse-resize"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const p = toWorld(e.clientX, e.clientY);
                            setDrag({
                              kind: 'bg-resize',
                              id: b.id,
                              startX: p.x,
                              startY: p.y,
                              width: Number(b.width_m),
                              height: Number(b.height_m),
                              ratio: Number(b.width_m) / Math.max(0.001, Number(b.height_m)),
                            });
                          }}
                        />
                      ) : null}
                    </g>
                  );
                })
            : null}

          {/* Colocar el modelo del recinto: arrastrar, girar y escalar */}
          {bgEdit && editableModel ? (
            <ModelPlan
              background={liveModelBackground(editableModel)}
              url={backgroundModelUrls.get(editableModel.id)!}
              zoom={zoom}
              dragging={drag?.kind === 'model' ? drag.mode : null}
              onStart={(mode, e, fp) => startModelDrag(editableModel, mode, e, fp)}
            />
          ) : null}

          {/* Trazo de calibración */}
          {drag?.kind === 'calibrate' ? (
            <g pointerEvents="none">
              <line
                x1={drag.x0}
                y1={drag.y0}
                x2={drag.x1}
                y2={drag.y1}
                stroke="var(--ef-cyan)"
                strokeWidth={strokePx * 2.5}
                strokeLinecap="round"
              />
              {[
                [drag.x0, drag.y0],
                [drag.x1, drag.y1],
              ].map(([cx, cy], i) => (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={4 / zoom}
                  fill="var(--ef-canvas)"
                  stroke="var(--ef-cyan)"
                  strokeWidth={strokePx * 2}
                />
              ))}
              <text
                x={(drag.x0 + drag.x1) / 2}
                y={(drag.y0 + drag.y1) / 2 - 12 / zoom}
                textAnchor="middle"
                fill="var(--ef-cyan)"
                fontSize={13 / zoom}
                fontWeight={600}
              >
                {fmtNum(Math.hypot(drag.x1 - drag.x0, drag.y1 - drag.y0), 2)} m actuales
              </text>
            </g>
          ) : null}

          {/* Cable en curso: se ve el recorrido y a qué aparato va a engancharse */}
          {drag?.kind === 'cable'
            ? (() => {
                const from = objectById.get(drag.fromId);
                if (!from) return null;
                const over = drag.overId ? objectById.get(drag.overId) : null;
                const color = CONNECTION_COLOR[toolKind(tool)];
                const pts = over
                  ? [...drag.points, { x: Number(over.x), y: Number(over.y) }]
                  : drag.points;
                return (
                  <g pointerEvents="none">
                    <path
                      d={pathD(pts)}
                      fill="none"
                      stroke={color}
                      strokeWidth={strokePx * 2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray={dashFor(toolKind(tool), strokePx)}
                    />
                    {over ? (
                      <rect
                        x={Number(over.x) - Number(over.length_m) / 2 - 0.08}
                        y={Number(over.y) - Number(over.width_m) / 2 - 0.08}
                        width={Number(over.length_m) + 0.16}
                        height={Number(over.width_m) + 0.16}
                        fill="none"
                        stroke={color}
                        strokeWidth={strokePx * 2}
                        transform={`rotate(${Number(over.rotation)}, ${Number(over.x)}, ${Number(over.y)})`}
                      />
                    ) : null}
                  </g>
                );
              })()
            : null}

          {/* Regla */}
          {(() => {
            const m = drag?.kind === 'measure' ? drag : measurement;
            if (!m) return null;
            const d = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
            if (d < 0.005) return null;
            return (
              <g pointerEvents="none">
                <line
                  x1={m.x0}
                  y1={m.y0}
                  x2={m.x1}
                  y2={m.y1}
                  stroke="var(--ef-accent-soft)"
                  strokeWidth={strokePx * 2.5}
                  strokeLinecap="round"
                />
                {[
                  [m.x0, m.y0],
                  [m.x1, m.y1],
                ].map(([cx, cy], i) => (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r={4 / zoom}
                    fill="var(--ef-canvas)"
                    stroke="var(--ef-accent-soft)"
                    strokeWidth={strokePx * 2}
                  />
                ))}
                <g transform={`translate(${(m.x0 + m.x1) / 2},${(m.y0 + m.y1) / 2})`}>
                  <MeasureChip zoom={zoom} rotation={0} accent text={`${fmtNum(d, 2)} m`} />
                </g>
              </g>
            );
          })()}

          {/* Dónde va a caer el objeto que se está arrastrando */}
          {dropAt ? (
            <g pointerEvents="none">
              <circle
                cx={dropAt.x}
                cy={dropAt.y}
                r={14 / zoom}
                fill="color-mix(in oklab, var(--ef-accent) 22%, transparent)"
                stroke="var(--ef-accent-soft)"
                strokeWidth={strokePx * 1.5}
              />
              <line
                x1={dropAt.x - 8 / zoom}
                y1={dropAt.y}
                x2={dropAt.x + 8 / zoom}
                y2={dropAt.y}
                stroke="var(--ef-accent-soft)"
                strokeWidth={strokePx * 1.5}
              />
              <line
                x1={dropAt.x}
                y1={dropAt.y - 8 / zoom}
                x2={dropAt.x}
                y2={dropAt.y + 8 / zoom}
                stroke="var(--ef-accent-soft)"
                strokeWidth={strokePx * 1.5}
              />
            </g>
          ) : null}

          {/* Selección por marco */}
          {drag?.kind === 'marquee' ? (
            <rect
              x={Math.min(drag.x0, drag.x1)}
              y={Math.min(drag.y0, drag.y1)}
              width={Math.abs(drag.x1 - drag.x0)}
              height={Math.abs(drag.y1 - drag.y0)}
              fill="color-mix(in oklab, var(--ef-accent) 18%, transparent)"
              stroke="var(--ef-accent-soft)"
              strokeWidth={strokePx}
            />
          ) : null}
        </g>
      </svg>

      {/* Escala */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-line bg-[color-mix(in_oklab,var(--ef-canvas)_80%,transparent)] px-2.5 py-1.5 text-[11px] text-muted backdrop-blur">
        <div className="h-0.5 bg-muted" style={{ width: zoom }} />
        <span className="num">1 m</span>
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-line bg-[color-mix(in_oklab,var(--ef-canvas)_80%,transparent)] p-1 backdrop-blur">
        <ZoomButton label="Alejar" onClick={() => zoomBy(1 / 1.25)}>
          −
        </ZoomButton>
        <span className="num w-12 text-center text-[11px] text-muted">{Math.round(zoom)} px/m</span>
        <ZoomButton label="Acercar" onClick={() => zoomBy(1.25)}>
          +
        </ZoomButton>
      </div>
    </div>
  );
}

/**
 * Símbolo de las acometidas, dibujado dentro del círculo.
 *
 * Los dos caben en una caja de 1×1 centrada en el origen, de modo que basta
 * con escalarla al tamaño del objeto: vale para un punto de 40 cm y para uno
 * que se haya agrandado.
 */
function FeedSymbol({
  kind,
  size,
  color,
  zoom,
}: {
  kind: string;
  size: number;
  color: string;
  zoom: number;
}) {
  if (!isFeed(kind)) return null;

  // El dibujo ocupa el 55 % del diámetro: deja aire contra el borde.
  const k = size * 0.55;
  const w = Math.max(1.6 / zoom, k * 0.09);

  return (
    <g pointerEvents="none" transform={`scale(${k})`}>
      {kind === 'power_source' ? (
        // Rayo
        <path
          d="M0.16,-0.52 L-0.26,0.06 L-0.02,0.06 L-0.16,0.52 L0.26,-0.06 L0.02,-0.06 Z"
          fill={color}
          stroke={color}
          strokeWidth={w / k / 2}
          strokeLinejoin="round"
        />
      ) : (
        // Nodo central con tres ramas: el icono de red de toda la vida
        <g stroke={color} strokeWidth={w / k} strokeLinecap="round" fill={color}>
          <path
            d="M0,-0.12 L0,-0.4 M0,0.12 L0,0.26 M-0.34,0.26 L0.34,0.26 M-0.34,0.26 L-0.34,0.42 M0.34,0.26 L0.34,0.42"
            fill="none"
          />
          <rect x={-0.16} y={-0.12} width={0.32} height={0.24} rx={0.05} />
          <circle cx={0} cy={-0.44} r={0.09} />
          <circle cx={-0.34} cy={0.46} r={0.08} />
          <circle cx={0.34} cy={0.46} r={0.08} />
        </g>
      )}
    </g>
  );
}

/** Cotas de un objeto: "1,20 × 0,80 × 0,75 m" (+ altura sobre el suelo). */
function measureText(o: PlanObject) {
  const l = fmtNum(Number(o.length_m), 2);
  const w = fmtNum(Number(o.width_m), 2);
  const h = fmtNum(Number(o.height_m), 2);
  const base = o.shape === 'line' ? `${l} m` : `${l} × ${w} × ${h} m`;
  const z = Number(o.z) || 0;
  return z > 0.001 ? `${base}  ↑${fmtNum(z, 2)} m` : base;
}

/**
 * Etiqueta de cotas con fondo. El texto suelto sobre el plano era ilegible;
 * esto dibuja una "pastilla" de tamaño constante en pantalla (px / zoom) y
 * compensa la rotación del objeto para que siempre se lea en horizontal.
 */
function MeasureChip({
  text,
  zoom,
  rotation = 0,
  accent = false,
}: {
  text: string;
  zoom: number;
  rotation?: number;
  accent?: boolean;
}) {
  const fz = 11 / zoom;
  const padX = 5 / zoom;
  const padY = 3 / zoom;
  // Ancho aproximado: el SVG no mide texto sin medirlo en el DOM.
  const w = text.length * fz * 0.54 + padX * 2;
  const h = fz + padY * 2;
  return (
    <g pointerEvents="none" transform={`rotate(${rotation})`}>
      <rect
        x={-w / 2}
        y={-h / 2}
        width={w}
        height={h}
        rx={h / 2}
        fill="color-mix(in oklab, var(--ef-canvas) 86%, transparent)"
        stroke={accent ? 'var(--ef-accent-soft)' : 'var(--ef-line-strong)'}
        strokeWidth={1 / zoom}
      />
      <text
        x={0}
        y={0}
        textAnchor="middle"
        dominantBaseline="central"
        fill={accent ? 'var(--ef-accent-soft)' : 'var(--ef-muted)'}
        fontSize={fz}
        fontWeight={600}
      >
        {text}
      </text>
    </g>
  );
}

function ZoomButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

type ModelPatch = Pick<
  PlanBackground,
  'model_offset_x' | 'model_offset_y' | 'model_rotation' | 'model_scale'
>;

/**
 * PLANTA DEL MODELO DEL RECINTO EN EL 2D
 *
 * Sin `onStart` es solo referencia: las cubiertas en un velo y los pilares en
 * oscuro, sin capturar el ratón. Con `onStart` (modo «Ajustar en el plano»)
 * se arrastra entera para moverla, el tirador de arriba la gira y el de la
 * esquina la escala, todo alrededor del centro de su planta.
 */
function ModelPlan({
  background,
  url,
  zoom,
  dragging = null,
  onStart,
}: {
  background: PlanBackground;
  url: string;
  zoom: number;
  dragging?: 'move' | 'rotate' | 'scale' | null;
  onStart?: (mode: 'move' | 'rotate' | 'scale', e: React.PointerEvent, fp: Footprint) => void;
}) {
  const fp = useFootprint(url);
  if (!fp) return null;

  const p = placementOf(background);
  const transform = placementTransform(p, fp);
  const px = 1 / zoom;

  if (!onStart) {
    return (
      <g transform={transform} pointerEvents="none">
        <path d={fp.roofs} fill="var(--ef-cyan)" fillOpacity={0.12} />
        <path d={fp.pillars} fill="var(--ef-text)" fillOpacity={0.9} />
      </g>
    );
  }

  const c = footprintCentre(fp);
  const pivot = modelToPlan(p, fp, c.x, c.z);
  const corners = [
    [fp.minX, fp.minZ],
    [fp.maxX, fp.minZ],
    [fp.maxX, fp.maxZ],
    [fp.minX, fp.maxZ],
  ].map(([x, z]) => modelToPlan(p, fp, x, z));
  const top = modelToPlan(p, fp, c.x, fp.minZ);
  const len = Math.hypot(top.x - pivot.x, top.y - pivot.y) || 1;
  const knob = {
    x: top.x + ((top.x - pivot.x) / len) * (30 / zoom),
    y: top.y + ((top.y - pivot.y) / len) * (30 / zoom),
  };
  const scaleKnob = corners[2];
  const label =
    dragging === 'rotate'
      ? `${fmtNum(p.extraRotation, 1)}°`
      : dragging === 'scale'
        ? `${fmtNum(p.scale * 100, 1)} %`
        : null;

  return (
    <g>
      {/* Toda la caja agarra para mover: más fácil que atinar a una cubierta. */}
      <polygon
        points={corners.map((q) => `${q.x},${q.y}`).join(' ')}
        fill="var(--ef-cyan)"
        fillOpacity={0.05}
        stroke="var(--ef-cyan)"
        strokeWidth={px * 1.5}
        strokeDasharray={`${px * 6} ${px * 4}`}
        className="cursor-move"
        onPointerDown={(e) => onStart('move', e, fp)}
      />
      <g transform={transform} className="cursor-move" onPointerDown={(e) => onStart('move', e, fp)}>
        <path d={fp.roofs} fill="var(--ef-cyan)" fillOpacity={0.35} />
        <path d={fp.pillars} fill="var(--ef-text)" />
      </g>

      <line
        x1={top.x}
        y1={top.y}
        x2={knob.x}
        y2={knob.y}
        stroke="var(--ef-cyan)"
        strokeWidth={px * 1.5}
        pointerEvents="none"
      />
      <circle
        cx={knob.x}
        cy={knob.y}
        r={7 / zoom}
        fill="var(--ef-cyan)"
        stroke="var(--ef-canvas)"
        strokeWidth={px * 1.5}
        className="cursor-grab"
        onPointerDown={(e) => onStart('rotate', e, fp)}
      >
        <title>Girar (Mayús: de 5 en 5°)</title>
      </circle>
      <rect
        x={scaleKnob.x - 6 / zoom}
        y={scaleKnob.y - 6 / zoom}
        width={12 / zoom}
        height={12 / zoom}
        rx={2 / zoom}
        fill="var(--ef-cyan)"
        stroke="var(--ef-canvas)"
        strokeWidth={px * 1.5}
        className="cursor-nwse-resize"
        onPointerDown={(e) => onStart('scale', e, fp)}
      >
        <title>Escalar</title>
      </rect>
      <circle cx={pivot.x} cy={pivot.y} r={3 / zoom} fill="var(--ef-cyan)" pointerEvents="none" />

      {label ? (
        <g transform={`translate(${knob.x},${knob.y - 18 / zoom})`}>
          <MeasureChip zoom={zoom} rotation={0} accent text={label} />
        </g>
      ) : null}
    </g>
  );
}
