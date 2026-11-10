import { boxFaceUvs } from './textureAtlas';

/**
 * VOLUMEN A PARTIR DE LAS VISTAS
 * ---------------------------------------------------------------------------
 * Con la plantilla en cruz cada foto se pegaba sobre una cara de una caja: una
 * silla gaming acababa siendo cuatro fotos planas alrededor de un hueco, como
 * un farolillo, y desde cualquier ángulo se veían todas a la vez.
 *
 * Aquí las fotos se usan dos veces:
 *
 *   1. Para TALLAR la forma. Se parte de un bloque macizo con las medidas del
 *      objeto y cada vista recortada le quita lo que en ella es transparente:
 *      la de frente da el contorno del respaldo, la de lado su inclinación y
 *      el grosor del asiento, la de arriba la estrella de la base. Lo que queda
 *      es lo que es sólido visto desde todas partes (un «casco visual»).
 *
 *   2. Para PINTARLA. Cada triángulo del resultado toma el color de la foto que
 *      mejor lo ve: lo que mira al frente, de la foto de frente; lo que mira a
 *      un lado, de esa vista. La marca del respaldo sale donde está en la foto.
 *
 * Solo cuentan las vistas con el fondo recortado. Una cara de la plantilla que
 * se ha dejado tal cual (con su color y su rótulo) o que se ha vaciado entera
 * no dice nada de la forma, y se ignora.
 *
 * Los cálculos son puros salvo la lectura de la imagen, que necesita un lienzo.
 */

/** Alfa de la imagen ya recortada, de 0 a 1, fila 0 arriba. */
export interface AlphaImage {
  alpha: Float32Array;
  width: number;
  height: number;
}

export interface VolumeMesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Caras de la plantilla que han servido para tallar, en el orden de BoxGeometry. */
  faces: number[];
}

/**
 * Las seis caras en el orden de materiales de BoxGeometry, con la dirección
 * desde la que se mira cada una y cómo cae un punto del objeto sobre su foto.
 * Las fórmulas son las mismas UV que BoxGeometry pone a sus caras, así que la
 * foto se ve exactamente igual que cuando se pegaba sobre la caja.
 */
const FACES: {
  dir: [number, number, number];
  uv: (x: number, y: number, z: number, W: number, H: number, D: number) => [number, number];
}[] = [
  { dir: [1, 0, 0], uv: (_x, y, z, _W, H, D) => [0.5 - z / D, 0.5 + y / H] }, // derecha
  { dir: [-1, 0, 0], uv: (_x, y, z, _W, H, D) => [0.5 + z / D, 0.5 + y / H] }, // izquierda
  { dir: [0, 1, 0], uv: (x, _y, z, W, _H, D) => [0.5 + x / W, 0.5 - z / D] }, // arriba
  { dir: [0, -1, 0], uv: (x, _y, z, W, _H, D) => [0.5 + x / W, 0.5 + z / D] }, // abajo
  { dir: [0, 0, 1], uv: (x, y, _z, W, H) => [0.5 + x / W, 0.5 + y / H] }, // frente
  { dir: [0, 0, -1], uv: (x, y, _z, W, H) => [0.5 - x / W, 0.5 + y / H] }, // atrás
];

/** Por debajo o por encima de esto, una cara no está recortada. */
const MIN_SOLID = 0.02;
const MAX_SOLID = 0.98;

/** Celdas en la medida más larga del objeto. */
const RESOLUTION = 88;

interface FaceSampler {
  index: number;
  /** Alfa en el punto (u, v) de la cara, interpolado. */
  sample: (u: number, v: number) => number;
  /** De (u, v) de la cara a UV del atlas, con medio téxel de margen. */
  toAtlas: (u: number, v: number) => [number, number];
}

function faceSamplers(img: AlphaImage, atlas: { length: number; width: number; height: number }) {
  const { alpha, width: aw, height: ah } = img;
  const uvs = boxFaceUvs(atlas.length, atlas.width, atlas.height);

  return uvs.map((t, index): FaceSampler & { solid: number } => {
    // Rectángulo de la cara en píxeles (fila 0 arriba).
    const x0 = t.offset[0] * aw;
    const x1 = (t.offset[0] + t.repeat[0]) * aw;
    const y0 = (1 - t.offset[1] - t.repeat[1]) * ah;
    const y1 = (1 - t.offset[1]) * ah;

    const px0 = Math.max(0, Math.floor(x0));
    const px1 = Math.min(aw - 1, Math.ceil(x1) - 1);
    const py0 = Math.max(0, Math.floor(y0));
    const py1 = Math.min(ah - 1, Math.ceil(y1) - 1);

    let solid = 0;
    let total = 0;
    for (let y = py0; y <= py1; y++) {
      for (let x = px0; x <= px1; x++) {
        total++;
        if (alpha[y * aw + x] >= 0.5) solid++;
      }
    }

    const at = (x: number, y: number) =>
      alpha[Math.min(py1, Math.max(py0, y)) * aw + Math.min(px1, Math.max(px0, x))];

    const sample = (u: number, v: number) => {
      // Centro de píxel: el (0,0) de la cara cae en la esquina, no en un centro.
      const fx = x0 + u * (x1 - x0) - 0.5;
      const fy = y0 + (1 - v) * (y1 - y0) - 0.5;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const a = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx;
      const b = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
      return a * (1 - ty) + b * ty;
    };

    const insetU = 0.5 / aw;
    const insetV = 0.5 / ah;
    const toAtlas = (u: number, v: number): [number, number] => [
      t.offset[0] + insetU + Math.min(1, Math.max(0, u)) * (t.repeat[0] - insetU * 2),
      t.offset[1] + insetV + Math.min(1, Math.max(0, v)) * (t.repeat[1] - insetV * 2),
    ];

    return { index, sample, toAtlas, solid: total ? solid / total : 0 };
  });
}

/**
 * Talla el volumen y lo pinta. Devuelve null si ninguna cara está recortada:
 * entonces no hay forma que sacar y el objeto se queda en su caja de siempre.
 *
 * `length`, `width` y `height` son las medidas del objeto en el plano (X, Z e
 * Y de su caja); `atlas`, las de la plantilla con la que se hizo la imagen.
 */
export function buildVolume(
  img: AlphaImage,
  atlas: { length: number; width: number; height: number },
  length: number,
  width: number,
  height: number,
): VolumeMesh | null {
  const W = Math.max(0.01, length);
  const H = Math.max(0.01, height);
  const D = Math.max(0.01, width);

  const samplers = faceSamplers(img, atlas);
  const carving = samplers.filter((f) => f.solid > MIN_SOLID && f.solid < MAX_SOLID);
  if (carving.length === 0) return null;

  // ---- Campo: 1 dentro, 0 fuera ------------------------------------------
  // Se evalúa en los centros de las celdas, con una capa de aire alrededor
  // para que la superficie se cierre en los bordes de la caja.
  const step = Math.max(W, H, D) / RESOLUTION;
  const nx = Math.max(2, Math.round(W / step));
  const ny = Math.max(2, Math.round(H / step));
  const nz = Math.max(2, Math.round(D / step));
  const sx = W / nx;
  const sy = H / ny;
  const sz = D / nz;
  const PX = nx + 2;
  const PY = ny + 2;
  const PZ = nz + 2;

  const px = (i: number) => -W / 2 + (i - 0.5) * sx;
  const py = (j: number) => -H / 2 + (j - 0.5) * sy;
  const pz = (k: number) => -D / 2 + (k - 0.5) * sz;

  const field = new Float32Array(PX * PY * PZ);
  const at = (i: number, j: number, k: number) => (k * PY + j) * PX + i;

  for (let k = 1; k <= nz; k++) {
    const z = pz(k);
    for (let j = 1; j <= ny; j++) {
      const y = py(j);
      for (let i = 1; i <= nx; i++) {
        const x = px(i);
        let v = 1;
        for (const f of carving) {
          const [u, w] = FACES[f.index].uv(x, y, z, W, H, D);
          const s = f.sample(u, w);
          if (s < v) v = s;
          if (v <= 0) break;
        }
        field[at(i, j, k)] = v;
      }
    }
  }

  // ---- Superficie: «surface nets» ----------------------------------------
  // Un vértice por celda que corta la superficie, en la media de los puntos
  // donde sus aristas cruzan el 0,5; y un cuadrilátero por cada arista de la
  // rejilla que pasa de dentro a fuera. Sale más suave que unos cubos y sin
  // los casos especiales de marching cubes.
  const CX = PX - 1;
  const CY = PY - 1;
  const CZ = PZ - 1;
  const cellVertex = new Int32Array(CX * CY * CZ).fill(-1);
  const cell = (i: number, j: number, k: number) => (k * CY + j) * CX + i;
  const verts: number[] = [];

  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const vals = new Float32Array(8);

  for (let k = 0; k < CZ; k++) {
    for (let j = 0; j < CY; j++) {
      for (let i = 0; i < CX; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const [di, dj, dk] = corners[c];
          vals[c] = field[at(i + di, j + dj, k + dk)];
          if (vals[c] > 0.5) inside++;
        }
        if (inside === 0 || inside === 8) continue;

        let ax = 0;
        let ay = 0;
        let az = 0;
        let n = 0;
        for (const [a, b] of edges) {
          const va = vals[a];
          const vb = vals[b];
          if (va > 0.5 === vb > 0.5) continue;
          const t = (0.5 - va) / (vb - va);
          const [ai, aj, ak] = corners[a];
          const [bi, bj, bk] = corners[b];
          ax += ai + (bi - ai) * t;
          ay += aj + (bj - aj) * t;
          az += ak + (bk - ak) * t;
          n++;
        }
        cellVertex[cell(i, j, k)] = verts.length / 3;
        verts.push(px(i + ax / n), py(j + ay / n), pz(k + az / n));
      }
    }
  }

  // Cuadriláteros. El orden de las cuatro celdas deja la normal hacia +eje;
  // si lo sólido está al otro lado se da la vuelta, para que todas miren
  // hacia fuera.
  const tris: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) tris.push(a, c, b, a, d, c);
    else tris.push(a, b, c, a, c, d);
  };

  for (let k = 1; k < PZ - 1; k++) {
    for (let j = 1; j < PY - 1; j++) {
      for (let i = 0; i < PX - 1; i++) {
        const here = field[at(i, j, k)] > 0.5;
        if (here === field[at(i + 1, j, k)] > 0.5) continue;
        quad(
          cellVertex[cell(i, j - 1, k - 1)],
          cellVertex[cell(i, j, k - 1)],
          cellVertex[cell(i, j, k)],
          cellVertex[cell(i, j - 1, k)],
          !here,
        );
      }
    }
  }
  for (let k = 1; k < PZ - 1; k++) {
    for (let j = 0; j < PY - 1; j++) {
      for (let i = 1; i < PX - 1; i++) {
        const here = field[at(i, j, k)] > 0.5;
        if (here === field[at(i, j + 1, k)] > 0.5) continue;
        quad(
          cellVertex[cell(i - 1, j, k - 1)],
          cellVertex[cell(i - 1, j, k)],
          cellVertex[cell(i, j, k)],
          cellVertex[cell(i, j, k - 1)],
          !here,
        );
      }
    }
  }
  for (let k = 0; k < PZ - 1; k++) {
    for (let j = 1; j < PY - 1; j++) {
      for (let i = 1; i < PX - 1; i++) {
        const here = field[at(i, j, k)] > 0.5;
        if (here === field[at(i, j, k + 1)] > 0.5) continue;
        quad(
          cellVertex[cell(i - 1, j - 1, k)],
          cellVertex[cell(i, j - 1, k)],
          cellVertex[cell(i, j, k)],
          cellVertex[cell(i - 1, j, k)],
          !here,
        );
      }
    }
  }

  if (tris.length === 0) return null;

  // ---- Normales suaves por vértice ---------------------------------------
  const vn = new Float32Array(verts.length);
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t] * 3;
    const b = tris[t + 1] * 3;
    const c = tris[t + 2] * 3;
    const ux = verts[b] - verts[a];
    const uy = verts[b + 1] - verts[a + 1];
    const uz = verts[b + 2] - verts[a + 2];
    const wx = verts[c] - verts[a];
    const wy = verts[c + 1] - verts[a + 1];
    const wz = verts[c + 2] - verts[a + 2];
    const nx2 = uy * wz - uz * wy;
    const ny2 = uz * wx - ux * wz;
    const nz2 = ux * wy - uy * wx;
    for (const v of [a, b, c]) {
      vn[v] += nx2;
      vn[v + 1] += ny2;
      vn[v + 2] += nz2;
    }
  }
  for (let v = 0; v < vn.length; v += 3) {
    const l = Math.hypot(vn[v], vn[v + 1], vn[v + 2]) || 1;
    vn[v] /= l;
    vn[v + 1] /= l;
    vn[v + 2] /= l;
  }

  // ---- Pintado: cada triángulo, de la foto que mejor lo ve ---------------
  // Los triángulos no comparten vértices porque dos vecinos pueden tomar el
  // color de fotos distintas.
  const triCount = tris.length / 3;
  const positions = new Float32Array(triCount * 9);
  const normals = new Float32Array(triCount * 9);
  const uvs = new Float32Array(triCount * 6);

  for (let t = 0; t < triCount; t++) {
    const ids = [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]];
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (const v of ids) {
      fx += vn[v * 3];
      fy += vn[v * 3 + 1];
      fz += vn[v * 3 + 2];
    }

    let best = carving[0];
    let bestDot = -Infinity;
    for (const f of carving) {
      const [dx, dy, dz] = FACES[f.index].dir;
      const d = fx * dx + fy * dy + fz * dz;
      if (d > bestDot) {
        bestDot = d;
        best = f;
      }
    }

    ids.forEach((v, c) => {
      const x = verts[v * 3];
      const y = verts[v * 3 + 1];
      const z = verts[v * 3 + 2];
      positions.set([x, y, z], t * 9 + c * 3);
      normals.set([vn[v * 3], vn[v * 3 + 1], vn[v * 3 + 2]], t * 9 + c * 3);
      const [u, w] = FACES[best.index].uv(x, y, z, W, H, D);
      uvs.set(best.toAtlas(u, w), t * 6 + c * 2);
    });
  }

  return { positions, normals, uvs, faces: carving.map((f) => f.index) };
}

// ---------------------------------------------------------------------------
// Lectura de la imagen (necesita un lienzo)
// ---------------------------------------------------------------------------

type Drawable = CanvasImageSource & { width: number; height: number };

/**
 * Alfa de la imagen, con el color clave también como transparente. Se lee en
 * pequeño (1024 px de lado como mucho): la forma no gana nada con más detalle.
 */
export function readAlpha(
  image: Drawable,
  keyColor?: string | null,
  keyTolerance = 0.12,
  maxSize = 1024,
): AlphaImage | null {
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
  const alpha = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    if (keyColor && Math.hypot(px[i] - kr, px[i + 1] - kg, px[i + 2] - kb) <= limit) continue;
    alpha[p] = px[i + 3] / 255;
  }
  return { alpha, width: w, height: h };
}

/**
 * Copia de la imagen con el color de los bordes extendido hacia el fondo.
 *
 * El volumen no se recorta con el alfa —la forma ya es la del objeto—, así que
 * lo que hay detrás de lo transparente acabaría viéndose en los cantos: negro,
 * o el magenta del color clave. Aquí cada píxel transparente cercano a la
 * silla toma el color de sus vecinos sólidos, y los cantos salen del color de
 * la silla.
 */
export function bleedImage(
  image: Drawable,
  keyColor?: string | null,
  keyTolerance = 0.12,
  maxSize = 4096,
  passes = 12,
): HTMLCanvasElement | null {
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
  const px = data.data;

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

  const filled = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const keyed =
      keyColor && Math.hypot(px[i] - kr, px[i + 1] - kg, px[i + 2] - kb) <= limit;
    if (!keyed && px[i + 3] >= 128) filled[p] = 1;
  }

  // Ribete del color clave. Al guardar en JPEG o al reescalar, los píxeles del
  // borde mezclan la silla con el magenta y no llegan a recortarse; en los
  // cantos del volumen se verían como una línea de color. Se descartan los que
  // se parecen BASTANTE al color clave pero solo si están pegados al fondo
  // recortado: un logo rojo en medio del respaldo no se toca.
  if (keyColor) {
    const loose = Math.min(1, keyTolerance * 2.5 + 0.1) * 441.673;
    const fringe: number[] = [];
    for (let p = 0; p < w * h; p++) {
      if (!filled[p]) continue;
      const i = p * 4;
      if (Math.hypot(px[i] - kr, px[i + 1] - kg, px[i + 2] - kb) > loose) continue;
      const x = p % w;
      const y = (p - x) / w;
      let nearBackground = false;
      for (let dy = -2; dy <= 2 && !nearBackground; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w && !filled[yy * w + xx]) {
            nearBackground = true;
            break;
          }
        }
      }
      if (nearBackground) fringe.push(p);
    }
    for (const p of fringe) filled[p] = 0;
  }

  // Por frentes: en cada pasada solo se tocan los píxeles que lindan con lo
  // ya relleno, así el coste es el de la franja que se pinta y no el de toda
  // la imagen, y se puede trabajar a resolución completa (la marca se lee).
  const neighbours = (p: number, out: number[]) => {
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
        out.push(yy * w + xx);
      }
    }
  };

  const around: number[] = [];
  let frontier: number[] = [];
  const queued = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!filled[p]) continue;
    around.length = 0;
    neighbours(p, around);
    for (const q of around) {
      if (!filled[q] && !queued[q]) {
        queued[q] = 1;
        frontier.push(q);
      }
    }
  }

  for (let pass = 0; pass < passes && frontier.length; pass++) {
    const done: number[] = [];
    for (const p of frontier) {
      around.length = 0;
      neighbours(p, around);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (const q of around) {
        if (!filled[q]) continue;
        r += px[q * 4];
        g += px[q * 4 + 1];
        b += px[q * 4 + 2];
        n++;
      }
      if (n === 0) continue;
      px[p * 4] = r / n;
      px[p * 4 + 1] = g / n;
      px[p * 4 + 2] = b / n;
      done.push(p);
    }
    // Se marcan al final de la pasada: si no, el color correría en diagonal
    // dentro de una misma pasada según el orden de recorrido.
    for (const p of done) filled[p] = 1;

    const next: number[] = [];
    for (const p of done) {
      around.length = 0;
      neighbours(p, around);
      for (const q of around) {
        if (!filled[q] && !queued[q]) {
          queued[q] = 1;
          next.push(q);
        }
      }
    }
    frontier = next;
  }

  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  ctx.putImageData(data, 0, 0);
  return canvas;
}
