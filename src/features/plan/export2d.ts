import {
  CONNECTION_COLOR,
  CONNECTION_LABEL,
  OBJECT_KIND_LABEL,
  type ConnectionKind,
  type EventRow,
  type MaterialNeed,
  type Plan,
  type PlanBackground,
  type PlanConnection,
  type PlanObject,
  type PlanZone,
} from '@/lib/types';
import { cablePath, footprintOf, polygonArea, polygonCentroid } from '@/lib/geometry';
import { fmtNum } from '@/lib/utils';
import { modelToPlan, placementOf, type Footprint } from './modelFootprint';

/**
 * PLANO 2D PROFESIONAL
 * ---------------------------------------------------------------------------
 * La captura del editor es una imagen de pantalla. Para montar hace falta un
 * plano de verdad: a escala normalizada, en una hoja estándar, con cotas,
 * leyenda y cajetín, y que un técnico pueda abrir en su programa de CAD.
 *
 * El dibujo se monta UNA vez, en metros (\`buildDrawing\`), y de ahí salen:
 *
 *   · \`toSvg\`: la hoja en milímetros de papel, a escala, para PDF y SVG.
 *   · \`toDxf\`: el dibujo en metros reales y por capas, para AutoCAD y demás.
 *
 * Del modelo 3D del recinto (unas pérgolas) entra lo que TOCA EL SUELO —las
 * bases de los pilares, en negro macizo— y el contorno de las cubiertas en
 * discontinua, que es como se dibuja en planta lo que queda por encima.
 */

// ---------------------------------------------------------------------------
// Modelo del dibujo (metros, ejes del plano: x a la derecha, y hacia abajo)
// ---------------------------------------------------------------------------

export type Paper = 'A4' | 'A3' | 'A2';

export interface ExportOptions {
  paper: Paper;
  /** Denominador de la escala (200 = 1:200). Null: la mayor que quepa. */
  scale: number | null;
  photo: boolean;
  cables: boolean;
  venue: boolean;
  /** Zonas marcadas, rotuladas «1 - Zona Fripozo». */
  zones: boolean;
  /** Puntos de luz y de red con su símbolo y numerados (E1, R1…). */
  feeds: boolean;
  /** Número de cada objeto en el plano. Sin él queda solo su forma, a escala. */
  marks: boolean;
  /** Hojas con el listado de material del evento detrás del plano. */
  material: boolean;
  /** En ese listado, marcar lo que no hay en el almacén. */
  markMissing: boolean;
  /** El listado separado por zonas (lo que cae dentro de cada una), y el total al final. */
  materialByZone?: boolean;
  /**
   * Encuadre: el punto del plano (metros) que queda en el centro del dibujo.
   * Null: centrado en todo lo que hay. Con una escala mayor que la que cabe,
   * es lo que permite sacar solo un trozo del plano.
   */
  view?: { cx: number; cy: number } | null;
}

export interface ExportInput {
  plan: Plan;
  event: Pick<EventRow, 'name' | 'location' | 'starts_at'> | null;
  objects: PlanObject[];
  connections: PlanConnection[];
  /** Capas con modelo del recinto y su planta ya calculada. */
  venues: { background: PlanBackground; footprint: Footprint }[];
  /** Fotos de fondo visibles, con la imagen ya en data URL para incrustarla. */
  photos: { background: PlanBackground; href: string }[];
  zones: PlanZone[];
  author: string;
  /** Listado de material del plano (computeMaterialNeeds). */
  material?: MaterialNeed[];
  /** Nombre de cada categoría, por su id. */
  categoryNames?: Map<string, string>;
  /** Material de lo que cae dentro de cada zona (zona null: fuera de todas). */
  materialByZone?: { zone: PlanZone | null; needs: MaterialNeed[] }[];
}

type Pt = { x: number; y: number };

interface DrawItem {
  object: PlanObject;
  mark: number | null;
  /** Contorno en planta (rectángulo girado) o círculo. */
  polygon: Pt[] | null;
  circle: { c: Pt; r: number } | null;
}

export interface LegendRow {
  mark: number;
  name: string;
  dims: string;
  count: number;
}

export interface Drawing {
  width: number;
  depth: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  items: DrawItem[];
  legend: LegendRow[];
  cables: { kind: ConnectionKind; points: Pt[] }[];
  /** Triángulos de lo que toca el suelo (pilares). */
  contact: Pt[][];
  roofEdges: [Pt, Pt][];
  photos: ExportInput['photos'];
  zones: { zone: PlanZone; points: Pt[]; centre: Pt; area: number }[];
  /** Puntos de luz (E1, E2…) y de red (R1, R2…). */
  feeds: { object: PlanObject; code: string }[];
  input: ExportInput;
  options: ExportOptions;
}

const FEED = new Set(['power_source', 'network_source']);

function corners(o: PlanObject): Pt[] {
  const f = footprintOf(o);
  const l = f.length / 2;
  const w = f.width / 2;
  const t = (Number(o.rotation) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cx = Number(o.x);
  const cy = Number(o.y);
  return [
    [-l, -w],
    [l, -w],
    [l, w],
    [-l, w],
  ].map(([u, v]) => ({ x: cx + u * c - v * s, y: cy + u * s + v * c }));
}

function nameOf(o: PlanObject) {
  return (o.label || '').trim() || OBJECT_KIND_LABEL[o.kind] || 'Elemento';
}

function dimsOf(o: PlanObject) {
  const f = footprintOf(o);
  return `${fmtNum(f.length, 2)} × ${fmtNum(f.width, 2)} × ${fmtNum(f.height, 2)}`;
}

export function buildDrawing(input: ExportInput, options: ExportOptions): Drawing {
  const W = Number(input.plan.width_m);
  const D = Number(input.plan.depth_m);

  // Marcas: los objetos iguales (mismo nombre y medidas) comparten número,
  // como en un plano de arquitectura; la leyenda dice cuántos hay.
  const legendMap = new Map<string, LegendRow>();
  const items: DrawItem[] = [];
  for (const o of input.objects) {
    if (o.shape === 'text' || o.shape === 'line') {
      items.push({ object: o, mark: null, polygon: null, circle: null });
      continue;
    }
    if (options.feeds && FEED.has(o.kind)) {
      const f = footprintOf(o);
      items.push({
        object: o,
        mark: null,
        polygon: null,
        circle: { c: { x: Number(o.x), y: Number(o.y) }, r: Math.max(f.length, f.width) / 2 },
      });
      continue;
    }
    const key = `${nameOf(o)}|${dimsOf(o)}`;
    let row = legendMap.get(key);
    if (!row) {
      row = { mark: legendMap.size + 1, name: nameOf(o), dims: dimsOf(o), count: 0 };
      legendMap.set(key, row);
    }
    row.count++;
    const f = footprintOf(o);
    items.push({
      object: o,
      mark: row.mark,
      polygon: o.shape === 'cylinder' ? null : corners(o),
      circle: o.shape === 'cylinder' ? { c: { x: Number(o.x), y: Number(o.y) }, r: f.length / 2 } : null,
    });
  }

  const byId = new Map(input.objects.map((o) => [o.id, o]));
  const cables = options.cables
    ? input.connections.flatMap((c) => {
        const a = byId.get(c.from_object_id);
        const b = byId.get(c.to_object_id);
        return a && b ? [{ kind: c.kind, points: cablePath(a, b, c.waypoints ?? []) }] : [];
      })
    : [];

  const contact: Pt[][] = [];
  const roofEdges: [Pt, Pt][] = [];
  if (options.venue) {
    for (const { background, footprint: fp } of input.venues) {
      const p = placementOf(background);
      const to = (x: number, z: number) => modelToPlan(p, fp, x, z);
      for (let i = 0; i + 5 < fp.contact.length; i += 6) {
        contact.push([
          to(fp.contact[i], fp.contact[i + 1]),
          to(fp.contact[i + 2], fp.contact[i + 3]),
          to(fp.contact[i + 4], fp.contact[i + 5]),
        ]);
      }
      for (let i = 0; i + 3 < fp.roofEdges.length; i += 4) {
        roofEdges.push([to(fp.roofEdges[i], fp.roofEdges[i + 1]), to(fp.roofEdges[i + 2], fp.roofEdges[i + 3])]);
      }
    }
  }

  const zones = options.zones
    ? input.zones
        .map((zone) => {
          const points = (zone.points ?? []).map((p) => ({ x: Number(p.x), y: Number(p.y) }));
          return { zone, points, centre: polygonCentroid(points), area: polygonArea(points) };
        })
        .filter((z) => z.points.length >= 3)
        .sort((a, b) => a.zone.number - b.zone.number)
    : [];

  // Numeradas por tipo y de izquierda a derecha y de arriba abajo, que es
  // como se buscan en el plano.
  const feeds: Drawing['feeds'] = [];
  if (options.feeds) {
    for (const [kind, prefix] of [
      ['power_source', 'E'],
      ['network_source', 'R'],
    ] as const) {
      input.objects
        .filter((o) => o.kind === kind)
        .sort((a, b) => Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x))
        .forEach((object, i) => feeds.push({ object, code: `${prefix}${i + 1}` }));
    }
  }

  // Lo que se dibuja manda en el encuadre; la foto se recorta a él.
  const pts: Pt[] = [
    { x: 0, y: 0 },
    { x: W, y: D },
  ];
  for (const it of items) {
    if (it.polygon) pts.push(...it.polygon);
    else if (it.circle) pts.push({ x: it.circle.c.x - it.circle.r, y: it.circle.c.y - it.circle.r }, { x: it.circle.c.x + it.circle.r, y: it.circle.c.y + it.circle.r });
    else pts.push({ x: Number(it.object.x), y: Number(it.object.y) });
  }
  for (const c of cables) pts.push(...c.points);
  for (const t of contact) pts.push(...t);
  for (const [a, b] of roofEdges) pts.push(a, b);
  for (const z of zones) pts.push(...z.points);
  const bounds = {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };

  return {
    width: W,
    depth: D,
    bounds,
    items,
    legend: [...legendMap.values()],
    cables,
    contact,
    roofEdges,
    photos: options.photo ? input.photos : [],
    zones,
    feeds,
    input,
    options,
  };
}

// ---------------------------------------------------------------------------
// Hoja: tamaño, escala y encaje
// ---------------------------------------------------------------------------

const PAPER: Record<Paper, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
  A2: { w: 594, h: 420 },
};

/** Escalas normalizadas de arquitectura, de más grande a más pequeña. */
export const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 2500, 5000];

export interface Sheet {
  w: number;
  h: number;
  margin: number;
  /** Zona del dibujo en la hoja, en mm. */
  area: { x: number; y: number; w: number; h: number };
  /** Columna de leyenda y cajetín. */
  side: { x: number; y: number; w: number; h: number };
  denom: number;
  /** La escala con la que cabe todo (la «automática»). */
  autoDenom: number;
  /** Punto del plano en el centro del dibujo. */
  centre: Pt;
  /** mm de papel por metro real. */
  k: number;
  /** Del plano (m) a la hoja (mm). */
  toPaper: (p: Pt) => Pt;
}

export function layoutSheet(d: Drawing): Sheet {
  const { w, h } = PAPER[d.options.paper];
  const margin = 10;
  const sideW = d.options.paper === 'A4' ? 70 : 82;
  const side = { x: w - margin - sideW, y: margin, w: sideW, h: h - margin * 2 };
  const area = { x: margin, y: margin, w: w - margin * 3 - sideW, h: h - margin * 2 };

  // Hueco para las cotas (arriba e izquierda) y la escala gráfica (abajo).
  const pad = { l: 16, t: 16, r: 6, b: 18 };
  const dw = Math.max(0.5, d.bounds.maxX - d.bounds.minX);
  const dh = Math.max(0.5, d.bounds.maxY - d.bounds.minY);
  const fitW = area.w - pad.l - pad.r;
  const fitH = area.h - pad.t - pad.b;
  const auto = SCALES.find((s) => (dw * 1000) / s <= fitW && (dh * 1000) / s <= fitH) ?? SCALES[SCALES.length - 1];
  const denom = d.options.scale ?? auto;
  const k = 1000 / denom;

  // El punto elegido (o el centro de todo) va al centro del hueco útil.
  const centre = d.options.view ?? {
    x: (d.bounds.minX + d.bounds.maxX) / 2,
    y: (d.bounds.minY + d.bounds.maxY) / 2,
  };
  const c = 'cx' in centre ? { x: centre.cx, y: centre.cy } : centre;
  const px = area.x + pad.l + fitW / 2;
  const py = area.y + pad.t + fitH / 2;
  const toPaper = (p: Pt) => ({ x: px + (p.x - c.x) * k, y: py + (p.y - c.y) * k });

  return { w, h, margin, area, side, denom, autoDenom: auto, centre: c, k, toPaper };
}

// ---------------------------------------------------------------------------
// SVG (hoja en mm)
// ---------------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const FONT = 'Helvetica, Arial, sans-serif';

const CABLE_DASH: Record<ConnectionKind, string | null> = {
  power: null,
  network: '1.6 1',
  signal: '3.2 1',
  usb: '0.4 0.8',
};

export function toSvg(d: Drawing): string {
  const sh = layoutSheet(d);
  const P = sh.toPaper;
  const out: string[] = [];
  const pathOf = (pts: Pt[], close: boolean) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${n(P(p).x)} ${n(P(p).y)}`).join('') + (close ? 'Z' : '');

  out.push(
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${sh.w}mm" height="${sh.h}mm" viewBox="0 0 ${sh.w} ${sh.h}" font-family="${FONT}">`,
    `<defs>`,
    `<clipPath id="area"><rect x="${sh.area.x}" y="${sh.area.y}" width="${sh.area.w}" height="${sh.area.h}"/></clipPath>`,
    `<filter id="gris"><feColorMatrix type="saturate" values="0"/></filter>`,
    `</defs>`,
    `<rect width="${sh.w}" height="${sh.h}" fill="#fff"/>`,
  );

  // --- Dibujo, recortado a su recuadro --------------------------------------
  out.push(`<g clip-path="url(#area)">`);

  for (const ph of d.photos) {
    const b = ph.background;
    const tl = P({ x: Number(b.x), y: Number(b.y) });
    const wmm = Number(b.width_m) * sh.k;
    const hmm = Number(b.height_m) * sh.k;
    out.push(
      `<image href="${ph.href}" xlink:href="${ph.href}" x="${n(tl.x)}" y="${n(tl.y)}" width="${n(wmm)}" height="${n(hmm)}" preserveAspectRatio="none" opacity="0.35" filter="url(#gris)" transform="rotate(${Number(b.rotation)} ${n(tl.x + wmm / 2)} ${n(tl.y + hmm / 2)})"/>`,
    );
  }

  // Recinto
  const r0 = P({ x: 0, y: 0 });
  out.push(
    `<rect x="${n(r0.x)}" y="${n(r0.y)}" width="${n(d.width * sh.k)}" height="${n(d.depth * sh.k)}" fill="none" stroke="#000" stroke-width="0.5"/>`,
  );

  // Zonas: velo de color y borde discontinuo, bajo todo lo demás.
  for (const z of d.zones) {
    out.push(
      `<path d="${pathOf(z.points, true)}" fill="${z.zone.color}" fill-opacity="0.12" stroke="${z.zone.color}" stroke-width="0.4" stroke-dasharray="2.2 1.2"/>`,
    );
  }

  // Recinto 3D: cubiertas en discontinua y, encima, lo que toca el suelo.
  if (d.roofEdges.length) {
    out.push(
      `<path d="${d.roofEdges.map(([a, b]) => `M${n(P(a).x)} ${n(P(a).y)}L${n(P(b).x)} ${n(P(b).y)}`).join('')}" fill="none" stroke="#555" stroke-width="0.18" stroke-dasharray="1.6 0.9"/>`,
    );
  }
  if (d.contact.length) {
    out.push(`<path d="${d.contact.map((t) => pathOf(t, true)).join('')}" fill="#000" stroke="#000" stroke-width="0.1"/>`);
  }

  // Cableado, bajo los objetos
  for (const c of d.cables) {
    const dash = CABLE_DASH[c.kind];
    out.push(
      `<path d="${pathOf(c.points, false)}" fill="none" stroke="${CONNECTION_COLOR[c.kind]}" stroke-width="0.35" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
    );
  }

  // Objetos
  for (const it of d.items) {
    const o = it.object;
    if (o.shape === 'text') {
      const c = P({ x: Number(o.x), y: Number(o.y) });
      const size = Math.max(0.08, Number(o.width_m) * 0.72) * sh.k;
      out.push(
        `<text x="${n(c.x)}" y="${n(c.y)}" font-size="${n(size)}" text-anchor="middle" dominant-baseline="middle" transform="rotate(${Number(o.rotation)} ${n(c.x)} ${n(c.y)})">${esc(o.label || '')}</text>`,
      );
      continue;
    }
    if (o.shape === 'line') {
      const pts = corners(o);
      const a = { x: (pts[0].x + pts[3].x) / 2, y: (pts[0].y + pts[3].y) / 2 };
      const b = { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
      out.push(`<path d="${pathOf([a, b], false)}" stroke="#000" stroke-width="0.35"/>`);
      continue;
    }
    const fill = o.shape === 'plane' ? 'none' : '#fff';
    if (it.circle) {
      const c = P(it.circle.c);
      out.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(it.circle.r * sh.k)}" fill="${fill}" stroke="#000" stroke-width="0.25"/>`);
    } else if (it.polygon) {
      out.push(`<path d="${pathOf(it.polygon, true)}" fill="${fill}" fill-opacity="0.9" stroke="#000" stroke-width="0.25"/>`);
    }
    if (FEED.has(o.kind) && !d.options.feeds) {
      const c = P({ x: Number(o.x), y: Number(o.y) });
      out.push(
        `<text x="${n(c.x)}" y="${n(c.y)}" font-size="2" font-weight="bold" text-anchor="middle" dominant-baseline="central">${o.kind === 'power_source' ? 'E' : 'R'}</text>`,
      );
    }
  }

  // Marcas (encima de todo, para que se lean)
  for (const it of d.items) {
    if (!d.options.marks || it.mark == null || FEED.has(it.object.kind)) continue;
    const c = P({ x: Number(it.object.x), y: Number(it.object.y) });
    const r = it.mark >= 100 ? 2.4 : 2;
    out.push(
      `<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${r}" fill="#fff" stroke="#000" stroke-width="0.18"/>`,
      `<text x="${n(c.x)}" y="${n(c.y)}" font-size="${it.mark >= 100 ? 1.6 : 2}" text-anchor="middle" dominant-baseline="central">${it.mark}</text>`,
    );
  }
  for (const fd of d.feeds) {
    const c = P({ x: Number(fd.object.x), y: Number(fd.object.y) });
    out.push(feedSymbol(fd.object.kind, c.x, c.y, 2.3));
    out.push(
      `<text x="${n(c.x + 3)}" y="${n(c.y - 2.4)}" font-size="2.2" font-weight="bold" stroke="#fff" stroke-width="0.6" paint-order="stroke">${fd.code}</text>`,
    );
  }

  for (const z of d.zones) {
    const c = P(z.centre);
    const label = `${z.zone.number} - ${z.zone.name || 'Zona'}`;
    const lines = wrap((z.zone.description ?? '').trim(), 42, 3);
    const wl = Math.max(label.length * 1.6, ...lines.map((l) => l.length * 1.1)) + 4;
    const hl = 5.2 + lines.length * 2.7;
    const top = c.y - hl / 2;
    out.push(
      `<rect x="${n(c.x - wl / 2)}" y="${n(top)}" width="${n(wl)}" height="${n(hl)}" rx="1" fill="#fff" stroke="${z.zone.color}" stroke-width="0.4"/>`,
      `<text x="${n(c.x)}" y="${n(top + 2.6)}" font-size="2.8" font-weight="bold" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`,
      ...lines.map(
        (l, i) =>
          `<text x="${n(c.x)}" y="${n(top + 5.2 + i * 2.7 + 1.2)}" font-size="2" fill="#333" text-anchor="middle" dominant-baseline="central">${esc(l)}</text>`,
      ),
    );
  }
  out.push(`</g>`);

  // --- Cotas generales del recinto ------------------------------------------
  // Solo cuando el recinto entero entra en el encuadre: con un trozo del
  // plano, las cotas quedarían colgando fuera del dibujo.
  const r1 = P({ x: d.width, y: d.depth });
  const top = Math.max(sh.area.y + 6, r0.y - 7);
  const left = Math.max(sh.area.x + 6, r0.x - 7);
  const fits =
    r0.x >= sh.area.x + 8 &&
    r0.y >= sh.area.y + 8 &&
    r1.x <= sh.area.x + sh.area.w - 2 &&
    r1.y <= sh.area.y + sh.area.h - 14;
  if (fits) out.push(
    `<g stroke="#000" stroke-width="0.13" fill="none">`,
    `<path d="M${n(r0.x)} ${n(r0.y - 1)}V${n(top - 1.5)}M${n(r1.x)} ${n(r0.y - 1)}V${n(top - 1.5)}M${n(r0.x)} ${n(top)}H${n(r1.x)}"/>`,
    `<path d="M${n(r0.x - 1)} ${n(r0.y)}H${n(left - 1.5)}M${n(r0.x - 1)} ${n(r1.y)}H${n(left - 1.5)}M${n(left)} ${n(r0.y)}V${n(r1.y)}"/>`,
    // Trazos oblicuos en los extremos, como en las cotas de arquitectura.
    ...[
      [r0.x, top],
      [r1.x, top],
      [left, r0.y],
      [left, r1.y],
    ].map(([x, y]) => `<path d="M${n(x - 1)} ${n(y + 1)}L${n(x + 1)} ${n(y - 1)}" stroke-width="0.3"/>`),
    `</g>`,
    `<text x="${n((r0.x + r1.x) / 2)}" y="${n(top - 1.2)}" font-size="2.4" text-anchor="middle">${fmtNum(d.width, 2)} m</text>`,
    `<text x="${n(left - 1.2)}" y="${n((r0.y + r1.y) / 2)}" font-size="2.4" text-anchor="middle" transform="rotate(-90 ${n(left - 1.2)} ${n((r0.y + r1.y) / 2)})">${fmtNum(d.depth, 2)} m</text>`,
  );

  // --- Escala gráfica ------------------------------------------------------
  const options = [0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  const total = options.find((t) => t * sh.k >= 30) ?? options[options.length - 1];
  const barX = sh.area.x + 6;
  const barY = sh.area.y + sh.area.h - 9;
  const seg = (total * sh.k) / 4;
  for (let i = 0; i < 4; i++) {
    out.push(
      `<rect x="${n(barX + i * seg)}" y="${n(barY)}" width="${n(seg)}" height="1.4" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="0.15"/>`,
    );
  }
  out.push(
    `<text x="${n(barX)}" y="${n(barY + 4.2)}" font-size="2.2" text-anchor="middle">0</text>`,
    `<text x="${n(barX + seg * 2)}" y="${n(barY + 4.2)}" font-size="2.2" text-anchor="middle">${fmtNum(total / 2, total < 2 ? 2 : 0)}</text>`,
    `<text x="${n(barX + seg * 4)}" y="${n(barY + 4.2)}" font-size="2.2" text-anchor="middle">${fmtNum(total, total < 2 ? 1 : 0)} m</text>`,
    `<text x="${n(barX + seg * 4 + 6)}" y="${n(barY + 1.4)}" font-size="2.6" font-weight="bold">E 1:${sh.denom}</text>`,
  );

  // Marco del dibujo
  out.push(
    `<rect x="${sh.area.x}" y="${sh.area.y}" width="${sh.area.w}" height="${sh.area.h}" fill="none" stroke="#000" stroke-width="0.35"/>`,
  );

  out.push(...sideColumn(d, sh));
  out.push(`</svg>`);
  return out.join('\n');
}

/**
 * Símbolo de un suministro, centrado en (cx, cy) y de radio r (mm): punto de
 * luz, un círculo con el rayo; punto de red, un cuadrado con tres nodos
 * enlazados.
 */
function feedSymbol(kind: string, cx: number, cy: number, r: number): string {
  const k = r / 2.3;
  if (kind === 'power_source') {
    const bolt = [
      [0.5, -1.6],
      [-0.9, 0.25],
      [-0.05, 0.25],
      [-0.45, 1.6],
      [0.95, -0.3],
      [0.1, -0.3],
    ]
      .map(([px, py], i) => `${i ? 'L' : 'M'}${n(cx + px * k)} ${n(cy + py * k)}`)
      .join('');
    return (
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="#fff" stroke="#000" stroke-width="0.3"/>` +
      `<path d="${bolt}Z" fill="#000"/>`
    );
  }
  const t = { x: cx, y: cy - 1.05 * k };
  const a = { x: cx - 1.1 * k, y: cy + 0.95 * k };
  const b = { x: cx + 1.1 * k, y: cy + 0.95 * k };
  return (
    `<rect x="${n(cx - r)}" y="${n(cy - r)}" width="${n(r * 2)}" height="${n(r * 2)}" rx="${n(r * 0.2)}" fill="#fff" stroke="#000" stroke-width="0.3"/>` +
    `<path d="M${n(t.x)} ${n(t.y)}L${n(a.x)} ${n(a.y)}M${n(t.x)} ${n(t.y)}L${n(b.x)} ${n(b.y)}M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}" stroke="#000" stroke-width="0.25"/>` +
    [t, a, b].map((p) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(0.45 * k)}" fill="#000"/>`).join('')
  );
}

/** Leyenda y cajetín. */
function sideColumn(d: Drawing, sh: Sheet): string[] {
  const { x, y, w, h } = sh.side;
  const out: string[] = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="0.35"/>`,
  ];

  const blockH = 62;
  const legendBottom = y + h - blockH - 4;
  let cy = y + 7;
  out.push(`<text x="${x + 4}" y="${cy}" font-size="3" font-weight="bold" letter-spacing="0.3">LEYENDA</text>`);
  cy += 3;

  // Los objetos solo van en la leyenda si hace falta: con el listado de
  // material detrás sobran, salvo que estén numerados (los números del plano
  // necesitan su clave).
  const withMaterialSheet = d.options.material && (d.input.material?.length ?? 0) > 0;
  const legend = withMaterialSheet && !d.options.marks ? [] : d.legend;

  // Cabecera de la tabla. Las medidas van debajo del nombre: en una columna
  // aparte, en A4 los nombres se quedaban en «Mesa plega…».
  const col = { mark: x + 6.5, name: d.options.marks ? x + 11 : x + 4, qty: x + w - 4 };
  if (legend.length) cy += 3.5;
  if (legend.length) out.push(
    `<text x="${col.name}" y="${cy}" font-size="1.9" fill="#555">ELEMENTO · L × A × H (m)</text>`,
    `<text x="${col.qty}" y="${cy}" font-size="1.9" fill="#555" text-anchor="end">UD.</text>`,
    `<path d="M${x + 3} ${cy + 1.2}H${x + w - 3}" stroke="#000" stroke-width="0.15"/>`,
  );
  if (legend.length) cy += 1.5;

  // Lo que viene después de la tabla también necesita sitio.
  const kinds = [...new Set(d.cables.map((c) => c.kind))];
  const extra =
    (kinds.length ? 6 + kinds.length * 4.2 : 0) +
    (d.contact.length || d.roofEdges.length ? 14 : 0) +
    (d.zones.length ? 7 + d.zones.reduce((t, z) => t + (z.zone.description ? 7 : 4.2), 0) : 0) +
    (d.feeds.length ? 7 + d.feeds.length * 4.6 : 0);
  const rowH = 6.4;
  const maxRows = Math.max(0, Math.floor((legendBottom - cy - extra) / rowH));
  const rows = legend.slice(0, legend.length > maxRows ? maxRows - 1 : maxRows);

  const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  const nameChars = Math.floor((col.qty - 6 - col.name) / 1.15);
  for (const r of rows) {
    cy += rowH;
    if (d.options.marks) {
      out.push(
        `<circle cx="${col.mark}" cy="${cy - 1.9}" r="1.7" fill="#fff" stroke="#000" stroke-width="0.15"/>`,
        `<text x="${col.mark}" y="${cy - 1.9}" font-size="1.7" text-anchor="middle" dominant-baseline="central">${r.mark}</text>`,
      );
    }
    out.push(
      `<text x="${col.name}" y="${cy - 2.4}" font-size="2.1">${esc(fit(r.name, Math.max(8, nameChars)))}</text>`,
      `<text x="${col.name}" y="${cy}" font-size="1.75" fill="#555">${r.dims}</text>`,
      `<text x="${col.qty}" y="${cy - 1.2}" font-size="2.1" text-anchor="end">${r.count}</text>`,
    );
  }
  if (rows.length < legend.length) {
    cy += rowH;
    out.push(
      `<text x="${col.name}" y="${cy}" font-size="2" fill="#555">… y ${legend.length - rows.length} elementos más (ver listado de material)</text>`,
    );
  }

  if (!legend.length) cy -= 3;
  if (d.zones.length) {
    cy += 7;
    out.push(`<text x="${x + 4}" y="${cy}" font-size="2.4" font-weight="bold">ZONAS</text>`);
    for (const z of d.zones) {
      cy += 4.2;
      out.push(
        `<rect x="${x + 4}" y="${cy - 2.7}" width="8" height="3.2" fill="${z.zone.color}" fill-opacity="0.18" stroke="${z.zone.color}" stroke-width="0.35" stroke-dasharray="1.4 0.8"/>`,
        `<text x="${x + 14}" y="${cy}" font-size="2.1">${esc(fit(`${z.zone.number} - ${z.zone.name || 'Zona'}`, Math.max(10, nameChars - 6)))}</text>`,
        `<text x="${x + w - 4}" y="${cy}" font-size="1.9" fill="#555" text-anchor="end">${fmtNum(z.area, 1)} m²</text>`,
      );
      if (z.zone.description) {
        cy += 2.8;
        out.push(
          `<text x="${x + 14}" y="${cy}" font-size="1.75" fill="#555">${esc(fit(z.zone.description, Math.max(10, nameChars + 2)))}</text>`,
        );
      }
    }
  }

  if (d.feeds.length) {
    cy += 7;
    out.push(`<text x="${x + 4}" y="${cy}" font-size="2.4" font-weight="bold">SUMINISTROS</text>`);
    for (const fd of d.feeds) {
      cy += 4.6;
      out.push(
        feedSymbol(fd.object.kind, x + 8, cy - 0.8, 1.7),
        `<text x="${x + 12}" y="${cy}" font-size="2.1" font-weight="bold">${fd.code}</text>`,
        `<text x="${x + 19}" y="${cy}" font-size="2.1">${esc(fit(nameOf(fd.object), Math.max(10, nameChars - 4)))}</text>`,
      );
    }
  }

  if (kinds.length) {
    cy += 7;
    out.push(`<text x="${x + 4}" y="${cy}" font-size="2.4" font-weight="bold">CABLEADO</text>`);
    for (const k of kinds) {
      cy += 4.2;
      const dash = CABLE_DASH[k];
      out.push(
        `<path d="M${x + 4} ${cy - 0.8}H${x + 12}" stroke="${CONNECTION_COLOR[k]}" stroke-width="0.5"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`,
        `<text x="${x + 14}" y="${cy}" font-size="2.1">${esc(CONNECTION_LABEL[k])}</text>`,
      );
    }
  }
  if (d.contact.length || d.roofEdges.length) {
    cy += 7;
    out.push(`<text x="${x + 4}" y="${cy}" font-size="2.4" font-weight="bold">RECINTO</text>`);
    cy += 4.2;
    out.push(
      `<rect x="${x + 6.5}" y="${cy - 2.6}" width="2.6" height="2.6" fill="#000"/>`,
      `<text x="${x + 14}" y="${cy}" font-size="2.1">Pilares y apoyos en el suelo</text>`,
    );
    cy += 4.2;
    out.push(
      `<path d="M${x + 4} ${cy - 0.8}H${x + 12}" stroke="#555" stroke-width="0.25" stroke-dasharray="1.6 0.9"/>`,
      `<text x="${x + 14}" y="${cy}" font-size="2.1">Proyección de cubiertas</text>`,
    );
  }

  out.push(...titleBlock(d, sh, 1, 1 + materialPages(d).length, 'PLANO'));
  return out;
}

/** Cajetín, abajo de la columna lateral. Es el mismo en todas las hojas. */
function titleBlock(d: Drawing, sh: Sheet, page: number, pages: number, kind: string): string[] {
  const { x, y, w, h } = sh.side;
  const out: string[] = [];
  const blockH = 62;
  const fit = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  const by = y + h - blockH;
  const ev = d.input.event;
  const fecha = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fields: [string, string][] = [
    ['EVENTO', ev?.name ?? '—'],
    [kind, kind === 'PLANO' ? d.input.plan.name : `Material · ${d.input.plan.name}`],
    ['LUGAR', ev?.location || '—'],
    ['FECHA', fecha],
    ['ESCALA', kind === 'PLANO' ? `1:${sh.denom}` : '—'],
    ['FORMATO', `${d.options.paper} · medidas en m`],
    ['AUTOR', d.input.author || '—'],
  ];
  out.push(`<path d="M${x} ${by}H${x + w}" stroke="#000" stroke-width="0.35"/>`);
  const fh = (blockH - 10) / fields.length;
  fields.forEach(([k, v], i) => {
    const fy = by + i * fh;
    out.push(
      `<path d="M${x} ${n(fy + fh)}H${x + w}" stroke="#000" stroke-width="0.12"/>`,
      `<text x="${x + 2.5}" y="${n(fy + fh * 0.62)}" font-size="1.7" fill="#555">${k}</text>`,
      `<text x="${x + 17}" y="${n(fy + fh * 0.66)}" font-size="${k === 'EVENTO' ? 2.6 : 2.2}" font-weight="${k === 'EVENTO' || k === 'ESCALA' ? 'bold' : 'normal'}">${esc(fit(v, Math.floor((w - 19) / 1.25)))}</text>`,
    );
  });
  out.push(
    `<path d="M${x + 15} ${by}V${by + blockH - 10}" stroke="#000" stroke-width="0.12"/>`,
    `<text x="${x + 2.5}" y="${y + h - 4}" font-size="2.6" font-weight="bold" letter-spacing="0.2">EventForge</text>`,
    `<text x="${x + w - 2.5}" y="${y + h - 4}" font-size="1.8" fill="#555" text-anchor="end">Hoja ${page}/${pages}</text>`,
  );
  return out;
}

/** Corta un texto en líneas de como mucho `max` caracteres, sin partir palabras. */
function wrap(text: string, max: number, maxLines: number): string[] {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line ? `${line} ${word}` : word).length <= max) {
      line = line ? `${line} ${word}` : word;
    } else {
      if (line) lines.push(line);
      line = word.length > max ? `${word.slice(0, max - 1)}…` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, max - 1)}…`;
    return kept;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Hojas de material
// ---------------------------------------------------------------------------

type MaterialEntry =
  | { group: string; color?: string; cont?: boolean; total?: boolean }
  | { need: MaterialNeed; inZone?: boolean; short?: boolean };

/**
 * El listado de material del evento, en las hojas que hagan falta, con el
 * mismo formato y cajetín que el plano. Agrupado por categoría y con el
 * cableado al final, una línea por tipo y sin cantidades. Si se pide, lo que
 * no hay en el almacén va resaltado con lo que falta.
 */
export function materialPages(d: Drawing): string[] {
  const needs = d.options.material ? (d.input.material ?? []) : [];
  if (needs.length === 0) return [];
  const sh = layoutSheet(d);
  const { x, y, w, h } = sh.area;
  const names = d.input.categoryNames ?? new Map<string, string>();
  const groupOf = (m: MaterialNeed) =>
    m.cabling ? 'Cableado' : (m.categoryId ? names.get(m.categoryId) : undefined) ?? 'Otros';

  /** Por categoría, con el cableado al final y cada grupo por orden alfabético. */
  const byCategory = (list: MaterialNeed[]) => {
    const groups = new Map<string, MaterialNeed[]>();
    for (const m of list) groups.set(groupOf(m), [...(groups.get(groupOf(m)) ?? []), m]);
    return [...groups.entries()]
      .sort((a, b) => Number(a[0] === 'Cableado') - Number(b[0] === 'Cableado') || a[0].localeCompare(b[0], 'es'))
      .flatMap(([, l]) => l.sort((a, b) => a.name.localeCompare(b.name, 'es')));
  };

  const entries: MaterialEntry[] = [];
  const zoned = d.options.materialByZone ? (d.input.materialByZone ?? []) : [];
  if (zoned.length) {
    // Separado por zonas: lo que cae dentro de cada una, y al final el total
    // del evento con las existencias. En las zonas se marca lo que, en el
    // total, no llega en el almacén.
    const shortKeys = new Set(needs.filter((m) => !m.cabling && m.missing > 0).map((m) => m.key));
    for (const { zone, needs: list } of zoned) {
      entries.push({
        group: zone ? `${zone.number} - ${zone.name || 'Zona'}` : 'Fuera de zonas',
        color: zone?.color,
      });
      for (const need of byCategory(list)) {
        entries.push({ need, inZone: true, short: shortKeys.has(need.key) });
      }
    }
    entries.push({ group: 'Total del evento', total: true });
    for (const need of byCategory([...needs])) entries.push({ need });
  } else {
    const groups = new Map<string, MaterialNeed[]>();
    for (const m of needs) groups.set(groupOf(m), [...(groups.get(groupOf(m)) ?? []), m]);
    const ordered = [...groups.entries()].sort(
      (a, b) => Number(a[0] === 'Cableado') - Number(b[0] === 'Cableado') || a[0].localeCompare(b[0], 'es'),
    );
    for (const [group, list] of ordered) {
      entries.push({ group });
      for (const need of list.sort((a, b) => a.name.localeCompare(b.name, 'es'))) entries.push({ need });
    }
  }

  const rowH = 5.4;
  const top = y + 26;
  const perPage = Math.max(5, Math.floor((y + h - 8 - top) / rowH));
  const pagesEntries: MaterialEntry[][] = [];
  let current: MaterialEntry[] = [];
  let lastGroup: Extract<MaterialEntry, { group: string }> = { group: '' };
  for (const e of entries) {
    if ('group' in e) lastGroup = e;
    if (current.length >= perPage) {
      pagesEntries.push(current);
      current = 'group' in e ? [] : [{ ...lastGroup, cont: true }];
    }
    current.push(e);
  }
  if (current.length) pagesEntries.push(current);

  const plan = 1;
  const total = plan + pagesEntries.length;
  const mark = d.options.markMissing;
  const col = mark
    ? { name: x + 6, need: x + w * 0.66, stock: x + w * 0.81, miss: x + w - 6 }
    : { name: x + 6, need: x + w - 6, stock: 0, miss: 0 };
  const qty = (v: number, unit: string) => `${fmtNum(v, unit === 'm' ? 1 : 0)} ${unit}`;
  const nameChars = Math.floor(((mark ? col.need - 28 : col.need - 30) - col.name) / 1.25);
  const short = needs.filter((m) => !m.cabling && m.missing > 0);

  return pagesEntries.map((pageEntries, p) => {
    const out: string[] = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${sh.w}mm" height="${sh.h}mm" viewBox="0 0 ${sh.w} ${sh.h}" font-family="${FONT}">`,
      `<rect width="${sh.w}" height="${sh.h}" fill="#fff"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#000" stroke-width="0.35"/>`,
      `<text x="${x + 6}" y="${y + 10}" font-size="4.2" font-weight="bold" letter-spacing="0.3">LISTADO DE MATERIAL</text>`,
      `<text x="${x + 6}" y="${y + 15.5}" font-size="2.4" fill="#555">${esc(d.input.event?.name ?? '')}${d.input.event?.name ? ' · ' : ''}${esc(d.input.plan.name)}${pagesEntries.length > 1 ? ` · ${p + 1} de ${pagesEntries.length}` : ''}</text>`,
    ];

    // Cabecera de columnas
    const hy = top - 2.2;
    out.push(
      `<text x="${col.name}" y="${hy}" font-size="2" fill="#555">MATERIAL</text>`,
      `<text x="${col.need}" y="${hy}" font-size="2" fill="#555" text-anchor="end">NECESARIO</text>`,
    );
    if (mark) {
      out.push(
        `<text x="${col.stock}" y="${hy}" font-size="2" fill="#555" text-anchor="end">EN ALMACÉN</text>`,
        `<text x="${col.miss}" y="${hy}" font-size="2" fill="#555" text-anchor="end">FALTA</text>`,
      );
    }
    out.push(`<path d="M${x + 4} ${top - 0.8}H${x + w - 4}" stroke="#000" stroke-width="0.2"/>`);

    let cy = top;
    for (const e of pageEntries) {
      if ('group' in e) {
        out.push(
          `<rect x="${x + 4}" y="${n(cy)}" width="${w - 8}" height="${rowH}" fill="${e.total ? '#e4e4e4' : '#f1f1f1'}"/>`,
          e.color
            ? `<rect x="${col.name}" y="${n(cy + 1.3)}" width="5" height="${rowH - 2.6}" fill="${e.color}" fill-opacity="0.3" stroke="${e.color}" stroke-width="0.35"/>`
            : '',
          `<text x="${e.color ? col.name + 7 : col.name}" y="${n(cy + rowH * 0.68)}" font-size="2.3" font-weight="bold">${esc(e.color ? e.group : e.group.toUpperCase())}${e.cont ? ' (cont.)' : ''}</text>`,
        );
      } else if (e.inZone) {
        // Fila de una zona: solo lo necesario ahí; en rojo si en el total
        // no llega el almacén.
        const m = e.need;
        const short = mark && e.short;
        if (short) out.push(`<rect x="${x + 4}" y="${n(cy)}" width="${w - 8}" height="${rowH}" fill="#fdecec"/>`);
        const base = n(cy + rowH * 0.68);
        out.push(
          `<text x="${col.name + 3}" y="${base}" font-size="2.3"${short ? ' font-weight="bold"' : ''}>${esc(m.name.length > nameChars - 2 ? `${m.name.slice(0, nameChars - 3)}…` : m.name)}</text>`,
          `<text x="${col.need}" y="${base}" font-size="2.3" text-anchor="end">${m.cabling ? '—' : qty(m.needed, m.unit)}</text>`,
        );
        if (short) {
          out.push(`<text x="${col.miss}" y="${base}" font-size="2" font-weight="bold" fill="#b91c1c" text-anchor="end">falta (ver total)</text>`);
        }
        out.push(`<path d="M${x + 4} ${n(cy + rowH)}H${x + w - 4}" stroke="#ddd" stroke-width="0.1"/>`);
      } else {
        const m = e.need;
        const missing = mark && !m.cabling && m.missing > 0;
        if (missing) {
          out.push(`<rect x="${x + 4}" y="${n(cy)}" width="${w - 8}" height="${rowH}" fill="#fdecec"/>`);
        }
        const base = n(cy + rowH * 0.68);
        out.push(
          `<text x="${col.name}" y="${base}" font-size="2.3"${missing ? ' font-weight="bold"' : ''}>${esc(m.name.length > nameChars ? `${m.name.slice(0, nameChars - 1)}…` : m.name)}</text>`,
          `<text x="${col.need}" y="${base}" font-size="2.3" text-anchor="end">${m.cabling ? '—' : qty(m.needed, m.unit)}</text>`,
        );
        if (mark) {
          out.push(
            `<text x="${col.stock}" y="${base}" font-size="2.3" fill="#555" text-anchor="end">${m.cabling ? '' : qty(m.available, m.unit)}</text>`,
            `<text x="${col.miss}" y="${base}" font-size="2.3" text-anchor="end"${missing ? ' font-weight="bold" fill="#b91c1c"' : ' fill="#999"'}>${m.cabling ? '' : missing ? qty(m.missing, m.unit) : '—'}</text>`,
          );
        }
        out.push(`<path d="M${x + 4} ${n(cy + rowH)}H${x + w - 4}" stroke="#ddd" stroke-width="0.1"/>`);
      }
      cy += rowH;
    }

    // Columna lateral: resumen y cajetín
    const sd = sh.side;
    out.push(
      `<rect x="${sd.x}" y="${sd.y}" width="${sd.w}" height="${sd.h}" fill="none" stroke="#000" stroke-width="0.35"/>`,
      `<text x="${sd.x + 4}" y="${sd.y + 7}" font-size="3" font-weight="bold" letter-spacing="0.3">RESUMEN</text>`,
    );
    const lines: [string, string, boolean?][] = [
      ['Referencias', String(needs.filter((m) => !m.cabling).length)],
      ['Cableado', needs.filter((m) => m.cabling).map((m) => m.name.replace(/^Cableado (de )?/, '').split(' (')[0]).join(', ') || '—'],
    ];
    if (mark) {
      lines.push(['Con falta en almacén', String(short.length), short.length > 0]);
    }
    let sy = sd.y + 14;
    for (const [k, v, alert] of lines) {
      out.push(
        `<text x="${sd.x + 4}" y="${sy}" font-size="2" fill="#555">${esc(k)}</text>`,
        `<text x="${sd.x + 4}" y="${sy + 3.4}" font-size="2.6" font-weight="bold"${alert ? ' fill="#b91c1c"' : ''}>${esc(v)}</text>`,
      );
      sy += 9;
    }
    if (mark && short.length) {
      out.push(
        `<rect x="${sd.x + 4}" y="${sy - 1}" width="6" height="3" fill="#fdecec"/>`,
        `<text x="${sd.x + 12}" y="${sy + 1.4}" font-size="1.9" fill="#555">No hay suficiente en el almacén</text>`,
      );
      // La lista de lo que falta, con cuánto falta de cada cosa, hasta donde
      // empieza el cajetín.
      sy += 10;
      out.push(
        `<text x="${sd.x + 4}" y="${sy}" font-size="2.4" font-weight="bold" fill="#b91c1c">FALTA EN ALMACÉN</text>`,
        `<text x="${sd.x + sd.w - 4}" y="${sy}" font-size="1.9" fill="#555" text-anchor="end">FALTAN</text>`,
        `<path d="M${sd.x + 3} ${sy + 1.2}H${sd.x + sd.w - 3}" stroke="#000" stroke-width="0.15"/>`,
      );
      const lineH = 4.4;
      const bottom = sd.y + sd.h - 62 - 6;
      const room = Math.max(0, Math.floor((bottom - sy - 1.5) / lineH));
      const list = [...short].sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, 'es'));
      const shownList = list.slice(0, list.length > room ? Math.max(0, room - 1) : room);
      const chars = Math.max(8, Math.floor((sd.w - 22) / 1.1));
      for (const m of shownList) {
        sy += lineH;
        out.push(
          `<text x="${sd.x + 4}" y="${sy}" font-size="2.1">${esc(m.name.length > chars ? `${m.name.slice(0, chars - 1)}…` : m.name)}</text>`,
          `<text x="${sd.x + sd.w - 4}" y="${sy}" font-size="2.1" font-weight="bold" fill="#b91c1c" text-anchor="end">${qty(m.missing, m.unit)}</text>`,
        );
      }
      if (shownList.length < list.length) {
        sy += lineH;
        out.push(`<text x="${sd.x + 4}" y="${sy}" font-size="1.9" fill="#555">… y ${list.length - shownList.length} más (ver la tabla)</text>`);
      }
    }
    out.push(...titleBlock(d, sh, plan + p + 1, total, 'LISTADO'));
    out.push(`</svg>`);
    return out.join('\n');
  });
}

/** Todas las hojas: el plano y, detrás, las del material. */
export function toSvgPages(d: Drawing): string[] {
  return [toSvg(d), ...materialPages(d)];
}


// ---------------------------------------------------------------------------
// DXF (metros reales, por capas) — R12, que abre cualquier programa de CAD
// ---------------------------------------------------------------------------

const LAYERS: { name: string; color: number; ltype?: string }[] = [
  { name: 'RECINTO', color: 7 },
  { name: 'COTAS', color: 8 },
  { name: 'OBJETOS', color: 7 },
  { name: 'MARCAS', color: 1 },
  { name: 'TEXTOS', color: 7 },
  { name: 'CABLE-ELECTRICO', color: 30 },
  { name: 'CABLE-RED', color: 4 },
  { name: 'CABLE-SENAL', color: 6 },
  { name: 'CABLE-USB', color: 3 },
  { name: 'PILARES', color: 250 },
  { name: 'CUBIERTAS', color: 9, ltype: 'DASHED' },
  { name: 'ZONAS', color: 5, ltype: 'DASHED' },
  { name: 'SUMINISTROS', color: 1 },
];

const CABLE_LAYER: Record<ConnectionKind, string> = {
  power: 'CABLE-ELECTRICO',
  network: 'CABLE-RED',
  signal: 'CABLE-SENAL',
  usb: 'CABLE-USB',
};

export function toDxf(d: Drawing): string {
  const sh = layoutSheet(d);
  // El texto mide en el dibujo lo que mediría en la hoja a esa escala.
  const mm = sh.denom / 1000;
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  // En CAD la Y crece hacia arriba; en el plano, hacia abajo.
  const X = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const Y = (v: number) => (Math.round(-v * 1000) / 1000).toString();
  // DXF R12 es ASCII: los acentos van como \U+XXXX.
  const txt = (s: string) => s.replace(/[^\x20-\x7e]/g, (c) => `\\U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 6);
  g(9, '$MEASUREMENT'); g(70, 1);
  g(9, '$EXTMIN'); g(10, X(d.bounds.minX)); g(20, Y(d.bounds.maxY)); g(30, 0);
  g(9, '$EXTMAX'); g(10, X(d.bounds.maxX)); g(20, Y(d.bounds.minY)); g(30, 0);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 2);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'LTYPE'); g(2, 'DASHED'); g(70, 0); g(3, '__ __ __'); g(72, 65); g(73, 2); g(40, 0.75);
  g(49, 0.5); g(49, -0.25);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, LAYERS.length);
  for (const l of LAYERS) {
    g(0, 'LAYER'); g(2, l.name); g(70, 0); g(62, l.color); g(6, l.ltype ?? 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');

  const poly = (layer: string, pts: Pt[], closed: boolean) => {
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? 1 : 0);
    for (const p of pts) {
      g(0, 'VERTEX'); g(8, layer); g(10, X(p.x)); g(20, Y(p.y)); g(30, 0);
    }
    g(0, 'SEQEND'); g(8, layer);
  };
  const line = (layer: string, a: Pt, b: Pt) => {
    g(0, 'LINE'); g(8, layer); g(10, X(a.x)); g(20, Y(a.y)); g(30, 0); g(11, X(b.x)); g(21, Y(b.y)); g(31, 0);
  };
  const text = (layer: string, p: Pt, height: number, value: string, rotation = 0, center = true) => {
    g(0, 'TEXT'); g(8, layer); g(10, X(p.x)); g(20, Y(p.y)); g(30, 0); g(40, height.toFixed(3)); g(1, txt(value));
    if (rotation) g(50, rotation);
    if (center) {
      g(72, 1); g(73, 2); g(11, X(p.x)); g(21, Y(p.y)); g(31, 0);
    }
  };

  poly('RECINTO', [{ x: 0, y: 0 }, { x: d.width, y: 0 }, { x: d.width, y: d.depth }, { x: 0, y: d.depth }], true);

  // Cotas generales
  const off = 7 * mm;
  line('COTAS', { x: 0, y: -off }, { x: d.width, y: -off });
  line('COTAS', { x: 0, y: 0 }, { x: 0, y: -off - mm });
  line('COTAS', { x: d.width, y: 0 }, { x: d.width, y: -off - mm });
  text('COTAS', { x: d.width / 2, y: -off - 2 * mm }, 2.4 * mm, `${fmtNum(d.width, 2)} m`);
  line('COTAS', { x: -off, y: 0 }, { x: -off, y: d.depth });
  line('COTAS', { x: 0, y: 0 }, { x: -off - mm, y: 0 });
  line('COTAS', { x: 0, y: d.depth }, { x: -off - mm, y: d.depth });
  text('COTAS', { x: -off - 2 * mm, y: d.depth / 2 }, 2.4 * mm, `${fmtNum(d.depth, 2)} m`, 90);

  for (const [a, b] of d.roofEdges) line('CUBIERTAS', a, b);
  for (const t of d.contact) {
    // SOLID: relleno macizo de tres o cuatro vértices (el cuarto repite el tercero).
    g(0, 'SOLID'); g(8, 'PILARES');
    g(10, X(t[0].x)); g(20, Y(t[0].y)); g(30, 0);
    g(11, X(t[1].x)); g(21, Y(t[1].y)); g(31, 0);
    g(12, X(t[2].x)); g(22, Y(t[2].y)); g(32, 0);
    g(13, X(t[2].x)); g(23, Y(t[2].y)); g(33, 0);
  }

  for (const z of d.zones) {
    poly('ZONAS', z.points, true);
    text('ZONAS', z.centre, 2.8 * mm, `${z.zone.number} - ${z.zone.name || 'Zona'}`);
    wrap((z.zone.description ?? '').trim(), 42, 3).forEach((line, i) =>
      text('ZONAS', { x: z.centre.x, y: z.centre.y + (3.6 + i * 2.7) * mm }, 2 * mm, line),
    );
  }
  for (const fd of d.feeds) {
    const c = { x: Number(fd.object.x), y: Number(fd.object.y) };
    g(0, 'CIRCLE'); g(8, 'SUMINISTROS'); g(10, X(c.x)); g(20, Y(c.y)); g(30, 0); g(40, (2.3 * mm).toFixed(3));
    text('SUMINISTROS', { x: c.x + 3 * mm, y: c.y - 2.4 * mm }, 2.2 * mm, fd.code, 0, false);
  }

  for (const c of d.cables) poly(CABLE_LAYER[c.kind], c.points, false);

  for (const it of d.items) {
    const o = it.object;
    const c = { x: Number(o.x), y: Number(o.y) };
    if (o.shape === 'text') {
      text('TEXTOS', c, Math.max(0.08, Number(o.width_m) * 0.72), o.label || '', -Number(o.rotation));
      continue;
    }
    if (o.shape === 'line') {
      const pts = corners(o);
      line('OBJETOS', { x: (pts[0].x + pts[3].x) / 2, y: (pts[0].y + pts[3].y) / 2 }, { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 });
      continue;
    }
    if (it.circle) {
      g(0, 'CIRCLE'); g(8, 'OBJETOS'); g(10, X(c.x)); g(20, Y(c.y)); g(30, 0); g(40, it.circle.r.toFixed(3));
    } else if (it.polygon) {
      poly('OBJETOS', it.polygon, true);
    }
    if (FEED.has(o.kind)) {
      if (!d.options.feeds) text('MARCAS', c, 2 * mm, o.kind === 'power_source' ? 'E' : 'R');
    } else if (it.mark != null && d.options.marks) {
      g(0, 'CIRCLE'); g(8, 'MARCAS'); g(10, X(c.x)); g(20, Y(c.y)); g(30, 0); g(40, (2 * mm).toFixed(3));
      text('MARCAS', c, 2 * mm, String(it.mark));
    }
  }

  // Leyenda a la derecha del dibujo, en el propio modelo
  let ly = d.bounds.minY;
  const lx = d.bounds.maxX + 15 * mm;
  text('TEXTOS', { x: lx, y: ly }, 3 * mm, 'LEYENDA', 0, false);
  for (const r of d.legend) {
    ly += 4.5 * mm;
    text('TEXTOS', { x: lx, y: ly }, 2.1 * mm, `${r.mark}. ${r.name} (${r.dims} m) x${r.count}`, 0, false);
  }
  if (d.zones.length) {
    ly += 7 * mm;
    text('TEXTOS', { x: lx, y: ly }, 2.6 * mm, 'ZONAS', 0, false);
    for (const z of d.zones) {
      ly += 4.5 * mm;
      text('TEXTOS', { x: lx, y: ly }, 2.1 * mm, `${z.zone.number} - ${z.zone.name || 'Zona'} (${fmtNum(z.area, 1)} m2)`, 0, false);
    }
  }
  if (d.feeds.length) {
    ly += 7 * mm;
    text('TEXTOS', { x: lx, y: ly }, 2.6 * mm, 'SUMINISTROS', 0, false);
    for (const fd of d.feeds) {
      ly += 4.5 * mm;
      text('TEXTOS', { x: lx, y: ly }, 2.1 * mm, `${fd.code} ${nameOf(fd.object)}`, 0, false);
    }
  }

  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}
