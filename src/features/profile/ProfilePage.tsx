import { useEffect, useState } from 'react';
import { Check, ShieldCheck, UserCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  ColorPicker,
  Field,
  ImageUpload,
  Input,
  LoadingState,
} from '@/components/ui';
import { useProfiles, useUpdateProfile } from '@/data/profiles';
import { BUCKETS } from '@/lib/storage';

export function ProfilePage() {
  const { profile, reloadProfile } = useAuth();
  const profiles = useProfiles();
  const update = useUpdateProfile();

  const [name, setName] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setRoleTitle(profile.role_title);
    setColor(profile.color);
    setAvatarPath(profile.avatar_url);
  }, [profile]);

  if (!profile) return <LoadingState />;

  const dirty =
    name !== profile.name ||
    roleTitle !== profile.role_title ||
    color !== profile.color ||
    avatarPath !== profile.avatar_url;

  async function save() {
    if (!profile) return;
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    try {
      await update.mutateAsync({
        id: profile.id,
        patch: { name: name.trim(), role_title: roleTitle.trim(), color, avatar_url: avatarPath },
      });
      await reloadProfile();
      toast.success('Perfil actualizado');
      setError(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar');
    }
  }

  return (
    <Page>
      <PageHeader title="Mi perfil" subtitle="Tus datos se guardan en el servidor y los ve todo el equipo." />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Datos del perfil" icon={<UserCircle2 className="size-4" />} />
          <div className="grid gap-5 px-5 pb-5 sm:grid-cols-[180px_1fr]">
            <div className="space-y-3">
              <div className="flex justify-center">
                <Avatar name={name || profile.name} avatarUrl={avatarPath} color={color} size="2xl" ring />
              </div>
              <ImageUpload
                bucket={BUCKETS.avatars}
                folder={profile.id}
                path={avatarPath}
                onChange={setAvatarPath}
                label="Foto"
                aspect="square"
                rounded="rounded-full"
                className="[&_p]:text-center"
              />
            </div>

            <div className="space-y-4">
              <Field label="Nombre" required error={error}>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Cargo">
                <Input
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="Producción, Técnica, Diseño…"
                />
              </Field>
              <Field label="Color personal" hint="Se usa en avatares y etiquetas.">
                <ColorPicker value={color} onChange={setColor} />
              </Field>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="primary"
                  onClick={() => void save()}
                  loading={update.isPending}
                  disabled={!dirty}
                  icon={<Check className="size-4" />}
                >
                  Guardar cambios
                </Button>
                {profile.is_admin ? (
                  <Badge color="#6366f1">
                    <ShieldCheck className="size-3" /> Administrador
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Equipo" subtitle={`${profiles.data?.length ?? 0} perfiles`} />
          <div className="space-y-2.5 px-5 pb-5">
            {(profiles.data ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-2.5">
                <Avatar name={p.name} avatarUrl={p.avatar_url} color={p.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">
                    {p.name}
                    {p.id === profile.id ? <span className="ml-1 text-dim">(tú)</span> : null}
                  </p>
                  <p className="truncate text-[11.5px] text-dim">{p.role_title || '—'}</p>
                </div>
                {!p.is_active ? <Badge color="#64748b">Inactivo</Badge> : null}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Page>
  );
}
