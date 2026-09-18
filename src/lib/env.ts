/**
 * Variables de entorno del frontend.
 *
 * Solo las variables con prefijo VITE_ llegan al navegador, y TODAS ellas son
 * publicas por definicion (acaban dentro del bundle). Por eso aqui unicamente
 * hay la URL del proyecto y la ANON key: la anon key no da acceso a nada porque
 * todas las tablas tienen RLS. La service_role key NUNCA debe aparecer aqui.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const env = {
  supabaseUrl: (url ?? '').trim(),
  supabaseAnonKey: (anonKey ?? '').trim(),
  appName: (import.meta.env.VITE_APP_NAME as string | undefined)?.trim() || 'EventForge',
};

/** true cuando la app tiene lo minimo para hablar con Supabase. */
export const isConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);

export const missingEnvVars = [
  !env.supabaseUrl && 'VITE_SUPABASE_URL',
  !env.supabaseAnonKey && 'VITE_SUPABASE_ANON_KEY',
].filter(Boolean) as string[];
