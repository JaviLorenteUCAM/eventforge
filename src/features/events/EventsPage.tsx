import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  CalendarClock,
  CalendarRange,
  Copy,
  MapPin,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import {
  AvatarStack,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Meter,
  Modal,
  SearchInput,
  Select,
} from '@/components/ui';
import { useDeleteEvent, useDuplicateEvent, useEvents } from '@/data/events';
import { useProfiles } from '@/data/profiles';
import { useTasks } from '@/data/tasks';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import { selectAll } from '@/data/api';
import { useQuery } from '@tanstack/react-query';
import {
  EVENT_STATUSES,
  EVENT_STATUS_COLOR,
  EVENT_STATUS_LABEL,
  type EventMember,
  type EventRow,
  type EventStatus,
} from '@/lib/types';
import { BUCKETS, resolveUrl } from '@/lib/storage';
import { fmtDateRange, normalize, relativeDay } from '@/lib/utils';
import { EventFormModal } from './EventFormModal';

type SortKey = 'date_asc' | 'date_desc' | 'name' | 'status';

export function EventsPage() {
  const [params, setParams] = useSearchParams();
  const events = useEvents();
  const tasks = useTasks();
  const profiles = useProfiles();
  const deleteEvent = useDeleteEvent();

  const allMembers = useQuery({
    queryKey: ['event-members', 'all'],
    queryFn: () => selectAll<EventMember>('event_members'),
  });

  useRealtime('events-page', [
    { table: 'events', invalidate: [qk.events] },
    { table: 'event_members', invalidate: [['event-members', 'all']] },
  ]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EventStatus | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('date_asc');
  const [editing, setEditing] = useState<EventRow | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<EventRow | null>(null);
  const [toDuplicate, setToDuplicate] = useState<EventRow | null>(null);

  useEffect(() => {
    if (params.get('nuevo') === '1') {
      setEditing(null);
      setFormOpen(true);
      params.delete('nuevo');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const progress = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const t of tasks.data ?? []) {
      const e = map.get(t.event_id) ?? { total: 0, done: 0 };
      e.total += 1;
      if (t.status === 'done') e.done += 1;
      map.set(t.event_id, e);
    }
    return map;
  }, [tasks.data]);

  const membersByEvent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of allMembers.data ?? []) {
      map.set(m.event_id, [...(map.get(m.event_id) ?? []), m.profile_id]);
    }
    return map;
  }, [allMembers.data]);

  const profileById = useMemo(
    () => new Map((profiles.data ?? []).map((p) => [p.id, p])),
    [profiles.data],
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    let list = (events.data ?? []).filter((e) => {
      if (status !== 'all' && e.status !== status) return false;
      if (!q) return true;
      return normalize(`${e.name} ${e.location} ${e.description}`).includes(q);
    });

    list = [...list].sort((a, b) => {
      switch (sort) {
        case 'date_desc':
          return +new Date(b.starts_at) - +new Date(a.starts_at);
        case 'name':
          return a.name.localeCompare(b.name, 'es');
        case 'status':
          return EVENT_STATUSES.indexOf(a.status) - EVENT_STATUSES.indexOf(b.status);
        default:
          return +new Date(a.starts_at) - +new Date(b.starts_at);
      }
    });
    return list;
  }, [events.data, search, status, sort]);

  async function handleDelete() {
    if (!toDelete) return;
    try {
      await deleteEvent.mutateAsync(toDelete.id);
      toast.success('Evento eliminado');
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }

  return (
    <Page>
      <PageHeader
        title="Eventos"
        subtitle={`${filtered.length} de ${events.data?.length ?? 0} eventos`}
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Nuevo evento
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nombre, lugar o descripción…"
          className="min-w-[240px] flex-1"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as EventStatus | 'all')}
          className="w-auto min-w-[150px]"
        >
          <option value="all">Todos los estados</option>
          {EVENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {EVENT_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="w-auto min-w-[160px]"
        >
          <option value="date_asc">Fecha ↑</option>
          <option value="date_desc">Fecha ↓</option>
          <option value="name">Nombre A–Z</option>
          <option value="status">Estado</option>
        </Select>
      </div>

      {events.isLoading ? (
        <LoadingState />
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={events.data?.length ? 'Ningún evento coincide con el filtro' : 'Todavía no hay eventos'}
          message={
            events.data?.length
              ? 'Prueba a cambiar la búsqueda o el estado seleccionado.'
              : 'Crea el primero y empieza a planificar plano, material y transporte.'
          }
          icon={<CalendarRange className="size-5" />}
          action={
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="size-3.5" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Nuevo evento
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e, i) => {
            const p = progress.get(e.id);
            const pct = p && p.total ? Math.round((p.done / p.total) * 100) : 0;
            const people = (membersByEvent.get(e.id) ?? [])
              .map((id) => profileById.get(id))
              .filter(Boolean)
              .map((x) => ({ id: x!.id, name: x!.name, avatar_url: x!.avatar_url, color: x!.color }));

            return (
              <motion.div
                key={e.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3) }}
              >
                <Card className="group flex h-full flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:border-line-strong">
                  <Link to={`/eventos/${e.id}`} className="block">
                    <EventCover path={e.cover_path} color={e.color} />
                  </Link>

                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/eventos/${e.id}`} className="min-w-0">
                        <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink hover:text-accent-soft">
                          {e.name}
                        </h3>
                      </Link>
                      <EventMenu
                        onEdit={() => {
                          setEditing(e);
                          setFormOpen(true);
                        }}
                        onDuplicate={() => setToDuplicate(e)}
                        onDelete={() => setToDelete(e)}
                      />
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" />
                        {fmtDateRange(e.starts_at, e.ends_at)}
                      </span>
                      {e.location ? (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">{e.location}</span>
                        </span>
                      ) : null}
                    </div>

                    {e.description ? (
                      <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-dim">
                        {e.description}
                      </p>
                    ) : null}

                    <div className="mt-3 flex items-center gap-2">
                      <Badge color={EVENT_STATUS_COLOR[e.status]} dot>
                        {EVENT_STATUS_LABEL[e.status]}
                      </Badge>
                      <span className="text-[11.5px] text-dim">{relativeDay(e.starts_at)}</span>
                    </div>

                    <div className="mt-auto pt-4">
                      <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-dim">
                        <span>Preparación · {p?.done ?? 0}/{p?.total ?? 0} tareas</span>
                        <span className="num text-muted">{pct}%</span>
                      </div>
                      <Meter value={pct} color={e.color} height={6} />
                      {people.length ? <AvatarStack people={people} size="xs" /> : null}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <EventFormModal
        open={formOpen}
        event={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void handleDelete()}
        loading={deleteEvent.isPending}
        title="Eliminar evento"
        message={
          <>
            Se eliminará <strong className="text-ink">{toDelete?.name}</strong> junto con su plano,
            horarios, tareas y cargas de transporte. Esta acción no se puede deshacer.
          </>
        }
      />

      <DuplicateModal event={toDuplicate} onClose={() => setToDuplicate(null)} />
    </Page>
  );
}

function EventCover({ path, color }: { path: string | null; color: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void resolveUrl(BUCKETS.eventMedia, path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return (
    <div
      className="relative h-28 w-full overflow-hidden"
      style={{
        background: url
          ? undefined
          : `linear-gradient(130deg, color-mix(in oklab, ${color} 55%, transparent), color-mix(in oklab, ${color} 12%, transparent))`,
      }}
    >
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" /> : null}
      <div className="absolute inset-0 bg-gradient-to-t from-[var(--ef-canvas)]/70 to-transparent" />
    </div>
  );
}

function EventMenu({
  onEdit,
  onDuplicate,
  onDelete,
}: {
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        aria-label="Acciones del evento"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-lg p-1.5 text-dim transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <MoreHorizontal className="size-4" />
      </button>

      {open ? (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-8 z-20 w-44 overflow-hidden rounded-xl border border-line bg-[var(--ef-surface-solid)] py-1 shadow-xl"
        >
          <MenuItem icon={<Pencil className="size-3.5" />} onClick={() => { setOpen(false); onEdit(); }}>
            Editar
          </MenuItem>
          <MenuItem icon={<Copy className="size-3.5" />} onClick={() => { setOpen(false); onDuplicate(); }}>
            Duplicar
          </MenuItem>
          <MenuItem
            icon={<Trash2 className="size-3.5" />}
            danger
            onClick={() => { setOpen(false); onDelete(); }}
          >
            Eliminar
          </MenuItem>
        </div>
      ) : null}
    </div>
  );
}

function MenuItem({
  children,
  icon,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-2 ${
        danger ? 'text-danger' : 'text-ink'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function DuplicateModal({ event, onClose }: { event: EventRow | null; onClose: () => void }) {
  const duplicate = useDuplicateEvent();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (!event) return;
    setName(`${event.name} (copia)`);
    const d = new Date(event.starts_at);
    const pad = (n: number) => String(n).padStart(2, '0');
    setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
  }, [event]);

  async function run() {
    if (!event) return;
    try {
      await duplicate.mutateAsync({
        id: event.id,
        name: name.trim(),
        startsAt: new Date(date).toISOString(),
      });
      toast.success('Evento duplicado con su plano, horarios y tareas');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido duplicar');
    }
  }

  return (
    <Modal
      open={Boolean(event)}
      onClose={onClose}
      size="sm"
      title="Duplicar evento"
      description="Se copian plano, objetos, conexiones, horarios, tareas y transporte."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={duplicate.isPending}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={duplicate.isPending}>
            Duplicar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-muted">Nombre de la copia</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-muted">Nueva fecha de inicio</label>
          <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          <p className="text-[12px] text-dim">
            Las fechas de horarios y tareas se desplazan automáticamente.
          </p>
        </div>
      </div>
    </Modal>
  );
}
