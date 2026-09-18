import { useEffect, useRef, useState } from 'react';
import { Grid2x2, ImageIcon, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, NumberInput, Select } from '@/components/ui';
import { BUCKETS, removeFile, resolveUrl, uploadFile } from '@/lib/storage';
import { generateBoxTemplate, generateCylinderTemplate } from '@/lib/textureAtlas';
import { downloadBlob, fmtNum, slugify } from '@/lib/utils';
import type { TextureMode } from '@/lib/types';

export interface TextureFields {
  texture_mode: TextureMode;
  texture_scale: number;
  texture_offset_x: number;
  texture_offset_y: number;
  texture_rotation: number;
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
      const blob = isCylinder
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
            <img src={url} alt="Textura" className="size-full object-cover" />
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
          <Field label="Cómo se aplica">
            <Select
              value={mode}
              onChange={(e) => onFieldChange({ texture_mode: e.target.value as TextureMode })}
              className="h-9"
              disabled={isCylinder}
            >
              <option value="atlas">Despliegue por caras (plantilla)</option>
              <option value="tile">Mosaico repetido en todas las caras</option>
            </Select>
          </Field>

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
