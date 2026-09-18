import { Database, HardDrive, KeyRound, Moon, ShieldCheck, Sun, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/auth/AuthProvider';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { Avatar, Badge, Button, Card, CardHeader, Checkbox, Segmented } from '@/components/ui';
import { useProfiles, useSetProfileActive } from '@/data/profiles';
import { env } from '@/lib/env';
import { useUi } from '@/store/ui';

export function SettingsPage() {
  const { profile, lock, session } = useAuth();
  const profiles = useProfiles();
  const setActive = useSetProfileActive();
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);

  const host = (() => {
    try {
      return new URL(env.supabaseUrl).host;
    } catch {
      return env.supabaseUrl;
    }
  })();

  return (
    <Page>
      <PageHeader title="Configuración" subtitle="Preferencias del dispositivo y del espacio de trabajo" />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Apariencia"
            subtitle="Se guarda solo en este dispositivo"
            icon={theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
          />
          <div className="px-5 pb-5">
            <Segmented
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark', label: 'Oscuro', icon: <Moon className="size-3.5" /> },
                { value: 'light', label: 'Claro', icon: <Sun className="size-3.5" /> },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Acceso" subtitle="Sesión y código del espacio" icon={<KeyRound className="size-4" />} />
          <div className="space-y-3 px-5 pb-5">
            <Row label="Perfil activo" value={profile?.name ?? '—'} />
            <Row
              label="Sesión"
              value={
                session?.expires_at
                  ? `Válida hasta ${new Date(session.expires_at * 1000).toLocaleString('es-ES')}`
                  : 'Activa'
              }
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void lock();
                toast.success('Se volverá a pedir el código en este dispositivo');
              }}
            >
              Olvidar el código en este dispositivo
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Infraestructura"
            subtitle="Dónde viven realmente tus datos"
            icon={<Database className="size-4" />}
          />
          <div className="space-y-3 px-5 pb-5">
            <Row label="Base de datos" value={`PostgreSQL · ${host}`} />
            <Row label="Almacenamiento" value="Supabase Storage (4 buckets)" />
            <Row label="Autenticación" value="Supabase Auth + código de acceso" />
            <Row label="Seguridad" value="Row Level Security activa en todas las tablas" />
            <p className="flex items-start gap-2 rounded-xl border border-line bg-surface-2 p-3 text-[12.5px] leading-relaxed text-muted">
              <HardDrive className="mt-0.5 size-4 shrink-0 text-accent-soft" />
              Las copias de seguridad y la recuperación están documentadas en{' '}
              <code className="rounded bg-surface px-1">docs/BACKUP.md</code>.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Perfiles del equipo"
            subtitle={profile?.is_admin ? 'Puedes activar o desactivar perfiles' : 'Solo lectura'}
            icon={<Users className="size-4" />}
          />
          <div className="space-y-2.5 px-5 pb-5">
            {(profiles.data ?? []).map((p) => (
              <div key={p.id} className="flex items-center gap-2.5">
                <Avatar name={p.name} avatarUrl={p.avatar_url} color={p.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-ink">{p.name}</p>
                  <p className="truncate text-[11.5px] text-dim">{p.role_title || '—'}</p>
                </div>
                {p.is_admin ? (
                  <Badge color="#6366f1">
                    <ShieldCheck className="size-3" /> Admin
                  </Badge>
                ) : null}
                <Checkbox
                  label="Activo"
                  checked={p.is_active}
                  disabled={!profile?.is_admin || setActive.isPending}
                  onChange={(e) => {
                    setActive.mutate(
                      { id: p.id, active: e.target.checked },
                      {
                        onSuccess: () => toast.success('Perfil actualizado'),
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : 'No se ha podido actualizar'),
                      },
                    );
                  }}
                />
              </div>
            ))}
            <p className="pt-1 text-[12px] leading-relaxed text-dim">
              El alta de nuevos perfiles se hace con <code className="rounded bg-surface-2 px-1">npm run seed</code>{' '}
              o desde el panel de Supabase (Authentication → Users). Está explicado en el README.
            </p>
          </div>
        </Card>
      </div>
    </Page>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}
