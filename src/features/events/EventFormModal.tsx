import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import {
  Avatar,
  Button,
  Checkbox,
  ColorPicker,
  Field,
  ImageUpload,
  Input,
  Modal,
  Select,
  Textarea,
} from '@/components/ui';
import { useCreateEvent, useEventMembers, useSetEventMembers, useUpdateEvent } from '@/data/events';
import { useProfiles } from '@/data/profiles';
import { useCreatePlan, usePlans } from '@/data/plans';
import { BUCKETS } from '@/lib/storage';
import { EVENT_STATUSES, EVENT_STATUS_LABEL, type EventRow, type EventStatus } from '@/lib/types';

/** ISO -> valor para <input type="datetime-local"> en hora local. */
function toLocalInput(iso: string | undefined) {
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string) {
  return new Date(value).toISOString();
}

export function EventFormModal({
  open,
  onClose,
  event,
  defaultDate,
}: {
  open: boolean;
  onClose: (createdId?: string) => void;
  event?: EventRow | null;
  defaultDate?: Date | null;
}) {
  const { profile } = useAuth();
  const profiles = useProfiles();
  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const setMembers = useSetEventMembers();
  const createPlan = useCreatePlan();
  const existingMembers = useEventMembers(event?.id);
  const plans = usePlans(event?.id);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [status, setStatus] = useState<EventStatus>('planning');
  const [color, setColor] = useState('#6366f1');
  const [notes, setNotes] = useState('');
  const [coverPath, setCoverPath] = useState<string | null>(null);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (event) {
      setName(event.name);
      setDescription(event.description);
      setLocation(event.location);
      setStartsAt(toLocalInput(event.starts_at));
      setEndsAt(toLocalInput(event.ends_at));
      setStatus(event.status);
      setColor(event.color);
      setNotes(event.notes);
      setCoverPath(event.cover_path);
    } else {
      const base = defaultDate ?? new Date();
      const start = new Date(base);
      start.setHours(9, 0, 0, 0);
      const end = new Date(start.getTime() + 8 * 3600 * 1000);
      setName('');
      setDescription('');
      setLocation('');
      setStartsAt(toLocalInput(start.toISOString()));
      setEndsAt(toLocalInput(end.toISOString()));
      setStatus('planning');
      setColor('#6366f1');
      setNotes('');
      setCoverPath(null);
      setMemberIds(profile ? [profile.id] : []);
    }
    setErrors({});
  }, [open, event, defaultDate, profile]);

  useEffect(() => {
    if (event && existingMembers.data) {
      setMemberIds(existingMembers.data.map((m) => m.profile_id));
    }
  }, [event, existingMembers.data]);

  function validate() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'El nombre es obligatorio.';
    if (!startsAt) e.startsAt = 'Indica la fecha de inicio.';
    if (!endsAt) e.endsAt = 'Indica la fecha de fin.';
    if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
      e.endsAt = 'La fecha de fin no puede ser anterior al inicio.';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;

    const values = {
      name: name.trim(),
      description: description.trim(),
      location: location.trim(),
      starts_at: fromLocalInput(startsAt),
      ends_at: fromLocalInput(endsAt),
      status,
      color,
      notes: notes.trim(),
      cover_path: coverPath,
    };

    try {
      if (event) {
        await updateEvent.mutateAsync({ id: event.id, patch: values });
        await setMembers.mutateAsync({ eventId: event.id, profileIds: memberIds });
        // Todo evento necesita al menos un plano para el editor.
        if (plans.data && plans.data.length === 0) {
          await createPlan.mutateAsync({ event_id: event.id, name: 'Plano principal', is_default: true });
        }
        toast.success('Evento actualizado');
        onClose();
      } else {
        const created = await createEvent.mutateAsync({ ...values, created_by: profile?.id ?? null });
        await setMembers.mutateAsync({ eventId: created.id, profileIds: memberIds });
        await createPlan.mutateAsync({ event_id: created.id, name: 'Plano principal', is_default: true });
        toast.success('Evento creado');
        onClose(created.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar el evento');
    }
  }

  const saving = createEvent.isPending || updateEvent.isPending || setMembers.isPending;

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      size="lg"
      title={event ? 'Editar evento' : 'Nuevo evento'}
      description={
        event ? 'Los cambios se guardan en la base de datos y los ven todos.' : 'Se creará también un plano vacío.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose()} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void handleSubmit()} loading={saving}>
            {event ? 'Guardar cambios' : 'Crear evento'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" required error={errors.name} className="sm:col-span-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Congreso Anual 2026" />
        </Field>

        <Field label="Ubicación" className="sm:col-span-2">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Madrid · IFEMA Pabellón 5" />
        </Field>

        <Field label="Inicio" required error={errors.startsAt}>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>

        <Field label="Fin" required error={errors.endsAt}>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>

        <Field label="Estado">
          <Select value={status} onChange={(e) => setStatus(e.target.value as EventStatus)}>
            {EVENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>

        <Field label="Descripción" className="sm:col-span-2">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>

        <Field label="Notas internas" className="sm:col-span-2">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>

        <div className="sm:col-span-2">
          <ImageUpload
            bucket={BUCKETS.eventMedia}
            folder={event?.id ?? 'nuevos'}
            path={coverPath}
            onChange={setCoverPath}
            label="Imagen de portada"
          />
        </div>

        <Field label="Responsables" hint="Solo los miembros pueden modificar este evento." className="sm:col-span-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {(profiles.data ?? []).map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3 py-2"
              >
                <Checkbox
                  label=""
                  checked={memberIds.includes(p.id)}
                  onChange={(e) =>
                    setMemberIds((prev) =>
                      e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                    )
                  }
                />
                <Avatar name={p.name} avatarUrl={p.avatar_url} color={p.color} size="xs" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">{p.name}</p>
                  <p className="truncate text-[11px] text-dim">{p.role_title}</p>
                </div>
              </label>
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}
