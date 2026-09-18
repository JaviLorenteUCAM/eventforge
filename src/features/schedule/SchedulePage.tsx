import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Clock, Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  ColorPicker,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  Textarea,
} from '@/components/ui';
import {
  useActivityMembers,
  useCreateActivity,
  useDeleteActivity,
  useDuplicateActivity,
  useScheduleActivities,
  useScheduleDays,
  useSetDayCount,
  useUpdateActivity,
  useUpdateDay,
} from '@/data/schedule';
import { useEvent } from '@/data/events';
import { useProfiles } from '@/data/profiles';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import type { ScheduleActivity } from '@/lib/types';
import { durationLabel, fmtDate, hhmm, timeToMinutes } from '@/lib/utils';

export function SchedulePage() {
  const { eventId } = useParams();
  const event = useEvent(eventId);
  const days = useScheduleDays(eventId);
  const activities = useScheduleActivities(eventId);
  const members = useActivityMembers(eventId);
  const profiles = useProfiles();

  const setDayCount = useSetDayCount();
  const updateDay = useUpdateDay();
  const deleteActivity = useDeleteActivity();
  const duplicateActivity = useDuplicateActivity();

  useRealtime(
    `schedule-${eventId}`,
    [
      { table: 'schedule_days', filter: `event_id=eq.${eventId}`, invalidate: [qk.scheduleDays(eventId ?? '')] },
      {
        table: 'schedule_activities',
        filter: `event_id=eq.${eventId}`,
        invalidate: [qk.scheduleActivities(eventId ?? '')],
      },
    ],
    Boolean(eventId),
  );

  const [dayCount, setDayCountInput] = useState(1);
  const [editing, setEditing] = useState<ScheduleActivity | null>(null);
  const [formDayId, setFormDayId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ScheduleActivity | null>(null);
  const [duplicating, setDuplicating] = useState<ScheduleActivity | null>(null);

  useEffect(() => {
    if (days.data) setDayCountInput(Math.max(1, days.data.length));
  }, [days.data]);

  const profileById = useMemo(
    () => new Map((profiles.data ?? []).map((p) => [p.id, p])),
    [profiles.data],
  );

  const membersByActivity = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of members.data ?? []) {
      map.set(m.activity_id, [...(map.get(m.activity_id) ?? []), m.profile_id]);
    }
    return map;
  }, [members.data]);

  const byDay = useMemo(() => {
    const map = new Map<string, ScheduleActivity[]>();
    for (const a of activities.data ?? []) {
      map.set(a.day_id, [...(map.get(a.day_id) ?? []), a]);
    }
    for (const list of map.values()) {
      list.sort((x, y) => timeToMinutes(x.starts_at) - timeToMinutes(y.starts_at));
    }
    return map;
  }, [activities.data]);

  async function applyDayCount(n: number) {
    if (!eventId) return;
    try {
      await setDayCount.mutateAsync({
        eventId,
        count: Math.max(1, Math.min(60, n)),
        startDate: event.data?.starts_at ?? null,
      });
      toast.success('Días actualizados');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido actualizar');
    }
  }

  async function handleDelete() {
    if (!toDelete || !eventId) return;
    try {
      await deleteActivity.mutateAsync({ id: toDelete.id, eventId });
      toast.success('Actividad eliminada');
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }

  if (days.isLoading) return <LoadingState />;

  return (
    <Page>
      <PageHeader
        title="Horarios"
        subtitle={`${days.data?.length ?? 0} días · ${activities.data?.length ?? 0} actividades`}
        actions={
          <div className="flex items-center gap-2">
            <label className="text-[12.5px] text-muted">Número de días</label>
            <Input
              type="number"
              min={1}
              max={60}
              value={dayCount}
              onChange={(e) => setDayCountInput(Number(e.target.value))}
              className="h-9 w-20 text-center"
            />
            <Button
              variant="outline"
              size="sm"
              loading={setDayCount.isPending}
              onClick={() => void applyDayCount(dayCount)}
            >
              Generar
            </Button>
          </div>
        }
      />

      {(days.data ?? []).length === 0 ? (
        <EmptyState
          title="Sin días definidos"
          message="Indica cuántos días dura el evento y genera la estructura de horarios."
          icon={<CalendarDays className="size-5" />}
          action={
            <Button size="sm" variant="primary" onClick={() => void applyDayCount(dayCount)}>
              Generar {dayCount} día{dayCount > 1 ? 's' : ''}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(days.data ?? []).map((day) => {
            const list = byDay.get(day.id) ?? [];
            return (
              <Card key={day.id} className="flex flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <div className="min-w-0">
                    <input
                      value={day.label}
                      onChange={(e) =>
                        updateDay.mutate({
                          id: day.id,
                          eventId: eventId!,
                          patch: { label: e.target.value },
                        })
                      }
                      className="w-full bg-transparent text-[14px] font-semibold tracking-tight text-ink outline-none focus:text-accent-soft"
                    />
                    <p className="text-[11.5px] text-dim">
                      {day.date ? fmtDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' }) : `Día ${day.day_index}`}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Añadir actividad"
                    title="Añadir actividad"
                    icon={<Plus className="size-4" />}
                    onClick={() => {
                      setEditing(null);
                      setFormDayId(day.id);
                    }}
                  />
                </div>

                <div className="min-h-[120px] flex-1 space-y-2 p-3">
                  <AnimatePresence initial={false}>
                    {list.map((a) => {
                      const people = (membersByActivity.get(a.id) ?? [])
                        .map((id) => profileById.get(id))
                        .filter(Boolean);
                      return (
                        <motion.div
                          key={a.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.97 }}
                          className="group relative overflow-hidden rounded-xl border border-line bg-surface-2 p-3"
                        >
                          <span
                            className="absolute inset-y-0 left-0 w-1"
                            style={{ background: a.color }}
                          />
                          <div className="pl-2">
                            <div className="flex items-start justify-between gap-2">
                              <p className="min-w-0 truncate text-[13.5px] font-medium text-ink">
                                {a.title}
                              </p>
                              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                <IconMini label="Editar" onClick={() => { setEditing(a); setFormDayId(a.day_id); }}>
                                  <Pencil className="size-3.5" />
                                </IconMini>
                                <IconMini label="Duplicar" onClick={() => setDuplicating(a)}>
                                  <Copy className="size-3.5" />
                                </IconMini>
                                <IconMini label="Eliminar" danger onClick={() => setToDelete(a)}>
                                  <Trash2 className="size-3.5" />
                                </IconMini>
                              </div>
                            </div>

                            <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted">
                              <Clock className="size-3" />
                              {hhmm(a.starts_at)}–{hhmm(a.ends_at)}
                              <span className="text-dim">· {durationLabel(a.starts_at, a.ends_at)}</span>
                            </p>

                            {a.description ? (
                              <p className="mt-1.5 line-clamp-2 text-[12px] text-dim">{a.description}</p>
                            ) : null}

                            {people.length ? (
                              <div className="mt-2 flex items-center -space-x-1.5">
                                {people.map((p) => (
                                  <Avatar
                                    key={p!.id}
                                    name={p!.name}
                                    avatarUrl={p!.avatar_url}
                                    color={p!.color}
                                    size="xs"
                                    className="border-2 border-[var(--ef-surface-solid)]"
                                  />
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  {list.length === 0 ? (
                    <button
                      onClick={() => {
                        setEditing(null);
                        setFormDayId(day.id);
                      }}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-6 text-[12.5px] text-dim transition-colors hover:border-line-strong hover:text-muted"
                    >
                      <Plus className="size-3.5" /> Añadir actividad
                    </button>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ActivityModal
        open={Boolean(formDayId)}
        eventId={eventId!}
        dayId={formDayId}
        activity={editing}
        memberIds={editing ? (membersByActivity.get(editing.id) ?? []) : []}
        onClose={() => {
          setFormDayId(null);
          setEditing(null);
        }}
      />

      <DuplicateActivityModal
        activity={duplicating}
        days={days.data ?? []}
        memberIds={duplicating ? (membersByActivity.get(duplicating.id) ?? []) : []}
        onClose={() => setDuplicating(null)}
        run={duplicateActivity}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void handleDelete()}
        loading={deleteActivity.isPending}
        title="Eliminar actividad"
        message={<>Se eliminará «{toDelete?.title}».</>}
      />
    </Page>
  );
}

function IconMini({
  children,
  label,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`rounded-md p-1 text-dim transition-colors hover:bg-surface ${danger ? 'hover:text-danger' : 'hover:text-ink'}`}
    >
      {children}
    </button>
  );
}

function ActivityModal({
  open,
  eventId,
  dayId,
  activity,
  memberIds,
  onClose,
}: {
  open: boolean;
  eventId: string;
  dayId: string | null;
  activity: ScheduleActivity | null;
  memberIds: string[];
  onClose: () => void;
}) {
  const profiles = useProfiles();
  const create = useCreateActivity();
  const update = useUpdateActivity();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [color, setColor] = useState('#6366f1');
  const [notes, setNotes] = useState('');
  const [people, setPeople] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(activity?.title ?? '');
    setDescription(activity?.description ?? '');
    setStart(hhmm(activity?.starts_at ?? '09:00'));
    setEnd(hhmm(activity?.ends_at ?? '10:00'));
    setColor(activity?.color ?? '#6366f1');
    setNotes(activity?.notes ?? '');
    setPeople(memberIds);
    setError(null);
    // memberIds llega como array nuevo en cada render: lo comparamos por contenido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activity, memberIds.join(',')]);

  async function submit() {
    if (!title.trim()) return setError('El título es obligatorio.');
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      return setError('La hora de fin debe ser posterior a la de inicio.');
    }

    const values = {
      title: title.trim(),
      description: description.trim(),
      starts_at: start,
      ends_at: end,
      color,
      notes: notes.trim(),
    };

    try {
      if (activity) {
        await update.mutateAsync({ id: activity.id, patch: values, memberIds: people });
      } else {
        await create.mutateAsync({
          values: { ...values, event_id: eventId, day_id: dayId! },
          memberIds: people,
        });
      }
      toast.success(activity ? 'Actividad actualizada' : 'Actividad creada');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={activity ? 'Editar actividad' : 'Nueva actividad'}
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
        <Field label="Título" required error={error} className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Montaje de escenario" />
        </Field>
        <Field label="Inicio" required>
          <Input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Fin" required>
          <Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Descripción" className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <Field label="Notas" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <Field label="Color" className="sm:col-span-2">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label="Responsables" className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {(profiles.data ?? []).map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2"
              >
                <Checkbox
                  label=""
                  checked={people.includes(p.id)}
                  onChange={(e) =>
                    setPeople((prev) =>
                      e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                    )
                  }
                />
                <Avatar name={p.name} avatarUrl={p.avatar_url} color={p.color} size="xs" />
                <span className="truncate text-[13px] text-ink">{p.name}</span>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function DuplicateActivityModal({
  activity,
  days,
  memberIds,
  onClose,
  run,
}: {
  activity: ScheduleActivity | null;
  days: { id: string; day_index: number; label: string }[];
  memberIds: string[];
  onClose: () => void;
  run: ReturnType<typeof useDuplicateActivity>;
}) {
  const [target, setTarget] = useState('');

  useEffect(() => {
    if (activity) setTarget(activity.day_id);
  }, [activity]);

  async function submit() {
    if (!activity) return;
    try {
      await run.mutateAsync({ activity, targetDayId: target, memberIds });
      toast.success('Actividad duplicada');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido duplicar');
    }
  }

  return (
    <Modal
      open={Boolean(activity)}
      onClose={onClose}
      size="sm"
      title="Duplicar actividad"
      description="La copia es independiente: editar una no afecta a la otra."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={run.isPending}>
            Duplicar
          </Button>
        </>
      }
    >
      <Field label="Día de destino">
        <Select value={target} onChange={(e) => setTarget(e.target.value)}>
          {days.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label || `Día ${d.day_index}`}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}
