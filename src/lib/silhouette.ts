import { simplifyPath } from './geometry';
import type { Waypoint } from './types';

/**
 * SILUETA DE UNA IMAGEN
 *
 * Convierte una imagen con transparencia en contornos que se puedan extruir:
 * lo que es sólido pasa a ser volumen y lo transparente, aire. Es lo que
 * convierte el dibujo de un soporte de televisión en dos patas macizas unidas
 * por su base, en lugar de una caja con el frente recortado y los laterales
 * enteros.
 *
 * El proceso es: imagen → máscara binaria → contornos → polígonos.
 *
 * No importa React ni three.js a propósito: son cálculos puros.
 */

export interface SilhouetteResult {
  /** Contorno exterior de cada pieza, en coordenadas 0..1 de la imagen. */
  outers: Waypoint[][];
  /** Huecos, ya emparejados con la pieza que los contiene. */
  holes: Waypoint[][][];
}

/**
 * Máscara binaria de la imagen: 1 donde hay material, 0 donde se ve a través.
 *
 * Cuenta como transparente lo que tenga poco alfa y, si se indica, lo que se
 * parezca al color clave: así funciona igual con un PNG recortado que con un
 * dibujo en el que el hueco está pintado de magenta.
 */
export function maskFromImage(
  image: CanvasImageSource & { width: number; height: number },
  options: { keyColor?: string | null; keyTolerance?: number; maxSize?: number } = {},
): { mask: Uint8Array; width: number; height: number } | null {
  const { keyColor, keyTolerance = 0.12, maxSize = 256 } = options;

  // Se trabaja en pequeño: el contorno no gana nada con más resolución y el
  // trazado es cuadrático en número de píxeles.
  const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
  const w = Math.max(8, Math.round(image.width * scale));
  const h = Math.max(8, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }

  let kr = 0;
  let kg = 0;
  let kb = 0;
  if (keyColor) {
    const hex = keyColor.replace('#', '');
    kr = parseInt(hex.slice(0, 2), 16);
    kg = parseInt(hex.slice(2, 4), 16);
    kb = parseInt(hex.slice(4, 6), 16);
  }
  const limit = Math.max(0, Math.min(1, keyTolerance)) * 441.673;

  const px = data.data;
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (px[i + 3] < 128) continue;
    if (keyColor && Math.hypot(px[i] - kr, px[i + 1] - kg, px[i + 2] - kb) <= limit) continue;
    mask[p] = 1;
  }
  return { mask, width: w, height: h };
}

/**
 * Contornos de la máscara, siguiendo el borde entre píxeles llenos y vacíos.
 *
 * Se recorre cada borde con la regla de la mano derecha («moore boundary
 * tracing»): se avanza pegado al material girando siempre hacia el mismo lado,
 * que es la forma sencilla de no perderse en formas con recovecos.
 *
 * El signo del área dice si el contorno es una pieza o un hueco.
 */
export function traceContours(mask: Uint8Array, w: number, h: number): Waypoint[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const seen = new Set<string>();
  const loops: Waypoint[][] = [];

  // Direcciones en sentido horario alrededor de un píxel.
  const dirs = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue;
      // Solo arrancamos en un píxel de borde no visitado.
      if (at(x, y - 1) && at(x, y + 1) && at(x - 1, y) && at(x + 1, y)) continue;
      if (seen.has(`${x},${y}`)) continue;

      const loop: Waypoint[] = [];
      let cx = x;
      let cy = y;
      let dir = 0;
      const startX = x;
      const startY = y;
      let guard = 0;

      do {
        loop.push({ x: cx, y: cy });
        seen.add(`${cx},${cy}`);

        // Se gira a la izquierda del sentido de avance y se busca el primer
        // vecino lleno dando la vuelta en sentido horario.
        let found = false;
        for (let i = 0; i < 8; i++) {
          const d = (dir + 6 + i) % 8;
          const nx = cx + dirs[d][0];
          const ny = cy + dirs[d][1];
          if (at(nx, ny)) {
            cx = nx;
            cy = ny;
            dir = d;
            found = true;
            break;
          }
        }
        if (!found) break; // píxel suelto
        guard++;
      } while ((cx !== startX || cy !== startY) && guard < w * h * 4);

      if (loop.length >= 8) loops.push(loop);
    }
  }

  return loops;
}

/** Área con signo: positiva si el recorrido va en sentido antihorario. */
export function signedArea(points: Waypoint[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** ¿El punto cae dentro del polígono? (regla par-impar) */
export function pointInPolygon(p: Waypoint, poly: Waypoint[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Silueta lista para extruir: piezas y huecos en coordenadas 0..1, con el
 * origen abajo a la izquierda (como los ejes de three.js, no como los de una
 * imagen).
 *
 * `tolerance` está en píxeles de la máscara: 1,2 quita el dentado de los
 * bordes sin comerse las esquinas.
 */
export function silhouetteFromImage(
  image: CanvasImageSource & { width: number; height: number },
  options: { keyColor?: string | null; keyTolerance?: number; tolerance?: number } = {},
): SilhouetteResult | null {
  const m = maskFromImage(image, options);
  if (!m) return null;

  const { mask, width, height } = m;
  const loops = traceContours(mask, width, height)
    .map((loop) => simplifyPath(loop, options.tolerance ?? 1.2))
    .filter((loop) => loop.length >= 3);

  if (loops.length === 0) return null;

  // A coordenadas 0..1 con la y hacia arriba.
  const norm = (loop: Waypoint[]) =>
    loop.map((p) => ({ x: p.x / (width - 1), y: 1 - p.y / (height - 1) }));

  const pieces = loops
    .map((loop) => ({ points: norm(loop), area: Math.abs(signedArea(loop)) }))
    // Fuera el ruido: manchas de menos del 0,2 % de la imagen.
    .filter((p) => p.area > width * height * 0.002)
    .sort((a, b) => b.area - a.area);

  if (pieces.length === 0) return null;

  // El contorno más grande que no esté dentro de otro es una pieza; los que
  // caen dentro de una pieza son huecos suyos.
  const outers: Waypoint[][] = [];
  const holes: Waypoint[][][] = [];

  for (const piece of pieces) {
    const probe = piece.points[0];
    const parent = outers.findIndex((o) => pointInPolygon(probe, o));
    if (parent === -1) {
      outers.push(piece.points);
      holes.push([]);
    } else {
      // Solo un nivel de anidamiento: un hueco dentro de un hueco vuelve a ser
      // material, pero eso no pasa dibujando soportes ni estructuras.
      const insideHole = holes[parent].some((hole) => pointInPolygon(probe, hole));
      if (!insideHole) holes[parent].push(piece.points);
    }
  }

  return { outers, holes };
}
