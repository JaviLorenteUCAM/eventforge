import { fmtNum } from './utils';

/**
 * TEXTURAS DE OBJETOS · plantilla desplegada ("atlas en cruz")
 * ---------------------------------------------------------------------------
 * Una caja se despliega en 6 caras dentro de una única imagen. La rejilla es
 * PROPORCIONAL a las medidas reales del objeto, de modo que lo que dibujes en
 * cada recuadro aparece sin deformar sobre su cara.
 *
 *   columnas (ancho):   W        L        W        L
 *   filas (alto)
 *      W              [     ] [ARRIBA ] [     ] [      ]
 *      H              [ IZDA] [FRENTE ] [ DCHA] [ATRÁS ]
 *      W              [     ] [ ABAJO ] [     ] [      ]
 *
 *   L = largo (eje X)   ·   W = ancho/fondo (eje Z)   ·   H = alto (eje Y)
 *
 * Atlas total: (2·(L+W))  ×  (H + 2·W) metros, escalado a píxeles al exportar.
 *
 * El orden de materiales de THREE.BoxGeometry es:
 *   0:+X (derecha) · 1:-X (izquierda) · 2:+Y (arriba)
 *   3:-Y (abajo)   · 4:+Z (frente)    · 5:-Z (atrás)
 * `boxFaceUvs()` devuelve el offset/repeat de cada índice EN ESE ORDEN.
 */

export interface FaceRect {
  /** Clave estable de la cara. */
  key: 'right' | 'left' | 'top' | 'bottom' | 'front' | 'back';
  label: string;
  color: string;
  /** Rectángulo dentro del atlas, en metros, origen ARRIBA-IZQUIERDA. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasLayout {
  widthM: number;
  heightM: number;
  faces: FaceRect[];
}

const FACE_COLORS: Record<FaceRect['key'], string> = {
  front: '#ef4444',
  back: '#3b82f6',
  left: '#22c55e',
  right: '#eab308',
  top: '#a855f7',
  bottom: '#f97316',
};

const FACE_LABELS: Record<FaceRect['key'], string> = {
  front: 'FRENTE',
  back: 'ATRÁS',
  left: 'IZQUIERDA',
  right: 'DERECHA',
  top: 'ARRIBA',
  bottom: 'ABAJO',
};

/** Reparto de las 6 caras de una caja, en metros. */
export function boxAtlasLayout(lengthM: number, widthM: number, heightM: number): AtlasLayout {
  const L = Math.max(0.01, lengthM);
  const W = Math.max(0.01, widthM);
  const H = Math.max(0.01, heightM);

  const colX = [0, W, W + L, W + L + W];
  const colW = [W, L, W, L];
  const rowY = [0, W, W + H];
  const rowH = [W, H, W];

  const cell = (key: FaceRect['key'], col: number, row: number): FaceRect => ({
    key,
    label: FACE_LABELS[key],
    color: FACE_COLORS[key],
    x: colX[col],
    y: rowY[row],
    w: colW[col],
    h: rowH[row],
  });

  return {
    widthM: 2 * (L + W),
    heightM: H + 2 * W,
    faces: [
      cell('left', 0, 1),
      cell('front', 1, 1),
      cell('right', 2, 1),
      cell('back', 3, 1),
      cell('top', 1, 0),
      cell('bottom', 1, 2),
    ],
  };
}

export interface UvTransform {
  offset: [number, number];
  repeat: [number, number];
}

/**
 * Offset/repeat por cara, en el orden de materiales de BoxGeometry.
 * Convierte el rectángulo (origen arriba-izquierda) a coordenadas UV de
 * three.js (origen abajo-izquierda), de ahí la inversión del eje Y.
 */
export function boxFaceUvs(lengthM: number, widthM: number, heightM: number): UvTransform[] {
  const layout = boxAtlasLayout(lengthM, widthM, heightM);
  const byKey = new Map(layout.faces.map((f) => [f.key, f]));

  const toUv = (f: FaceRect): UvTransform => ({
    offset: [f.x / layout.widthM, 1 - (f.y + f.h) / layout.heightM],
    repeat: [f.w / layout.widthM, f.h / layout.heightM],
  });

  const order: FaceRect['key'][] = ['right', 'left', 'top', 'bottom', 'front', 'back'];
  return order.map((k) => toUv(byKey.get(k)!));
}

// ---------------------------------------------------------------------------
// Generación de la plantilla
// ---------------------------------------------------------------------------

const MAX_PX = 2048;
const MIN_PX = 512;

function pixelsPerMetre(widthM: number, heightM: number) {
  const byWidth = MAX_PX / widthM;
  const byHeight = MAX_PX / heightM;
  const ppm = Math.min(byWidth, byHeight);
  // Evita plantillas minúsculas para objetos pequeños (una regleta de 40 cm).
  const minPpm = MIN_PX / Math.max(widthM, heightM);
  return Math.max(ppm, minPpm);
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  sub: string,
  cx: number,
  cy: number,
  maxW: number,
  maxH: number,
) {
  const vertical = maxH > maxW * 1.6;
  ctx.save();
  ctx.translate(cx, cy);
  if (vertical) ctx.rotate(-Math.PI / 2);

  const available = vertical ? maxH : maxW;
  const size = Math.max(9, Math.min(available / (text.length * 0.62), (vertical ? maxW : maxH) / 3));

  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = `700 ${size}px system-ui, sans-serif`;
  ctx.fillText(text, 0, -size * 0.55);

  ctx.font = `500 ${size * 0.62}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
  ctx.fillText(sub, 0, size * 0.55);

  ctx.restore();
}

/**
 * Plantilla de una caja: cada cara con su color, su nombre y sus medidas.
 * Se descarga, se edita en cualquier programa de imagen respetando los
 * recuadros y se vuelve a importar.
 */
export async function generateBoxTemplate(
  name: string,
  lengthM: number,
  widthM: number,
  heightM: number,
): Promise<Blob> {
  const layout = boxAtlasLayout(lengthM, widthM, heightM);
  const ppm = pixelsPerMetre(layout.widthM, layout.heightM);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(layout.widthM * ppm);
  canvas.height = Math.round(layout.heightM * ppm);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite generar la plantilla.');

  // Fondo neutro: las zonas fuera de las caras no se ven en el objeto.
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(15,23,42,0.25)';
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  ctx.setLineDash([]);

  for (const face of layout.faces) {
    const x = face.x * ppm;
    const y = face.y * ppm;
    const w = face.w * ppm;
    const h = face.h * ppm;

    ctx.fillStyle = face.color;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(15,23,42,0.85)';
    ctx.lineWidth = Math.max(2, ppm * 0.01);
    ctx.strokeRect(x, y, w, h);

    drawLabel(
      ctx,
      face.label,
      `${fmtNum(face.w, 2)} × ${fmtNum(face.h, 2)} m`,
      x + w / 2,
      y + h / 2,
      w * 0.9,
      h * 0.9,
    );
  }

  // Pie con el nombre y la escala, fuera de cualquier cara.
  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.font = `500 ${Math.max(10, ppm * 0.05)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${name} · ${Math.round(ppm)} px/m`, 8, 8);

  return toBlob(canvas);
}

/**
 * Plantilla de un cilindro: solo la superficie lateral desenrollada
 * (perímetro × alto). Las tapas no se pueden desplegar en la misma imagen sin
 * deformarlas, así que en cilindros la textura se aplica envolviendo el lateral.
 */
/**
 * Plantilla del modo silueta: la VISTA DE FRENTE a secas, con el contorno
 * marcado y el fondo a cuadros para que se vea qué parte es transparente.
 *
 * Es mucho más fácil de dibujar que el despliegue en cruz: se pinta el objeto
 * de frente y se borra (o se pinta del color clave) lo que sea aire.
 */
export async function generateFrontTemplate(
  name: string,
  lengthM: number,
  heightM: number,
): Promise<Blob> {
  const px = 1024;
  const ratio = Math.max(0.05, heightM) / Math.max(0.05, lengthM);
  const w = px;
  const h = Math.max(64, Math.round(px * ratio));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se ha podido crear la plantilla');

  // Fondo a cuadros: recuerda que lo que quede así será aire.
  const tile = 32;
  for (let y = 0; y < h; y += tile) {
    for (let x = 0; x < w; x += tile) {
      ctx.fillStyle = (x / tile + y / tile) % 2 === 0 ? '#e5e7eb' : '#cbd5e1';
      ctx.fillRect(x, y, tile, tile);
    }
  }

  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);

  ctx.fillStyle = '#0f172a';
  ctx.font = `${Math.round(h * 0.06)}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${name} · vista de frente`, 16, 14);
  ctx.fillText(
    `${lengthM.toFixed(2)} × ${heightM.toFixed(2)} m — borra lo que sea aire`,
    16,
    14 + Math.round(h * 0.08),
  );

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Error al generar la plantilla'))), 'image/png'),
  );
}

export async function generateCylinderTemplate(
  name: string,
  diameterM: number,
  heightM: number,
): Promise<Blob> {
  const perimeter = Math.PI * Math.max(0.01, diameterM);
  const H = Math.max(0.01, heightM);
  const ppm = pixelsPerMetre(perimeter, H);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(perimeter * ppm);
  canvas.height = Math.round(H * ppm);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite generar la plantilla.');

  ctx.fillStyle = '#eab308';
  ctx.globalAlpha = 0.85;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = 'rgba(15,23,42,0.85)';
  ctx.lineWidth = Math.max(2, ppm * 0.01);
  ctx.strokeRect(0, 0, canvas.width, canvas.height);

  // Marcas de los cuartos, para orientarse al dibujar.
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(15,23,42,0.4)';
  for (let i = 1; i < 4; i++) {
    const x = (canvas.width / 4) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  drawLabel(
    ctx,
    'LATERAL',
    `perímetro ${fmtNum(perimeter, 2)} × alto ${fmtNum(H, 2)} m`,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.9,
    canvas.height * 0.9,
  );

  ctx.fillStyle = 'rgba(15,23,42,0.55)';
  ctx.font = `500 ${Math.max(10, ppm * 0.05)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${name} · ${Math.round(ppm)} px/m`, 8, 8);

  return toBlob(canvas);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se ha podido generar la imagen.'))),
      'image/png',
    );
  });
}
