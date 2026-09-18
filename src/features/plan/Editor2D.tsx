import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, PlanBackground, PlanConnection, PlanIssue, PlanObject } from '@/lib/types';
import { clamp, fmtNum, round, snap as snapTo } from '@/lib/utils';
import { usePlanStore } from './planStore';

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
  selectedBackgroundId: string | null;
  onSelectBackground: (id: string | null) => void;
  onBackgroundCommit: (id: string, patch: Partial<PlanBackground>) => void;
  /** Se dispara al soltar el trazo de calibración. */
  onCalibrate: (line: CalibrationLine) => void;
  issuesByObject: Map<string, PlanIssue[]>;
  selectedConnectionId: string | null;
  onSelectConnection: (id: string | null) => void;
  onCommit: (updates: CommitUpdate[], label: string) => void;
  onLink: (fromId: string, toId: string) => void;
  svgRef: React.RefObject<SVGSVGElement | null>;
}

type DragState =
  | { kind: 'move'; ids: string[]; startX: number; startY: number; dx: number; dy: number }
  | { kind: 'resize'; id: string; startX: number; startY: number; length: number; width: number }
  | { kind: 'rotate'; id: string; rotation: number }
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
  | { kind: 'calibrate'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'measure'; x0: number; y0: number; x1: number; y1: number }
  | null;

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
  selectedBackgroundId,
  onSelectBackground,
  onBackgroundCommit,
  onCalibrate,
  issuesByObject,
  selectedConnectionId,
  onSelectConnection,
  onCommit,
  onLink,
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
    showMeasures,
    snap,
    bgEdit,
  } = usePlanStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [measurement, setMeasurement] = useState<Measurement | null>(null);

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
    const newZoom = clamp(zoom * factor, 8, 240);
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
    e.stopPropagation();
    if (trackDown(e)) return;
    if (spaceDown || e.button === 1) return;

    if (tool !== 'select') {
      if (!linkFrom) setLinkFrom(obj.id);
      else if (linkFrom !== obj.id) {
        onLink(linkFrom, obj.id);
        setLinkFrom(null);
      } else setLinkFrom(null);
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

    // Regla: mide una distancia cualquiera sobre el plano.
    if (tool === 'measure') {
      const p = toWorld(e.clientX, e.clientY);
      setMeasurement(null);
      setDrag({ kind: 'measure', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }

    if (tool !== 'select') {
      setLinkFrom(null);
      return;
    }
    onSelectConnection(null);
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
      const newZoom = clamp((start.zoom * st.dist) / start.dist, 8, 240);
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

    if (!drag) return;

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
      if (snap && !e.shiftKey) {
        const first = objectById.get(drag.ids[0]);
        if (first) {
          dx = snapTo(Number(first.x) + dx, grid) - Number(first.x);
          dy = snapTo(Number(first.y) + dy, grid) - Number(first.y);
        }
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
      if (snap && !e.shiftKey) {
        length = Math.max(0.05, snapTo(length, grid / 2));
        width = Math.max(0.05, snapTo(width, grid / 2));
      }
      setDrag({ ...drag, length, width });
      return;
    }

    if (drag.kind === 'rotate') {
      const obj = objectById.get(drag.id);
      if (!obj) return;
      const angle = (Math.atan2(p.y - Number(obj.y), p.x - Number(obj.x)) * 180) / Math.PI + 90;
      const rotation = e.shiftKey ? angle : Math.round(angle / 15) * 15;
      setDrag({ ...drag, rotation: ((rotation % 360) + 360) % 360 });
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
      for (const id of drag.ids) {
        const o = objectById.get(id);
        if (!o || o.locked) continue;
        updates.push({
          id,
          patch: { x: Number(o.x) + drag.dx, y: Number(o.y) + drag.dy },
          previous: { x: Number(o.x), y: Number(o.y) },
        });
      }
      if (updates.length) {
        onCommit(updates, updates.length > 1 ? `Mover ${updates.length} objetos` : 'Mover objeto');
      }
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

    if (drag.kind === 'rotate') {
      const o = objectById.get(drag.id);
      if (o && Number(o.rotation) !== drag.rotation) {
        onCommit(
          [
            {
              id: drag.id,
              patch: { rotation: drag.rotation },
              previous: { rotation: Number(o.rotation) },
            },
          ],
          'Rotar objeto',
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
      if (drag.kind === 'rotate' && drag.id === o.id) {
        return { ...o, rotation: drag.rotation };
      }
      return o;
    },
    [drag],
  );

  const selectedObjects = objects.filter((o) => selection.includes(o.id)).map(liveObject);
  const single = selectedObjects.length === 1 ? selectedObjects[0] : null;
  const strokePx = 1 / zoom;

  return (
    <div
      ref={containerRef}
      className="relative size-full overflow-hidden bg-[var(--ef-canvas-2)]"
      style={{ cursor: spaceDown ? 'grab' : tool !== 'select' ? 'crosshair' : 'default' }}
      onWheel={handleWheel}
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

          {/* Cables */}
          <g>
            {connections.map((c) => {
              if (c.kind === 'power' && !showPower) return null;
              if (c.kind === 'network' && !showNetwork) return null;
              const a = objectById.get(c.from_object_id);
              const b = objectById.get(c.to_object_id);
              if (!a || !b) return null;
              const la = liveObject(a);
              const lb = liveObject(b);
              const isSelected = selectedConnectionId === c.id;
              return (
                <g key={c.id}>
                  <line
                    x1={Number(la.x)}
                    y1={Number(la.y)}
                    x2={Number(lb.x)}
                    y2={Number(lb.y)}
                    stroke={c.color}
                    strokeWidth={(isSelected ? 3.5 : 2) * strokePx}
                    strokeDasharray={c.kind === 'network' ? `${strokePx * 6} ${strokePx * 4}` : undefined}
                    strokeLinecap="round"
                    opacity={0.9}
                  />
                  {/* Zona de click más ancha */}
                  <line
                    x1={Number(la.x)}
                    y1={Number(la.y)}
                    x2={Number(lb.x)}
                    y2={Number(lb.y)}
                    stroke="transparent"
                    strokeWidth={10 * strokePx}
                    className="cursor-pointer"
                    onPointerDown={(e) => {
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
              const l = Number(o.length_m);
              const w = Number(o.width_m);
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

                  {/* Marca de orientación (no aplica a texto ni líneas) */}
                  {o.shape !== 'text' && o.shape !== 'line' ? (
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
                      text={measureText(o)}
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
                cx={Number(single.length_m) / 2}
                cy={Number(single.width_m) / 2}
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
                  setDrag({ kind: 'rotate', id: single.id, rotation: Number(single.rotation) });
                }}
              />
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
