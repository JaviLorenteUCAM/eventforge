import { useEffect, useState } from 'react';
import { Download, Layers, MapPin, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  ConfirmDialog,
  Field,
  Input,
  LoadingState,
  Modal,
  SearchInput,
  Textarea,
} from '@/components/ui';
import {
  useDeleteScenario,
  useLoadScenario,
  useSaveScenario,
  useScenarios,
} from '@/data/scenarios';
import type { Plan, Scenario } from '@/lib/types';
import { cn, fmtDate, fmtNum, normalize } from '@/lib/utils';

/**
 * Guardar el plano actual como escenario reutilizable.
 * Copia recinto, objetos, cableado e imágenes de fondo calibradas.
 */
export function SaveScenarioModal({
  open,
  plan,
  objectCount,
  onClose,
}: {
  open: boolean;
  plan: Plan;
  objectCount: number;
  onClose: () => void;
}) {
  const save = useSaveScenario();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(plan.name === 'Plano principal' ? '' : plan.name);
    setDescription('');
    setLocation('');
    setError(null);
  }, [open, plan.name]);

  async function submit() {
    if (!name.trim()) return setError('Ponle un nombre al escenario.');
    try {
      await save.mutateAsync({
        planId: plan.id,
        name: name.trim(),
        description: description.trim(),
        location: location.trim(),
      });
      toast.success('Escenario guardado. Ya puedes cargarlo en otros eventos.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Guardar como escenario"
      description="Una plantilla reutilizable para eventos que se repiten en el mismo espacio."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={save.isPending}
            icon={<Save className="size-4" />}
          >
            Guardar escenario
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Nombre" required error={error}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Patio central del colegio"
            autoFocus
          />
        </Field>
        <Field label="Ubicación">
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Murcia · Colegio San José"
          />
        </Field>
        <Field label="Descripción">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Montaje habitual de la gala anual"
          />
        </Field>

        <div className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] text-muted">
          Se guardarán <strong className="text-ink">{objectCount} objetos</strong>, su cableado, las
          imágenes de fondo calibradas y el recinto de{' '}
          <span className="num text-ink">
            {fmtNum(Number(plan.width_m), 2)} × {fmtNum(Number(plan.depth_m), 2)} m
          </span>
          .
        </div>
      </div>
    </Modal>
  );
}

/** Cargar un escenario guardado sobre el plano actual. */
export function LoadScenarioModal({
  open,
  planId,
  hasContent,
  onClose,
}: {
  open: boolean;
  planId: string;
  hasContent: boolean;
  onClose: () => void;
}) {
  const scenarios = useScenarios();
  const load = useLoadScenario();
  const remove = useDeleteScenario();

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Scenario | null>(null);
  const [toDelete, setToDelete] = useState<Scenario | null>(null);

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setSearch('');
    }
  }, [open]);

  const list = (scenarios.data ?? []).filter((s) => {
    const q = normalize(search);
    return !q || normalize(`${s.name} ${s.location} ${s.description}`).includes(q);
  });

  async function apply(replace: boolean) {
    if (!picked) return;
    try {
      const n = await load.mutateAsync({ scenarioId: picked.id, planId, replace });
      toast.success(`Escenario cargado: ${n} objetos`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido cargar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Cargar un escenario"
      description="Recupera un espacio ya montado: recinto, objetos, cableado e imágenes de fondo."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {hasContent ? (
            <Button
              variant="secondary"
              onClick={() => void apply(false)}
              disabled={!picked}
              loading={load.isPending}
            >
              Añadir al plano actual
            </Button>
          ) : null}
          <Button
            variant="primary"
            onClick={() => void apply(true)}
            disabled={!picked}
            loading={load.isPending}
            icon={<Download className="size-4" />}
          >
            {hasContent ? 'Reemplazar el plano' : 'Cargar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar escenario…" />

        {scenarios.isLoading ? (
          <LoadingState label="Cargando escenarios…" />
        ) : list.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center">
            <Layers className="mx-auto mb-2 size-5 text-dim" />
            <p className="text-[13px] text-ink">
              {scenarios.data?.length ? 'Ningún escenario coincide' : 'Todavía no hay escenarios'}
            </p>
            <p className="mt-1 text-[12px] text-muted">
              Monta un plano y usa «Guardar como escenario» para reutilizarlo.
            </p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {list.map((s) => {
              const isPicked = picked?.id === s.id;
              return (
                <div
                  key={s.id}
                  className={cn(
                    'group relative rounded-xl border p-3 transition-colors',
                    isPicked ? 'border-accent-soft bg-surface-2' : 'border-line hover:bg-surface-2',
                  )}
                >
                  <button onClick={() => setPicked(s)} className="block w-full text-left">
                    <p className="truncate text-[13.5px] font-medium text-ink">{s.name}</p>
                    {s.location ? (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-muted">
                        <MapPin className="size-3 shrink-0" />
                        {s.location}
                      </p>
                    ) : null}
                    {s.description ? (
                      <p className="mt-1 line-clamp-2 text-[12px] text-dim">{s.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge color="#6366f1">
                        {fmtNum(Number(s.width_m), 1)} × {fmtNum(Number(s.depth_m), 1)} m
                      </Badge>
                      <span className="text-[11px] text-dim">{fmtDate(s.created_at)}</span>
                    </div>
                  </button>

                  <button
                    onClick={() => setToDelete(s)}
                    aria-label="Eliminar escenario"
                    className="absolute right-2 top-2 rounded-md p-1 text-dim opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {picked && hasContent ? (
          <p className="rounded-lg border border-[color-mix(in_oklab,var(--ef-warn)_40%,transparent)] bg-[color-mix(in_oklab,var(--ef-warn)_10%,transparent)] px-3 py-2 text-[12px] leading-relaxed text-ink">
            «Reemplazar» borra lo que haya ahora en el plano antes de cargar el escenario.
            «Añadir» lo conserva y superpone el escenario encima.
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            await remove.mutateAsync(toDelete.id);
            toast.success('Escenario eliminado');
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
          }
          setToDelete(null);
        }}
        loading={remove.isPending}
        title="Eliminar escenario"
        message={
          <>
            Se eliminará «{toDelete?.name}». Los planos que ya lo hayan usado no se ven afectados.
          </>
        }
      />
    </Modal>
  );
}
