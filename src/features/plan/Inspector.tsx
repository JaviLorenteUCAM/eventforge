import { useEffect, useState } from 'react';
import { Copy, Image, Package, Trash2, Unlink } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  ColorPicker,
  Field,
  Input,
  NumberInput,
  Select,
} from '@/components/ui';
import { useItemVariants, useWarehouseItems } from '@/data/warehouse';
import type { Plan, PlanConnection, PlanIssue, PlanObject } from '@/lib/types';
import { OBJECT_KINDS, OBJECT_KIND_LABEL, type ObjectKind } from '@/lib/types';
import { cn, fmtM3, fmtNum, volumeOf } from '@/lib/utils';
import type { CommitUpdate } from './Editor2D';

interface Props {
  plan: Plan;
  selected: PlanObject[];
  connection: PlanConnection | null;
  issues: PlanIssue[];
  warehouseName?: string;
  /** Abre el editor de textura de la ficha de origen del objeto. */
  onEditTexture?: () => void;
  onCommit: (updates: CommitUpdate[], label: string) => void;
  onCommitConnection: (patch: Partial<PlanConnection>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onDeleteConnection: () => void;
  onPlanChange: (patch: Partial<Plan>) => void;
}

export function Inspector({
  plan,
  selected,
  connection,
  issues,
  warehouseName,
  onEditTexture,
  onCommit,
  onCommitConnection,
  onDelete,
  onDuplicate,
  onDeleteConnection,
  onPlanChange,
}: Props) {
  if (connection) {
    return (
      <ConnectionInspector
        connection={connection}
        onCommit={onCommitConnection}
        onDelete={onDeleteConnection}
      />
    );
  }

  if (selected.length === 0) {
    return <PlanInspector plan={plan} onChange={onPlanChange} />;
  }

  if (selected.length > 1) {
    return (
      <MultiInspector count={selected.length} objects={selected} onDelete={onDelete} onDuplicate={onDuplicate} />
    );
  }

  return (
    <ObjectInspector
      object={selected[0]}
      issues={issues}
      warehouseName={warehouseName}
      onEditTexture={onEditTexture}
      onCommit={onCommit}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
    />
  );
}

/** Alturas habituales al colgar un objeto (foco de pared, pantalla, techo). */
const ELEVATION_PRESETS = [
  { label: 'Suelo', value: 0 },
  { label: 'Mesa · 0,75 m', value: 0.75 },
  { label: 'Pared · 2 m', value: 2 },
  { label: 'Alto · 3 m', value: 3 },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line px-3.5 py-3.5 last:border-b-0">
      <p className="mb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-dim">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ObjectInspector({
  object,
  issues,
  warehouseName,
  onEditTexture,
  onCommit,
  onDelete,
  onDuplicate,
}: {
  object: PlanObject;
  issues: PlanIssue[];
  warehouseName?: string;
  onEditTexture?: () => void;
  onCommit: (updates: CommitUpdate[], label: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [label, setLabel] = useState(object.label);

  useEffect(() => setLabel(object.label), [object.id, object.label]);

  const set = (patch: Partial<PlanObject>, name = 'Modificar objeto') => {
    const previous: Partial<PlanObject> = {};
    for (const key of Object.keys(patch) as (keyof PlanObject)[]) {
      (previous as Record<string, unknown>)[key] = object[key];
    }
    onCommit([{ id: object.id, patch, previous }], name);
  };

  const volume = volumeOf(Number(object.length_m), Number(object.width_m), Number(object.height_m));

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Identificación">
          <Field label="Nombre">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => {
                if (label !== object.label) set({ label }, 'Renombrar objeto');
              }}
              className="h-9"
            />
          </Field>

          {warehouseName ? (
            <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
              <Package className="size-3.5 shrink-0 text-ok" />
              <div className="min-w-0">
                <p className="text-[10.5px] uppercase tracking-wider text-dim">Unidad del almacén</p>
                <p className="truncate text-[12.5px] text-ink">{warehouseName}</p>
              </div>
            </div>
          ) : null}

          <VariantPicker object={object} onPick={set} />

          <Field label="Tipo">
            <Select
              value={object.kind}
              onChange={(e) => set({ kind: e.target.value as ObjectKind }, 'Cambiar tipo')}
              className="h-9"
            >
              {OBJECT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {OBJECT_KIND_LABEL[k]}
                </option>
              ))}
            </Select>
          </Field>
        </Section>

        <Section title="Dimensiones reales">
          <div className="grid grid-cols-3 gap-2">
            <Field label="Largo">
              <NumberInput
                value={Number(object.length_m)}
                onChange={(v) => set({ length_m: Math.max(0.01, v) }, 'Redimensionar')}
                unit="m"
                min={0.01}
              />
            </Field>
            <Field label="Ancho">
              <NumberInput
                value={Number(object.width_m)}
                onChange={(v) => set({ width_m: Math.max(0.01, v) }, 'Redimensionar')}
                unit="m"
                min={0.01}
              />
            </Field>
            <Field label="Alto">
              <NumberInput
                value={Number(object.height_m)}
                onChange={(v) => set({ height_m: Math.max(0.01, v) }, 'Redimensionar')}
                unit="m"
                min={0.01}
              />
            </Field>
          </div>
          <p className="num text-[11.5px] text-dim">Volumen {fmtM3(volume)}</p>
        </Section>

        <Section title="Posición">
          <div className="grid grid-cols-2 gap-2">
            <Field label="X">
              <NumberInput value={Number(object.x)} onChange={(v) => set({ x: v }, 'Mover')} unit="m" min={-999} />
            </Field>
            <Field label="Y">
              <NumberInput value={Number(object.y)} onChange={(v) => set({ y: v }, 'Mover')} unit="m" min={-999} />
            </Field>
          </div>

          <Field
            label="Altura sobre el suelo"
            hint={
              Number(object.z) > 0
                ? `Su base queda a ${fmtNum(Number(object.z), 2)} m y su parte alta a ${fmtNum(Number(object.z) + Number(object.height_m), 2)} m.`
                : 'Apoyado en el suelo. Súbelo para colgarlo de una pared o del techo.'
            }
          >
            <NumberInput
              value={Number(object.z)}
              onChange={(v) => set({ z: Math.max(0, v) }, 'Cambiar altura')}
              unit="m"
              step={0.1}
              min={0}
            />
          </Field>

          <div className="flex flex-wrap gap-1.5">
            {ELEVATION_PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => set({ z: p.value }, 'Cambiar altura')}
                className={cn(
                  'rounded-md border px-2 py-1 text-[11px] transition-colors',
                  Math.abs(Number(object.z) - p.value) < 0.001
                    ? 'border-accent-soft bg-surface-2 text-ink'
                    : 'border-line text-dim hover:text-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Field label="Rotación">
            <NumberInput
              value={Number(object.rotation)}
              onChange={(v) => set({ rotation: ((v % 360) + 360) % 360 }, 'Rotar')}
              unit="°"
              step={15}
              min={-360}
              max={360}
            />
          </Field>
          <Checkbox
            label="Bloqueado"
            checked={object.locked}
            onChange={(e) => set({ locked: e.target.checked }, 'Bloquear objeto')}
          />
        </Section>

        <Section title="Apariencia">
          <Field label="Forma">
            <Select
              value={object.shape}
              onChange={(e) => set({ shape: e.target.value as PlanObject['shape'] }, 'Cambiar forma')}
              className="h-9"
            >
              <option value="box">Rectángulo / caja</option>
              <option value="cylinder">Círculo / cilindro</option>
              <option value="plane">Superficie plana</option>
              <option value="text">Texto</option>
              <option value="line">Línea</option>
            </Select>
          </Field>
          <Field label="Color">
            <ColorPicker value={object.color} onChange={(c) => set({ color: c }, 'Cambiar color')} />
          </Field>
          {onEditTexture ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-center"
              icon={<Image className="size-3.5" />}
              onClick={onEditTexture}
            >
              Textura y plantilla…
            </Button>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-dim">
              Las figuras sueltas no llevan textura. Crea el objeto en el almacén o en la
              biblioteca para poder ponerle una imagen.
            </p>
          )}
        </Section>

        <Section title="Electricidad y red">
          <Checkbox
            label="Necesita corriente"
            checked={object.requires_power}
            onChange={(e) => set({ requires_power: e.target.checked }, 'Alimentación')}
          />
          <Checkbox
            label="Necesita red"
            checked={object.requires_network}
            onChange={(e) => set({ requires_network: e.target.checked }, 'Red')}
          />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Consumo">
              <NumberInput
                value={Number(object.power_w)}
                onChange={(v) => set({ power_w: Math.max(0, v) }, 'Consumo')}
                unit="W"
                step={5}
              />
            </Field>
            <Field label="Tomas">
              <NumberInput
                value={object.outlet_count}
                onChange={(v) => set({ outlet_count: Math.max(0, Math.round(v)) }, 'Tomas')}
                step={1}
              />
            </Field>
            <Field label="Puertos">
              <NumberInput
                value={object.port_count}
                onChange={(v) => set({ port_count: Math.max(0, Math.round(v)) }, 'Puertos')}
                step={1}
              />
            </Field>
          </div>
        </Section>

        {issues.length ? (
          <Section title="Incidencias">
            {issues.map((i) => (
              <div
                key={i.id}
                className="rounded-lg border px-2.5 py-2 text-[12px]"
                style={{
                  borderColor: `color-mix(in oklab, ${i.severity === 'error' ? 'var(--ef-danger)' : 'var(--ef-warn)'} 40%, transparent)`,
                  background: `color-mix(in oklab, ${i.severity === 'error' ? 'var(--ef-danger)' : 'var(--ef-warn)'} 10%, transparent)`,
                }}
              >
                <p className="text-ink">{i.title}</p>
                <p className="mt-0.5 text-[11px] text-muted">{i.detail}</p>
              </div>
            ))}
          </Section>
        ) : null}
      </div>

      <div className="flex gap-2 border-t border-line p-3">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 justify-center"
          icon={<Copy className="size-3.5" />}
          onClick={onDuplicate}
        >
          Duplicar
        </Button>
        <Button
          size="sm"
          variant="danger"
          className="flex-1 justify-center"
          icon={<Trash2 className="size-3.5" />}
          onClick={onDelete}
        >
          Eliminar
        </Button>
      </div>
    </div>
  );
}

/**
 * ESTILO DEL OBJETO
 *
 * Cuál de los acabados del material es este en concreto: el photocall de este
 * año, la mesa con mantel rojo. Cambiarlo aquí cambia también el color, el
 * nombre y —si el estilo suma material aparte— lo que pide el listado.
 */
function VariantPicker({
  object,
  onPick,
}: {
  object: PlanObject;
  onPick: (patch: Partial<PlanObject>, name?: string) => void;
}) {
  const variants = useItemVariants();
  const items = useWarehouseItems();

  if (!object.warehouse_item_id) return null;

  const item = items.data?.find((i) => i.id === object.warehouse_item_id);
  const list = (variants.data ?? []).filter((v) => v.item_id === object.warehouse_item_id);
  if (list.length === 0) return null;

  return (
    <Field label="Estilo" hint="Los estilos se dan de alta en el almacén, dentro del material.">
      <Select
        value={object.variant_id ?? ''}
        className="h-9"
        onChange={(e) => {
          const id = e.target.value || null;
          const v = id ? list.find((x) => x.id === id) : null;
          onPick(
            {
              variant_id: id,
              label: v && item ? `${item.name} · ${v.name}` : (item?.name ?? object.label),
              color: v?.color || item?.color || object.color,
            },
            'Cambiar estilo',
          );
        }}
      >
        <option value="">Sin estilo</option>
        {list.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.adds_material ? ' · suma material' : ''}
          </option>
        ))}
      </Select>
    </Field>
  );
}

function MultiInspector({
  count,
  objects,
  onDelete,
  onDuplicate,
}: {
  count: number;
  objects: PlanObject[];
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const volume = objects.reduce(
    (s, o) => s + volumeOf(Number(o.length_m), Number(o.width_m), Number(o.height_m)),
    0,
  );

  return (
    <div className="flex h-full flex-col">
      <Section title="Selección múltiple">
        <p className="text-[13px] text-ink">{count} objetos seleccionados</p>
        <p className="num text-[12px] text-muted">Volumen {fmtM3(volume)}</p>
        <p className="text-[12px] text-dim">
          Arrastra para moverlos juntos. Usa Supr para eliminarlos o Ctrl+D para duplicarlos.
        </p>
      </Section>

      <div className="mt-auto flex gap-2 border-t border-line p-3">
        <Button
          size="sm"
          variant="outline"
          className="flex-1 justify-center"
          icon={<Copy className="size-3.5" />}
          onClick={onDuplicate}
        >
          Duplicar
        </Button>
        <Button
          size="sm"
          variant="danger"
          className="flex-1 justify-center"
          icon={<Trash2 className="size-3.5" />}
          onClick={onDelete}
        >
          Eliminar
        </Button>
      </div>
    </div>
  );
}

function ConnectionInspector({
  connection,
  onCommit,
  onDelete,
}: {
  connection: PlanConnection;
  onCommit: (patch: Partial<PlanConnection>) => void;
  onDelete: () => void;
}) {
  const [type, setType] = useState(connection.cable_type);
  useEffect(() => setType(connection.cable_type), [connection.id, connection.cable_type]);

  return (
    <div className="flex h-full flex-col">
      <Section title="Cable">
        <Badge color={connection.kind === 'power' ? '#f59e0b' : '#22d3ee'} dot>
          {connection.kind === 'power' ? 'Eléctrico' : 'Red'}
        </Badge>
        <Field label="Tipo de cable">
          <Input
            value={type}
            onChange={(e) => setType(e.target.value)}
            onBlur={() => {
              if (type !== connection.cable_type) onCommit({ cable_type: type });
            }}
            placeholder={connection.kind === 'power' ? 'Manguera 3G2.5' : 'Cat6 U/UTP'}
            className="h-9"
          />
        </Field>
        <Field label="Longitud" hint="Se suma al listado de material.">
          <NumberInput
            value={Number(connection.length_m)}
            onChange={(v) => onCommit({ length_m: Math.max(0, v) })}
            unit="m"
            step={0.5}
          />
        </Field>
        <Field label="Color">
          <ColorPicker value={connection.color} onChange={(c) => onCommit({ color: c })} />
        </Field>
        <p className="num text-[11.5px] text-dim">
          Longitud registrada: {fmtNum(Number(connection.length_m), 2)} m
        </p>
      </Section>

      <div className="mt-auto border-t border-line p-3">
        <Button
          size="sm"
          variant="danger"
          className="w-full justify-center"
          icon={<Unlink className="size-3.5" />}
          onClick={onDelete}
        >
          Eliminar cable
        </Button>
      </div>
    </div>
  );
}

function PlanInspector({ plan, onChange }: { plan: Plan; onChange: (patch: Partial<Plan>) => void }) {
  return (
    <div className="flex h-full flex-col">
      <Section title="Recinto">
        <Field label="Nombre del plano">
          <Input
            defaultValue={plan.name}
            onBlur={(e) => {
              if (e.target.value !== plan.name) onChange({ name: e.target.value });
            }}
            className="h-9"
          />
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="Ancho">
            <NumberInput
              value={Number(plan.width_m)}
              onChange={(v) => onChange({ width_m: Math.max(1, v) })}
              unit="m"
              min={1}
            />
          </Field>
          <Field label="Fondo">
            <NumberInput
              value={Number(plan.depth_m)}
              onChange={(v) => onChange({ depth_m: Math.max(1, v) })}
              unit="m"
              min={1}
            />
          </Field>
          <Field label="Alto">
            <NumberInput
              value={Number(plan.height_m)}
              onChange={(v) => onChange({ height_m: Math.max(1, v) })}
              unit="m"
              min={1}
            />
          </Field>
        </div>
        <Field label="Rejilla" hint="Tamaño de casilla y paso del ajuste.">
          <NumberInput
            value={Number(plan.grid_size_m)}
            onChange={(v) => onChange({ grid_size_m: Math.max(0.05, v) })}
            unit="m"
            step={0.05}
            min={0.05}
          />
        </Field>
      </Section>

      <Section title="Atajos y ratón">
        <ul className="space-y-1 text-[11.5px] text-muted">
          <Shortcut keys="Clic" action="Seleccionar" />
          <Shortcut keys="Mayús + clic" action="Añadir a la selección" />
          <Shortcut keys="Arrastrar" action="Mover / marco de selección" />
          <Shortcut keys="Espacio + arrastrar" action="Desplazar la vista" />
          <Shortcut keys="Rueda" action="Zoom" />
          <Shortcut keys="3D · botón derecho" action="Girar la cámara" />
          <Shortcut keys="3D · rueda pulsada" action="Desplazar la vista" />
          <Shortcut keys="Ctrl + D" action="Duplicar" />
          <Shortcut keys="Ctrl + C / V" action="Copiar / pegar" />
          <Shortcut keys="Ctrl + Z / Y" action="Deshacer / rehacer" />
          <Shortcut keys="Supr" action="Eliminar" />
          <Shortcut keys="Flechas" action="Mover 1 casilla" />
          <Shortcut keys="Esc" action="Deseleccionar" />
        </ul>
      </Section>
    </div>
  );
}

function Shortcut({ keys, action }: { keys: string; action: string }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink">
        {keys}
      </span>
      <span className="text-right">{action}</span>
    </li>
  );
}
