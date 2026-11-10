import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FileCode2, FileDown, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Checkbox, Field, Modal, Segmented, Select } from '@/components/ui';
import type {
  EventRow,
  MaterialNeed,
  Plan,
  PlanBackground,
  PlanConnection,
  PlanObject,
  PlanZone,
} from '@/lib/types';
import { downloadBlob, slugify } from '@/lib/utils';
import {
  buildDrawing,
  layoutSheet,
  toDxf,
  toSvg,
  toSvgPages,
  type ExportOptions,
  type Paper,
} from './export2d';
import { loadFootprint, type Footprint } from './modelFootprint';

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
  author: string;
}) {
  const [paper, setPaper] = useState<Paper>('A3');
  const [scale, setScale] = useState<number | null>(null);
  const [photo, setPhoto] = useState(false);
  const [cables, setCables] = useState(true);
  const [venue, setVenue] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [feeds, setFeeds] = useState(true);
  const [marks, setMarks] = useState(true);
  const [withMaterial, setWithMaterial] = useState(true);
  const [markMissing, setMarkMissing] = useState(true);
  const [page, setPage] = useState(0);

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
            },
            {
              paper,
              scale,
              photo,
              cables,
              venue,
              zones: showZones,
              feeds,
              marks,
              material: withMaterial,
              markMissing,
            } satisfies ExportOptions,
          )
        : null,
    [
      open, plan, event, objects, connections, venues, photos, zones, author, material, categoryNames,
      paper, scale, photo, cables, venue, showZones, feeds, marks, withMaterial, markMissing,
    ],
  );
  const svg = useMemo(() => (drawing ? toSvg(drawing) : ''), [drawing]);
  const pages = useMemo(() => (drawing ? toSvgPages(drawing) : []), [drawing]);
  const shown = Math.min(page, Math.max(0, pages.length - 1));
  const sheet = useMemo(() => (drawing ? layoutSheet(drawing) : null), [drawing]);

  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    const current = pages[shown];
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current], { type: 'image/svg+xml' }));
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [pages, shown]);

  const fileName = slugify(`plano ${event?.name ?? ''} ${plan.name}`) || 'plano';

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
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <div className="space-y-4">
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
              {[50, 100, 150, 200, 250, 500, 1000].map((s) => (
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
            <Checkbox
              label="Puntos de luz y de red (E1, R1…)"
              checked={feeds}
              disabled={!objects.some((o) => o.kind === 'power_source' || o.kind === 'network_source')}
              onChange={(e) => setFeeds(e.target.checked)}
            />
            <Checkbox label="Cableado" checked={cables} onChange={(e) => setCables(e.target.checked)} />
            <Checkbox
              label="Numerar los objetos"
              checked={marks}
              onChange={(e) => setMarks(e.target.checked)}
            />
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
              label="Recinto 3D (pilares y cubiertas)"
              checked={venue}
              disabled={venues.length === 0}
              onChange={(e) => setVenue(e.target.checked)}
            />
            <Checkbox label="Foto de fondo, en gris" checked={photo} onChange={(e) => setPhoto(e.target.checked)} />
          </div>
          <p className="text-[11.5px] leading-relaxed text-dim">
            Los objetos iguales comparten número y la leyenda dice cuántos hay. Las zonas salen
            rotuladas («1 - Zona Fripozo») y los puntos de luz y de red, con su símbolo y numerados. El DXF va en metros
            reales y por capas (recinto, objetos, marcas, cada tipo de cable, pilares y cubiertas).
          </p>
        </div>

        <div className="min-w-0">
          <div className="overflow-hidden rounded-lg border border-line bg-white">
            {preview ? (
              <img src={preview} alt="Vista previa del plano" className="block w-full" />
            ) : null}
          </div>
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
                Hoja {shown + 1} de {pages.length} · {shown === 0 ? 'plano' : 'material'}
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
