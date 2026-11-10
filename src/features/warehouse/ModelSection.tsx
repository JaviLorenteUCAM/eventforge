import { useRef, useState } from 'react';
import { Box, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, NumberInput } from '@/components/ui';
import { uploadModel } from '@/lib/storage';

/**
 * MODELO 3D DE LA FICHA
 *
 * Para objetos con forma propia —una silla gaming, una planta, un trofeo— que
 * ninguna caja pintada reproduce. El .glb se dibuja en el 3D del plano en lugar
 * de la caja, escalado a las medidas de la ficha, así que en el 2D sigue
 * ocupando su rectángulo de siempre.
 *
 * Al cambiar o quitar el modelo NO se borra el fichero anterior: un material
 * duplicado comparte el mismo .glb y se quedaría sin él.
 */
export function ModelSection({
  path,
  floorOffset,
  folder,
  onPathChange,
  onFloorOffsetChange,
}: {
  path: string | null;
  floorOffset: number;
  /** Carpeta dentro del bucket de modelos. */
  folder: string;
  onPathChange: (p: string | null) => void;
  onFloorOffsetChange: (v: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      onPathChange(await uploadModel(folder, file));
      toast.success('Modelo cargado. Guarda la ficha para usarlo en los planos.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido subir el modelo');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3.5">
      <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.1em] text-dim">
        Modelo 3D
      </p>

      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-lg border border-line bg-surface text-dim">
          <Box className={path ? 'size-5 text-accent-soft' : 'size-5'} />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept=".glb,model/gltf-binary"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={busy}
              icon={<Upload className="size-3.5" />}
              onClick={() => inputRef.current?.click()}
            >
              {path ? 'Cambiar modelo' : 'Subir modelo (.glb)'}
            </Button>
            {path ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                icon={<Trash2 className="size-3.5" />}
                onClick={() => onPathChange(null)}
              >
                Quitar
              </Button>
            ) : null}
          </div>
          {path ? (
            <p className="num truncate text-[11.5px] text-muted">{path.split('/').pop()}</p>
          ) : null}
          <p className="text-[11.5px] leading-relaxed text-dim">
            Para objetos con forma propia, como una silla gaming. El 3D lo dibuja en lugar de la
            caja, escalado a las medidas de la ficha (largo × ancho × alto) y con el frente hacia
            donde está el frente de la plantilla. En el 2D sigue siendo su rectángulo. Formato glTF
            binario (.glb) con la textura incluida, hasta 30 MB.
          </p>
        </div>
      </div>

      {path ? (
        <Field
          className="mt-3 border-t border-line pt-3"
          label="Altura del suelo del modelo"
          hint="Si el modelo flota, ponlo en negativo para bajarlo; en positivo lo sube. Vale para todas las copias."
        >
          <NumberInput
            value={floorOffset}
            onChange={(v) => onFloorOffsetChange(Math.max(-2, Math.min(2, v)))}
            unit="m"
            step={0.01}
            min={-2}
            max={2}
          />
        </Field>
      ) : null}
    </div>
  );
}
