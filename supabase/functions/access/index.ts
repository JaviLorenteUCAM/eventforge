// ============================================================================
// EventForge · Edge Function "access"
// ----------------------------------------------------------------------------
// Puerta de entrada privada de la aplicacion.
//
//   POST { action: "list",  code }              -> lista de perfiles
//   POST { action: "login", code, profileId }   -> token de sesion (magic link)
//
// Por que existe esta funcion
// ---------------------------
// La pantalla "¿quien eres?" no pide contraseña. Si el frontend consultase
// directamente la tabla `profiles` con la anon key, cualquiera con la URL
// podria listar al equipo y (peor) usar esa anon key contra la base de datos.
// Por eso:
//
//   1. Todas las tablas tienen RLS y NADA es accesible para el rol `anon`.
//   2. El listado de perfiles y el alta de sesion pasan por esta funcion, que
//      exige un CODIGO DE ACCESO compartido (secreto de servidor, nunca en el
//      bundle del frontend).
//   3. Con el codigo correcto la funcion usa la service_role key -solo del lado
//      servidor- para emitir un magic-link de un solo uso del usuario elegido.
//      El navegador lo canjea por una sesion JWT real de Supabase Auth.
//
// Resultado: experiencia "elegir quien soy" sin contraseñas, pero con una
// sesion autenticada de verdad y RLS aplicandose en la base de datos.
//
// Para endurecerlo mas adelante basta con: pedir codigo por persona, activar
// magic links por email, o exigir OTP. La arquitectura no cambia.
// ============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ACCESS_CODE = Deno.env.get('ACCESS_CODE') ?? '';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowAll = ALLOWED_ORIGINS.includes('*');
  const allowed = allowAll || (origin !== null && ALLOWED_ORIGINS.includes(origin));
  return {
    'Access-Control-Allow-Origin': allowAll ? '*' : allowed ? origin! : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

/** Comparacion en tiempo constante para no filtrar el codigo por timing. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

// ---- Rate limiting simple en memoria (por instancia) -----------------------
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 12;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin);

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('cf-connecting-ip') ??
    'unknown';

  if (rateLimited(ip)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers });
  }

  if (!ACCESS_CODE) {
    return new Response(
      JSON.stringify({ error: 'server_misconfigured', detail: 'Falta el secreto ACCESS_CODE' }),
      { status: 500, headers },
    );
  }

  let body: { action?: string; code?: string; profileId?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers });
  }

  if (!body.code || !safeEqual(body.code.trim(), ACCESS_CODE)) {
    return new Response(JSON.stringify({ error: 'invalid_code' }), { status: 401, headers });
  }

  // ---------------------------------------------------------------- list ----
  if (body.action === 'list') {
    const { data, error } = await admin
      .from('profiles')
      .select('id, name, role_title, avatar_url, color, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ error: 'db_error', detail: error.message }), {
        status: 500,
        headers,
      });
    }
    return new Response(JSON.stringify({ profiles: data ?? [] }), { status: 200, headers });
  }

  // --------------------------------------------------------------- login ----
  if (body.action === 'login') {
    if (!body.profileId) {
      return new Response(JSON.stringify({ error: 'missing_profile' }), { status: 400, headers });
    }

    const { data: profile, error: pErr } = await admin
      .from('profiles')
      .select('id, is_active')
      .eq('id', body.profileId)
      .maybeSingle();

    if (pErr || !profile || !profile.is_active) {
      return new Response(JSON.stringify({ error: 'unknown_profile' }), { status: 404, headers });
    }

    const { data: userRes, error: uErr } = await admin.auth.admin.getUserById(body.profileId);
    if (uErr || !userRes?.user?.email) {
      return new Response(JSON.stringify({ error: 'user_without_email' }), { status: 500, headers });
    }

    const { data: link, error: lErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: userRes.user.email,
    });

    if (lErr || !link?.properties?.hashed_token) {
      return new Response(
        JSON.stringify({ error: 'link_error', detail: lErr?.message ?? 'sin token' }),
        { status: 500, headers },
      );
    }

    // El token es de un solo uso; el navegador lo canjea con verifyOtp().
    return new Response(
      JSON.stringify({ email: userRes.user.email, tokenHash: link.properties.hashed_token }),
      { status: 200, headers },
    );
  }

  return new Response(JSON.stringify({ error: 'unknown_action' }), { status: 400, headers });
});
