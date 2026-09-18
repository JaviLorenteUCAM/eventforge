import type { PlanConnection, PlanObject, Waypoint } from './types';
import { round } from './utils';

/**
 * GEOMETRÍA DEL PLANO
 *
 * Todo en METROS y en el mismo sistema que el editor:
 *   x -> izquierda a derecha
 *   y -> arriba a abajo
 *   (x, y) es el CENTRO del objeto y `rotation` gira alrededor de ese centro.
 *   z -> altura de la BASE sobre el suelo; la parte alta es z + height_m.
 *
 * Este archivo no importa React a propósito: son cálculos puros, fáciles de
 * razonar y de probar por separado.
 */

/** ¿El punto cae dentro del objeto, teniendo en cuenta su rotación? */
export function containsPoint(o: PlanObject, px: number, py: number, margin = 0): boolean {
  const cx = Number(o.x);
  const cy = Number(o.y);
  const rad = (-Number(o.rotation) * Math.PI) / 180;
  // Llevamos el punto al espacio local del objeto (deshaciendo su giro).
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return (
    Math.abs(lx) <= Number(o.length_m) / 2 + margin &&
    Math.abs(ly) <= Number(o.width_m) / 2 + margin
  );
}

/**
 * Objeto que hay bajo un punto. Devuelve el ÚLTIMO de la lista que lo contiene,
 * que es el que se dibuja encima y por tanto el que el usuario ve.
 */
export function objectAt(
  objects: PlanObject[],
  px: number,
  py: number,
  options: { ignore?: Set<string>; margin?: number } = {},
): PlanObject | null {
  const { ignore, margin = 0 } = options;
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i];
    if (ignore?.has(o.id)) continue;
    if (containsPoint(o, px, py, margin)) return o;
  }
  return null;
}

/** Objetos sobre los que no tiene sentido apoyar nada. */
const NOT_STACKABLE = new Set(['text', 'line']);

/**
 * Altura a la que debería quedar la BASE de un objeto colocado en (x, y).
 *
 * Si debajo hay algo —una mesa, una tarima— se apoya encima en lugar de
 * atravesarlo. Si no hay nada, se queda en el suelo. Solo cuentan los objetos
 * cuyo centro queda tapado: basta con que el punto de destino caiga dentro.
 */
export function restingZ(
  objects: PlanObject[],
  x: number,
  y: number,
  ignore: Set<string> = new Set(),
): number {
  let top = 0;
  for (const o of objects) {
    if (ignore.has(o.id)) continue;
    if (NOT_STACKABLE.has(o.shape)) continue;
    if (!containsPoint(o, x, y)) continue;
    const candidate = Number(o.z) + Number(o.height_m);
    if (candidate > top) top = candidate;
  }
  return round(top, 3);
}

/** Centro geométrico de un objeto, en planta. */
export const centerOf = (o: PlanObject) => ({ x: Number(o.x), y: Number(o.y) });

/** Altura del punto por el que se conecta un cable: el centro vertical. */
export const anchorZ = (o: PlanObject) => Number(o.z ?? 0) + Number(o.height_m ?? 0) / 2;

/**
 * Trazado completo de un cable: origen, puntos intermedios y destino.
 * Los extremos siempre son los objetos, de modo que al mover uno el cable lo
 * sigue sin tener que reescribir el trazo.
 */
export function cablePath(a: PlanObject, b: PlanObject, waypoints: Waypoint[] = []): Waypoint[] {
  const mid = (waypoints ?? []).filter(
    (p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)),
  );
  return [centerOf(a), ...mid.map((p) => ({ x: Number(p.x), y: Number(p.y) })), centerOf(b)];
}

/**
 * Metros reales de cable: se recorre el trazado en planta y se le suma el
 * desnivel entre los dos extremos. Sin holgura: eso lo añade quien llama.
 */
export function cableLength(a: PlanObject, b: PlanObject, waypoints: Waypoint[] = []): number {
  const path = cablePath(a, b, waypoints);
  let flat = 0;
  for (let i = 1; i < path.length; i++) {
    flat += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  const dz = Math.abs(anchorZ(a) - anchorZ(b));
  return round(Math.hypot(flat, dz), 3);
}

/** `d` de un <path> SVG que pasa por todos los puntos. */
export function pathD(points: Waypoint[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

/**
 * Quita los puntos que no aportan nada al trazo.
 *
 * Al dibujar a mano llegan decenas de puntos por segundo; guardarlos todos
 * hincharía la fila y no cambiaría el dibujo. Se aplica Douglas-Peucker con
 * una tolerancia en metros: se conservan las curvas y se tiran los puntos que
 * caen prácticamente sobre la recta anterior.
 */
export function simplifyPath(points: Waypoint[], tolerance = 0.08): Waypoint[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist <= tolerance) return [first, last];

  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function distanceToSegment(p: Waypoint, a: Waypoint, b: Waypoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Longitud de un cable ya guardado, para recalcularla al mover un objeto. */
export function connectionLength(
  c: PlanConnection,
  byId: Map<string, PlanObject>,
): number | null {
  const a = byId.get(c.from_object_id);
  const b = byId.get(c.to_object_id);
  if (!a || !b) return null;
  return cableLength(a, b, c.waypoints ?? []);
}
