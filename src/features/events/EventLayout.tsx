import { useEffect } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Boxes, CalendarDays, ClipboardList, Layers3, ListChecks, Truck } from 'lucide-react';
import { Badge, ErrorState, LoadingState } from '@/components/ui';
import { useEvent } from '@/data/events';
import { useCreatePlan, usePlans } from '@/data/plans';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { EVENT_STATUS_COLOR, EVENT_STATUS_LABEL } from '@/lib/types';
import { cn, fmtDateRange } from '@/lib/utils';

const TABS = [
  { to: '.', label: 'Resumen', icon: <ClipboardList className="size-4" />, end: true },
  { to: 'plano', label: 'Plano', icon: <Layers3 className="size-4" /> },
  { to: 'horarios', label: 'Horarios', icon: <CalendarDays className="size-4" /> },
  { to: 'material', label: 'Material', icon: <Boxes className="size-4" /> },
  { to: 'tareas', label: 'Tareas', icon: <ListChecks className="size-4" /> },
  { to: 'transporte', label: 'Transporte', icon: <Truck className="size-4" /> },
];

export function EventLayout() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const plans = usePlans(eventId);
  const createPlan = useCreatePlan();

  useRealtime(
    `event-${eventId}`,
    [
      { table: 'events', filter: `id=eq.${eventId}`, invalidate: [qk.event(eventId ?? '')] },
      { table: 'plans', filter: `event_id=eq.${eventId}`, invalidate: [qk.plans(eventId ?? '')] },
    ],
    Boolean(eventId),
  );

  // Autocuracion: si el evento no tiene plano (p.ej. creado antes), lo creamos.
  useEffect(() => {
    if (!eventId || !plans.isSuccess || plans.data.length > 0 || createPlan.isPending) return;
    createPlan.mutate({ event_id: eventId, name: 'Plano principal', is_default: true });
  }, [eventId, plans.isSuccess, plans.data, createPlan]);

  if (event.isLoading) return <LoadingState />;
  if (event.isError) return <ErrorState error={event.error} onRetry={() => void event.refetch()} />;
  if (!event.data) {
    return (
      <div className="p-8">
        <ErrorState error="Este evento no existe o no tienes acceso." />
      </div>
    );
  }

  const e = event.data;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line bg-[color-mix(in_oklab,var(--ef-canvas)_70%,transparent)] px-4 pt-5 backdrop-blur-xl sm:px-6">
        <div className="mx-auto w-full max-w-[1400px]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-9 w-1.5 rounded-full" style={{ background: e.color }} />
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight text-ink sm:text-xl">
                {e.name}
              </h1>
              <p className="mt-0.5 truncate text-[12.5px] text-muted">
                {fmtDateRange(e.starts_at, e.ends_at)}
                {e.location ? ` · ${e.location}` : ''}
              </p>
            </div>
            <Badge color={EVENT_STATUS_COLOR[e.status]} dot>
              {EVENT_STATUS_LABEL[e.status]}
            </Badge>
          </div>

          <nav className="no-scrollbar -mb-px mt-4 flex gap-1 overflow-x-auto">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                    isActive ? 'text-ink' : 'text-muted hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {tab.icon}
                    {tab.label}
                    {isActive ? (
                      <motion.span
                        layoutId="event-tab"
                        className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent"
                        transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                      />
                    ) : null}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
