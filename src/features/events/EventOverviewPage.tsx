import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Boxes,
  CalendarDays,
  CheckCircle2,
  Layers3,
  ListChecks,
  Pencil,
  Zap,
} from 'lucide-react';
import { Page } from '@/components/layout/PageHeader';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  LoadingState,
  Meter,
  SectionTitle,
  Stat,
} from '@/components/ui';
import { useEvent, useEventMembers } from '@/data/events';
import { useTasks } from '@/data/tasks';
import { useScheduleActivities, useScheduleDays } from '@/data/schedule';
import { usePlanConnections, usePlanObjects, usePlans } from '@/data/plans';
import { useCatalog, useWarehouseItems } from '@/data/warehouse';
import { useProfileMap } from '@/data/profiles';
import { analyzePlan, powerBudget } from '@/lib/issues';
import { computeMaterialNeeds, summarizeMaterial } from '@/lib/materials';
import { fmtNum, fmtPct, hhmm } from '@/lib/utils';
import { EventFormModal } from './EventFormModal';

export function EventOverviewPage() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const members = useEventMembers(eventId);
  const profiles = useProfileMap();
  const tasks = useTasks(eventId);
  const days = useScheduleDays(eventId);
  const activities = useScheduleActivities(eventId);
  const plans = usePlans(eventId);
  const planId = plans.data?.[0]?.id;
  const objects = usePlanObjects(planId);
  const connections = usePlanConnections(planId);
  const catalog = useCatalog();
  const items = useWarehouseItems();

  const [editOpen, setEditOpen] = useState(false);

  const issues = useMemo(
    () => analyzePlan(objects.data ?? [], connections.data ?? []),
    [objects.data, connections.data],
  );

  const needs = useMemo(
    () =>
      computeMaterialNeeds(
        objects.data ?? [],
        connections.data ?? [],
        catalog.data ?? [],
        items.data ?? [],
      ),
    [objects.data, connections.data, catalog.data, items.data],
  );
  const material = summarizeMaterial(needs);

  const taskStats = useMemo(() => {
    const list = tasks.data ?? [];
    const done = list.filter((t) => t.status === 'done').length;
    return { total: list.length, done, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
  }, [tasks.data]);

  const nextActivity = useMemo(() => {
    const dayById = new Map((days.data ?? []).map((d) => [d.id, d]));
    return [...(activities.data ?? [])]
      .sort((a, b) => {
        const da = dayById.get(a.day_id)?.day_index ?? 99;
        const db = dayById.get(b.day_id)?.day_index ?? 99;
        return da - db || a.starts_at.localeCompare(b.starts_at);
      })
      .map((a) => ({ ...a, dayLabel: dayById.get(a.day_id)?.label ?? '' }))[0];
  }, [activities.data, days.data]);

  const power = powerBudget(objects.data ?? []);

  if (event.isLoading || !event.data) return <LoadingState />;
  const e = event.data;

  const readiness = Math.round(
    (taskStats.pct + material.coverage + (issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 12))) / 3,
  );

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionTitle>Preparación global</SectionTitle>
          <div className="flex items-end gap-3">
            <span className="num text-4xl font-semibold tracking-tight text-ink">{readiness}%</span>
            <span className="mb-1.5 text-[13px] text-muted">
              tareas, cobertura de material e incidencias
            </span>
          </div>
          <Meter value={readiness} color={e.color} className="mt-3 w-full max-w-md" height={10} />
        </div>
        <Button variant="outline" icon={<Pencil className="size-4" />} onClick={() => setEditOpen(true)}>
          Editar evento
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat
          label="Tareas"
          value={`${taskStats.done} / ${taskStats.total}`}
          hint={`${taskStats.pct}% completadas`}
          tone={taskStats.pct === 100 && taskStats.total > 0 ? 'ok' : 'default'}
          icon={<ListChecks className="size-4" />}
        />
        <Stat
          label="Material"
          value={fmtPct(material.coverage)}
          hint={`${material.lines} referencias · faltan ${material.totalMissing}`}
          tone={material.coverage >= 100 ? 'ok' : 'warn'}
          icon={<Boxes className="size-4" />}
        />
        <Stat
          label="Incidencias"
          value={issues.length}
          hint={issues.length ? 'Revisa el plano' : 'Sin problemas detectados'}
          tone={issues.length ? 'danger' : 'ok'}
          icon={<AlertTriangle className="size-4" />}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Plano"
              subtitle={`${objects.data?.length ?? 0} objetos · ${connections.data?.length ?? 0} conexiones`}
              icon={<Layers3 className="size-4" />}
              actions={
                <Link to="plano">
                  <Button size="sm" variant="outline">
                    Abrir editor
                  </Button>
                </Link>
              }
            />
            <div className="grid grid-cols-2 gap-px border-t border-line bg-[var(--ef-line)] sm:grid-cols-4">
              <MiniStat label="Objetos" value={objects.data?.length ?? 0} />
              <MiniStat label="Cables" value={connections.data?.length ?? 0} />
              <MiniStat
                label="Consumo"
                value={`${power.totalW} W`}
                hint={`≈ ${power.amps230} A a 230 V`}
              />
              <MiniStat
                label="Falta material"
                value={material.totalMissing > 0 ? fmtNum(material.totalMissing, 0) : '—'}
                hint={material.totalMissing > 0 ? 'unidades por conseguir' : 'todo disponible'}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Incidencias detectadas"
              subtitle="Análisis automático de electricidad y red"
              icon={<Zap className="size-4" />}
              actions={
                <Link to="plano">
                  <Button size="sm" variant="ghost">
                    Ir al plano
                  </Button>
                </Link>
              }
            />
            <div className="max-h-72 divide-y divide-[var(--ef-line)] overflow-y-auto border-t border-line">
              {issues.length === 0 ? (
                <div className="flex items-center gap-2 px-5 py-6 text-[13px] text-muted">
                  <CheckCircle2 className="size-4 text-ok" />
                  Todo conectado correctamente.
                </div>
              ) : (
                issues.map((issue) => (
                  <Link
                    key={issue.id}
                    to={`plano?sel=${issue.objectId ?? ''}`}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-surface-2"
                  >
                    <AlertTriangle
                      className={`mt-0.5 size-4 shrink-0 ${issue.severity === 'error' ? 'text-danger' : 'text-warn'}`}
                    />
                    <div className="min-w-0">
                      <p className="text-[13.5px] text-ink">{issue.title}</p>
                      <p className="text-[12px] text-dim">{issue.detail}</p>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Próxima actividad" icon={<CalendarDays className="size-4" />} />
            <div className="px-5 pb-5">
              {nextActivity ? (
                <Link to="horarios" className="block">
                  <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 p-3.5">
                    <span
                      className="mt-0.5 h-10 w-1 shrink-0 rounded-full"
                      style={{ background: nextActivity.color }}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-ink">{nextActivity.title}</p>
                      <p className="mt-0.5 text-[12.5px] text-muted">
                        {nextActivity.dayLabel} · {hhmm(nextActivity.starts_at)}–
                        {hhmm(nextActivity.ends_at)}
                      </p>
                    </div>
                  </div>
                </Link>
              ) : (
                <p className="text-[13px] text-muted">
                  Sin actividades programadas.{' '}
                  <Link to="horarios" className="text-accent-soft hover:underline">
                    Crear horario
                  </Link>
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Equipo" subtitle={`${members.data?.length ?? 0} responsables`} />
            <div className="space-y-2 px-5 pb-5">
              {(members.data ?? []).map((m) => {
                const p = profiles.get(m.profile_id);
                if (!p) return null;
                return (
                  <div key={m.profile_id} className="flex items-center gap-2.5">
                    <Avatar name={p.name} avatarUrl={p.avatar_url} color={p.color} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-ink">{p.name}</p>
                      <p className="truncate text-[11.5px] text-dim">{p.role_title}</p>
                    </div>
                    {m.role === 'owner' ? <Badge color="#6366f1">Responsable</Badge> : null}
                  </div>
                );
              })}
              {(members.data ?? []).length === 0 ? (
                <p className="text-[13px] text-muted">Sin responsables asignados.</p>
              ) : null}
            </div>
          </Card>

          {e.notes ? (
            <Card>
              <CardHeader title="Notas" />
              <p className="whitespace-pre-wrap px-5 pb-5 text-[13px] leading-relaxed text-muted">
                {e.notes}
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <EventFormModal open={editOpen} event={e} onClose={() => setEditOpen(false)} />
    </Page>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="bg-[var(--ef-surface-solid)] px-4 py-3.5">
      <p className="text-[11px] uppercase tracking-[0.1em] text-dim">{label}</p>
      <p className="num mt-1 text-lg font-semibold text-ink">{value}</p>
      {hint ? <p className="text-[11px] text-dim">{hint}</p> : null}
    </div>
  );
}
