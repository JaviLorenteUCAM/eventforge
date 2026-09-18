import { useCallback, useEffect, useRef, useState } from 'react';
import type { TransportItem, TransportVehicle } from '@/lib/types';
import { footprintOf } from '@/lib/packing';
import { cn, fmtNum, snap as snapTo } from '@/lib/utils';

/**
 * Vista cenital de la caja de carga.
 *   eje X de pantalla  ->  ancho del vehiculo
 *   eje Y de pantalla  ->  largo del vehiculo (el morro queda arriba)
 * Los bultos se anclan por su esquina (x, y) y se dibujan con su huella real.
 */
export function LoadView2D({
  vehicle,
  items,
  selection,
  onSelect,
  onMove,
  invalidIds,
  layer,
}: {
  vehicle: TransportVehicle;
  items: TransportItem[];
  selection: string[];
  onSelect: (ids: string[]) => void;
  onMove: (id: string, x: number, y: number) => void;
  invalidIds: Set<string>;
  layer: number | 'all';
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 420 });
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; x: number; y: number } | null>(
    null,
  );

  const W = Number(vehicle.width_m);
  const L = Number(vehicle.length_m);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = 28;
  const scale = Math.max(
    8,
    Math.min((size.w - pad * 2) / Math.max(W, 0.1), (size.h - pad * 2) / Math.max(L, 0.1)),
  );
  const offsetX = (size.w - W * scale) / 2;
  const offsetY = (size.h - L * scale) / 2;

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - offsetX) / scale,
        y: (clientY - rect.top - offsetY) / scale,
      };
    },
    [offsetX, offsetY, scale],
  );

  const visible = items.filter((i) => layer === 'all' || Math.abs(Number(i.z) - layer) < 0.001);

  return (
    <div ref={wrapRef} className="relative size-full overflow-hidden bg-[var(--ef-canvas-2)]">
      <svg
        width={size.w}
        height={size.h}
        className="block touch-none select-none"
        onPointerMove={(e) => {
          if (!drag) return;
          const p = toWorld(e.clientX, e.clientY);
          setDrag({ ...drag, x: snapTo(p.x - drag.dx, 0.05), y: snapTo(p.y - drag.dy, 0.05) });
        }}
        onPointerUp={() => {
          if (drag) onMove(drag.id, Math.max(0, drag.x), Math.max(0, drag.y));
          setDrag(null);
        }}
        onPointerLeave={() => {
          if (drag) onMove(drag.id, Math.max(0, drag.x), Math.max(0, drag.y));
          setDrag(null);
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect([]);
        }}
      >
        <g transform={`translate(${offsetX},${offsetY}) scale(${scale})`}>
          {/* Caja de carga */}
          <rect x={0} y={0} width={W} height={L} fill="#0f172a" stroke="var(--ef-line-strong)" strokeWidth={2 / scale} />

          {/* Rejilla de 10 cm */}
          <g opacity={0.35}>
            {Array.from({ length: Math.floor(W / 0.5) }, (_, i) => (
              <line
                key={`v${i}`}
                x1={(i + 1) * 0.5}
                y1={0}
                x2={(i + 1) * 0.5}
                y2={L}
                stroke="var(--ef-grid)"
                strokeWidth={1 / scale}
              />
            ))}
            {Array.from({ length: Math.floor(L / 0.5) }, (_, i) => (
              <line
                key={`h${i}`}
                x1={0}
                y1={(i + 1) * 0.5}
                x2={W}
                y2={(i + 1) * 0.5}
                stroke="var(--ef-grid)"
                strokeWidth={1 / scale}
              />
            ))}
          </g>

          {/* Morro del vehículo (dentro de la caja, para no chocar con la cota) */}
          <text
            x={W / 2}
            y={0.16}
            textAnchor="middle"
            fill="var(--ef-dim)"
            fontSize={10 / scale}
            letterSpacing={2 / scale}
            pointerEvents="none"
          >
            CABINA
          </text>

          {visible.map((item) => {
            const { fx, fy } = footprintOf(item);
            const isDragging = drag?.id === item.id;
            const x = isDragging ? drag.x : Number(item.x);
            const y = isDragging ? drag.y : Number(item.y);
            const selected = selection.includes(item.id);
            const invalid = invalidIds.has(item.id);

            return (
              <g key={item.id} transform={`translate(${x},${y})`}>
                <rect
                  width={fx}
                  height={fy}
                  rx={0.02}
                  fill={`${item.color}66`}
                  stroke={invalid ? 'var(--ef-danger)' : selected ? 'var(--ef-accent-soft)' : item.color}
                  strokeWidth={(selected || invalid ? 2.5 : 1.5) / scale}
                  className="cursor-move"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelect([item.id]);
                    const p = toWorld(e.clientX, e.clientY);
                    setDrag({
                      id: item.id,
                      dx: p.x - Number(item.x),
                      dy: p.y - Number(item.y),
                      x: Number(item.x),
                      y: Number(item.y),
                    });
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                  }}
                />
                <text
                  x={fx / 2}
                  y={fy / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="var(--ef-text)"
                  fontSize={Math.min(11, fx * scale * 0.18) / scale}
                  pointerEvents="none"
                >
                  {item.label}
                </text>
                {Number(item.z) > 0 ? (
                  <text
                    x={fx / 2}
                    y={fy / 2 + 12 / scale}
                    textAnchor="middle"
                    fill="var(--ef-dim)"
                    fontSize={9 / scale}
                    pointerEvents="none"
                  >
                    apilado +{fmtNum(Number(item.z), 2)} m
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>

        {/* Cotas */}
        <text x={size.w / 2} y={offsetY - 10} textAnchor="middle" fill="var(--ef-muted)" fontSize={11}>
          {fmtNum(W, 2)} m
        </text>
        <text
          x={offsetX - 12}
          y={size.h / 2}
          textAnchor="middle"
          fill="var(--ef-muted)"
          fontSize={11}
          transform={`rotate(-90, ${offsetX - 12}, ${size.h / 2})`}
        >
          {fmtNum(L, 2)} m
        </text>
      </svg>

      <p className={cn('pointer-events-none absolute bottom-2 left-3 text-[11px] text-dim')}>
        Arrastra los bultos para reorganizarlos · ajuste de 5 cm
      </p>
    </div>
  );
}
