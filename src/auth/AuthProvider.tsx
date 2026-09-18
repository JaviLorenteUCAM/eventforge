import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { callAccess, supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';

/**
 * Acceso privado en dos pasos:
 *
 *   1. CODIGO DE ACCESO del espacio de trabajo. Se valida en la Edge Function
 *      `access` (nunca en el navegador) y se recuerda por dispositivo.
 *   2. SELECCION DE PERFIL. La funcion emite un magic-link de un solo uso que
 *      el navegador canjea por una sesion real de Supabase Auth.
 *
 * A partir de ahi, todas las consultas viajan con un JWT y la seguridad la
 * aplica PostgreSQL con Row Level Security.
 */

const CODE_KEY = 'eventforge.accessCode';

export interface PublicProfile {
  id: string;
  name: string;
  role_title: string;
  avatar_url: string | null;
  color: string;
  is_active: boolean;
}

interface AuthContextValue {
  /** true mientras se restaura la sesion al abrir la app. */
  booting: boolean;
  /** Codigo de acceso validado en este dispositivo. */
  accessCode: string | null;
  /** Perfiles disponibles para la pantalla "¿quién eres?". */
  publicProfiles: PublicProfile[];
  loadingProfiles: boolean;
  session: Session | null;
  profile: Profile | null;
  /** Valida el codigo y carga la lista de perfiles. */
  unlock: (code: string) => Promise<void>;
  /** Vuelve a pedir el codigo en este dispositivo. */
  lock: () => Promise<void>;
  /** Refresca la lista de perfiles con el codigo ya validado. */
  refreshProfiles: () => Promise<void>;
  /** Inicia sesion como el perfil indicado. */
  signIn: (profileId: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Recarga el perfil propio desde la base de datos. */
  reloadProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [accessCode, setAccessCode] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CODE_KEY);
    } catch {
      return null;
    }
  });
  const [publicProfiles, setPublicProfiles] = useState<PublicProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (mounted.current) setProfile((data as Profile | null) ?? null);
  }, []);

  // Restaurar sesion + escuchar cambios ------------------------------------
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session ?? null);
      if (data.session?.user?.id) await loadProfile(data.session.user.id);
      if (!cancelled) setBooting(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession?.user?.id) {
        void loadProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const fetchProfiles = useCallback(async (code: string) => {
    setLoadingProfiles(true);
    try {
      const res = await callAccess<{ profiles: PublicProfile[] }>({ action: 'list', code });
      if (mounted.current) setPublicProfiles(res.profiles ?? []);
    } finally {
      if (mounted.current) setLoadingProfiles(false);
    }
  }, []);

  // Con el codigo ya guardado, precargar los perfiles al arrancar.
  useEffect(() => {
    if (!accessCode || session) return;
    fetchProfiles(accessCode).catch(() => {
      // Codigo caducado o cambiado en el servidor: hay que volver a pedirlo.
      try {
        localStorage.removeItem(CODE_KEY);
      } catch {
        /* almacenamiento no disponible */
      }
      setAccessCode(null);
    });
  }, [accessCode, session, fetchProfiles]);

  const unlock = useCallback(
    async (code: string) => {
      const clean = code.trim();
      await fetchProfiles(clean);
      try {
        localStorage.setItem(CODE_KEY, clean);
      } catch {
        /* modo privado: seguimos en memoria */
      }
      setAccessCode(clean);
    },
    [fetchProfiles],
  );

  const lock = useCallback(async () => {
    await supabase.auth.signOut();
    try {
      localStorage.removeItem(CODE_KEY);
    } catch {
      /* ignore */
    }
    setAccessCode(null);
    setPublicProfiles([]);
  }, []);

  const refreshProfiles = useCallback(async () => {
    if (accessCode) await fetchProfiles(accessCode);
  }, [accessCode, fetchProfiles]);

  const signIn = useCallback(
    async (profileId: string) => {
      if (!accessCode) throw new Error('Introduce primero el código de acceso.');

      const res = await callAccess<{ email: string; tokenHash: string }>({
        action: 'login',
        code: accessCode,
        profileId,
      });

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: res.tokenHash,
        type: 'magiclink',
      });
      if (error) throw error;

      setSession(data.session ?? null);
      if (data.session?.user?.id) await loadProfile(data.session.user.id);
    },
    [accessCode, loadProfile],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
  }, []);

  const reloadProfile = useCallback(async () => {
    if (session?.user?.id) await loadProfile(session.user.id);
  }, [session, loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      booting,
      accessCode,
      publicProfiles,
      loadingProfiles,
      session,
      profile,
      unlock,
      lock,
      refreshProfiles,
      signIn,
      signOut,
      reloadProfile,
    }),
    [
      booting,
      accessCode,
      publicProfiles,
      loadingProfiles,
      session,
      profile,
      unlock,
      lock,
      refreshProfiles,
      signIn,
      signOut,
      reloadProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
