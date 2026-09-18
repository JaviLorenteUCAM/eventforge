import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Circle, ListChecks, Plus, Timer, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  SearchInput,
  Segmented,
  Select,
  Textarea,
} from '@/components/ui';
import { useCreateTask, useDeleteTask, useTasks, useUpdateTask } from '@/data/tasks';
import { useProfiles } from '@/data/profiles';
import { useRealtime } from '@/data/realtime';
import { qk } from '@/data/keys';
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_COLOR,
  TASK_PRIORITY_LABEL,
  TASK_STATUSES,
  TASK_STATUS_LABEL,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '@/lib/types';
import { cn, fmtDate, normalize, relativeDay } from '@/lib/utils';

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  pending: <Circle className="size-4 text-dim" />,
  in_progress: <Timer className="size-4 text-warn" />,
  done: <CheckCircle2 className="size-4 text-ok" />,
};

export function TasksPage() {
  const { eventId } = useParams();
  const { profile } = useAuth();
  const tasks = useTasks(eventId);
  const profiles = useProfiles();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  useRealtime(
    `tasks-${eventId}`,
    [{ table: 'tasks', filter: `event_id=eq.${eventId}`, invalidate: [qk.tasks(eventId)] }],
    Boolean(eventId),
  );

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TaskStatus | 'all' | 'mine'>('all');
  const [editing, setEditing] = useState<Task | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Task | null>(null);

  const profileById = useMemo(
    () => new Map((profiles.data ?? []).map((p) => [p.id, p])),
    [profiles.data],
  );

  const filtered = useMemo(() => {
    const q = normalize(search);
    return (tasks.data ?? []).filter((t) => {
      if (filter === 'mine' && t.assignee_id !== profile?.id) return false;
      if (filter !== 'all' && filter !== 'mine' && t.status !== filter) return false;
      if (q && !normalize(`${t.title} ${t.description}`).includes(q)) return false;
      return true;
    });
  }, [tasks.data, search, filter, profile?.id]);

  const columns = useMemo(
    () =>
      TASK_STATUSES.map((status) => ({
        status,
        items: filtered.filter((t) => t.status === status),
      })),
    [filtered],
  );

  async function cycleStatus(task: Task) {
    const next: TaskStatus =
      task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    try {
      await updateTask.mutateAsync({ id: task.id, patch: { status: next } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido actualizar');
    }
  }

  async function handleDelete() {
    if (!toDelete || !eventId) return;
    try {
      await deleteTask.mutateAsync({ id: toDelete.id, eventId });
      toast.success('Tarea eliminada');
      setToDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido eliminar');
    }
  }

  const done = (tasks.data ?? []).filter((t) => t.status === 'done').length;

  return (
    <Page>
      <PageHeader
        title="Tareas"
        subtitle={`${done} de ${tasks.data?.length ?? 0} completadas`}
        actions={
          <Button
            variant="primary"
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Nueva tarea
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <SearchInput value={search} onChange={setSearch} className="min-w-[220px] flex-1" />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Todas' },
            { value: 'mine', label: 'Mías' },
            { value: 'pending', label: 'Pendientes' },
            { value: 'in_progress', label: 'En proceso' },
            { value: 'done', label: 'Hechas' },
          ]}
        />
      </div>

      {tasks.isLoading ? (
        <LoadingState />
      ) : tasks.isError ? (
        <ErrorState error={tasks.error} onRetry={() => void tasks.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No hay tareas"
          message="Crea tareas para repartir el trabajo del evento entre el equipo."
          icon={<ListChecks className="size-5" />}
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
              Nueva tarea
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {columns.map((col) => (
            <div key={col.status}>
              <div className="mb-2.5 flex items-center justify-between px-1">
                <h2 className="flex items-center gap-2 text-[12.5px] font-semibold uppercase tracking-[0.1em] text-dim">
                  {STATUS_ICON[col.status]}
                  {TASK_STATUS_LABEL[col.status]}
                </h2>
                <span className="num text-[12px] text-dim">{col.items.length}</span>
              </div>

              <div className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {col.items.map((t) => {
                    const owner = t.assignee_id ? profileById.get(t.assignee_id) : null;
                    const overdue =
                      t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date();
                    return (
                      <motion.div
                        key={t.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                      >
                        <Card className="group p-3.5">
                          <div className="flex items-start gap-2.5">
                            <button
                              onClick={() => void cycleStatus(t)}
                              title="Cambiar estado"
                              className="mt-0.5 shrink-0 transition-transform hover:scale-110"
                            >
                              {STATUS_ICON[t.status]}
                            </button>

                            <button
                              onClick={() => {
                                setEditing(t);
                                setFormOpen(true);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p
                                className={cn(
                                  'text-[13.5px] leading-snug text-ink',
                                  t.status === 'done' && 'text-muted line-through',
                                )}
                              >
                                {t.title}
                              </p>
                              {t.description ? (
                                <p className="mt-1 line-clamp-2 text-[12px] text-dim">{t.description}</p>
                              ) : null}
                            </button>

                            <button
                              onClick={() => setToDelete(t)}
                              aria-label="Eliminar tarea"
                              className="shrink-0 rounded-md p-1 text-dim opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>

                          <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6.5">
                            <Badge color={TASK_PRIORITY_COLOR[t.priority]}>
                              {TASK_PRIORITY_LABEL[t.priority]}
                            </Badge>
                            {t.due_date ? (
                              <span
                                className={cn(
                                  'text-[11.5px]',
                                  overdue ? 'font-medium text-danger' : 'text-dim',
                                )}
                                title={fmtDate(t.due_date)}
                              >
                                {relativeDay(t.due_date)}
                              </span>
                            ) : null}
                            {owner ? (
                              <Avatar
                                name={owner.name}
                                avatarUrl={owner.avatar_url}
                                color={owner.color}
                                size="xs"
                                className="ml-auto"
                              />
                            ) : null}
                          </div>
                        </Card>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {col.items.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-dim">
                    Sin tareas
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskFormModal
        open={formOpen}
        task={editing}
        eventId={eventId!}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onCreate={(v) => createTask.mutateAsync(v)}
        onUpdate={(id, patch) => updateTask.mutateAsync({ id, patch })}
        saving={createTask.isPending || updateTask.isPending}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void handleDelete()}
        loading={deleteTask.isPending}
        title="Eliminar tarea"
        message={<>Se eliminará «{toDelete?.title}». Esta acción no se puede deshacer.</>}
      />
    </Page>
  );
}

function TaskFormModal({
  open,
  task,
  eventId,
  onClose,
  onCreate,
  onUpdate,
  saving,
}: {
  open: boolean;
  task: Task | null;
  eventId: string;
  onClose: () => void;
  onCreate: (values: Partial<Task>) => Promise<unknown>;
  onUpdate: (id: string, patch: Partial<Task>) => Promise<unknown>;
  saving: boolean;
}) {
  const { profile } = useAuth();
  const profiles = useProfiles();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('pending');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setDescription(task?.description ?? '');
    setAssignee(task?.assignee_id ?? '');
    setPriority(task?.priority ?? 'medium');
    setStatus(task?.status ?? 'pending');
    setDueDate(task?.due_date ?? '');
    setError(null);
  }, [open, task]);

  async function submit() {
    if (!title.trim()) {
      setError('El título es obligatorio.');
      return;
    }
    const values: Partial<Task> = {
      title: title.trim(),
      description: description.trim(),
      assignee_id: assignee || null,
      priority,
      status,
      due_date: dueDate || null,
    };
    try {
      if (task) await onUpdate(task.id, values);
      else await onCreate({ ...values, event_id: eventId, created_by: profile?.id ?? null });
      toast.success(task ? 'Tarea actualizada' : 'Tarea creada');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? 'Editar tarea' : 'Nueva tarea'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={saving}>
            Guardar
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Título" required error={error} className="sm:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="Descripción" className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Responsable">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Sin asignar</option>
            {(profiles.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prioridad">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TASK_PRIORITY_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estado">
          <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha límite">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
