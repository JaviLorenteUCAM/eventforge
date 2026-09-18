import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, isConfigured } from './env';

/**
 * Cliente unico de Supabase.
 *
 * - Fuente de verdad: PostgreSQL remoto. El navegador solo cachea.
 * - La sesion se guarda en localStorage (es un JWT firmado por Supabase, no
 *   datos de negocio) y se refresca sola.
 */
export const supabase: SupabaseClient = createClient(
  env.supabaseUrl || 'https://placeholder.supabase.co',
  env.supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'eventforge.auth',
    },
    realtime: { params: { eventsPerSecond: 8 } },
    global: { headers: { 'x-application-name': 'eventforge' } },
  },
);

/** URL de la Edge Function de acceso privado. */
export function accessFunctionUrl(): string {
  return `${env.supabaseUrl}/functions/v1/access`;
}

/** Llamada a la Edge Function `access` (no requiere sesion). */
export async function callAccess<T>(payload: Record<string, unknown>): Promise<T> {
  if (!isConfigured) {
    throw new Error('La aplicación no tiene configuradas las variables de Supabase.');
  }

  let res: Response;
  try {
    res = await fetch(accessFunctionUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // DNS, red caída, CORS o función no desplegada: el navegador no distingue.
    throw new AccessError('network');
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* respuesta no-JSON */
  }

  if (!res.ok) {
    const code = (json as { error?: string } | null)?.error ?? `http_${res.status}`;
    throw new AccessError(code, (json as { detail?: string } | null)?.detail);
  }
  return json as T;
}

export class AccessError extends Error {
  code: string;
  detail?: string;
  constructor(code: string, detail?: string) {
    super(ACCESS_ERROR_MESSAGES[code] ?? detail ?? code);
    this.name = 'AccessError';
    this.code = code;
    this.detail = detail;
  }
}

const ACCESS_ERROR_MESSAGES: Record<string, string> = {
  network:
    'No se ha podido contactar con el servidor. Comprueba tu conexión y que la función «access» esté desplegada en Supabase.',
  invalid_code: 'Código de acceso incorrecto.',
  rate_limited: 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.',
  unknown_profile: 'Ese perfil ya no existe o está desactivado.',
  server_misconfigured: 'El servidor no tiene configurado el código de acceso (secreto ACCESS_CODE).',
  user_without_email: 'El perfil no tiene un usuario de autenticación asociado.',
  link_error: 'No se ha podido iniciar la sesión. Inténtalo de nuevo.',
  db_error: 'Error al leer los perfiles.',
};

/** Mensaje legible para errores de PostgREST/Supabase. */
export function humanizeError(error: unknown): string {
  if (!error) return 'Error desconocido';
  if (error instanceof AccessError) return error.message;

  const e = error as { message?: string; code?: string; details?: string; hint?: string };
  const code = e.code ?? '';

  if (code === '42501' || e.message?.includes('row-level security')) {
    return 'No tienes permisos para realizar esta acción sobre este evento.';
  }
  if (code === '23505') return 'Ya existe un registro con esos datos (valor duplicado).';
  if (code === '23503') return 'No se puede completar: hay otros datos que dependen de este registro.';
  if (code === '23514') return 'Algún valor no es válido (revisa cantidades, fechas y dimensiones).';
  if (code === 'PGRST116') return 'No se ha encontrado el registro.';
  if (e.message?.includes('Failed to fetch')) {
    return 'Sin conexión con el servidor. Comprueba tu red.';
  }
  return e.message || 'Error desconocido';
}
