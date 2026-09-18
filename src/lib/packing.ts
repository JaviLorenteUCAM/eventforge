import type { TransportItem, TransportVehicle } from './types';
import { round } from './utils';

/**
 * SIMULACION DE CARGA (V1)
 *
 * Sistema de coordenadas de la caja de carga, en metros:
 *
 *      X -> ancho del vehiculo   (0 .. vehicle.width_m)
 *      Y -> largo del vehiculo   (0 .. vehicle.length_m)   "profundidad"
 *      Z -> alto                 (0 .. vehicle.height_m)   apilado
 *
 * Cada bulto guarda su posicion (x, y, z) y una rotacion de 0 o 90 grados.
 * El colocador automatico usa un algoritmo de estanterias por capas: ordena los
 * bultos de mayor a menor superficie, los coloca en filas a lo largo de X y,
 * cuando se acaba el fondo, empieza una capa nueva encima.
 *
 * Evolucion futura documentada en docs/ARQUITECTURA.md: sustituir por un
 * empaquetado 3D con huecos (guillotine / maximal rectangles) y restricciones
 * de fragilidad y orden de descarga.
 */

export interface Footprint {
  fx: number;
  fy: number;
}

export function footprintOf(item: Pick<TransportItem, 'length_m' | 'width_m' | 'rotation'>): Footprint {
  const rotated = Math.abs(Math.round(Number(item.rotation) / 90)) % 2 === 1;
  return rotated
    ? { fx: Number(item.width_m), fy: Number(item.length_m) }
    : { fx: Number(item.length_m), fy: Number(item.width_m) };
}

export interface LoadMetrics {
  itemCount: number;
  totalWeightKg: number;
  usedVolumeM3: number;
  vehicleVolumeM3: number;
  occupancyPct: number;
  weightPct: number;
  overweight: boolean;
  outOfBounds: string[];
  overlapping: string[];
  fits: boolean;
  missingVolumeM3: number;
}

export function computeLoadMetrics(
  items: TransportItem[],
  vehicle: TransportVehicle | null | undefined,
): LoadMetrics {
  const usedVolume = items.reduce(
    (s, i) => s + Number(i.length_m) * Number(i.width_m) * Number(i.height_m) * (i.quantity || 1),
    0,
  );
  const totalWeight = items.reduce((s, i) => s + Number(i.weight_kg) * (i.quantity || 1), 0);

  const vehicleVolume = vehicle
    ? Number(vehicle.length_m) * Number(vehicle.width_m) * Number(vehicle.height_m)
    : 0;

  const outOfBounds: string[] = [];
  const overlapping: string[] = [];

  if (vehicle) {
    for (const item of items) {
      const { fx, fy } = footprintOf(item);
      const x = Number(item.x);
      const y = Number(item.y);
      const z = Number(item.z);
      if (
        x < -0.001 ||
        y < -0.001 ||
        z < -0.001 ||
        x + fx > Number(vehicle.width_m) + 0.001 ||
        y + fy > Number(vehicle.length_m) + 0.001 ||
        z + Number(item.height_m) > Number(vehicle.height_m) + 0.001
      ) {
        outOfBounds.push(item.id);
      }
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (boxesOverlap(items[i], items[j])) {
          overlapping.push(items[i].id, items[j].id);
        }
      }
    }
  }

  const occupancy = vehicleVolume > 0 ? (usedVolume / vehicleVolume) * 100 : 0;
  const maxWeight = vehicle ? Number(vehicle.max_weight_kg) : 0;
  const weightPct = maxWeight > 0 ? (totalWeight / maxWeight) * 100 : 0;

  return {
    itemCount: items.length,
    totalWeightKg: round(totalWeight, 1),
    usedVolumeM3: round(usedVolume, 3),
    vehicleVolumeM3: round(vehicleVolume, 3),
    occupancyPct: round(occupancy, 1),
    weightPct: round(weightPct, 1),
    overweight: maxWeight > 0 && totalWeight > maxWeight,
    outOfBounds,
    overlapping: [...new Set(overlapping)],
    fits: usedVolume <= vehicleVolume && outOfBounds.length === 0,
    missingVolumeM3: round(Math.max(0, usedVolume - vehicleVolume), 3),
  };
}

const EPS = 0.002;

export function boxesOverlap(a: TransportItem, b: TransportItem): boolean {
  const fa = footprintOf(a);
  const fb = footprintOf(b);
  const overlapX = Number(a.x) < Number(b.x) + fb.fx - EPS && Number(b.x) < Number(a.x) + fa.fx - EPS;
  const overlapY = Number(a.y) < Number(b.y) + fb.fy - EPS && Number(b.y) < Number(a.y) + fa.fy - EPS;
  const overlapZ =
    Number(a.z) < Number(b.z) + Number(b.height_m) - EPS &&
    Number(b.z) < Number(a.z) + Number(a.height_m) - EPS;
  return overlapX && overlapY && overlapZ;
}

export interface PackResult {
  positions: { id: string; x: number; y: number; z: number; rotation: number }[];
  unplaced: string[];
}

/**
 * Altura a la que queda apoyado un bulto: la cota más alta de lo que ya hay
 * justo debajo de su huella. Si no hay nada debajo, el suelo (0).
 * Es lo que evita que los bultos "floten" al colocarlos.
 */
export function restingHeight(
  items: { x: number | string; y: number | string; z: number | string; height_m: number | string; length_m: number | string; width_m: number | string; rotation: number | string }[],
  x: number,
  y: number,
  fx: number,
  fy: number,
): number {
  let top = 0;
  for (const it of items) {
    const f = footprintOf(it as Pick<TransportItem, 'length_m' | 'width_m' | 'rotation'>);
    const overlaps =
      x < Number(it.x) + f.fx - EPS &&
      Number(it.x) < x + fx - EPS &&
      y < Number(it.y) + f.fy - EPS &&
      Number(it.y) < y + fy - EPS;
    if (overlaps) top = Math.max(top, Number(it.z) + Number(it.height_m));
  }
  return round(top, 3);
}

/**
 * Colocacion automatica por capas. No pretende ser optima: pretende dar un
 * punto de partida razonable que luego se ajusta a mano arrastrando bultos.
 */
export function autoPack(items: TransportItem[], vehicle: TransportVehicle): PackResult {
  const W = Number(vehicle.width_m);
  const L = Number(vehicle.length_m);
  const H = Number(vehicle.height_m);

  const sorted = [...items].sort((a, b) => {
    const areaA = Number(a.length_m) * Number(a.width_m);
    const areaB = Number(b.length_m) * Number(b.width_m);
    if (areaB !== areaA) return areaB - areaA;
    return Number(b.height_m) - Number(a.height_m);
  });

  const positions: PackResult['positions'] = [];
  const placed: TransportItem[] = [];
  const unplaced: string[] = [];

  let cursorX = 0;
  let cursorY = 0;
  let layerZ = 0;
  let rowDepth = 0; // fondo maximo de la fila actual
  let layerHeight = 0; // alto maximo de la capa actual

  for (const item of sorted) {
    const l = Number(item.length_m);
    const w = Number(item.width_m);
    const h = Number(item.height_m);

    // Elegimos orientacion: la que quepa mejor a lo ancho.
    let rotation = 0;
    let fx = l;
    let fy = w;
    if (fx > W && w <= W) {
      rotation = 90;
      fx = w;
      fy = l;
    }

    if (fx > W || fy > L || h > H) {
      unplaced.push(item.id);
      continue;
    }

    // ¿Cabe en la fila actual?
    if (cursorX + fx > W + EPS) {
      cursorX = 0;
      cursorY += rowDepth;
      rowDepth = 0;
    }
    // ¿Cabe en la capa actual?
    if (cursorY + fy > L + EPS) {
      cursorY = 0;
      cursorX = 0;
      rowDepth = 0;
      layerZ += layerHeight;
      layerHeight = 0;
    }
    // Asentamos el bulto sobre lo que realmente hay debajo, para que no quede
    // flotando cuando la capa anterior solo era alta en otra zona del suelo.
    const restZ = restingHeight(placed, cursorX, cursorY, fx, fy);

    // ¿Cabe en altura?
    if (restZ + h > H + EPS) {
      unplaced.push(item.id);
      continue;
    }

    const position = {
      id: item.id,
      x: round(cursorX),
      y: round(cursorY),
      z: round(restZ),
      rotation,
    };
    positions.push(position);
    placed.push({ ...item, ...position });

    cursorX += fx;
    rowDepth = Math.max(rowDepth, fy);
    layerHeight = Math.max(layerHeight, h);
  }

  return { positions, unplaced };
}

/** Comprueba si una posicion propuesta es valida (dentro y sin solapes). */
export function isPlacementValid(
  candidate: TransportItem,
  others: TransportItem[],
  vehicle: TransportVehicle,
): { inside: boolean; collides: boolean } {
  const { fx, fy } = footprintOf(candidate);
  const inside =
    Number(candidate.x) >= -EPS &&
    Number(candidate.y) >= -EPS &&
    Number(candidate.z) >= -EPS &&
    Number(candidate.x) + fx <= Number(vehicle.width_m) + EPS &&
    Number(candidate.y) + fy <= Number(vehicle.length_m) + EPS &&
    Number(candidate.z) + Number(candidate.height_m) <= Number(vehicle.height_m) + EPS;

  const collides = others.some((o) => o.id !== candidate.id && boxesOverlap(candidate, o));
  return { inside, collides };
}
