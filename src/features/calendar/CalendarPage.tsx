import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Button, Card, ErrorState, LoadingState, Segmented } from '@/components/ui';
import { useEvents, useUpdateEvent } from '@/data/events';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { EVENT_STATUS_LABEL, type EventRow } from '@/lib/types';
import { cn, hexWithAlpha } from '@/lib/utils';
import { EventFormModal } from '@/features/events/EventFormModal';

type View = 'month' | 'week' | 'day';

export function CalendarPage() {
  const navigate = useNavigate();
  const events = useEvents();
  const updateEvent = useUpdateEvent();

  useRealtime('calendar', [{ table: 'events', invalidate: [qk.events] }]);

  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [formDate, setFormDate] = useState<Date | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const range = useMemo(() => {
    if (view === 'day') return { start: startOfDay(cursor), end: startOfDay(cursor) };
    if (view === 'week') {
      return {
        start: startOfWeek(cursor, { weekStartsOn: 1 }),
        end: endOfWeek(cursor, { weekStartsOn: 1 }),
      };
    }
    return {
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
    };
  }, [cursor, view]);

  const days = useMemo(
    () => eachDayOfInterval({ start: range.start, end: range.end }),
    [range.start, range.end],
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of events.data ?? []) {
      const start = startOfDay(new Date(e.starts_at));
      const end = startOfDay(new Date(e.ends_at));
      let d = start;
      let guard = 0;
      while (d <= end && guard < 400) {
        const key = format(d, 'yyyy-MM-dd');
        map.set(key, [...(map.get(key) ?? []), e]);
        d = addDays(d, 1);
        guard++;
      }
    }
    return map;
  }, [events.data]);

  function shift(dir: number) {
    if (view === 'month') setCursor((c) => addMonths(c, dir));
    else if (view === 'week') setCursor((c) => addWeeks(c, dir));
    else setCursor((c) => addDays(c, dir));
  }

  /** Mover un evento a otro día conservando su duración. */
  async function moveEvent(eventId: string, targetDay: Date) {
    const e = events.data?.find((x) => x.id === eventId);
    if (!e) return;
    const oldStart = new Date(e.starts_at);
    const delta = differenceInCalendarDays(targetDay, startOfDay(oldStart));
    if (delta === 0) return;

    const newStart = addDays(oldStart, delta);
    const newEnd = addDays(new Date(e.ends_at), delta);
    try {
      await updateEvent.mutateAsync({
        id: eventId,
        patch: { starts_at: newStart.toISOString(), ends_at: newEnd.toISOString() },
      });
      toast.success(`«${e.name}» movido a ${format(newStart, "d 'de' MMMM", { locale: es })}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido mover el evento');
    }
  }

  const title =
    view === 'month'
      ? format(cursor, 'MMMM yyyy', { locale: es })
      : view === 'week'
        ? `${format(range.start, 'd MMM', { locale: es })} – ${format(range.end, 'd MMM yyyy', { locale: es })}`
        : format(cursor, "EEEE d 'de' MMMM yyyy", { locale: es });

  return (
    <Page>
      <PageHeader
        title="Calendario"
        subtitle="Vista global de todos los eventos. Arrastra un evento para cambiar su fecha."
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'month', label: 'Mes' },
                { value: 'week', label: 'Semana' },
                { value: 'day', label: 'Día' },
              ]}
            />
            <Button
              variant="primary"
              icon={<Plus className="size-4" />}
              onClick={() => {
                setFormDate(new Date());
                setFormOpen(true);
              }}
            >
              Nuevo evento
            </Button>
          </>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        <Button size="icon" variant="outline" aria-label="Anterior" onClick={() => shift(-1)} icon={<ChevronLeft className="size-4" />} />
        <Button size="icon" variant="outline" aria-label="Siguiente" onClick={() => shift(1)} icon={<ChevronRight className="size-4" />} />
        <Button size="sm" variant="ghost" onClick={() => setCursor(new Date())}>
          Hoy
        </Button>
        <h2 className="ml-2 text-[15px] font-semibold capitalize tracking-tight text-ink">{title}</h2>
      </div>

      {events.isLoading ? (
        <LoadingState />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : view === 'month' ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line">
            {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => (
              <div key={d} className="px-2 py-2 text-center text-[11.5px] font-medium uppercase tracking-wider text-dim">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const list = eventsByDay.get(key) ?? [];
              const outside = !isSameMonth(day, cursor);
              return (
                <div
                  key={key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragging) void moveEvent(dragging, day);
                    setDragging(null);
                  }}
                  onDoubleClick={() => {
                    setFormDate(day);
                    setFormOpen(true);
                  }}
                  className={cn(
                    'min-h-[104px] border-b border-r border-line p-1.5 transition-colors last:border-r-0',
                    outside && 'opacity-40',
                    dragging && 'hover:bg-surface-2',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between px-1">
                    <span
                      className={cn(
                        'num grid size-6 place-items-center rounded-full text-[12px]',
                        isToday(day) ? 'bg-accent font-semibold text-accent-ink' : 'text-muted',
                      )}
                    >
                      {format(day, 'd')}
                    </span>
                  </div>

                  <div className="space-y-1">
                    {list.slice(0, 3).map((e) => (
                      <EventChip
                        key={`${key}-${e.id}`}
                        event={e}
                        onDragStart={() => setDragging(e.id)}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => navigate(`/eventos/${e.id}`)}
                      />
                    ))}
                    {list.length > 3 ? (
                      <p className="px-1 text-[11px] text-dim">+{list.length - 3} más</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <TimeGrid
          days={days}
          eventsByDay={eventsByDay}
          onOpen={(id) => navigate(`/eventos/${id}`)}
          onCreate={(d) => {
            setFormDate(d);
            setFormOpen(true);
          }}
        />
      )}

      <EventFormModal
        open={formOpen}
        defaultDate={formDate}
        onClose={(createdId) => {
          setFormOpen(false);
          if (createdId) navigate(`/eventos/${createdId}`);
        }}
      />
    </Page>
  );
}

function EventChip({
  event,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  event: EventRow;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      title={`${event.name} · ${EVENT_STATUS_LABEL[event.status]}`}
      className="grab block w-full truncate rounded-md px-1.5 py-1 text-left text-[11.5px] font-medium transition-transform hover:scale-[1.02]"
      style={{
        background: hexWithAlpha(event.color, 0.22),
        color: event.color,
        borderLeft: `2px solid ${event.color}`,
      }}
    >
      {event.name}
    </button>
  );
}

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 06:00 – 22:00

function TimeGrid({
  days,
  eventsByDay,
  onOpen,
  onCreate,
}: {
  days: Date[];
  eventsByDay: Map<string, EventRow[]>;
  onOpen: (id: string) => void;
  onCreate: (d: Date) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0,1fr))` }}>
        <div className="border-b border-r border-line" />
        {days.map((d) => (
          <div
            key={d.toISOString()}
            className="border-b border-r border-line px-2 py-2 text-center last:border-r-0"
          >
            <p className="text-[11.5px] uppercase tracking-wider text-dim">
              {format(d, 'EEE', { locale: es })}
            </p>
            <p
              className={cn(
                'num mx-auto mt-0.5 grid size-6 place-items-center rounded-full text-[12.5px]',
                isToday(d) ? 'bg-accent font-semibold text-accent-ink' : 'text-ink',
              )}
            >
              {format(d, 'd')}
            </p>
          </div>
        ))}

        {HOURS.map((h) => (
          <div key={h} className="contents">
            <div className="border-b border-r border-line px-2 py-1 text-right text-[11px] text-dim">
              {String(h).padStart(2, '0')}:00
            </div>
            {days.map((d) => {
              const list = (eventsByDay.get(format(d, 'yyyy-MM-dd')) ?? []).filter((e) => {
                const start = new Date(e.starts_at);
                const end = new Date(e.ends_at);
                const dayStart = isSameDay(start, d) ? start.getHours() : 0;
                const dayEnd = isSameDay(end, d) ? end.getHours() : 23;
                return h >= dayStart && h <= dayEnd;
              });
              return (
                <div
                  key={`${h}-${d.toISOString()}`}
                  onDoubleClick={() => onCreate(d)}
                  className="min-h-[38px] border-b border-r border-line p-0.5 last:border-r-0 hover:bg-surface-2"
                >
                  {list.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onOpen(e.id)}
                      className="mb-0.5 block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium"
                      style={{
                        background: hexWithAlpha(e.color, 0.2),
                        color: e.color,
                        borderLeft: `2px solid ${e.color}`,
                      }}
                    >
                      {e.name}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <p className="flex items-center gap-1.5 border-t border-line px-4 py-2.5 text-[12px] text-dim">
        <CalendarDays className="size-3.5" />
        Doble clic en una casilla para crear un evento ese día.
      </p>
    </Card>
  );
}
