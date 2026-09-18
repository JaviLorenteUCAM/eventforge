import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleDot,
  MapPin,
  PackageSearch,
  Plus,
  Timer,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Meter,
  SectionTitle,
  Stat,
} from '@/components/ui';
import { useEvents } from '@/data/events';
import { useTasks } from '@/data/tasks';
import { useScheduleActivities, useScheduleDays } from '@/data/schedule';
import { useBoxes, useCatalog, useWarehouseItems } from '@/data/warehouse';
import { usePlanConnections, usePlanObjects, usePlans } from '@/data/plans';
import { useProfileMap } from '@/data/profiles';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { analyzePlan } from '@/lib/issues';
import { computeMaterialNeeds, summarizeMaterial } from '@/lib/materials';
import {
  EVENT_STATUS_COLOR,
  EVENT_STATUS_LABEL,
  TASK_PRIORITY_COLOR,
  TASK_PRIORITY_LABEL,
  type EventRow,
} from '@/lib/types';
import { fmtDate, fmtNum, hhmm, relativeDay } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 13) return 'Buenos días';
  if (h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

const ACTIVE_STATUSES = ['preparation', 'setup', 'live', 'teardown'];

export function DashboardPage() {
  const { profile } = useAuth();
  const events = useEvents();
  const tasks = useTasks();
  const items = useWarehouseItems();
  const boxes = useBoxes();
  const catalog = useCatalog();
  const profiles = useProfileMap();

  useRealtime('dashboard', [
    { table: 'events', invalidate: [qk.events] },
    { table: 'tasks', invalidate: [['tasks']] },
  ]);

  // Momento de referencia fijo para este render.
  const now = useMemo(() => Date.now(), []);
  const sorted = useMemo(
    () => [...(events.data ?? [])].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)),
    [events.data],
  );

  const running = sorted.filter(
    (e) => ACTIVE_STATUSES.includes(e.status) && +new Date(e.ends_at) >= now,
  );
  const upcoming = sorted.filter(
    (e) => +new Date(e.starts_at) > now && e.status !== 'finished',
  );
  const focusEvent = running[0] ?? upcoming[0] ?? null;

  const openTasks = (tasks.data ?? []).filter((t) => t.status !== 'done');
  const myTasks = openTasks.filter((t) => t.assignee_id === profile?.id);

  const progressByEvent = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const t of tasks.data ?? []) {
      const entry = map.get(t.event_id) ?? { total: 0, done: 0 };
      entry.total += 1;
      if (t.status === 'done') entry.done += 1;
      map.set(t.event_id, entry);
    }
    return map;
  }, [tasks.data]);

  const readiness = (e: EventRow) => {
    const p = progressByEvent.get(e.id);
    if (!p || p.total === 0) return 0;
    return Math.round((p.done / p.total) * 100);
  };

  if (events.isLoading) return <Page><LoadingState /></Page>;
  if (events.isError) {
    return (
      <Page>
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      </Page>
    );
  }

  const totalStock = (items.data ?? []).reduce((s, i) => s + Number(i.quantity), 0);

  return (
    <Page>
      <PageHeader
        title={
          <>
            {greeting()},{' '}
            <span className="bg-gradient-to-r from-accent-soft to-[var(--ef-cyan)] bg-clip-text text-transparent">
              {profile?.name?.split(' ')[0] ?? ''}
            </span>
          </>
        }
        subtitle={fmtDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <Link to="/eventos?nuevo=1">
            <Button variant="primary" icon={<Plus className="size-4" />}>
              Nuevo evento
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Eventos en curso"
          value={running.length}
          hint={running[0]?.name}
          tone={running.length ? 'ok' : 'default'}
          icon={<CircleDot className="size-4" />}
        />
        <Stat
          label="Próximos eventos"
          value={upcoming.length}
          hint={upcoming[0] ? relativeDay(upcoming[0].starts_at) : 'Sin programar'}
          icon={<CalendarClock className="size-4" />}
        />
        <Stat
          label="Tareas pendientes"
          value={openTasks.length}
          hint={`${myTasks.length} asignadas a ti`}
          tone={openTasks.length ? 'warn' : 'ok'}
          icon={<CheckCircle2 className="size-4" />}
        />
        <Stat
          label="Almacén"
          value={fmtNum(totalStock, 0)}
          hint={`${items.data?.length ?? 0} referencias · ${boxes.data?.length ?? 0} cajas`}
          icon={<Boxes className="size-4" />}
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionTitle
            actions={
              <Link to="/eventos" className="text-[12.5px] text-accent-soft hover:underline">
                Ver todos
              </Link>
            }
          >
            Próximos eventos
          </SectionTitle>

          {running.length === 0 && upcoming.length === 0 ? (
            <EmptyState
              title="No hay eventos programados"
              message="Crea tu primer evento para empezar a planificar planos, material y tareas."
              icon={<CalendarClock className="size-5" />}
              action={
                <Link to="/eventos?nuevo=1">
                  <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />}>
                    Crear evento
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {[...running, ...upcoming].slice(0, 4).map((e, i) => (
                <motion.div
                  key={e.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link to={`/eventos/${e.id}`} className="block">
                    <Card className="group h-full p-4 transition-all hover:-translate-y-0.5 hover:border-line-strong">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-ink">
                          {e.name}
                        </h3>
                        <Badge color={EVENT_STATUS_COLOR[e.status]} dot>
                          {EVENT_STATUS_LABEL[e.status]}
                        </Badge>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3.5" />
                          {fmtDate(e.starts_at)}
                        </span>
                        {e.location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3.5" />
                            {e.location}
                          </span>
                        ) : null}
                        <span className="text-dim">{relativeDay(e.starts_at)}</span>
                      </div>

                      <div className="mt-3.5">
                        <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-dim">
                          <span>Preparación</span>
                          <span className="num text-muted">{readiness(e)}%</span>
                        </div>
                        <Meter value={readiness(e)} color={e.color} height={6} />
                      </div>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}

          {focusEvent ? <FocusPanels event={focusEvent} catalogReady={catalog.isSuccess} /> : null}
        </div>

        <div className="space-y-6">
          <div>
            <SectionTitle>Tareas pendientes</SectionTitle>
            <Card className="divide-y divide-[var(--ef-line)]">
              {openTasks.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-muted">
                  Todo al día. No hay tareas pendientes.
                </div>
              ) : (
                openTasks
                  .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'))
                  .slice(0, 7)
                  .map((t) => {
                    const owner = t.assignee_id ? profiles.get(t.assignee_id) : null;
                    return (
                      <Link
                        key={t.id}
                        to={`/eventos/${t.event_id}/tareas`}
                        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                      >
                        {t.status === 'in_progress' ? (
                          <Timer className="mt-0.5 size-4 shrink-0 text-warn" />
                        ) : (
                          <Circle className="mt-0.5 size-4 shrink-0 text-dim" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] text-ink">{t.title}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge color={TASK_PRIORITY_COLOR[t.priority]}>
                              {TASK_PRIORITY_LABEL[t.priority]}
                            </Badge>
                            {t.due_date ? (
                              <span className="text-[11.5px] text-dim">{relativeDay(t.due_date)}</span>
                            ) : null}
                          </div>
                        </div>
                        {owner ? (
                          <Avatar
                            name={owner.name}
                            avatarUrl={owner.avatar_url}
                            color={owner.color}
                            size="xs"
                          />
                        ) : null}
                      </Link>
                    );
                  })
              )}
            </Card>
          </div>

          {focusEvent ? <UpcomingActivities eventId={focusEvent.id} /> : null}
        </div>
      </div>
    </Page>
  );
}

/** Incidencias y material del evento más inminente. */
function FocusPanels({ event, catalogReady }: { event: EventRow; catalogReady: boolean }) {
  const plans = usePlans(event.id);
  const planId = plans.data?.[0]?.id;
  const objects = usePlanObjects(planId);
  const connections = usePlanConnections(planId);
  const items = useWarehouseItems();
  const catalog = useCatalog();

  const issues = useMemo(
    () => analyzePlan(objects.data ?? [], connections.data ?? []),
    [objects.data, connections.data],
  );

  const needs = useMemo(
    () =>
      catalogReady
        ? computeMaterialNeeds(
            objects.data ?? [],
            connections.data ?? [],
            catalog.data ?? [],
            items.data ?? [],
          )
        : [],
    [objects.data, connections.data, catalog.data, items.data, catalogReady],
  );
  const summary = summarizeMaterial(needs);
  const missing = needs.filter((n) => n.missing > 0);

  if (!planId) return null;

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      <div>
        <SectionTitle
          actions={
            <Link
              to={`/eventos/${event.id}/plano`}
              className="text-[12.5px] text-accent-soft hover:underline"
            >
              Abrir plano
            </Link>
          }
        >
          Incidencias · {event.name}
        </SectionTitle>
        <Card className="max-h-64 divide-y divide-[var(--ef-line)] overflow-y-auto">
          {issues.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted">
              <CheckCircle2 className="size-4 text-ok" />
              Sin incidencias detectadas en el plano.
            </div>
          ) : (
            issues.slice(0, 8).map((issue) => (
              <Link
                key={issue.id}
                to={`/eventos/${event.id}/plano?sel=${issue.objectId ?? ''}`}
                className="flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-surface-2"
              >
                <AlertTriangle
                  className={`mt-0.5 size-4 shrink-0 ${issue.severity === 'error' ? 'text-danger' : 'text-warn'}`}
                />
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">{issue.title}</p>
                  <p className="truncate text-[11.5px] text-dim">{issue.detail}</p>
                </div>
              </Link>
            ))
          )}
        </Card>
      </div>

      <div>
        <SectionTitle
          actions={
            <Link
              to={`/eventos/${event.id}/material`}
              className="text-[12.5px] text-accent-soft hover:underline"
            >
              Ver material
            </Link>
          }
        >
          Material pendiente
        </SectionTitle>
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between text-[12.5px]">
            <span className="text-muted">Cobertura del almacén</span>
            <span className="num font-medium text-ink">{summary.coverage}%</span>
          </div>
          <Meter value={summary.coverage} color={summary.coverage >= 100 ? '#34d399' : undefined} />

          {missing.length === 0 ? (
            <p className="mt-4 flex items-center gap-2 text-[13px] text-muted">
              <CheckCircle2 className="size-4 text-ok" />
              Todo el material necesario está disponible.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {missing.slice(0, 5).map((n) => (
                <li key={n.key} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 truncate text-ink">{n.name}</span>
                  <span className="num shrink-0 text-danger">
                    faltan {fmtNum(n.missing, 0)} {n.unit}
                  </span>
                </li>
              ))}
              {missing.length > 5 ? (
                <li className="flex items-center gap-1.5 text-[12px] text-dim">
                  <PackageSearch className="size-3.5" />+{missing.length - 5} referencias más
                </li>
              ) : null}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function UpcomingActivities({ eventId }: { eventId: string }) {
  const days = useScheduleDays(eventId);
  const activities = useScheduleActivities(eventId);

  const dayLabel = new Map((days.data ?? []).map((d) => [d.id, d.label || `Día ${d.day_index}`]));
  const list = [...(activities.data ?? [])]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .slice(0, 6);

  return (
    <div>
      <SectionTitle
        actions={
          <Link to={`/eventos/${eventId}/horarios`} className="text-[12.5px] text-accent-soft hover:underline">
            Ver horarios
          </Link>
        }
      >
        Próximas actividades
      </SectionTitle>
      <Card className="divide-y divide-[var(--ef-line)]">
        {list.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-muted">
            Este evento aún no tiene actividades.
          </div>
        ) : (
          list.map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: a.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] text-ink">{a.title}</p>
                <p className="text-[11.5px] text-dim">
                  {dayLabel.get(a.day_id) ?? '—'} · {hhmm(a.starts_at)}–{hhmm(a.ends_at)}
                </p>
              </div>
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
