# Seguridad y privacidad

---

## 1. El punto de partida

El requisito era: **pantalla de "¿quién eres?" con foto, sin contraseñas**, en una aplicación
**publicada en Internet** y **privada**.

Esos dos objetivos chocan. Una selección de perfil, por sí sola, no es autenticación: si la
aplicación consultase la tabla `profiles` directamente con la clave pública, cualquiera que
diera con la URL podría listar al equipo, entrar como quien quisiera y leer y escribir todos
los datos.

---

## 2. Qué se ha implementado

### 2.1 Nada es público en la base de datos

Todas las tablas tienen **Row Level Security** activada y **ninguna política concede nada al
rol `anon`**. La `anon key` que viaja dentro del JavaScript del navegador es, sin sesión,
inútil: cualquier consulta devuelve cero filas.

Las políticas son (`supabase/migrations/0002_rls.sql`):

| Ámbito | Lectura | Escritura |
|---|---|---|
| `profiles` | Cualquier perfil activo | El propio perfil, o un administrador |
| `events` y sus tablas hijas (tareas, horarios, planos, objetos, cables, cargas, capturas) | Cualquier perfil activo | Solo **miembros de ese evento** o administradores |
| Catálogos globales (almacén, cajas, categorías, biblioteca, vehículos) | Cualquier perfil activo | Cualquier perfil activo |
| Alta y baja de personas (`auth.users` + `profiles`) | — | Solo administradores, y solo a través de la Edge Function `access`, que valida el JWT en el servidor |

La lectura del evento es global a propósito: el equipo necesita ver el calendario completo. La
escritura sí está restringida a los responsables asignados.

Las funciones auxiliares (`is_active_profile()`, `is_event_member()`, `can_edit_plan()`…) son
`SECURITY DEFINER` con `search_path` fijo, para evitar recursión entre políticas y ataques por
manipulación del `search_path`.

### 2.2 La puerta de entrada

```text
┌──────────────────────────────────────────────────────────────┐
│  NAVEGADOR                                                   │
│                                                              │
│  1. El usuario escribe el CÓDIGO DE ACCESO del equipo        │
│     └─► POST /functions/v1/access { action: "list", code }   │
│                                                              │
│  4. Recibe la lista de perfiles y elige el suyo              │
│     └─► POST /functions/v1/access { action: "login", ... }   │
│                                                              │
│  6. Canjea el token con supabase.auth.verifyOtp()            │
│     └─► Sesión JWT real                                      │
└──────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────────┐
│  EDGE FUNCTION `access` (servidor)                           │
│                                                              │
│  2. Compara el código con el secreto ACCESS_CODE             │
│     · comparación en tiempo constante (sin fugas por timing) │
│     · límite de 12 intentos por minuto y por IP              │
│  3. Solo si es correcto, devuelve los perfiles               │
│                                                              │
│  5. Con la service_role key (solo del lado servidor) genera  │
│     un magic link de UN SOLO USO para ese usuario            │
└──────────────────────────────────────────────────────────────┘
```

Propiedades:

- El **código no está en el frontend**: es un secreto de servidor.
- La **lista de perfiles no es pública**: exige el código.
- El token de sesión lo emite el servidor; el navegador no puede fabricarlo.
- A partir de la sesión, **la seguridad la aplica PostgreSQL**, no la interfaz.

### 2.3 Almacenamiento

| Bucket | Acceso | Por qué |
|---|---|---|
| `avatars` | Lectura pública | Las fotos deben verse en la pantalla de selección, *antes* de haber iniciado sesión. Son fotos de perfil del equipo: exposición aceptable y consciente. |
| `event-media`, `warehouse-photos`, `captures` | Privado | Se leen con URLs firmadas de 1 hora que solo se generan con sesión válida. |

La escritura en cualquier bucket exige sesión de un perfil activo.

### 2.4 Cabeceras HTTP

`vercel.json` y `netlify.toml` fijan `X-Frame-Options: DENY` (nadie puede incrustar la app en
un iframe), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
y `X-Robots-Tag: noindex, nofollow` (más la etiqueta `robots` en el HTML) para que la
aplicación no aparezca en buscadores.

### 2.5 Secretos

- `.env` está en `.gitignore`; se publica `.env.example` sin valores.
- En Vercel solo se configuran `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` solo existe en tu ordenador (para `npm run seed`) y dentro de
  Supabase (para la Edge Function, donde se inyecta sola).
- `ACCESS_CODE` solo existe como secreto de la Edge Function.

---

## 3. Qué NO protege este sistema

Con franqueza, para que tomes decisiones informadas:

| Limitación | Detalle |
|---|---|
| **Código compartido** | Si alguien del equipo lo filtra, quien lo tenga entra. Mitigación: cámbialo en el panel; todos los dispositivos volverán a pedirlo. |
| **No hay identidad real** | Con el código, cualquiera puede entrar como cualquier perfil. La trazabilidad (`created_by`) indica *qué perfil* hizo algo, no *qué persona*. |
| **Sesiones duraderas** | Un dispositivo que quede abierto mantiene la sesión. Usa «Cerrar sesión» en equipos compartidos. |
| **Sin registro de auditoría** | Se guarda quién creó cada cosa, pero no un historial de cambios. |
| **Lectura global entre eventos** | Cualquier perfil activo ve todos los eventos (decisión de diseño para un equipo pequeño). |

---

## 4. Cómo endurecerlo cuando lo necesites

La arquitectura usa sesiones reales de Supabase Auth desde el primer día, así que **no hay que
tocar la base de datos ni las políticas**. Solo cambia la pantalla de entrada.

### Nivel 1 · Un código por persona (30 minutos)

En la Edge Function, sustituye el secreto único por un mapa:

```ts
// Secreto ACCESS_CODES = {"juan":"1234","maria":"5678", ...}
const CODES = JSON.parse(Deno.env.get('ACCESS_CODES') ?? '{}');
// En "login": comprobar que CODES[slugDelPerfil] === body.code
```

Ya no basta con el código del equipo para suplantar a otra persona.

### Nivel 2 · Magic link por email (1–2 horas)

1. Añade una columna `email` a `profiles` (o usa la de `auth.users`).
2. Supabase → **Authentication → Providers → Email** → activa *Magic Link*.
3. En la pantalla de perfiles, al elegir uno, llama a
   `supabase.auth.signInWithOtp({ email })` en lugar de a la Edge Function.
4. Activa `detectSessionInUrl: true` en `src/lib/supabase.ts`.

Se mantiene la experiencia de «elegir quién soy»: un clic en tu foto, y confirmas desde tu
correo. Sin contraseñas que recordar.

### Nivel 3 · Contraseña o passkey (medio día)

`supabase.auth.signInWithPassword()` o WebAuthn. La pantalla de perfiles puede seguir siendo
el punto de partida: al pulsar tu foto aparece el campo correspondiente.

### Nivel 4 · Restricciones adicionales

- **Lista de IPs permitidas** en la Edge Function (si el equipo trabaja siempre desde la misma
  oficina).
- **Aislamiento por evento**: cambiar la política de `SELECT` de `events` y sus hijas para
  exigir `is_event_member(...)` también en lectura. Es un cambio de dos líneas por tabla.
- **Registro de auditoría**: una tabla `activity_log` con un trigger `AFTER INSERT OR UPDATE OR
  DELETE` en las tablas críticas.
- **Caducidad de sesión**: Supabase → Authentication → Sessions → *Time-box user sessions*.

---

## 5. Comprobaciones periódicas

- [ ] `.env` **no** aparece en GitHub (`git log --all --full-history -- .env` no devuelve nada).
- [ ] La `service_role` key no está en las variables de entorno de Vercel.
- [ ] Todas las tablas siguen con RLS activada (Supabase → Database → Tables, columna *RLS*).
- [ ] El `ACCESS_CODE` se ha cambiado si alguien ha dejado el equipo.
- [ ] Los perfiles de personas que ya no están se han marcado como **inactivos**
      (Configuración → Perfiles del equipo).
- [ ] Existe una copia de seguridad reciente (ver [BACKUP.md](BACKUP.md)).

---

## 6. Si sospechas que alguien no autorizado ha entrado

1. Cambia `ACCESS_CODE` en la Edge Function → todos los dispositivos vuelven a pedirlo.
2. Supabase → **Authentication → Users**: revisa los últimos inicios de sesión.
3. Revoca todas las sesiones activas: **Authentication → Sessions → Revoke all**.
4. Si el problema es mayor, regenera la `anon key` (**Project Settings → API Keys →
   Rotate**) y actualiza la variable en Vercel.
5. Restaura desde una copia si se han borrado datos.
