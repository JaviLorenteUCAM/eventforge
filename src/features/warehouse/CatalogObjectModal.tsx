import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
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
import { TextureSection, type TextureFields } from './TextureSection';
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
 * Alta y edición de objetos PROPIOS DE UN EVENTO (la «biblioteca»).
 *
 * La biblioteca es para lo puntual: una alfombra cortada a medida, un cartel,
 * una estructura prestada… Lo que se tiene de forma habitual va al Almacén,
 * donde además lleva unidades y se cruza con lo que pide cada plano.
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
    color: '#94a3b8',
    material: '',
    notes: '',
    shape: 'box' as 'box' | 'cylinder' | 'plane',
    requires_power: false,
    requires_network: false,
    requires_signal: false,
    requires_usb: false,
    power_w: 0,
    outlet_count: 0,
    port_count: 0,
    signal_out_count: 0,
    usb_port_count: 0,
    texture_mode: 'atlas' as TextureMode,
    texture_scale: 1,
    texture_offset_x: 0,
    texture_offset_y: 0,
    texture_rotation: 0,
    texture_key_color: null as string | null,
    texture_key_tolerance: 0.12,
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
      color: object?.color ?? '#94a3b8',
      material: object?.material ?? '',
      notes: object?.notes ?? '',
      shape: object?.shape ?? 'box',
      requires_power: object?.requires_power ?? false,
      requires_network: object?.requires_network ?? false,
      requires_signal: object?.requires_signal ?? false,
      requires_usb: object?.requires_usb ?? false,
      power_w: Number(object?.power_w ?? 0),
      outlet_count: Number(object?.outlet_count ?? 0),
      port_count: Number(object?.port_count ?? 0),
      signal_out_count: Number(object?.signal_out_count ?? 0),
      usb_port_count: Number(object?.usb_port_count ?? 0),
      texture_mode: object?.texture_mode ?? 'atlas',
      texture_scale: Number(object?.texture_scale ?? 1),
      texture_offset_x: Number(object?.texture_offset_x ?? 0),
      texture_offset_y: Number(object?.texture_offset_y ?? 0),
      texture_rotation: Number(object?.texture_rotation ?? 0),
      texture_key_color: object?.texture_key_color ?? null,
      texture_key_tolerance: Number(object?.texture_key_tolerance ?? 0.12),
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
      description="Objeto puntual: se guarda en la biblioteca y se puede colocar en cualquier plano. Lo que tengas en existencias va al Almacén."
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
            Corriente, red, señal y USB
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
            <Checkbox
              label="Necesita señal (imagen)"
              checked={form.requires_signal}
              onChange={(e) => setForm({ ...form, requires_signal: e.target.checked })}
            />
            <Checkbox
              label="Necesita USB"
              checked={form.requires_usb}
              onChange={(e) => setForm({ ...form, requires_usb: e.target.checked })}
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
            <Field
              label="Salidas de señal que ofrece"
              hint="Cámaras, ordenadores, splitters y matrices."
            >
              <NumberInput
                value={form.signal_out_count}
                onChange={(v) => setForm({ ...form, signal_out_count: Math.round(v) })}
                step={1}
              />
            </Field>
            <Field label="Puertos USB que ofrece" hint="Ordenadores y hubs.">
              <NumberInput
                value={form.usb_port_count}
                onChange={(v) => setForm({ ...form, usb_port_count: Math.round(v) })}
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
            keyColor={form.texture_key_color}
            keyTolerance={form.texture_key_tolerance}
            folder="biblioteca"
            onPathChange={setTexturePath}
            onFieldChange={(patch: Partial<TextureFields>) => setForm((f) => ({ ...f, ...patch }))}
          />
        </div>

        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </Field>
      </div>
    </Modal>
  );
}
