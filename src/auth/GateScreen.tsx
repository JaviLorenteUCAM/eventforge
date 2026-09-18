import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, KeyRound, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Button, Input, LoadingState, Spinner } from '@/components/ui';
import { env } from '@/lib/env';
import { useAuth } from './AuthProvider';

/**
 * Pantalla de entrada privada.
 *   Paso 1 · Codigo de acceso del espacio de trabajo (una vez por dispositivo).
 *   Paso 2 · "¿Quien eres?" -> selección de perfil, sin contraseña.
 */
export function GateScreen() {
  const { accessCode, publicProfiles, loadingProfiles, unlock, signIn, refreshProfiles, lock } =
    useAuth();

  const [code, setCode] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [signingIn, setSigningIn] = useState<string | null>(null);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setUnlocking(true);
    try {
      await unlock(code);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido validar el código');
    } finally {
      setUnlocking(false);
    }
  }

  async function handleSignIn(id: string) {
    setSigningIn(id);
    try {
      await signIn(id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido iniciar sesión');
      setSigningIn(null);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10">
      <BackgroundGrid />

      <div className="relative w-full max-w-4xl">
        <header className="mb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-surface-2 text-accent-soft"
          >
            <ShieldCheck className="size-6" />
          </motion.div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            {env.appName}
          </h1>
          <p className="mt-1.5 text-sm text-muted">Gestión integral de eventos · acceso privado</p>
        </header>

        <AnimatePresence mode="wait">
          {!accessCode ? (
            <motion.form
              key="code"
              onSubmit={handleUnlock}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22 }}
              className="card mx-auto max-w-md p-6"
            >
              <div className="mb-4 flex items-center gap-3">
                <div className="grid size-9 place-items-center rounded-xl border border-line bg-surface-2 text-accent-soft">
                  <KeyRound className="size-4" />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-ink">Código de acceso</h2>
                  <p className="text-[12.5px] text-muted">Solo hace falta una vez por dispositivo.</p>
                </div>
              </div>

              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Introduce el código del equipo"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="h-12 text-center text-base tracking-[0.2em]"
              />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="mt-4 w-full justify-center"
                loading={unlocking}
                icon={<ArrowRight className="size-4" />}
              >
                Entrar
              </Button>

              <p className="mt-4 text-center text-[12px] leading-relaxed text-dim">
                El código se comprueba en el servidor. Sin él, la base de datos no devuelve ningún
                dato: todas las tablas están protegidas con Row Level Security.
              </p>
            </motion.form>
          ) : (
            <motion.div
              key="profiles"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22 }}
            >
              <div className="mb-6 text-center">
                <h2 className="text-lg font-semibold tracking-tight text-ink">¿Quién eres?</h2>
                <p className="mt-1 text-[13px] text-muted">
                  Selecciona tu perfil para entrar en el espacio de trabajo.
                </p>
              </div>

              {loadingProfiles && publicProfiles.length === 0 ? (
                <LoadingState label="Cargando perfiles…" />
              ) : publicProfiles.length === 0 ? (
                <div className="card mx-auto max-w-md p-6 text-center">
                  <p className="text-sm text-ink">Todavía no hay perfiles creados.</p>
                  <p className="mt-1.5 text-[13px] text-muted">
                    Ejecuta <code className="rounded bg-surface-2 px-1.5 py-0.5">npm run seed</code>{' '}
                    o crea los usuarios desde el panel de Supabase.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mx-auto mt-4"
                    icon={<RefreshCw className="size-3.5" />}
                    onClick={() => void refreshProfiles()}
                  >
                    Recargar
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {publicProfiles.map((p, index) => (
                    <motion.button
                      key={p.id}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05, duration: 0.25 }}
                      disabled={signingIn !== null}
                      onClick={() => void handleSignIn(p.id)}
                      className="card group relative flex flex-col items-center gap-3 p-5 transition-all hover:-translate-y-1 hover:border-line-strong disabled:opacity-60"
                    >
                      <span
                        className="pointer-events-none absolute inset-x-6 -top-px h-px opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ background: `linear-gradient(90deg, transparent, ${p.color}, transparent)` }}
                      />
                      <Avatar
                        name={p.name}
                        avatarUrl={p.avatar_url}
                        color={p.color}
                        size="xl"
                        className="transition-transform group-hover:scale-105"
                      />
                      <div className="text-center">
                        <p className="text-sm font-semibold text-ink">{p.name}</p>
                        <p className="mt-0.5 text-[12px] text-muted">{p.role_title || '—'}</p>
                      </div>
                      {signingIn === p.id ? (
                        <div className="absolute inset-0 grid place-items-center rounded-2xl bg-black/45">
                          <Spinner />
                        </div>
                      ) : null}
                    </motion.button>
                  ))}
                </div>
              )}

              <div className="mt-8 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Lock className="size-3.5" />}
                  onClick={() => void lock()}
                >
                  Cambiar código de acceso
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function BackgroundGrid() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-[0.35]"
      style={{
        backgroundImage:
          'linear-gradient(var(--ef-grid) 1px, transparent 1px), linear-gradient(90deg, var(--ef-grid) 1px, transparent 1px)',
        backgroundSize: '56px 56px',
        maskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)',
        WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, black, transparent)',
      }}
    />
  );
}
