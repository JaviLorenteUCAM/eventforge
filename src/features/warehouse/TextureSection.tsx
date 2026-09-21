import { useEffect, useRef, useState } from 'react';
import { Grid2x2, ImageIcon, Pipette, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button, ColorPicker, Field, NumberInput, Select } from '@/components/ui';
import { BUCKETS, removeFile, resolveUrl, uploadFile } from '@/lib/storage';
import {
  generateBoxTemplate,
  generateCylinderTemplate,
  generateFrontTemplate,
} from '@/lib/textureAtlas';
import { cn, downloadBlob, fmtNum, slugify } from '@/lib/utils';
import type { TextureMode } from '@/lib/types';

export interface TextureFields {
  texture_mode: TextureMode;
  texture_scale: number;
  texture_offset_x: number;
  texture_offset_y: number;
  texture_rotation: number;
  texture_key_color: string | null;
  texture_key_tolerance: number;
}

/**
 * COLOR TRANSPARENTE
 *
 * Un soporte de televisión son dos patas y el centro hueco, pero la textura se
 * pinta sobre una caja. Para que el hueco sea hueco hay dos caminos:
 *
 *   · subir un PNG con transparencia, y ya está;
 *   · pintar el hueco de un color que no se use en el resto del dibujo y
 *     marcarlo aquí. Es la vía para quien edita con Paint.
 *
 * El cuentagotas evita tener que saberse el hexadecimal: se pulsa sobre la
 * propia imagen y se toma el color de ese píxel.
 */
function CutoutControls({
  url,
  keyColor,
  keyTolerance,
  onChange,
}: {
  url: string | null;
  keyColor: string | null;
  keyTolerance: number;
  onChange: (patch: Partial<TextureFields>) => void;
}) {
  const [picking, setPicking] = useState(false);

  function pickFromImage(e: React.MouseEvent<HTMLImageElement>) {
    if (!picking) return;
    const img = e.currentTarget;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);

    // La imagen se muestra con object-contain: hay que deshacer el encaje para
    // saber a qué píxel del original corresponde el clic.
    const box = img.getBoundingClientRect();
    const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
    const drawnW = img.naturalWidth * scale;
    const drawnH = img.naturalHeight * scale;
    const x = (e.clientX - box.left - (box.width - drawnW) / 2) / scale;
    const y = (e.clientY - box.top - (box.height - drawnH) / 2) / scale;
    if (x < 0 || y < 0 || x >= img.naturalWidth || y >= img.naturalHeight) return;

    try {
      const [r, g, b] = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      const hex =
        '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      onChange({ texture_key_color: hex });
      setPicking(false);
      toast.success(`Color ${hex} marcado como transparente`);
    } catch {
      toast.error('No se ha podido leer el color de la imagen.');
    }
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium text-ink">Color transparente</p>
        {keyColor ? (
          <button
            type="button"
            onClick={() => onChange({ texture_key_color: null })}
            className="text-[11.5px] text-accent-soft hover:underline"
          >
            Quitar recorte
          </button>
        ) : null}
      </div>

      <p className="mt-1 text-[11.5px] leading-relaxed text-dim">
        Para dejar huecos de verdad: el centro vacío de un soporte de televisión, el interior
        de un aro. Si tu PNG ya lleva transparencia no hace falta tocar nada, se respeta sola.
      </p>

      {url ? (
        <div className="mt-2.5">
          <div
            className={cn(
              'relative h-28 overflow-hidden rounded-lg border bg-[repeating-conic-gradient(#334155_0%_25%,#1e293b_0%_50%)] bg-[length:16px_16px]',
              picking ? 'border-accent-soft ring-2 ring-accent-soft' : 'border-line',
            )}
          >
            <img
              src={url}
              alt="Textura"
              onClick={pickFromImage}
              className={cn('size-full object-contain', picking && 'cursor-crosshair')}
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant={picking ? 'primary' : 'outline'}
            className="mt-2"
            icon={<Pipette className="size-3.5" />}
            onClick={() => setPicking((v) => !v)}
          >
            {picking ? 'Pulsa el color en la imagen' : 'Elegir color de la imagen'}
          </Button>
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <span
          className="size-6 shrink-0 rounded-md border border-line-strong"
          style={{
            background: keyColor ?? 'transparent',
            backgroundImage: keyColor
              ? undefined
              : 'repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%)',
            backgroundSize: keyColor ? undefined : '10px 10px',
          }}
        />
        <span className="num text-[11.5px] text-muted">{keyColor ?? 'sin recorte'}</span>
      </div>

      <div className="mt-2">
        <ColorPicker
          value={keyColor ?? '#ff00ff'}
          onChange={(c) => onChange({ texture_key_color: c })}
        />
      </div>

      {keyColor ? (
        <Field
          className="mt-2.5"
          label="Margen"
          hint="Súbelo si quedan restos del color por los bordes; bájalo si se come el dibujo."
        >
          <NumberInput
            value={keyTolerance}
            onChange={(v) => onChange({ texture_key_tolerance: Math.max(0, Math.min(1, v)) })}
            step={0.02}
            min={0}
            max={1}
          />
        </Field>
      ) : null}
    </div>
  );
}

/**
 * Textura de un objeto (del almacén, de la biblioteca o ya colocado en un plano).
 *
 * Flujo pensado para no tener que adivinar dónde cae cada cara:
 *   1. «Exportar plantilla» descarga un PNG con el objeto DESPLEGADO: cada cara
 *      en su color, con su nombre y sus medidas reales.
 *   2. Se edita esa imagen respetando los recuadros.
 *   3. Se vuelve a subir aquí y cada cara aparece donde toca.
 *
 * El modo «mosaico» es la alternativa rápida: una imagen que se repite en todas
 * las caras (madera, tela, moqueta), con escala y desplazamiento ajustables.
 */
export function TextureSection({
  name,
  shape,
  lengthM,
  widthM,
  heightM,
  path,
  mode,
  scale,
  offsetX,
  offsetY,
  rotation,
  keyColor,
  keyTolerance,
  folder = 'objetos',
  compact = false,
  onPathChange,
  onFieldChange,
}: {
  name: string;
  shape: string;
  lengthM: number;
  widthM: number;
  heightM: number;
  path: string | null;
  mode: TextureMode;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  keyColor: string | null;
  keyTolerance: number;
  /** Carpeta dentro del bucket de texturas. */
  folder?: string;
  /** Versión reducida para el panel lateral del plano. */
  compact?: boolean;
  onPathChange: (p: string | null) => void;
  onFieldChange: (patch: Partial<TextureFields>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isCylinder = shape === 'cylinder';

  useEffect(() => {
    let alive = true;
    void resolveUrl(BUCKETS.textures, path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  async function exportTemplate() {
    try {
      const blob =
        mode === 'silhouette'
          ? await generateFrontTemplate(name, lengthM, heightM)
          : isCylinder
            ? await generateCylinderTemplate(name, lengthM, heightM)
            : await generateBoxTemplate(name, lengthM, widthM, heightM);
      downloadBlob(blob, `plantilla-${slugify(name) || 'objeto'}.png`);
      toast.success('Plantilla descargada. Edítala respetando los recuadros y vuelve a subirla.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido generar la plantilla');
    }
  }

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const newPath = await uploadFile(BUCKETS.textures, folder, file);
      const old = path;
      onPathChange(newPath);
      // Ojo: la anterior solo se borra si nadie más la usa. Cuando se crea una
      // copia del objeto, el llamante pasa `keepPrevious` no borrando aquí.
      if (old && old !== newPath) void removeFile(BUCKETS.textures, old);
      toast.success('Textura cargada');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido subir la textura');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3.5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-dim">Textura</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          icon={<Grid2x2 className="size-3.5" />}
          onClick={() => void exportTemplate()}
        >
          Exportar plantilla
        </Button>
      </div>

      <div className={compact ? 'space-y-2.5' : 'flex gap-3'}>
        <div
          className={`${compact ? 'h-24 w-full' : 'size-24 shrink-0'} overflow-hidden rounded-lg border border-line bg-surface`}
        >
          {url ? (
            <img src={url} alt="Textura" className="size-full object-contain" />
          ) : (
            <div className="grid size-full place-items-center text-dim">
              <ImageIcon className="size-5" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={busy}
              icon={<Upload className="size-3.5" />}
              onClick={() => inputRef.current?.click()}
            >
              {path ? 'Cambiar' : 'Subir textura'}
            </Button>
            {path ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => {
                  onPathChange(null);
                  setUrl(null);
                }}
              >
                Quitar
              </Button>
            ) : null}
          </div>

          <p className="text-[11.5px] leading-relaxed text-dim">
            {isCylinder
              ? 'En cilindros la imagen envuelve la superficie lateral. La plantilla es el lateral desenrollado (perímetro × alto).'
              : 'La plantilla despliega las 6 caras con sus proporciones reales. Cada recuadro corresponde a una cara del objeto.'}
          </p>
        </div>
      </div>

      {path ? (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <CutoutControls
            url={url}
            keyColor={keyColor}
            keyTolerance={keyTolerance}
            onChange={onFieldChange}
          />

          <Field label="Cómo se aplica">
            <Select
              value={mode}
              onChange={(e) => onFieldChange({ texture_mode: e.target.value as TextureMode })}
              className="h-9"
              disabled={isCylinder}
            >
              <option value="atlas">Despliegue por caras (plantilla)</option>
              <option value="tile">Mosaico repetido en todas las caras</option>
              <option value="silhouette">Silueta: la imagen es la forma del objeto</option>
            </Select>
          </Field>

          {mode === 'silhouette' ? (
            <p className="rounded-lg border border-[color-mix(in_oklab,var(--ef-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--ef-accent)_10%,transparent)] px-2.5 py-2 text-[11.5px] leading-relaxed text-ink">
              La imagen deja de pintarse sobre una caja: se lee su contorno y se le da fondo.
              Lo que en el dibujo es sólido se convierte en volumen macizo y lo transparente en
              aire, así que un soporte sale con sus dos patas unidas por la base y el hueco lo
              es por los cuatro costados, sin laterales flotando. Los cantos del corte se
              pintan del color del objeto. La plantilla pasa a ser la <strong>vista de
              frente</strong>, que es mucho más fácil de dibujar.
            </p>
          ) : null}

          {mode === 'tile' || isCylinder ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Escala">
                <NumberInput
                  value={scale}
                  onChange={(v) => onFieldChange({ texture_scale: Math.max(0.01, v) })}
                  step={0.1}
                  min={0.01}
                />
              </Field>
              <Field label="Rotación">
                <NumberInput
                  value={rotation}
                  onChange={(v) => onFieldChange({ texture_rotation: v })}
                  unit="°"
                  step={15}
                  min={-360}
                  max={360}
                />
              </Field>
              <Field label="Desplazar X">
                <NumberInput
                  value={offsetX}
                  onChange={(v) => onFieldChange({ texture_offset_x: v })}
                  step={0.05}
                  min={-10}
                />
              </Field>
              <Field label="Desplazar Y">
                <NumberInput
                  value={offsetY}
                  onChange={(v) => onFieldChange({ texture_offset_y: v })}
                  step={0.05}
                  min={-10}
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11.5px] leading-relaxed text-dim">
                En modo plantilla la imagen encaja por construcción: no hace falta ajustar escala
                ni desplazamiento. Si necesitas moverla, cambia a mosaico.
              </p>
              <p className="rounded-lg border border-[color-mix(in_oklab,var(--ef-warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--ef-warn)_10%,transparent)] px-2.5 py-2 text-[11.5px] leading-relaxed text-ink">
                El reparto de las caras depende de las medidas de <strong>este</strong> objeto (
                {fmtNum(lengthM, 2)} × {fmtNum(widthM, 2)} × {fmtNum(heightM, 2)} m). Si las
                cambias, vuelve a exportar la plantilla y a subirla: si no, los recuadros dejarán
                de coincidir con las caras. Redimensionar una copia ya colocada en un plano sí es
                seguro: la textura se estira con ella.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
