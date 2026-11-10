import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { PlanBackground } from '@/lib/types';
import { round } from '@/lib/utils';
import { loadModel } from './modelLoader';

/**
 * PLANTA DEL MODELO DEL RECINTO
 * ---------------------------------------------------------------------------
 * Colocar el modelo mirando el 3D era casi imposible: las cubiertas están a
 * cuatro o seis metros y, con la cámara un poco inclinada, la perspectiva las
 * desplaza respecto al suelo. El 2D, en cambio, es una vista cenital exacta.
 *
 * Aquí se saca del propio .glb lo que se ve desde arriba —las caras que miran
 * hacia arriba (cubiertas) y, aparte, los pilares— como trazados SVG en el
 * marco del modelo. El 2D los dibuja sobre la foto con el mismo encaje que el
 * 3D, y así se puede arrastrar, girar y escalar el modelo hasta que cuadre.
 *
 * Los pilares se reconocen por el nombre del material («Pilares», «pillar»,
 * «column»…). Un modelo que no los nombre se ve igual, solo con cubiertas.
 */

export interface Footprint {
  /** Trazado de las caras que miran hacia arriba, en metros del modelo (X, Z). */
  roofs: string;
  /** Trazado de las cabezas de los pilares. */
  pillars: string;
  /**
   * Lo que TOCA EL SUELO, en triángulos (x, z, x, z, x, z): las caras de abajo
   * que quedan a ras de suelo. En unas pérgolas, las bases de los pilares. No
   * depende de cómo se llamen los materiales, así que vale para cualquier
   * modelo. Es lo que el plano exportado dibuja en negro macizo.
   */
  contact: number[];
  /**
   * Contorno de las cubiertas, en segmentos (x1, z1, x2, z2): las aristas que
   * solo tiene un triángulo, es decir, el borde exterior de cada faldón o
   * techo, sin las líneas internas de la triangulación.
   */
  roofEdges: number[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Medidas de la imagen para la que se hizo, si el modelo las trae. */
  frame: { width: number; height: number } | null;
}

const PILLAR = /pilar|pillar|column|post|poste/i;
/** Lo que está bajo la cubierta y no forma parte de su contorno. */
const UNDER_ROOF = /viga|beam|pilar|pillar|column|post|poste/i;
/** Hasta qué altura sobre lo más bajo del modelo se considera «suelo». */
const GROUND = 0.05;
const cache = new Map<string, Promise<Footprint>>();

function compute(scene: THREE.Group): Footprint {
  scene.updateMatrixWorld(true);
  const roofs: string[] = [];
  const pillars: string[] = [];
  const contact: number[] = [];
  // Aristas de las cubiertas: cuántos triángulos comparten cada una.
  const edges = new Map<string, { n: number; seg: number[] }>();
  const key = (v: THREE.Vector3) => `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
  const addEdge = (p: THREE.Vector3, q: THREE.Vector3) => {
    const kp = key(p);
    const kq = key(q);
    const k = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
    const e = edges.get(k);
    if (e) e.n++;
    else edges.set(k, { n: 1, seg: [p.x, p.z, q.x, q.z] });
  };
  const bottom = new THREE.Box3().setFromObject(scene).min.y;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const f = (v: number) => v.toFixed(2);

  scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const isPillar = PILLAR.test(material?.name ?? '');
    const underRoof = UNDER_ROOF.test(material?.name ?? '');
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;

    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(mesh.matrixWorld);
      for (const v of [a, b, c]) {
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z);
        maxZ = Math.max(maxZ, v.z);
      }
      const n = ab.subVectors(b, a).cross(ac.subVectors(c, a));
      const len = n.length();
      if (len === 0) continue;
      const ny = n.y / len;
      const tri = `M${f(a.x)} ${f(a.z)}L${f(b.x)} ${f(b.z)}L${f(c.x)} ${f(c.z)}Z`;
      if (isPillar) {
        if (ny > 0.5) pillars.push(tri);
      } else if (ny > 0.25) {
        roofs.push(tri);
      }
      if (ny > 0.25 && !underRoof) {
        addEdge(a, b);
        addEdge(b, c);
        addEdge(c, a);
      }
      // A ras de suelo y mirando hacia abajo: es lo que se apoya en el suelo.
      if (ny < -0.5 && Math.max(a.y, b.y, c.y) < bottom + GROUND) {
        contact.push(a.x, a.z, b.x, b.z, c.x, c.z);
      }
    }
  });

  const extras = (scene.userData as { eventforge?: { imageWidthM?: number; imageHeightM?: number } })
    .eventforge;
  const roofEdges: number[] = [];
  for (const e of edges.values()) if (e.n === 1) roofEdges.push(...e.seg);

  return {
    roofs: roofs.join(''),
    pillars: pillars.join(''),
    contact,
    roofEdges,
    minX,
    maxX,
    minZ,
    maxZ,
    frame:
      extras?.imageWidthM && extras.imageHeightM
        ? { width: extras.imageWidthM, height: extras.imageHeightM }
        : null,
  };
}

export function loadFootprint(url: string): Promise<Footprint> {
  const key = url.split('?')[0];
  let promise = cache.get(key);
  if (!promise) {
    promise = loadModel(url).then(compute);
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);
  }
  return promise;
}

/** Planta de un modelo, o null mientras carga o si falla. */
export function useFootprint(url: string | undefined): Footprint | null {
  const [footprint, setFootprint] = useState<Footprint | null>(null);
  useEffect(() => {
    if (!url) {
      setFootprint(null);
      return;
    }
    let alive = true;
    loadFootprint(url).then(
      (fp) => {
        if (alive) setFootprint(fp);
      },
      () => {
        if (alive) setFootprint(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return footprint;
}

// ---------------------------------------------------------------------------
// Encaje: del marco del modelo al plano
// ---------------------------------------------------------------------------

/** Lo que coloca el modelo: la capa y su ajuste. */
export interface ModelPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
  extraRotation: number;
  scale: number;
}

export function placementOf(b: PlanBackground): ModelPlacement {
  return {
    x: Number(b.x),
    y: Number(b.y),
    width: Number(b.width_m),
    height: Number(b.height_m),
    rotation: Number(b.rotation),
    offsetX: Number(b.model_offset_x ?? 0),
    offsetY: Number(b.model_offset_y ?? 0),
    extraRotation: Number(b.model_rotation ?? 0),
    scale: Number(b.model_scale ?? 1),
  };
}

/**
 * Escala del marco del modelo al plano: LA MISMA EN LOS DOS EJES.
 *
 * Antes se escalaba el ancho y el alto por separado para que el modelo llenara
 * la imagen. Con la misma captura daba igual, pero con otra foto de distinta
 * proporción el estirado era desigual y, como el modelo va girado dentro de la
 * imagen, los pabellones cuadrados salían como rombos: imposible cuadrarlos.
 *
 *   · Misma captura (misma proporción): se encaja exacto con la calibración de
 *     la capa.
 *   · Otra imagen: el modelo va a su tamaño real, en metros, y solo hay que
 *     moverlo y girarlo (la escala del ajuste queda para afinar).
 */
export function frameScale(
  width: number,
  height: number,
  frame: { width: number; height: number } | null,
): number {
  if (!frame) return 1;
  const sx = width / frame.width;
  const sz = height / frame.height;
  return Math.abs(sx / sz - 1) < 0.015 ? (sx + sz) / 2 : 1;
}

/**
 * Transformación SVG del marco del modelo al plano. Es exactamente la del 3D
 * (EnvironmentModel): un giro de -θ alrededor del eje vertical en three.js es
 * un rotate(θ) en el SVG, que tiene la Y hacia abajo.
 */
export function placementTransform(p: ModelPlacement, fp: Footprint): string {
  const s = frameScale(p.width, p.height, fp.frame);
  return (
    `translate(${p.x + p.width / 2 + p.offsetX} ${p.y + p.height / 2 + p.offsetY}) ` +
    `rotate(${p.rotation + p.extraRotation}) scale(${p.scale > 0 ? p.scale : 1}) ` +
    `translate(${-p.width / 2} ${-p.height / 2}) scale(${s})`
  );
}

/** Un punto del marco del modelo, llevado al plano. */
export function modelToPlan(p: ModelPlacement, fp: Footprint, mx: number, mz: number) {
  const s = frameScale(p.width, p.height, fp.frame);
  const k = p.scale > 0 ? p.scale : 1;
  const u = (mx * s - p.width / 2) * k;
  const v = (mz * s - p.height / 2) * k;
  const t = ((p.rotation + p.extraRotation) * Math.PI) / 180;
  return {
    x: p.x + p.width / 2 + p.offsetX + u * Math.cos(t) - v * Math.sin(t),
    y: p.y + p.height / 2 + p.offsetY + u * Math.sin(t) + v * Math.cos(t),
  };
}

/** Centro de la planta del modelo (en su marco). */
export function footprintCentre(fp: Footprint) {
  return { x: (fp.minX + fp.maxX) / 2, z: (fp.minZ + fp.maxZ) / 2 };
}

/**
 * Nuevo giro y escala SIN que el modelo se mueva de sitio: el desplazamiento
 * se corrige para que el centro de su planta se quede donde estaba. Girar o
 * escalar alrededor del centro de la foto lo mandaba lejos cuando el modelo
 * ocupa solo una parte de ella.
 */
export function aroundCentre(
  p: ModelPlacement,
  fp: Footprint,
  extraRotation: number,
  scale: number,
): { model_offset_x: number; model_offset_y: number; model_rotation: number; model_scale: number } {
  const c = footprintCentre(fp);
  const before = modelToPlan(p, fp, c.x, c.z);
  const after = modelToPlan({ ...p, extraRotation, scale }, fp, c.x, c.z);
  return {
    model_offset_x: round(p.offsetX + before.x - after.x, 3),
    model_offset_y: round(p.offsetY + before.y - after.y, 3),
    model_rotation: round(extraRotation, 2),
    model_scale: round(scale, 3),
  };
}
