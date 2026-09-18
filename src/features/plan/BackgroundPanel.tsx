import { useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  ImagePlus,
  Lock,
  LockOpen,
  Move,
  Ruler,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, ConfirmDialog, Field, NumberInput } from '@/components/ui';
import { BUCKETS, uploadFile } from '@/lib/storage';
import type { Plan, PlanBackground } from '@/lib/types';
import { cn, fmtNum } from '@/lib/utils';
import { usePlanStore } from './planStore';

/**
 * Panel de capas de imagen del plano.
 *
 * Flujo previsto:
 *   1. Subir la foto (aérea del patio, plano del recinto...).
 *   2. Calibrar: trazar una línea sobre algo cuya medida real se conozca e
 *      indicarla. Todo el escenario se escala a partir de ahí.
 *   3. Ajustar opacidad y, si hace falta, mover o superponer más capas.
 */
export function BackgroundPanel({
  plan,
  backgrounds,
  urls,
  selectedId,
  onSelect,
  onChange,
  onDelete,
  onUploaded,
}: {
  plan: Plan;
  backgrounds: PlanBackground[];
  urls: Map<string, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<PlanBackground>) => void;
  onDelete: (b: PlanBackground) => void;
  onUploaded: (path: string, naturalRatio: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [toDelete, setToDelete] = useState<PlanBackground | null>(null);

  const tool = usePlanStore((s) => s.tool);
  const setTool = usePlanStore((s) => s.setTool);
  const bgEdit = usePlanStore((s) => s.bgEdit);
  const setBgEdit = usePlanStore((s) => s.setBgEdit);

  const selected = backgrounds.find((b) => b.id === selectedId) ?? null;

  async function handleFile(file: File) {
    setBusy(true);
    try {
      // Medimos la imagen para conservar su proporción al colocarla.
      const ratio = await new Promise<number>((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(img.naturalWidth / Math.max(1, img.naturalHeight));
        };
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('No se ha podido leer la imagen.'));
        };
        img.src = objectUrl;
      });

      const path = await uploadFile(BUCKETS.planBackgrounds, plan.id, file);
      onUploaded(path, ratio);
      toast.success('Imagen añadida. Ahora calíbrala para fijar la escala.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido subir la imagen');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* --- Añadir --------------------------------------------------- */}
        <div className="border-b border-line p-3.5">
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
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center"
            loading={busy}
            icon={<ImagePlus className="size-3.5" />}
            onClick={() => inputRef.current?.click()}
          >
            Añadir imagen de referencia
          </Button>
          <p className="mt-2 text-[11.5px] leading-relaxed text-dim">
            Sube una foto aérea o el plano del recinto. Después usa{' '}
            <strong className="text-muted">Calibrar</strong> para indicar cuánto mide algo que
            aparezca en ella y que todo el escenario se ajuste a esa escala.
          </p>
        </div>

        {/* --- Calibración ---------------------------------------------- */}
        <div className="border-b border-line p-3.5">
          <p className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">
            Escala
          </p>
          <Button
            variant={tool === 'calibrate' ? 'primary' : 'outline'}
            size="sm"
            className="w-full justify-center"
            icon={<Ruler className="size-3.5" />}
            disabled={backgrounds.length === 0}
            onClick={() => setTool(tool === 'calibrate' ? 'select' : 'calibrate')}
          >
            {tool === 'calibrate' ? 'Cancelar calibración' : 'Calibrar con una medida'}
          </Button>
          {tool === 'calibrate' ? (
            <p className="mt-2 rounded-lg border border-[color-mix(in_oklab,var(--ef-cyan)_35%,transparent)] bg-[color-mix(in_oklab,var(--ef-cyan)_10%,transparent)] px-2.5 py-2 text-[11.5px] leading-relaxed text-ink">
              Arrastra sobre la imagen de un extremo a otro de algo cuya medida conozcas (una
              puerta, una pista, una fachada). Mantén <strong>Mayús</strong> para forzar la línea
              horizontal o vertical.
            </p>
          ) : null}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Ancho">
              <NumberInput
                value={Number(plan.width_m)}
                onChange={() => {}}
                unit="m"
                disabled
              />
            </Field>
            <Field label="Fondo">
              <NumberInput value={Number(plan.depth_m)} onChange={() => {}} unit="m" disabled />
            </Field>
            <Field label="Alto">
              <NumberInput value={Number(plan.height_m)} onChange={() => {}} unit="m" disabled />
            </Field>
          </div>
          <p className="mt-1.5 text-[11px] text-dim">
            El recinto se edita en la pestaña Inspector, sin nada seleccionado.
          </p>
        </div>

        {/* --- Capas ----------------------------------------------------- */}
        <div className="p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">
              Capas ({backgrounds.length})
            </p>
            {backgrounds.length > 0 ? (
              <button
                onClick={() => setBgEdit(!bgEdit)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                  bgEdit
                    ? 'border-[var(--ef-cyan)] text-[var(--ef-cyan)]'
                    : 'border-line text-dim hover:text-muted',
                )}
              >
                <Move className="size-3" />
                {bgEdit ? 'Ajustando' : 'Ajustar en el plano'}
              </button>
            ) : null}
          </div>

          {backgrounds.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-[12px] text-dim">
              Sin imágenes de fondo.
            </p>
          ) : (
            <div className="space-y-2">
              {backgrounds.map((b) => {
                const isSel = b.id === selectedId;
                return (
                  <div
                    key={b.id}
                    className={cn(
                      'overflow-hidden rounded-xl border transition-colors',
                      isSel ? 'border-[var(--ef-cyan)]' : 'border-line',
                    )}
                  >
                    <button
                      onClick={() => onSelect(isSel ? null : b.id)}
                      className="flex w-full items-center gap-2.5 bg-surface-2 p-2 text-left"
                    >
                      <span className="size-10 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
                        {urls.get(b.id) ? (
                          <img src={urls.get(b.id)} alt="" className="size-full object-cover" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-ink">
                          {b.label || 'Imagen de referencia'}
                        </span>
                        <span className="num block text-[10.5px] text-dim">
                          {fmtNum(Number(b.width_m), 2)} × {fmtNum(Number(b.height_m), 2)} m
                        </span>
                      </span>
                    </button>

                    {isSel ? (
                      <div className="space-y-3 border-t border-line p-3">
                        <div>
                          <div className="mb-1 flex items-center justify-between text-[11.5px]">
                            <span className="text-muted">Opacidad</span>
                            <span className="num text-ink">
                              {Math.round(Number(b.opacity) * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={Number(b.opacity)}
                            onChange={(e) =>
                              onChange(b.id, { opacity: Number(e.target.value) })
                            }
                            className="w-full accent-[var(--ef-cyan)]"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <Field label="X">
                            <NumberInput
                              value={Number(b.x)}
                              onChange={(v) => onChange(b.id, { x: v })}
                              unit="m"
                              min={-9999}
                            />
                          </Field>
                          <Field label="Y">
                            <NumberInput
                              value={Number(b.y)}
                              onChange={(v) => onChange(b.id, { y: v })}
                              unit="m"
                              min={-9999}
                            />
                          </Field>
                          <Field label="Ancho">
                            <NumberInput
                              value={Number(b.width_m)}
                              onChange={(v) => onChange(b.id, { width_m: Math.max(0.1, v) })}
                              unit="m"
                            />
                          </Field>
                          <Field label="Alto">
                            <NumberInput
                              value={Number(b.height_m)}
                              onChange={(v) => onChange(b.id, { height_m: Math.max(0.1, v) })}
                              unit="m"
                            />
                          </Field>
                        </div>

                        <Field label="Rotación">
                          <NumberInput
                            value={Number(b.rotation)}
                            onChange={(v) => onChange(b.id, { rotation: v })}
                            unit="°"
                            step={15}
                            min={-360}
                            max={360}
                          />
                        </Field>

                        <div className="flex items-center gap-1">
                          <IconToggle
                            active={b.visible}
                            label={b.visible ? 'Ocultar' : 'Mostrar'}
                            onClick={() => onChange(b.id, { visible: !b.visible })}
                          >
                            {b.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                          </IconToggle>
                          <IconToggle
                            active={b.locked}
                            label={b.locked ? 'Desbloquear' : 'Bloquear'}
                            onClick={() => onChange(b.id, { locked: !b.locked })}
                          >
                            {b.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
                          </IconToggle>
                          <div className="flex-1" />
                          <button
                            onClick={() => setToDelete(b)}
                            aria-label="Eliminar capa"
                            className="rounded-md p-1.5 text-dim transition-colors hover:text-danger"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {backgrounds.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-3 w-full justify-center"
              icon={<Upload className="size-3.5" />}
              onClick={() => inputRef.current?.click()}
              loading={busy}
            >
              Añadir otra capa
            </Button>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => {
          if (toDelete) onDelete(toDelete);
          setToDelete(null);
        }}
        title="Eliminar imagen de fondo"
        message="Se quitará del plano y se borrará del almacenamiento. Los objetos que hayas colocado encima no se tocan."
      />

      {selected?.locked ? (
        <p className="border-t border-line px-3.5 py-2 text-[11.5px] text-warn">
          Esta capa está bloqueada: desbloquéala para moverla.
        </p>
      ) : null}
    </div>
  );
}

function IconToggle({
  children,
  active,
  label,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'rounded-md border p-1.5 transition-colors',
        active ? 'border-line-strong bg-surface-2 text-ink' : 'border-transparent text-dim hover:text-muted',
      )}
    >
      {children}
    </button>
  );
}
