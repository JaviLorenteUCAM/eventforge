import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FileDown,
  Maximize,
  Minus,
  Plus,
  Printer,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Checkbox, Field, Input, Modal, Segmented, Select, Textarea } from '@/components/ui';
import type {
  EventRow,
  MaterialNeed,
  Plan,
  PlanBackground,
  PlanConnection,
  PlanObject,
  PlanZone,
  Snapshot,
} from '@/lib/types';
import { BUCKETS, resolveUrl } from '@/lib/storage';
import { MAX_RENDERS, RenderPicker } from './RenderPicker';
import { downloadBlob, slugify } from '@/lib/utils';
import {
  buildDrawing,
  layoutSheet,
  SCALES,
  type ZoneStyle,
  toDxf,
  toSvg,
  toSvgPages,
  type ExportOptions,
  type Paper,
  type RenderPhoto,
} from './export2d';

/** ISO -> valor de un <input type="datetime-local">, en hora local. */
function toLocalInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Largo máximo de la descripción de la muestra. */
const MAX_DESCRIPTION = 3000;

/**
 * Una captura lista para ir dentro del PDF: se descarga, se reduce (las
 * capturas salen a resolución de pantalla, y veinte enteras harían un PDF
 * enorme) y se incrusta como JPEG.
 */
async function embedCapture(url: string): Promise<RenderPhoto> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * k));
  const height = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Sin lienzo');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return { href: canvas.toDataURL('image/jpeg', 0.88), width, height };
}
import { loadFootprint, type Footprint } from './modelFootprint';
import { pointInPolygon } from '@/lib/silhouette';

/**
 * EXPORTAR EL PLANO EN 2D
 *
 * Un plano para montar, no una captura: hoja normalizada a escala, cotas,
 * leyenda numerada y cajetín. En PDF (por la impresión del navegador, que lo
 * guarda vectorial y a escala exacta), en SVG y en DXF para CAD.
 */
export function ExportPlanModal({
  open,
  onClose,
  plan,
  event,
  objects,
  connections,
  backgrounds,
  backgroundUrls,
  backgroundModelUrls,
  zones,
  material,
  categoryNames,
  needsFor,
  snapshots = [],
  author,
}: {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  event: EventRow | null;
  objects: PlanObject[];
  connections: PlanConnection[];
  backgrounds: PlanBackground[];
  backgroundUrls: Map<string, string>;
  backgroundModelUrls: Map<string, string>;
  zones: PlanZone[];
  material: MaterialNeed[];
  categoryNames: Map<string, string>;
  /** Calcula el material de un subconjunto de objetos y cables (para cada zona). */
  needsFor: (objects: PlanObject[], connections: PlanConnection[]) => MaterialNeed[];
  /** Capturas del evento, para elegir las fotos de la muestra. */
  snapshots?: Snapshot[];
  author: string;
}) {
  /** Plano técnico (con el material) o muestra (plano y fotos del render). */
  const [docKind, setDocKind] = useState<'technical' | 'showcase'>('technical');
  const showcase = docKind === 'showcase';
  const [furniture, setFurniture] = useState(false);
  const [description, setDescription] = useState('');
  const [perPage, setPerPage] = useState<'1' | '2' | '4'>('2');
  const [renderIds, setRenderIds] = useState<string[]>([]);
  // Comienzo y cierre del cajetín: se proponen los del evento y se pueden
  // cambiar para este PDF (por ejemplo, el horario de apertura al público).
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const resetSchedule = () => {
    setStartAt(toLocalInput(event?.starts_at));
    setEndAt(toLocalInput(event?.ends_at));
  };
  useEffect(() => {
    if (open) {
      setStartAt(toLocalInput(event?.starts_at));
      setEndAt(toLocalInput(event?.ends_at));
    }
  }, [open, event?.starts_at, event?.ends_at]);
  const scheduleBackwards = Boolean(startAt && endAt && endAt < startAt);
  const [renders, setRenders] = useState<RenderPhoto[]>([]);
  const [loadingRenders, setLoadingRenders] = useState(false);
  const embedded = useRef(new Map<string, RenderPhoto>());

  // Las capturas del render (las más nuevas primero) y las elegidas, ya
  // incrustadas y en el orden en que se marcaron.
  const captures = useMemo(
    () =>
      snapshots
        .filter((s) => s.kind === '3d' || s.kind === '2d')
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [snapshots],
  );
  useEffect(() => {
    if (!open || !showcase) return;
    let alive = true;
    const byId = new Map(captures.map((s) => [s.id, s]));
    const missing = renderIds.filter((id) => !embedded.current.has(id) && byId.has(id));
    setLoadingRenders(missing.length > 0);
    void Promise.all(
      missing.map(async (id) => {
        try {
          const url = await resolveUrl(BUCKETS.captures, byId.get(id)!.storage_path);
          if (url) embedded.current.set(id, await embedCapture(url));
        } catch {
          /* la que no se pueda leer, no sale */
        }
      }),
    ).then(() => {
      if (!alive) return;
      setLoadingRenders(false);
      setRenders(renderIds.map((id) => embedded.current.get(id)).filter((r): r is RenderPhoto => Boolean(r)));
    });
    return () => {
      alive = false;
    };
  }, [open, showcase, renderIds, captures]);
  const [paper, setPaper] = useState<Paper>('A3');
  const [scale, setScale] = useState<number | null>(null);
  const [photo, setPhoto] = useState(false);
  const [cables, setCables] = useState(false);
  const [venue, setVenue] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [zoneStyle, setZoneStyle] = useState<ZoneStyle>('label');
  const [zoneNumberSize, setZoneNumberSize] = useState(1);
  const [feeds, setFeeds] = useState(true);
  const [marks, setMarks] = useState(false);
  const [withMaterial, setWithMaterial] = useState(true);
  const [markMissing, setMarkMissing] = useState(true);
  const [byZone, setByZone] = useState(true);

  /**
   * Material de cada zona: los objetos cuyo centro cae dentro. Un objeto en
   * zonas que se solapan cuenta en la de número más bajo, para no contarlo
   * dos veces. El cableado va con las zonas por las que pasa (basta con que
   * uno de sus extremos esté dentro).
   */
  const materialByZone = useMemo(() => {
    if (!open || !byZone || zones.length === 0) return [];
    const sorted = [...zones].sort((a, b) => a.number - b.number);
    const zoneOf = new Map<string, string>();
    for (const o of objects) {
      const p = { x: Number(o.x), y: Number(o.y) };
      const z = sorted.find((q) =>
        pointInPolygon(p, (q.points ?? []).map((v) => ({ x: Number(v.x), y: Number(v.y) }))),
      );
      if (z) zoneOf.set(o.id, z.id);
    }
    const groupFor = (zoneId: string | null) => {
      const objs = objects.filter((o) => (zoneOf.get(o.id) ?? null) === zoneId);
      const ids = new Set(objs.map((o) => o.id));
      const conns = connections.filter((c) => ids.has(c.from_object_id) || ids.has(c.to_object_id));
      return needsFor(objs, conns);
    };
    return [
      ...sorted.map((zone) => ({ zone, needs: groupFor(zone.id) })),
      { zone: null, needs: groupFor(null) },
    ].filter((g) => g.needs.length > 0);
  }, [open, byZone, zones, objects, connections, needsFor]);
  const [page, setPage] = useState(0);
  /** Encuadre: el punto del plano que va al centro del dibujo (null: todo). */
  const [view, setView] = useState<{ cx: number; cy: number } | null>(null);
  /** Lo que se lleva arrastrado, en píxeles de la vista previa. */
  const [dragPx, setDragPx] = useState<{ x: number; y: number } | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => backgrounds.filter((b) => b.visible), [backgrounds]);

  // Planta de los modelos del recinto (pilares y cubiertas).
  const [venues, setVenues] = useState<{ background: PlanBackground; footprint: Footprint }[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const withModel = visible.filter((b) => backgroundModelUrls.has(b.id));
    void Promise.all(
      withModel.map(async (b) => {
        try {
          return { background: b, footprint: await loadFootprint(backgroundModelUrls.get(b.id)!) };
        } catch {
          return null;
        }
      }),
    ).then((list) => {
      if (alive) setVenues(list.filter((v): v is NonNullable<typeof v> => v !== null));
    });
    return () => {
      alive = false;
    };
  }, [open, visible, backgroundModelUrls]);

  // Las fotos van incrustadas: un enlace firmado caduca y un PDF no lo seguiría.
  const [photos, setPhotos] = useState<{ background: PlanBackground; href: string }[]>([]);
  useEffect(() => {
    if (!open || !photo) return;
    let alive = true;
    void Promise.all(
      visible.map(async (b) => {
        const url = backgroundUrls.get(b.id);
        if (!url) return null;
        try {
          const blob = await (await fetch(url)).blob();
          const href = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          return { background: b, href };
        } catch {
          return null;
        }
      }),
    ).then((list) => {
      if (alive) setPhotos(list.filter((p): p is NonNullable<typeof p> => p !== null));
    });
    return () => {
      alive = false;
    };
  }, [open, photo, visible, backgroundUrls]);

  const drawing = useMemo(
    () =>
      open
        ? buildDrawing(
            {
              plan,
              event,
              objects,
              connections,
              venues,
              photos: photo ? photos : [],
              zones,
              author,
              material,
              categoryNames,
              materialByZone,
              renders: showcase ? renders : [],
            },
            {
              document: docKind,
              furniture: showcase ? furniture : true,
              description: showcase ? description : '',
              photosPerPage: Number(perPage) as 1 | 2 | 4,
              schedule: startAt || endAt ? { start: startAt, end: endAt } : null,
              paper,
              scale,
              photo,
              cables,
              venue,
              zones: showZones,
              zoneStyle,
              zoneNumberSize,
              feeds,
              marks,
              material: withMaterial && !showcase,
              markMissing,
              materialByZone: byZone,
              view,
            } satisfies ExportOptions,
          )
        : null,
    [
      open, plan, event, objects, connections, venues, photos, zones, author, material, categoryNames,
      materialByZone, byZone, docKind, showcase, furniture, description, perPage, renders, startAt, endAt,
      paper, scale, photo, cables, venue, showZones, zoneStyle, zoneNumberSize, feeds, marks, withMaterial, markMissing, view,
    ],
  );
  const svg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);
  const pages = useMemo(() => (drawing ? toSvgPages(drawing) : []), [drawing]);
  const shown = Math.min(page, Math.max(0, pages.length - 1));
  const sheet = useMemo(() => (drawing ? layoutSheet(drawing) : null), [drawing]);

  /**
   * ENCUADRE
   *
   * En la vista previa de la hoja del plano se arrastra el dibujo para elegir
   * qué parte entra, y con la rueda o con − / + se cambia de escala entre las
   * normalizadas. Mientras se arrastra solo se desplaza la imagen; al soltar
   * se vuelve a componer la hoja con el nuevo centro.
   */
  const zoom = (dir: 1 | -1) => {
    if (!sheet) return;
    const i = SCALES.indexOf(sheet.denom);
    const at = i < 0 ? SCALES.findIndex((v) => v > sheet.denom) : i;
    const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, at - dir))];
    if (next === sheet.denom) return;
    setView((v) => v ?? { cx: sheet.centre.x, cy: sheet.centre.y });
    setScale(next);
  };
  const fitAll = () => {
    setView(null);
    setScale(null);
  };

  function onPreviewDown(e: React.PointerEvent) {
    if (shown !== 0 || e.button !== 0) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setDragPx({ x: 0, y: 0 });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onPreviewMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    setDragPx({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  }
  function onPreviewUp() {
    const img = imgRef.current;
    if (!dragStart.current || !dragPx || !sheet || !img) {
      dragStart.current = null;
      setDragPx(null);
      return;
    }
    // Píxeles de la vista previa → mm de hoja → metros del plano.
    const mmPerPx = sheet.w / Math.max(1, img.clientWidth);
    const dx = (dragPx.x * mmPerPx) / sheet.k;
    const dy = (dragPx.y * mmPerPx) / sheet.k;
    if (Math.abs(dragPx.x) + Math.abs(dragPx.y) > 2) {
      setView({ cx: sheet.centre.x - dx, cy: sheet.centre.y - dy });
    }
    dragStart.current = null;
    setDragPx(null);
  }

  // La rueda acerca y aleja (con el listener a mano: el de React es pasivo y
  // no deja evitar que se desplace la ventana).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    const el = boxRef.current;
    if (!el || shown !== 0) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const current = pages[shown];
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current], { type: 'image/svg+xml' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pages, shown]);

  const fileName =
    slugify(`${showcase ? 'muestra' : 'plano'} ${event?.name ?? ''} ${plan.name}`) || 'plano';

  function printPdf() {
    if (!pages.length || !sheet) return;
    // Se imprime desde un marco oculto con la hoja a su tamaño exacto: el
    // navegador lo guarda como PDF vectorial y a escala.
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument;
    if (!doc || !iframe.contentWindow) {
      iframe.remove();
      return toast.error('El navegador no ha dejado preparar la impresión');
    }
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${fileName}</title>` +
        `<style>@page{size:${sheet.w}mm ${sheet.h}mm;margin:0}html,body{margin:0;padding:0}` +
        `svg{display:block;width:${sheet.w}mm;height:${sheet.h}mm}</style></head>` +
        `<body>${pages
          .map((p, i) => `<div style="${i < pages.length - 1 ? 'page-break-after:always;break-after:page' : ''}">${p.replace(/^<\?xml[^>]*>\s*/, '')}</div>`)
          .join('')}</body></html>`,
    );
    doc.close();
    const win = iframe.contentWindow;
    const cleanup = () => setTimeout(() => iframe.remove(), 500);
    win.addEventListener('afterprint', cleanup);
    // Un momento para que las fotos incrustadas se pinten antes de imprimir.
    setTimeout(() => {
      win.focus();
      win.print();
    }, 350);
    toast.info(`En la ventana de impresión elige «Guardar como PDF», tamaño ${paper} y escala 100 %.`);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Exportar plano 2D"
      description="Hoja a escala con cotas, leyenda y cajetín. Del recinto 3D se dibujan los pilares y apoyos en el suelo y la proyección de las cubiertas."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            variant="outline"
            icon={<FileCode2 className="size-4" />}
            onClick={() => drawing && downloadBlob(new Blob([toDxf(drawing)], { type: 'application/dxf' }), `${fileName}.dxf`)}
          >
            DXF (CAD)
          </Button>
          <Button
            variant="outline"
            icon={<FileDown className="size-4" />}
            onClick={() => downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${fileName}.svg`)}
          >
            SVG (plano)
          </Button>
          <Button variant="primary" icon={<Printer className="size-4" />} onClick={printPdf}>
            PDF
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
        <div className="space-y-4">
          <Field
            label="Documento"
            hint={
              showcase
                ? 'Para enseñar: el plano y las fotos del render, sin listado de material.'
                : 'Para montar: el plano a escala y el listado de material.'
            }
          >
            <Segmented
              value={docKind}
              onChange={(v) => {
                setDocKind(v);
                setPage(0);
              }}
              layoutId="export-doc-kind"
              options={[
                { value: 'technical', label: 'Plano técnico' },
                { value: 'showcase', label: 'Muestra' },
              ]}
            />
          </Field>
          <Field
            label="Comienzo y cierre"
            hint={
              scheduleBackwards
                ? 'El cierre es anterior al comienzo.'
                : 'Salen en el cajetín de todas las hojas. Se proponen los del evento.'
            }
          >
            <div className="grid gap-1.5">
              <label className="flex items-center gap-2 text-[12px] text-muted">
                <span className="w-[62px] shrink-0">Comienzo</span>
                <Input
                  type="datetime-local"
                  value={startAt}
                  onChange={(e) => setStartAt(e.target.value)}
                  aria-label="Fecha y hora de comienzo"
                />
              </label>
              <label className="flex items-center gap-2 text-[12px] text-muted">
                <span className="w-[62px] shrink-0">Cierre</span>
                <Input
                  type="datetime-local"
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  aria-label="Fecha y hora de cierre"
                />
              </label>
              {event &&
              (startAt !== toLocalInput(event.starts_at) || endAt !== toLocalInput(event.ends_at)) ? (
                <button
                  type="button"
                  onClick={resetSchedule}
                  className="justify-self-start text-[11.5px] text-accent-soft hover:underline"
                >
                  Volver a las del evento
                </button>
              ) : null}
            </div>
          </Field>
          {showcase ? (
            <>
              <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                <Checkbox
                  label="Ver el mobiliario en el plano"
                  checked={furniture}
                  onChange={(e) => setFurniture(e.target.checked)}
                />
                <p className="mt-1 pl-6 text-[11px] leading-relaxed text-dim">
                  Se dibuja a escala en el plano, sin listado de material.
                </p>
              </div>
              <Field
                label="Fotos del render"
                hint={`${renderIds.length} de ${MAX_RENDERS} · en el orden en que las marques${loadingRenders ? ' · preparando…' : ''}`}
              >
                <RenderPicker
                  snapshots={captures}
                  selected={renderIds}
                  onChange={(ids) => setRenderIds(ids.slice(0, MAX_RENDERS))}
                />
              </Field>
              <Field label="Fotos por hoja">
                <Segmented
                  size="sm"
                  value={perPage}
                  onChange={setPerPage}
                  layoutId="export-per-page"
                  options={[
                    { value: '1', label: '1' },
                    { value: '2', label: '2' },
                    { value: '4', label: '4' },
                  ]}
                />
              </Field>
              <Field
                label="Descripción (opcional)"
                hint={`Va delante de las fotos. ${description.length}/${MAX_DESCRIPTION}`}
              >
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
                  rows={4}
                  placeholder="Detalles del montaje: zonas, horarios, qué se verá…"
                />
              </Field>
            </>
          ) : null}
          <Field label="Hoja">
            <Segmented
              value={paper}
              onChange={setPaper}
              options={[
                { value: 'A4', label: 'A4' },
                { value: 'A3', label: 'A3' },
                { value: 'A2', label: 'A2' },
              ]}
            />
          </Field>
          <Field label="Escala" hint={sheet ? `Se usa 1:${sheet.denom}.` : undefined}>
            <Select
              value={scale == null ? 'auto' : String(scale)}
              onChange={(e) => setScale(e.target.value === 'auto' ? null : Number(e.target.value))}
            >
              <option value="auto">Automática (la mayor que quepa)</option>
              {SCALES.filter((v) => v >= 20 && v <= 2000).map((s) => (
                <option key={s} value={s}>
                  1:{s}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-2.5">
            <Checkbox
              label={`Zonas (${zones.length})`}
              checked={showZones}
              disabled={zones.length === 0}
              onChange={(e) => setShowZones(e.target.checked)}
            />
            {showZones && zones.length > 0 ? (
              <div className="pl-6">
                <Segmented
                  size="sm"
                  value={zoneStyle}
                  onChange={setZoneStyle}
                  layoutId="export-zone-style"
                  options={[
                    { value: 'label', label: 'Con nombre' },
                    { value: 'number', label: 'Número' },
                    { value: 'color', label: 'Solo color' },
                  ]}
                />
                {zoneStyle === 'number' ? (
                  <div className="mt-2 max-w-[260px]">
                    <div className="mb-1 flex items-center justify-between text-[12.5px]">
                      <span className="text-muted">Tamaño del número</span>
                      <span className="num text-ink">{Math.round(zoneNumberSize * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.25}
                      max={3}
                      step={0.05}
                      value={zoneNumberSize}
                      onChange={(e) => setZoneNumberSize(Number(e.target.value))}
                      aria-label="Tamaño del número de zona"
                      className="w-full accent-[var(--ef-cyan)]"
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
            <Checkbox
              label="Puntos de luz y de red (E1, R1…)"
              checked={feeds}
              disabled={!objects.some((o) => o.kind === 'power_source' || o.kind === 'network_source')}
              onChange={(e) => setFeeds(e.target.checked)}
            />
            {!showcase || furniture ? (
              <>
                <Checkbox label="Cableado" checked={cables} onChange={(e) => setCables(e.target.checked)} />
                <Checkbox
                  label="Numerar los objetos"
                  checked={marks}
                  onChange={(e) => setMarks(e.target.checked)}
                />
              </>
            ) : null}
            {showcase ? null : (
            <>
            <Checkbox
              label="Hoja con el material necesario (en el PDF)"
              checked={withMaterial}
              disabled={material.length === 0}
              onChange={(e) => setWithMaterial(e.target.checked)}
            />
            <Checkbox
              label="Marcar lo que falta en almacén"
              checked={markMissing}
              disabled={!withMaterial || material.length === 0}
              onChange={(e) => setMarkMissing(e.target.checked)}
              className="pl-6"
            />
            <Checkbox
              label="Separar el material por zonas"
              checked={byZone}
              disabled={!withMaterial || material.length === 0 || zones.length === 0}
              onChange={(e) => setByZone(e.target.checked)}
              className="pl-6"
            />
            </>
            )}
            <Checkbox
              label="Recinto 3D (pilares y cubiertas)"
              checked={venue}
              disabled={venues.length === 0}
              onChange={(e) => setVenue(e.target.checked)}
            />
            <Checkbox label="Foto de fondo, en gris" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
          </div>
          <p className="text-[11.5px] leading-relaxed text-dim">
            Los objetos iguales comparten número y la leyenda dice cuántos hay. Las zonas salen
            con su nombre, solo con su número o solo con su color (la leyenda las explica), y los puntos de luz y de red, con su símbolo y numerados. El DXF va en metros
            reales y por capas (recinto, objetos, marcas, cada tipo de cable, pilares y cubiertas),
            siempre con el plano entero.
          </p>
        </div>

        <div className="min-w-0">
          <div
            ref={boxRef}
            className={`relative overflow-hidden rounded-lg border border-line bg-white ${shown === 0 ? (dragPx ? 'cursor-grabbing' : 'cursor-grab') : ''}`}
            onPointerDown={onPreviewDown}
            onPointerMove={onPreviewMove}
            onPointerUp={onPreviewUp}
            onPointerCancel={onPreviewUp}
          >
            {preview ? (
              <img
                ref={imgRef}
                src={preview}
                alt="Vista previa del plano"
                draggable={false}
                className="block w-full select-none"
                style={dragPx ? { transform: `translate(${dragPx.x}px, ${dragPx.y}px)` } : undefined}
              />
            ) : null}
            {shown === 0 ? (
              <div
                className="absolute bottom-2 left-2 flex items-center gap-1 rounded-lg border border-line bg-[var(--ef-surface-solid)] p-1 shadow-lg"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Button size="sm" variant="ghost" icon={<Minus className="size-3.5" />} onClick={() => zoom(-1)} aria-label="Alejar" />
                <span className="num min-w-[52px] text-center text-[12px] text-ink">
                  1:{sheet?.denom}
                </span>
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => zoom(1)} aria-label="Acercar" />
                <Button size="sm" variant="ghost" icon={<Maximize className="size-3.5" />} onClick={fitAll}>
                  Todo
                </Button>
              </div>
            ) : null}
          </div>
          {shown === 0 ? (
            <p className="mt-1.5 text-center text-[11.5px] text-dim">
              Arrastra para elegir qué parte del plano sale · rueda o − / + para acercar
            </p>
          ) : null}
          {pages.length > 1 ? (
            <div className="mt-2 flex items-center justify-center gap-2 text-[12.5px] text-muted">
              <Button
                size="sm"
                variant="ghost"
                icon={<ChevronLeft className="size-4" />}
                disabled={shown === 0}
                onClick={() => setPage(shown - 1)}
              >
                Anterior
              </Button>
              <span className="num">
                Hoja {shown + 1} de {pages.length} · {shown === 0 ? 'plano' : showcase ? 'muestra' : 'material'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={shown >= pages.length - 1}
                onClick={() => setPage(shown + 1)}
              >
                Siguiente <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
