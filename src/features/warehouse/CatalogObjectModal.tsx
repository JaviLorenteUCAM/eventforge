import { useEffect, useRef, useState } from 'react';
import { Grid2x2, ImageIcon, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { BUCKETS, removeFile, resolveUrl, uploadFile } from '@/lib/storage';
import { generateBoxTemplate, generateCylinderTemplate } from '@/lib/textureAtlas';
import { downloadBlob, fmtNum, slugify } from '@/lib/utils';
import {
  Button,
  Checkbox,
  ColorPicker,
  Field,
  Input,
  Modal,
  NumberInput,
  Select,
  Textarea,
} from '@/components/ui';
import {
  useCategories,
  useCreateCatalogObject,
  useUpdateCatalogObject,
} from '@/data/warehouse';
import {
  OBJECT_KINDS,
  OBJECT_KIND_LABEL,
  type CatalogObject,
  type ObjectKind,
  type TextureMode,
} from '@/lib/types';

/**
 * Alta/edicion de objetos personalizados de la biblioteca.
 * Se usa tanto desde el Almacen como desde el editor de planos.
 */
export function CatalogObjectModal({
  open,
  object,
  onClose,
  onCreated,
}: {
  open: boolean;
  object?: CatalogObject | null;
  onClose: () => void;
  onCreated?: (created: CatalogObject) => void;
}) {
  const { profile } = useAuth();
  const categories = useCategories();
  const create = useCreateCatalogObject();
  const update = useUpdateCatalogObject();

  const [form, setForm] = useState({
    name: '',
    category_id: '',
    kind: 'generic' as ObjectKind,
    length_m: 1,
    width_m: 1,
    height_m: 1,
    weight_kg: 0,
    color: '#94a3b8',
    material: '',
    notes: '',
    shape: 'box' as 'box' | 'cylinder' | 'plane',
    requires_power: false,
    requires_network: false,
    power_w: 0,
    outlet_count: 0,
    port_count: 0,
    texture_mode: 'atlas' as TextureMode,
    texture_scale: 1,
    texture_offset_x: 0,
    texture_offset_y: 0,
    texture_rotation: 0,
  });
  const [texturePath, setTexturePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm({
      name: object?.name ?? '',
      category_id: object?.category_id ?? '',
      kind: object?.kind ?? 'generic',
      length_m: Number(object?.length_m ?? 1),
      width_m: Number(object?.width_m ?? 1),
      height_m: Number(object?.height_m ?? 1),
      weight_kg: Number(object?.weight_kg ?? 0),
      color: object?.color ?? '#94a3b8',
      material: object?.material ?? '',
      notes: object?.notes ?? '',
      shape: object?.shape ?? 'box',
      requires_power: object?.requires_power ?? false,
      requires_network: object?.requires_network ?? false,
      power_w: Number(object?.power_w ?? 0),
      outlet_count: Number(object?.outlet_count ?? 0),
      port_count: Number(object?.port_count ?? 0),
      texture_mode: object?.texture_mode ?? 'atlas',
      texture_scale: Number(object?.texture_scale ?? 1),
      texture_offset_x: Number(object?.texture_offset_x ?? 0),
      texture_offset_y: Number(object?.texture_offset_y ?? 0),
      texture_rotation: Number(object?.texture_rotation ?? 0),
    });
    setTexturePath(object?.texture_path ?? null);
    setError(null);
  }, [open, object]);

  async function submit() {
    if (!form.name.trim()) return setError('El nombre es obligatorio.');
    if (form.length_m <= 0 || form.width_m <= 0 || form.height_m <= 0) {
      return setError('Las dimensiones deben ser mayores que cero.');
    }

    const values = {
      ...form,
      name: form.name.trim(),
      category_id: form.category_id || null,
      texture_path: texturePath,
    };

    try {
      if (object) {
        await update.mutateAsync({ id: object.id, patch: values });
        toast.success('Objeto actualizado');
      } else {
        const created = await create.mutateAsync({
          ...values,
          is_system: false,
          created_by: profile?.id ?? null,
        });
        toast.success('Objeto añadido a la biblioteca');
        onCreated?.(created);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={object ? 'Editar objeto' : 'Crear objeto personalizado'}
      description="Se guarda en la biblioteca y queda disponible para todos los eventos."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={create.isPending || update.isPending}
          >
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required error={error} className="sm:col-span-2">
          <Input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Mesa de control 1,80 m"
            autoFocus
          />
        </Field>

        <Field label="Categoría">
          <Select
            value={form.category_id}
            onChange={(e) => setForm({ ...form, category_id: e.target.value })}
          >
            <option value="">Sin categoría</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Tipo" hint="Determina cómo se comporta en el análisis de conexiones.">
          <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ObjectKind })}>
            {OBJECT_KINDS.map((k) => (
              <option key={k} value={k}>
                {OBJECT_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Largo" required>
          <NumberInput value={form.length_m} onChange={(v) => setForm({ ...form, length_m: v })} unit="m" min={0.01} />
        </Field>
        <Field label="Ancho" required>
          <NumberInput value={form.width_m} onChange={(v) => setForm({ ...form, width_m: v })} unit="m" min={0.01} />
        </Field>
        <Field label="Alto" required>
          <NumberInput value={form.height_m} onChange={(v) => setForm({ ...form, height_m: v })} unit="m" min={0.01} />
        </Field>
        <Field label="Peso">
          <NumberInput value={form.weight_kg} onChange={(v) => setForm({ ...form, weight_kg: v })} unit="kg" />
        </Field>

        <Field label="Forma">
          <Select
            value={form.shape}
            onChange={(e) => setForm({ ...form, shape: e.target.value as 'box' | 'cylinder' | 'plane' })}
          >
            <option value="box">Caja / rectángulo</option>
            <option value="cylinder">Cilindro / círculo</option>
            <option value="plane">Plano (alfombra, tarima fina)</option>
          </Select>
        </Field>

        <Field label="Material">
          <Input
            value={form.material}
            onChange={(e) => setForm({ ...form, material: e.target.value })}
            placeholder="Madera, aluminio…"
          />
        </Field>

        <Field label="Color" className="sm:col-span-2">
          <ColorPicker value={form.color} onChange={(c) => setForm({ ...form, color: c })} />
        </Field>

        <div className="rounded-xl border border-line bg-surface-2 p-3.5 sm:col-span-2">
          <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.1em] text-dim">
            Electricidad y red
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox
              label="Necesita corriente"
              checked={form.requires_power}
              onChange={(e) => setForm({ ...form, requires_power: e.target.checked })}
            />
            <Checkbox
              label="Necesita red"
              checked={form.requires_network}
              onChange={(e) => setForm({ ...form, requires_network: e.target.checked })}
            />
            <Field label="Consumo">
              <NumberInput
                value={form.power_w}
                onChange={(v) => setForm({ ...form, power_w: v })}
                unit="W"
                step={5}
              />
            </Field>
            <div />
            <Field label="Tomas que ofrece" hint="Regletas, cuadros, alargaderas.">
              <NumberInput
                value={form.outlet_count}
                onChange={(v) => setForm({ ...form, outlet_count: Math.round(v) })}
                step={1}
              />
            </Field>
            <Field label="Puertos de red que ofrece" hint="Switches y routers.">
              <NumberInput
                value={form.port_count}
                onChange={(v) => setForm({ ...form, port_count: Math.round(v) })}
                step={1}
              />
            </Field>
          </div>
        </div>

        <div className="sm:col-span-2">
          <TextureSection
            name={form.name || 'Objeto'}
            shape={form.shape}
            lengthM={form.length_m}
            widthM={form.width_m}
            heightM={form.height_m}
            path={texturePath}
            mode={form.texture_mode}
            scale={form.texture_scale}
            offsetX={form.texture_offset_x}
            offsetY={form.texture_offset_y}
            rotation={form.texture_rotation}
            onPathChange={setTexturePath}
            onFieldChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
        </div>

        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * Textura del objeto.
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
function TextureSection({
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
  onPathChange,
  onFieldChange,
}: {
  name: string;
  shape: 'box' | 'cylinder' | 'plane';
  lengthM: number;
  widthM: number;
  heightM: number;
  path: string | null;
  mode: TextureMode;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
  onPathChange: (p: string | null) => void;
  onFieldChange: (patch: Partial<{
    texture_mode: TextureMode;
    texture_scale: number;
    texture_offset_x: number;
    texture_offset_y: number;
    texture_rotation: number;
  }>) => void;
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
      const newPath = await uploadFile(BUCKETS.textures, 'catalogo', file);
      const old = path;
      onPathChange(newPath);
      if (old) void removeFile(BUCKETS.textures, old);
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

      <div className="flex gap-3">
        <div className="size-24 shrink-0 overflow-hidden rounded-lg border border-line bg-surface">
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
                  void removeFile(BUCKETS.textures, path);
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
                El reparto de las caras depende de las medidas de <strong>este</strong> objeto
                ({fmtNum(lengthM, 2)} × {fmtNum(widthM, 2)} × {fmtNum(heightM, 2)} m). Si las
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
