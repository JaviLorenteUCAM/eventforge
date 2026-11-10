/**
 * MODELO 3D DE LAS PÉRGOLAS DE LA UCAM, A PARTIR DE LA VISTA AÉREA
 * ---------------------------------------------------------------------------
 * No hay un modelo público de esa zona: OpenStreetMap no tiene las pérgolas y
 * el 3D de Google no se puede extraer. Este script lo construye midiendo la
 * vista aérea:
 *
 *   · Escala: los pasos de cebra (bandas de 0,5 m con 0,5 m de separación)
 *     dan 9,73 px por metro de periodo → 0,1028 m/px. Las bandas de 4 m del
 *     paso de la avenida cuadran con esa misma escala.
 *   · Orientación: las pérgolas siguen una retícula girada 48,5° respecto a la
 *     foto. Las piezas se midieron sobre la foto girada (donde cada techado es
 *     un rectángulo recto) y aquí se devuelven a la orientación original.
 *   · Lo que hay: 7 pabellones de cubierta piramidal con lucernario en el
 *     vértice y 9 pasos cubiertos de techo plano de unos 4 m de ancho.
 *
 * Desde arriba no se ven los pilares ni las alturas: van como SUPUESTOS en los
 * parámetros de abajo, para corregirlos en cuanto se conozcan las medidas
 * reales.
 *
 * El modelo se coloca en el MARCO DE LA IMAGEN: origen en su esquina superior
 * izquierda, X hacia la derecha y Z hacia abajo, en metros. Lleva en los
 * «extras» de la escena las medidas de la imagen, de modo que EventForge lo
 * encaja sobre la foto de fondo calibrada y hereda su escala y su giro.
 *
 * Uso:
 *   node tools/modelos/pergolas_ucam.mjs <aerea.png|webp> <salida.glb> <ffmpeg.exe>
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';

// --- Supuestos (ajustables) ----------------------------------------------
const ALTURA_ALERO = 3.9; // cara inferior de las cubiertas piramidales
const ALTURA_PASOS = 3.7; // cara superior de los techos planos
const PENDIENTE = 27; // grados de las cubiertas de teja
const VUELO = 0.6; // alero: distancia del borde de la cubierta a los pilares
const PILAR_PABELLON = 0.4; // sección de los pilares de los pabellones
const PILAR_PASO = 0.25; // sección de los pilares de los pasos cubiertos
const SEPARACION_PILARES = 4.5; // máximo entre pilares de un paso cubierto
const LUCERNARIO = 1.7; // lado del lucernario del vértice

// --- Medidas de la foto ---------------------------------------------------
const IMG_W = 1152;
const IMG_H = 769;
const S = 1 / 9.73; // metros por píxel
const THETA = (48.5 * Math.PI) / 180;
const C_IN = [576, 384.5]; // centro de la foto original
const C_OUT = [669.5, 686]; // centro de la foto girada

/**
 * Píxeles de la foto girada → metros en el marco de la foto original.
 * (Es la inversa del giro con el que se midió.)
 */
function toWorld(xr, yr) {
  const dx = xr - C_OUT[0];
  const dy = yr - C_OUT[1];
  const c = Math.cos(THETA);
  const s = Math.sin(THETA);
  return [(C_IN[0] + dx * c - dy * s) * S, (C_IN[1] + dx * s + dy * c) * S];
}

// Rectángulos medidos en la foto girada: [x0, x1, y0, y1] en píxeles.
const PABELLONES = {
  A: [587.5, 675, 302.5, 380],
  B1: [577.5, 682.5, 462.5, 567.5],
  B2: [740, 845, 462.5, 567.5],
  B3: [902.5, 1010, 465, 570],
  C1: [577.5, 682.5, 675, 780],
  C2: [740, 845, 675, 780],
  C3: [902.5, 1010, 677.5, 780],
};
// Pasos cubiertos claros (norte-sur en la foto girada) y grises (este-oeste).
const PASOS_CLAROS = [
  [610, 647.5, 380, 462.5],
  [770, 812.5, 340, 462.5],
  [932.5, 977.5, 340, 465],
  [607.5, 647.5, 567.5, 675],
  [935, 977.5, 570, 677.5],
];
const PASOS_GRISES = [
  [682.5, 740, 492.5, 530],
  [845, 902.5, 495, 530],
  [682.5, 740, 705, 745],
  [845, 902.5, 702.5, 745],
];

const [photoPath, outPath, ffmpeg] = process.argv.slice(2);
if (!photoPath || !outPath || !ffmpeg) {
  console.error('Uso: node pergolas_ucam.mjs <aerea> <salida.glb> <ffmpeg>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

const parts = {
  roof: [], // caras de arriba: llevan la foto aérea proyectada
  tile: [], // cantos de las cubiertas de teja
  slabLight: [], // cantos y cara inferior de los techos planos claros
  slabGrey: [], // ídem, grises
  pillar: [],
  beam: [],
  glass: [],
};

/**
 * Coloca una geometría construida en el marco local de una pieza (u a lo largo
 * del eje X de la foto girada, v a lo largo de su eje Y, en metros desde el
 * centro de la pieza) en el marco de la foto original.
 */
function placeLocal(geo, cxr, cyr) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const c = Math.cos(THETA);
  const s = Math.sin(THETA);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) / S + cxr;
    const v = pos.getZ(i) / S + cyr;
    const [X, Z] = toWorld(u, v);
    pos.setXYZ(i, X, pos.getY(i), Z);
    if (nor) {
      const nx = nor.getX(i);
      const nz = nor.getZ(i);
      nor.setXYZ(i, nx * c - nz * s, nor.getY(i), nx * s + nz * c);
    }
  }
  return geo;
}

const box = (w, h, d, x, y, z) =>
  new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();

/** Cuatro caras de un tronco de pirámide (o pirámide si top = 0), mirando hacia fuera. */
function frustum(base, top, y0, y1) {
  const g = new THREE.BufferGeometry();
  const P = [];
  const corners = (h, y) => [
    [-h, y, -h],
    [h, y, -h],
    [h, y, h],
    [-h, y, h],
  ];
  const b = corners(base, y0);
  const t = corners(top, y1);
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    // Orden antihorario visto desde fuera.
    P.push(...b[k], ...t[n], ...b[n]);
    if (top > 0) P.push(...b[k], ...t[k], ...t[n]);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.computeVertexNormals();
  return g;
}

/** Cara horizontal (techo visto desde abajo o desde arriba). */
function flat(w, d, y, up) {
  const g = new THREE.PlaneGeometry(w, d).rotateX(up ? -Math.PI / 2 : Math.PI / 2);
  return g.translate(0, y, 0).toNonIndexed();
}

/** Pabellón de cubierta piramidal con lucernario, vigas y cuatro pilares. */
function pavilion([x0, x1, y0, y1]) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const side = ((x1 - x0 + (y1 - y0)) / 2) * S;
  const half = side / 2;
  const t = LUCERNARIO / 2;
  const rise = (half - t) * Math.tan((PENDIENTE * Math.PI) / 180);
  const eave = ALTURA_ALERO;
  const fascia = 0.22;
  const top = eave + fascia + rise;

  // Faldones (con la foto) y el canto del alero.
  parts.roof.push(placeLocal(frustum(half, t, eave + fascia, top), cx, cy));
  parts.tile.push(placeLocal(frustum(half, half, eave, eave + fascia), cx, cy));
  parts.tile.push(placeLocal(flat(side, side, eave, false), cx, cy));

  // Lucernario: pirámide de vidrio sobre el hueco del vértice.
  parts.glass.push(placeLocal(frustum(t, 0, top, top + t * 0.9), cx, cy));
  parts.beam.push(placeLocal(frustum(t + 0.06, t + 0.06, top - 0.05, top + 0.04), cx, cy));

  // Pilares en las esquinas, metidos el vuelo del alero, y vigas de borde.
  const inset = half - VUELO;
  for (const [su, sv] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    parts.pillar.push(
      placeLocal(box(PILAR_PABELLON, eave, PILAR_PABELLON, su * inset, eave / 2, sv * inset), cx, cy),
    );
  }
  const beamH = 0.45;
  const beamW = 0.3;
  for (const s of [-1, 1]) {
    parts.beam.push(placeLocal(box(inset * 2 + beamW, beamH, beamW, 0, eave - beamH / 2, s * inset), cx, cy));
    parts.beam.push(placeLocal(box(beamW, beamH, inset * 2 + beamW, s * inset, eave - beamH / 2, 0), cx, cy));
  }
}

/** Paso cubierto de techo plano con pilares a ambos lados. */
function walkway([x0, x1, y0, y1], tone) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = (x1 - x0) * S;
  const d = (y1 - y0) * S;
  const slab = 0.22;
  const topY = ALTURA_PASOS;
  const target = tone === 'light' ? parts.slabLight : parts.slabGrey;

  parts.roof.push(placeLocal(flat(w, d, topY, true), cx, cy));
  // Cantos y cara de abajo: una caja sin la tapa de arriba sería más fiel,
  // pero la tapa queda tapada por la cara con la foto, a la misma altura.
  target.push(placeLocal(box(w, slab, d, 0, topY - slab / 2 - 0.002, 0), cx, cy));

  // Pilares a lo largo del lado largo, sin pasar de la separación máxima.
  const along = w >= d ? 'u' : 'v';
  const length = Math.max(w, d);
  const across = Math.min(w, d);
  const n = Math.max(2, Math.ceil(length / SEPARACION_PILARES) + 1);
  const margin = 0.35;
  for (let k = 0; k < n; k++) {
    const a = -length / 2 + margin + (k / (n - 1)) * (length - margin * 2);
    for (const s of [-1, 1]) {
      const b = s * (across / 2 - margin);
      const [u, v] = along === 'u' ? [a, b] : [b, a];
      parts.pillar.push(
        placeLocal(box(PILAR_PASO, topY - slab, PILAR_PASO, u, (topY - slab) / 2, v), cx, cy),
      );
    }
  }
}

for (const rect of Object.values(PABELLONES)) pavilion(rect);
for (const rect of PASOS_CLAROS) walkway(rect, 'light');
for (const rect of PASOS_GRISES) walkway(rect, 'grey');

// UV de las caras de arriba: la foto aérea vista desde arriba, píxel a píxel.
for (const g of parts.roof) {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / S / IMG_W;
    uv[i * 2 + 1] = pos.getZ(i) / S / IMG_H;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------------------------------------------------------------------------
// GLB
// ---------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pergolas-'));
const jpgPath = path.join(tmp, 'aerea.jpg');
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', photoPath, '-q:v', '3', jpgPath]);
const jpg = fs.readFileSync(jpgPath);
fs.rmSync(tmp, { recursive: true, force: true });

function merge(list) {
  let count = 0;
  for (const g of list) count += g.getAttribute('position').count;
  const P = new Float32Array(count * 3);
  const N = new Float32Array(count * 3);
  const U = list[0]?.getAttribute('uv') && list === parts.roof ? new Float32Array(count * 2) : null;
  let o = 0;
  for (const g of list) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    P.set(p.array, o * 3);
    N.set(g.getAttribute('normal').array, o * 3);
    if (U) U.set(g.getAttribute('uv').array, o * 2);
    o += p.count;
  }
  return { P, N, U, count };
}

const lin = (c) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const color = (r, g, b) => [lin(r), lin(g), lin(b), 1];

const MATERIALS = [
  ['roof', { name: 'Cubiertas (foto aérea)', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 } }],
  ['tile', { name: 'Canto de teja', pbrMetallicRoughness: { baseColorFactor: color(168, 128, 98), metallicFactor: 0, roughnessFactor: 0.8 } }],
  ['slabLight', { name: 'Techo plano claro', pbrMetallicRoughness: { baseColorFactor: color(205, 204, 206), metallicFactor: 0.1, roughnessFactor: 0.6 } }],
  ['slabGrey', { name: 'Techo plano gris', pbrMetallicRoughness: { baseColorFactor: color(150, 152, 160), metallicFactor: 0.2, roughnessFactor: 0.55 } }],
  ['pillar', { name: 'Pilares', pbrMetallicRoughness: { baseColorFactor: color(214, 206, 192), metallicFactor: 0, roughnessFactor: 0.75 } }],
  ['beam', { name: 'Vigas', pbrMetallicRoughness: { baseColorFactor: color(110, 86, 64), metallicFactor: 0, roughnessFactor: 0.7 } }],
  ['glass', { name: 'Lucernario', pbrMetallicRoughness: { baseColorFactor: [0.35, 0.5, 0.62, 1], metallicFactor: 0.6, roughnessFactor: 0.12 } }],
];

const chunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];
function addView(buf, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, ...(target ? { target } : {}) });
  chunks.push(buf);
  byteLength += buf.length;
  return bufferViews.length - 1;
}
function addAccessor(arr, type, bounds) {
  const view = addView(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), 34962);
  const size = type === 'VEC3' ? 3 : 2;
  const acc = { bufferView: view, componentType: 5126, count: arr.length / size, type };
  if (bounds) {
    acc.min = [Infinity, Infinity, Infinity];
    acc.max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3)
      for (let k = 0; k < 3; k++) {
        acc.min[k] = Math.min(acc.min[k], arr[i + k]);
        acc.max[k] = Math.max(acc.max[k], arr[i + k]);
      }
  }
  accessors.push(acc);
  return accessors.length - 1;
}

const imageView = addView(jpg);
let tris = 0;
const primitives = MATERIALS.map(([key], material) => {
  const m = merge(parts[key]);
  tris += m.count / 3;
  return {
    attributes: {
      POSITION: addAccessor(m.P, 'VEC3', true),
      NORMAL: addAccessor(m.N, 'VEC3'),
      ...(m.U ? { TEXCOORD_0: addAccessor(m.U, 'VEC2') } : {}),
    },
    material,
  };
});

const gltf = {
  asset: { version: '2.0', generator: 'EventForge · pergolas_ucam.mjs' },
  scene: 0,
  scenes: [
    {
      nodes: [0],
      // EventForge lo usa para encajar el modelo sobre la foto de fondo: el
      // modelo está en metros en el marco de una imagen que mide esto.
      extras: { eventforge: { imageWidthM: IMG_W * S, imageHeightM: IMG_H * S } },
    },
  ],
  nodes: [{ mesh: 0, name: 'Pérgolas UCAM' }],
  meshes: [{ name: 'Pérgolas', primitives }],
  materials: MATERIALS.map(([, m]) => m),
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
  images: [{ bufferView: imageView, mimeType: 'image/jpeg' }],
  buffers: [{ byteLength }],
  bufferViews,
  accessors,
};

const json = Buffer.from(JSON.stringify(gltf));
const jsonPad = Buffer.alloc((4 - (json.length % 4)) % 4, 0x20);
const bin = Buffer.concat(chunks);
const binPad = Buffer.alloc((4 - (bin.length % 4)) % 4);
const total = 28 + json.length + jsonPad.length + bin.length + binPad.length;
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jh = Buffer.alloc(8);
jh.writeUInt32LE(json.length + jsonPad.length, 0);
jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8);
bh.writeUInt32LE(bin.length + binPad.length, 0);
bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([header, jh, json, jsonPad, bh, bin, binPad]));

console.log(
  `${outPath}: ${(total / 1024).toFixed(0)} KB, ${Math.round(tris)} triángulos, ` +
    `${Object.keys(PABELLONES).length} pabellones y ${PASOS_CLAROS.length + PASOS_GRISES.length} pasos cubiertos; ` +
    `marco de la imagen ${(IMG_W * S).toFixed(1)} × ${(IMG_H * S).toFixed(1)} m`,
);
