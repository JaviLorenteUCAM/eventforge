/**
 * MODELO 3D DE LA SILLA PHOENIX MONARCH, A PARTIR DE UNA FOTO
 * ---------------------------------------------------------------------------
 * Construye la silla por piezas a escala real —respaldo, asiento,
 * reposabrazos, mecanismo, pistón, base de cinco radios y ruedas— y pinta las
 * partes tapizadas proyectando sobre ellas la foto del fabricante: lo que mira
 * al frente toma la vista de frente, lo de atrás la de detrás y los costados la
 * lateral. Así la marca («phoenix», el logo y «MONARCH») sale donde está.
 *
 * Las medidas salen de la propia foto: las cuatro vistas comparten escala y
 * suelo, así que cada fila de píxeles es una altura y el contorno del respaldo
 * se lee de la vista de frente; su inclinación y su grosor, de la lateral.
 *
 * La foto es el PNG/WEBP del fabricante con el fondo transparente:
 *   [lateral] [frente] [lateral] [detrás]
 *
 * Uso:
 *   node tools/modelos/silla_phoenix.mjs <foto.webp> <salida.glb> <ffmpeg.exe>
 *
 * Sale un .glb con la textura incrustada, de pie sobre el suelo (Y = 0),
 * centrado y con el frente hacia +Z, que es lo que espera EventForge.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const [photoPath, outPath, ffmpeg] = process.argv.slice(2);
if (!photoPath || !outPath || !ffmpeg) {
  console.error('Uso: node silla_phoenix.mjs <foto> <salida.glb> <ffmpeg>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Foto
// ---------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'silla-'));
const rawPath = path.join(tmp, 'foto.rgba');
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', photoPath, '-f', 'rawvideo', '-pix_fmt', 'rgba', rawPath]);
// El tamaño es el de la foto de esta silla; otra foto lo pasa por entorno.
const IMG_W = Number(process.env.IMG_W ?? 2000);
const IMG_H = Number(process.env.IMG_H ?? 1899);
const px = fs.readFileSync(rawPath);
if (px.length !== IMG_W * IMG_H * 4) {
  throw new Error(`La foto no mide ${IMG_W}×${IMG_H} (define IMG_W e IMG_H)`);
}
const solid = (x, y) => px[(y * IMG_W + x) * 4 + 3] > 128;

/** Tramo opaco de la fila `y` que contiene a `x`, entre `a` y `b`. */
function spanAt(y, x, a, b) {
  if (!solid(x, y)) return null;
  let l = x;
  let r = x;
  while (l > a && solid(l - 1, y)) l--;
  while (r < b && solid(r + 1, y)) r++;
  return [l, r];
}

/** Primer y último píxel opaco de la fila `y`, entre `a` y `b`. */
function extentAt(y, a, b) {
  let l = -1;
  let r = -1;
  for (let x = a; x <= b; x++) {
    if (!solid(x, y)) continue;
    if (l < 0) l = x;
    r = x;
  }
  return l < 0 ? null : [l, r];
}

// Vistas dentro de la foto (columnas) y referencias medidas en ella.
const FRONT = { a: 513, b: 987, cx: 747, floor: 1394 }; // cx: eje del pistón
const SIDE = { a: 1, b: 479, cz: 226, floor: 1393 }; // frente de la silla a la derecha
const BACK = { a: 1538, b: 1982, cx: 1742.5, floor: 1392, widen: 1.09 };
const TOP_Y = 508;
const M = 1.36 / (FRONT.floor - TOP_Y); // metros por píxel (alto total 1,36 m)

const yOf = (row, floor) => (floor - row) * M;
const rowOf = (Y, floor) => floor - Y / M;

// ---------------------------------------------------------------------------
// Proyección de la foto sobre las piezas tapizadas
// ---------------------------------------------------------------------------

/**
 * UV de un punto según hacia dónde mira su triángulo. glTF pone el origen de
 * la imagen ARRIBA a la izquierda, así que v crece hacia abajo como las filas.
 */
function projectUv(X, Y, Z, n) {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  let u;
  let v;
  if (az >= ax && az >= ay) {
    if (n.z > 0) {
      u = FRONT.cx + X / M;
      v = rowOf(Y, FRONT.floor);
    } else {
      // Desde detrás la derecha de la silla queda a la izquierda de la foto.
      u = BACK.cx - (X / M) * BACK.widen;
      v = rowOf(Y, BACK.floor);
    }
  } else if (ax >= ay) {
    // Los dos costados con la misma vista lateral: proyectar a lo largo de X
    // ya la da la vuelta en el lado contrario.
    u = SIDE.cz + Z / M;
    v = rowOf(Y, SIDE.floor);
  } else {
    // Arriba y abajo no hay foto: un trozo liso del tapizado de la vista de
    // frente, estirado. De lejos se lee como la tela gris moteada.
    u = 700 + ((X + 0.3) / 0.6) * 40;
    v = 905 + ((Z + 0.3) / 0.7) * 30;
  }
  return [u / IMG_W, v / IMG_H];
}

// ---------------------------------------------------------------------------
// Utilidades de geometría
// ---------------------------------------------------------------------------

/** Normales suaves dentro de la pieza y aristas vivas en las esquinas. */
function smooth(geo) {
  const g = mergeVertices(geo.deleteAttribute('normal').deleteAttribute('uv'), 1e-5);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Pone UV proyectadas, triángulo a triángulo. */
function withProjectedUv(geo) {
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    // La orientación la da la normal suave media, no la del triángulo: en una
    // superficie curva la proyección cambia de foto de forma más limpia.
    n.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      n.x += nor.getX(i + k);
      n.y += nor.getY(i + k);
      n.z += nor.getZ(i + k);
    }
    for (const [k, p] of [a, b, c].entries()) {
      const [u, v] = projectUv(p.x, p.y, p.z, n);
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = v;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function place(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
    new THREE.Vector3(1, 1, 1),
  );
  return geo.applyMatrix4(m);
}

/** Caja con las medidas y el centro dados. */
const box = (w, h, d, at) => place(new THREE.BoxGeometry(w, h, d).toNonIndexed(), at);
const cyl = (r0, r1, h, at, seg = 24) =>
  place(new THREE.CylinderGeometry(r0, r1, h, seg).toNonIndexed(), at);

// ---------------------------------------------------------------------------
// Respaldo: contorno de la vista de frente, curvado como en la lateral
// ---------------------------------------------------------------------------

const BACKREST_BOTTOM = 1000; // fila donde el respaldo se mete en el asiento

function backrest() {
  const left = [];
  const right = [];
  let last = null;
  for (let row = TOP_Y + 1; row <= BACKREST_BOTTOM; row += 4) {
    let s = spanAt(row, FRONT.cx, FRONT.a, FRONT.b);
    // A la altura de los reposabrazos el tramo se ensancha con ellos: se
    // mantiene el ancho del respaldo de la fila anterior.
    if (!s || (last && s[1] - s[0] > (last[1] - last[0]) * 1.15)) s = last;
    if (!s) continue;
    last = s;
    const Y = yOf(row, FRONT.floor);
    left.push(new THREE.Vector2((s[0] - FRONT.cx) * M, Y));
    right.push(new THREE.Vector2((s[1] + 1 - FRONT.cx) * M, Y));
  }
  const outline = [...left.reverse(), ...right];
  const shape = new THREE.Shape(outline);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });

  // Perfil lateral por altura: borde trasero y grosor. El respaldo se curva
  // siguiendo la foto en vez de girarlo en bloque (arriba es casi vertical y
  // abajo se inclina hacia el asiento).
  const backEdge = new Map();
  const thick = new Map();
  for (let row = TOP_Y; row <= BACKREST_BOTTOM; row++) {
    const e = extentAt(row, SIDE.a, Math.min(SIDE.b, SIDE.a + 200));
    if (!e) continue;
    backEdge.set(row, e[0]);
    thick.set(row, Math.min(0.18, Math.max(0.1, (e[1] - e[0]) * M)));
  }
  const lookup = (map, row) => {
    const r = Math.round(Math.min(BACKREST_BOTTOM, Math.max(565, row)));
    for (let d = 0; d < 40; d++) {
      if (map.has(r + d)) return map.get(r + d);
      if (map.has(r - d)) return map.get(r - d);
    }
    return 0;
  };

  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const X = pos.getX(i);
    const Y = pos.getY(i);
    const t = pos.getZ(i); // 0 = cara de detrás, 1 = cara de delante
    const row = rowOf(Y, SIDE.floor);
    const back = (lookup(backEdge, row) - SIDE.cz) * M;
    pos.setXYZ(i, X, Y, back + t * lookup(thick, row));
  }
  pos.needsUpdate = true;
  return withProjectedUv(smooth(geo));
}

// ---------------------------------------------------------------------------
// Asiento: perfil de la vista lateral, con el ancho de la de frente
// ---------------------------------------------------------------------------

function seat() {
  const z = (col) => (col - SIDE.cz) * M;
  const y = (row) => yOf(row, SIDE.floor);
  // Perfil a mano sobre la lateral: de detrás (metido bajo el respaldo) al
  // borde delantero redondeado.
  const profile = [
    [120, 1004],
    [400, 1004],
    [430, 1010],
    [446, 1028],
    [447, 1050],
    [440, 1068],
    [425, 1082],
    [395, 1092],
    [120, 1092],
  ].map(([c, r]) => new THREE.Vector2(z(c), y(r)));
  const shape = new THREE.Shape(profile);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, steps: 1 });

  const s = spanAt(1010, FRONT.cx, FRONT.a, FRONT.b) ?? [FRONT.cx - 170, FRONT.cx + 170];
  const W = (s[1] - s[0]) * M;
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    // (perfil Z, alto, t) → X a lo ancho. (0,5 − t) mantiene el sentido de
    // las caras: si no, quedarían del revés.
    pos.setXYZ(i, (0.5 - pos.getZ(i)) * W, pos.getY(i), pos.getX(i));
  }
  pos.needsUpdate = true;
  return withProjectedUv(smooth(geo));
}

// ---------------------------------------------------------------------------
// Plástico y metal
// ---------------------------------------------------------------------------

function plastic() {
  const parts = [];
  const zOf = (col) => (col - SIDE.cz) * M;
  const xPad = 0.314;

  for (const side of [-1, 1]) {
    const x = side * xPad;
    // Almohadilla del reposabrazos
    parts.push(box(0.075, 0.032, zOf(389) - zOf(211), { x, y: 0.826, z: (zOf(389) + zOf(211)) / 2 }));
    // Columna y su funda
    parts.push(box(0.032, 0.32, 0.06, { x, y: 0.645, z: zOf(285) }));
    parts.push(box(0.05, 0.12, 0.075, { x, y: 0.54, z: zOf(285) }));
    // Pletina que la une por debajo del asiento
    parts.push(box(0.1, 0.025, 0.06, { x: side * (xPad - 0.05), y: 0.475, z: zOf(285) }));
  }

  // Mecanismo bajo el asiento y su palanca
  parts.push(box(0.26, 0.07, zOf(334) - zOf(200), { y: 0.41, z: (zOf(334) + zOf(200)) / 2 }));
  parts.push(box(0.2, 0.015, 0.02, { x: 0.2, y: 0.4, z: zOf(300), ry: 0.25 }));

  // Funda del pistón
  parts.push(cyl(0.036, 0.042, 0.08, { y: 0.255 }));

  // Base: buje y cinco radios que bajan hacia las ruedas
  parts.push(cyl(0.06, 0.065, 0.06, { y: 0.2 }));
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2 + Math.PI / 10;
    const g = new THREE.BoxGeometry(1, 1, 1, 6, 1, 1).toNonIndexed();
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) + 0.5; // 0 en el buje, 1 en la punta
      const r = 0.04 + t * 0.29;
      const w = 0.06 - t * 0.022;
      const h = 0.05 - t * 0.022;
      const top = 0.225 - t * 0.065 - t * t * 0.02;
      pos.setXYZ(i, r, top - h + (pos.getY(i) + 0.5) * h, pos.getZ(i) * w);
    }
    pos.needsUpdate = true;
    parts.push(place(g, { ry: ang }));

    // Rueda doble con su horquilla
    const rx = Math.cos(ang) * 0.33;
    const rz = -Math.sin(ang) * 0.33;
    parts.push(cyl(0.012, 0.012, 0.06, { x: rx, y: 0.1, z: rz }, 12));
    parts.push(box(0.05, 0.04, 0.05, { x: rx, y: 0.075, z: rz, ry: ang }));
    for (const off of [-0.017, 0.017]) {
      parts.push(
        cyl(0.034, 0.034, 0.02, {
          x: rx + Math.cos(ang) * off,
          y: 0.034,
          z: rz - Math.sin(ang) * off,
          rz: Math.PI / 2,
          ry: ang,
        }),
      );
    }
  }
  return parts;
}

function metal() {
  // Pistón cromado oscuro
  return [cyl(0.026, 0.026, 0.16, { y: 0.36 })];
}

// ---------------------------------------------------------------------------
// Fusión por material
// ---------------------------------------------------------------------------

function merge(list, withUv) {
  let count = 0;
  for (const g of list) count += g.getAttribute('position').count;
  const P = new Float32Array(count * 3);
  const N = new Float32Array(count * 3);
  const U = withUv ? new Float32Array(count * 2) : null;
  let o = 0;
  for (let g of list) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (!withUv) g = smooth(g);
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    P.set(p.array, o * 3);
    N.set(n.array, o * 3);
    if (U) U.set(g.getAttribute('uv').array, o * 2);
    o += p.count;
  }
  return { P, N, U, count };
}

const fabric = merge([backrest(), seat()], true);
const black = merge(plastic(), false);
const chrome = merge(metal(), false);

// Centrado en planta: el modelo se coloca por el centro de su huella.
const all = [fabric, black, chrome];
let minX = Infinity;
let maxX = -Infinity;
let minZ = Infinity;
let maxZ = -Infinity;
let minY = Infinity;
let maxY = -Infinity;
for (const m of all) {
  for (let i = 0; i < m.count; i++) {
    minX = Math.min(minX, m.P[i * 3]);
    maxX = Math.max(maxX, m.P[i * 3]);
    minY = Math.min(minY, m.P[i * 3 + 1]);
    maxY = Math.max(maxY, m.P[i * 3 + 1]);
    minZ = Math.min(minZ, m.P[i * 3 + 2]);
    maxZ = Math.max(maxZ, m.P[i * 3 + 2]);
  }
}
const cx = (minX + maxX) / 2;
const cz = (minZ + maxZ) / 2;
for (const m of all) {
  for (let i = 0; i < m.count; i++) {
    m.P[i * 3] -= cx;
    m.P[i * 3 + 1] -= minY;
    m.P[i * 3 + 2] -= cz;
  }
}

// ---------------------------------------------------------------------------
// Textura: la foto con el color de los bordes extendido hacia el fondo
// ---------------------------------------------------------------------------

/**
 * El fondo transparente de la foto es negro por debajo. Donde la proyección
 * cae un pelo fuera de la silla se vería un ribete negro, así que los píxeles
 * transparentes cercanos toman el color de sus vecinos opacos.
 */
function bleed(passes = 24) {
  const out = Buffer.from(px);
  const filled = new Uint8Array(IMG_W * IMG_H);
  for (let p = 0; p < filled.length; p++) filled[p] = out[p * 4 + 3] > 128 ? 1 : 0;
  let frontier = [];
  const queued = new Uint8Array(filled.length);
  const nb = (p, f) => {
    const x = p % IMG_W;
    const y = (p - x) / IMG_W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < IMG_W && yy < IMG_H) f(yy * IMG_W + xx);
      }
  };
  for (let p = 0; p < filled.length; p++) {
    if (!filled[p]) continue;
    nb(p, (q) => {
      if (!filled[q] && !queued[q]) {
        queued[q] = 1;
        frontier.push(q);
      }
    });
  }
  for (let k = 0; k < passes && frontier.length; k++) {
    const done = [];
    for (const p of frontier) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      nb(p, (q) => {
        if (!filled[q]) return;
        r += out[q * 4];
        g += out[q * 4 + 1];
        b += out[q * 4 + 2];
        n++;
      });
      if (!n) continue;
      out[p * 4] = r / n;
      out[p * 4 + 1] = g / n;
      out[p * 4 + 2] = b / n;
      done.push(p);
    }
    for (const p of done) filled[p] = 1;
    const next = [];
    for (const p of done)
      nb(p, (q) => {
        if (!filled[q] && !queued[q]) {
          queued[q] = 1;
          next.push(q);
        }
      });
    frontier = next;
  }
  for (let p = 0; p < filled.length; p++) out[p * 4 + 3] = 255;
  return out;
}

const bledPath = path.join(tmp, 'tela.rgba');
fs.writeFileSync(bledPath, bleed());
const jpgPath = path.join(tmp, 'tela.jpg');
execFileSync(ffmpeg, [
  '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${IMG_W}x${IMG_H}`,
  '-i', bledPath, '-q:v', '3', jpgPath,
]);
const jpg = fs.readFileSync(jpgPath);

// ---------------------------------------------------------------------------
// GLB a mano: JSON + un único búfer binario
// ---------------------------------------------------------------------------

const chunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];

function addView(bytes, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(Buffer.alloc(pad));
    byteLength += pad;
  }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
  chunks.push(Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.length ?? bytes.byteLength));
  byteLength += bytes.length ?? bytes.byteLength;
  return bufferViews.length - 1;
}

function addAccessor(arr, type, withBounds) {
  const view = addView(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), 34962);
  const size = type === 'VEC3' ? 3 : 2;
  const acc = { bufferView: view, componentType: 5126, count: arr.length / size, type };
  if (withBounds) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < arr.length; i += 3)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], arr[i + k]);
        max[k] = Math.max(max[k], arr[i + k]);
      }
    acc.min = min;
    acc.max = max;
  }
  accessors.push(acc);
  return accessors.length - 1;
}

const imageView = addView(jpg);

const materials = [
  {
    name: 'Tapizado',
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      metallicFactor: 0,
      roughnessFactor: 0.92,
    },
  },
  {
    name: 'Plástico negro',
    pbrMetallicRoughness: { baseColorFactor: [0.012, 0.012, 0.014, 1], metallicFactor: 0, roughnessFactor: 0.45 },
  },
  {
    name: 'Pistón',
    pbrMetallicRoughness: { baseColorFactor: [0.12, 0.12, 0.13, 1], metallicFactor: 0.85, roughnessFactor: 0.3 },
  },
];

const primitives = [
  [fabric, 0],
  [black, 1],
  [chrome, 2],
].map(([m, material]) => ({
  attributes: {
    POSITION: addAccessor(m.P, 'VEC3', true),
    NORMAL: addAccessor(m.N, 'VEC3'),
    ...(m.U ? { TEXCOORD_0: addAccessor(m.U, 'VEC2') } : {}),
  },
  material,
}));

const gltf = {
  asset: { version: '2.0', generator: 'EventForge · silla_phoenix.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Silla Phoenix Monarch' }],
  meshes: [{ name: 'Silla', primitives }],
  materials,
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
const total = 12 + 8 + json.length + jsonPad.length + 8 + bin.length + binPad.length;

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // glTF
header.writeUInt32LE(2, 4);
header.writeUInt32LE(total, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.length + jsonPad.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // JSON
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length + binPad.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // BIN

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, Buffer.concat([header, jsonHeader, json, jsonPad, binHeader, bin, binPad]));
fs.rmSync(tmp, { recursive: true, force: true });

const tris = (fabric.count + black.count + chrome.count) / 3;
console.log(
  `${outPath}: ${(total / 1024).toFixed(0)} KB, ${tris} triángulos, ` +
    `${(maxX - minX).toFixed(2)} × ${(maxY - minY).toFixed(2)} × ${(maxZ - minZ).toFixed(2)} m (ancho × alto × fondo)`,
);
