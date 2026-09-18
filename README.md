# EventForge

**Plataforma web privada para gestionar eventos de principio a fin**: perfiles, eventos,
calendario, planos 2D y 3D, objetos y mobiliario, material eléctrico y de red, conexiones,
detección automática de incidencias, horarios, tareas, listado automático de material,
almacén, cajas, transporte y simulación de carga.

No es una maqueta ni una demo con datos falsos: es una aplicación real con **base de datos
remota (PostgreSQL), almacenamiento remoto de imágenes, seguridad a nivel de base de datos y
sincronización entre usuarios**. Si Juan cambia algo desde su ordenador, María lo ve desde el
suyo.

---

## Índice

1. [Qué necesitas](#1-qué-necesitas)
2. [Arquitectura](#2-arquitectura)
3. [Instalación en tu ordenador](#3-instalación-en-tu-ordenador)
4. [Crear y configurar la base de datos](#4-crear-y-configurar-la-base-de-datos)
5. [Variables de entorno](#5-variables-de-entorno)
6. [Almacenamiento de imágenes](#6-almacenamiento-de-imágenes)
7. [Acceso privado y usuarios](#7-acceso-privado-y-usuarios)
8. [Ejecutar en local](#8-ejecutar-en-local)
9. [Subir el proyecto a GitHub](#9-subir-el-proyecto-a-github)
10. [Desplegar en Internet](#10-desplegar-en-internet)
11. [Actualizar la aplicación](#11-actualizar-la-aplicación)
12. [Copias de seguridad y recuperación](#12-copias-de-seguridad-y-recuperación)
13. [Costes](#13-costes)
14. [Estructura del proyecto](#14-estructura-del-proyecto)
15. [Cómo funciona cada módulo](#15-cómo-funciona-cada-módulo)
16. [Solución de problemas](#16-solución-de-problemas)
17. [Qué se puede mejorar en la v2](#17-qué-se-puede-mejorar-en-la-v2)

---

## 1. Qué necesitas

| Herramienta | Para qué | Cómo conseguirla |
|---|---|---|
| **Node.js 20 o superior** | Ejecutar la aplicación en tu ordenador | <https://nodejs.org> (versión LTS) |
| **Git** | Guardar el código y subirlo a GitHub | <https://git-scm.com> |
| **Cuenta de GitHub** | Alojar el código | <https://github.com> (gratis) |
| **Cuenta de Supabase** | Base de datos + almacenamiento + autenticación | <https://supabase.com> (plan gratuito) |
| **Cuenta de Vercel** | Publicar la web en Internet | <https://vercel.com> (plan Hobby gratuito) |

> No hace falta contratar un dominio. Vercel te da una URL del tipo
> `https://eventforge-tuusuario.vercel.app`, suficiente para empezar.

Comprueba que tienes lo necesario:

```bash
node -v && npm -v && git --version
```

---

## 2. Arquitectura

```text
                        INTERNET
                            │
                            ▼
                 ┌──────────────────────┐
                 │   VERCEL (hosting)   │
                 │  Frontend estático   │
                 │  React + TypeScript  │
                 └──────────┬───────────┘
                            │  HTTPS (anon key + JWT de sesión)
                            ▼
                 ┌──────────────────────┐
                 │       SUPABASE       │
                 ├──────────────────────┤
                 │ PostgreSQL           │  ← única fuente de verdad
                 │ Auth                 │  ← sesiones reales (JWT)
                 │ Storage              │  ← fotos, portadas, capturas
                 │ Realtime             │  ← cambios en vivo
                 │ Edge Function access │  ← puerta de entrada privada
                 └──────────────────────┘
```

**Qué hace cada parte**

- **Vercel** sirve únicamente ficheros estáticos (HTML, CSS, JS). No guarda datos.
- **PostgreSQL** guarda *todo*: eventos, planos, objetos, cables, material, cajas, cargas.
  Es una base de datos relacional normalizada, no un JSON gigante.
- **Auth** emite las sesiones. Cada petición del navegador viaja con un JWT firmado.
- **Row Level Security (RLS)** decide, dentro de PostgreSQL, qué puede ver y escribir cada
  usuario. La seguridad no depende de ocultar botones en el frontend.
- **Storage** guarda las imágenes en cuatro buckets separados.
- **Realtime** avisa al resto de navegadores cuando algo cambia.
- **Edge Function `access`** valida el código de acceso del equipo y emite la sesión del
  perfil elegido. Es lo que permite entrar "sin contraseña" sin abrir la aplicación al mundo.

### Por qué esta arquitectura

| Decisión | Motivo |
|---|---|
| **Vite + React + TypeScript** (SPA) en lugar de Next.js | La aplicación es privada, con editores 2D/3D muy interactivos y sin necesidad de SEO ni renderizado en servidor. Una SPA estática es más simple de desplegar, más barata y más rápida de iterar. |
| **Supabase** | Reúne PostgreSQL, autenticación, almacenamiento, tiempo real y seguridad por filas en un único servicio con plan gratuito. Al ser PostgreSQL estándar, los datos son portables: si algún día quieres irte, te llevas un `pg_dump`. |
| **TanStack Query** para el estado del servidor | Cachea, reintenta, invalida y sincroniza. Evita reimplementar a mano la capa de datos. |
| **Zustand** para el estado de interfaz | Ligero y sin *boilerplate*. Solo guarda cosas de interfaz (zoom, selección, tema), nunca datos de negocio. |
| **Three.js + React Three Fiber** | Estándar de facto para 3D en React, con dimensiones reales en metros. |
| **Tailwind CSS v4** con tokens semánticos | Diseño consistente, modo oscuro y claro con las mismas clases, y CSS final muy pequeño. |

### Modelo de datos

```text
profiles ──┬── event_members ──┬── events ──┬── tasks
           │                   │            ├── schedule_days ── schedule_activities ── schedule_activity_members
           │                   │            ├── plans ──┬── plan_objects ──┐
           │                   │            │           └── plan_connections┘
           │                   │            ├── transport_loads ── transport_items
           │                   │            └── snapshots
           │
material_categories ──┬── object_catalog ──── (plan_objects.catalog_id)
                      └── warehouse_items ─┬── warehouse_box_items ── warehouse_boxes
                                           └── (plan_objects.warehouse_item_id)
transport_vehicles ──── (transport_loads.vehicle_id)
```

El detalle completo (columnas, tipos, índices, claves foráneas y decisiones de diseño) está
en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) y, sobre todo, en los propios ficheros SQL
de `supabase/migrations/`, que están comentados.

---

## 3. Instalación en tu ordenador

```bash
git clone https://github.com/TU-USUARIO/eventforge.git
cd eventforge
npm install
```

Si todavía no tienes el proyecto en GitHub, basta con abrir una terminal en la carpeta
`eventforge` y ejecutar `npm install`.

---

## 4. Crear y configurar la base de datos

### 4.1 Crear el proyecto en Supabase

1. Entra en <https://supabase.com> y pulsa **Start your project**.
2. **New project**:
   - *Name*: `eventforge`
   - *Database Password*: genera una y **guárdala en tu gestor de contraseñas** (la
     necesitarás para las copias de seguridad).
   - *Region*: elige la más cercana (por ejemplo `eu-west-3 · Paris`).
3. Espera 1–2 minutos a que el proyecto se aprovisione.

### 4.2 Aplicar las migraciones

En el panel de Supabase, abre **SQL Editor** → **New query**. Copia y ejecuta el contenido
de estos cuatro ficheros, **en este orden**, uno cada vez:

| Orden | Fichero | Qué hace |
|---|---|---|
| 1 | `supabase/migrations/0001_schema.sql` | Crea todas las tablas, índices y relaciones |
| 2 | `supabase/migrations/0002_rls.sql` | Activa Row Level Security, políticas, buckets y realtime |
| 3 | `supabase/migrations/0003_catalog.sql` | Categorías, biblioteca de objetos y vehículos base |
| 4 | `supabase/migrations/0004_functions.sql` | Duplicar evento y resumen de evento |
| 5 | `supabase/migrations/0005_backgrounds_scenarios_textures.sql` | Imágenes de fondo calibradas, escenarios reutilizables y texturas |

Cada uno debe terminar con `Success. No rows returned`.

> **Alternativa con el CLI de Supabase** (opcional):
> ```bash
> npx supabase link --project-ref TU-REF
> npx supabase db push
> ```

### 4.3 Comprobar

En **Table Editor** deberías ver 19 tablas. En **Database → Roles / Policies**, todas con el
candado de RLS activado.

---

## 5. Variables de entorno

Nunca escribas claves dentro del código. Todas viven en `.env`, que **no se sube a Git**.

```bash
cp .env.example .env      # macOS / Linux
copy .env.example .env    # Windows (CMD)
Copy-Item .env.example .env   # Windows (PowerShell)
```

Abre `.env` y rellena:

| Variable | Dónde se usa | Dónde obtenerla |
|---|---|---|
| `VITE_SUPABASE_URL` | Navegador | Supabase → **Project Settings → Data API → Project URL** |
| `VITE_SUPABASE_ANON_KEY` | Navegador | Supabase → **Project Settings → API Keys → `anon` / `public`** |
| `VITE_APP_NAME` | Navegador | El nombre que quieras mostrar |
| `SUPABASE_URL` | Solo `npm run seed` | El mismo valor que `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo `npm run seed` | Supabase → **Project Settings → API Keys → `service_role`** |
| `ACCESS_CODE` | Referencia local | El código que decidas para tu equipo |

> ⚠️ **`VITE_SUPABASE_ANON_KEY` es pública** (acaba dentro del JavaScript que descarga el
> navegador) y eso es correcto: sin sesión no da acceso a ningún dato, porque todas las
> tablas tienen RLS.
>
> 🚫 **`SUPABASE_SERVICE_ROLE_KEY` es privada y se salta toda la seguridad.** Úsala solo en
> tu ordenador. Nunca la pongas en Vercel ni la compartas.

---

## 6. Almacenamiento de imágenes

La migración `0002_rls.sql` crea automáticamente los cuatro buckets. Puedes verificarlos en
**Storage**:

| Bucket | Acceso | Contenido |
|---|---|---|
| `avatars` | Lectura pública | Fotos de perfil (hacen falta *antes* de iniciar sesión, en la pantalla "¿quién eres?") |
| `event-media` | Privado | Portadas de evento |
| `warehouse-photos` | Privado | Fotos del material del almacén |
| `captures` | Privado | Capturas 2D y 3D de los planos |
| `plan-backgrounds` | Privado | Fotos aéreas y planos de referencia del recinto |
| `textures` | Privado | Texturas de los objetos de la biblioteca |

Los buckets privados se leen mediante **URLs firmadas temporales** (1 hora), que la
aplicación genera sola. Límite de 5–10 MB por imagen y solo PNG, JPG y WEBP.

Ninguna imagen se guarda en el navegador: todas viajan a Supabase Storage.

---

## 7. Acceso privado y usuarios

### 7.1 El problema de "seleccionar quién soy"

Pediste una pantalla de selección de perfil sin contraseña. Publicada en Internet, una
pantalla así **por sí sola no protege nada**: cualquiera con la URL entraría y vería (y
editaría) todos los datos del equipo.

### 7.2 La solución implementada

Dos capas, sin renunciar a la experiencia:

```text
  ┌─────────────────────────┐
  │ 1. CÓDIGO DE ACCESO     │  Un código compartido por el equipo.
  │    (una vez por         │  Se valida en el SERVIDOR (Edge Function),
  │     dispositivo)        │  nunca en el navegador. Se recuerda en el
  └───────────┬─────────────┘  dispositivo para no repetirlo cada día.
              ▼
  ┌─────────────────────────┐
  │ 2. ¿QUIÉN ERES?         │  Cuadrícula con foto, nombre y cargo.
  │    Selección de perfil  │  Un clic y entras. Sin contraseña.
  └───────────┬─────────────┘
              ▼
  ┌─────────────────────────┐
  │ Sesión real de Supabase │  El servidor emite un enlace mágico de un
  │ Auth (JWT) + RLS        │  solo uso que el navegador canjea por una
  └─────────────────────────┘  sesión JWT auténtica.
```

Consecuencias prácticas:

- La `anon key` publicada **no sirve para nada** sin sesión: RLS deniega todo al rol `anon`.
- El código de acceso **no está en el código del frontend**: es un secreto del servidor.
- Hay **límite de intentos** (12 por minuto y por IP) contra la fuerza bruta.
- La lista de perfiles **tampoco es pública**: solo se obtiene con el código correcto.
- Al ser sesiones de Supabase Auth de verdad, **migrar a contraseñas, magic links por email
  o 2FA más adelante no requiere tocar la base de datos ni las políticas**: basta con
  cambiar la pantalla de entrada.

**Sinceridad sobre el nivel de seguridad**: un código compartido protege frente a alguien que
tropiece con la URL, no frente a un miembro del equipo que se lo dé a un tercero, y no
distingue quién es realmente quién (cualquiera con el código puede entrar como cualquier
perfil). Para un grupo reducido y de confianza es un compromiso razonable. Cuando necesites
más, en `docs/SEGURIDAD.md` está explicado cómo pasar a magic links por email sin rehacer
nada.

### 7.3 Configurar el código de acceso

El código vive como **secreto de la Edge Function**, no en la base de datos ni en el código.

**Opción A · Desde el panel** (recomendada, sin instalar nada)

1. Supabase → **Edge Functions** → **Deploy a new function** → nombre: `access`.
2. Pega el contenido de `supabase/functions/access/index.ts`.
3. Desactiva **Verify JWT** (esta función se llama sin sesión: es la puerta de entrada).
4. Despliega.
5. En **Edge Functions → access → Secrets**, añade:
   - `ACCESS_CODE` = el código que quieras (por ejemplo `montaje-2026`).
   - *(opcional)* `ALLOWED_ORIGINS` = `https://tu-app.vercel.app,http://localhost:5173`
     para que solo tu web pueda llamarla.

**Opción B · Con el CLI**

```bash
npx supabase login
npx supabase link --project-ref TU-REF
npx supabase secrets set ACCESS_CODE=montaje-2026
npx supabase functions deploy access --no-verify-jwt
```

### 7.4 Crear los usuarios

```bash
npm run seed
```

Crea los cuatro perfiles (**Juan · Producción**, **María · Técnica**, **Pedro ·
Organización**, **Ana · Diseño**), un almacén de ejemplo y el **Evento Demo 2026** completo:
plano con objetos y cableado (con dos fallos intencionados para probar el detector de
incidencias), horarios de 3 días, 8 tareas, cajas y una carga de transporte.

```bash
npm run seed -- --users    # solo los perfiles, sin datos de ejemplo
npm run seed -- --reset    # regenera el evento demo desde cero
```

El script es **idempotente**: puedes ejecutarlo varias veces sin duplicar nada.

**Añadir una persona más tarde**: edita el array `PEOPLE` en `scripts/seed.mjs` y vuelve a
ejecutar `npm run seed -- --users`. También puedes crearla a mano en Supabase
(**Authentication → Add user**, con *Auto Confirm User* activado) y después insertar su fila
en `profiles` con el mismo `id`.

Cada perfil puede editar su nombre, cargo, color y foto desde **Perfil**. Los administradores
(`is_admin`) pueden activar o desactivar perfiles desde **Configuración**.

---

## 8. Ejecutar en local

```bash
npm run dev
```

Abre <http://localhost:5173>.

- Si faltan variables de entorno verás una pantalla que te dice exactamente cuáles.
- Si están bien, verás la pantalla del código de acceso.

Otros comandos:

```bash
npm run build       # compila para producción (TypeScript + Vite)
npm run preview     # sirve la versión compilada en local
npm run typecheck   # solo comprobación de tipos
npm run lint        # análisis estático
npm run test:db     # aplica las migraciones a un PostgreSQL de prueba
```

### Probar la base de datos sin tocar Supabase

```bash
npm run test:db
```

Levanta un PostgreSQL real en memoria (PGlite, PostgreSQL compilado a
WebAssembly), aplica las cuatro migraciones y comprueba que:

- se crean las 19 tablas, sus índices y sus claves foráneas;
- **todas** las tablas quedan con Row Level Security activada;
- los triggers funcionan (el creador de un evento entra como responsable);
- `duplicate_event()` copia plano, objetos, cables, horarios y tareas;
- las restricciones rechazan datos inválidos (fechas invertidas, cables a sí
  mismos, estados inexistentes, dimensiones a cero, códigos duplicados);
- borrar un evento arrastra sus dependencias.

Ejecútalo siempre que toques un fichero de `supabase/migrations/`: detecta los
errores antes de aplicarlos a tu proyecto real.

---

## 9. Subir el proyecto a GitHub

Lo que **nunca** se sube: `.env`, `node_modules/`, `dist/`. Ya está en `.gitignore`.

```bash
git init
git add .
git commit -m "EventForge: versión inicial"
git branch -M main
```

Crea un repositorio **privado** en <https://github.com/new> llamado `eventforge`, sin
README ni .gitignore, y luego:

```bash
git remote add origin https://github.com/TU-USUARIO/eventforge.git
git push -u origin main
```

Comprueba en GitHub que **no aparece** el fichero `.env`.

---

## 10. Desplegar en Internet

Resumen en ocho pasos:

```text
1. Crear cuenta en Vercel
2. Importar el repositorio de GitHub
3. Configurar las dos variables de entorno
4. Deploy
5. Copiar la URL
6. Añadir la URL a Supabase (Redirect URLs y ALLOWED_ORIGINS)
7. Entrar con el código de acceso
8. Probar desde un segundo dispositivo
```

Detalle:

1. **Vercel** → *Sign up* con tu cuenta de GitHub.
2. **Add New… → Project** → selecciona `eventforge` → **Import**.
3. Vercel detecta Vite automáticamente (*Build Command*: `npm run build`, *Output
   Directory*: `dist`). No cambies nada.
4. Despliega **Environment Variables** y añade exactamente dos:

   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://TU-PROYECTO.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi...` (la clave `anon`) |

   > No añadas nunca aquí `SUPABASE_SERVICE_ROLE_KEY`.

5. **Deploy**. En 1–2 minutos tendrás `https://eventforge-xxxx.vercel.app`.
6. En Supabase:
   - **Authentication → URL Configuration**: añade tu URL de Vercel en *Site URL* y en
     *Redirect URLs*.
   - **Edge Functions → access → Secrets**: si usas `ALLOWED_ORIGINS`, añade la URL de
     Vercel a la lista.
7. Abre la URL, introduce el código de acceso y elige tu perfil.
8. Abre la misma URL en el móvil o en otro ordenador: verás los mismos datos. Crea una tarea
   en uno y compruébalo en el otro.

El fichero `vercel.json` ya incluye las reescrituras necesarias para que las rutas internas
(`/eventos/123/plano`) funcionen al recargar, además de cabeceras de seguridad y `noindex`
para que la aplicación no se indexe en buscadores.

> ¿Prefieres **Netlify** o **Cloudflare Pages**? El proyecto incluye `netlify.toml` y
> `public/_redirects`. El procedimiento es idéntico: conectar el repositorio, `npm run build`,
> carpeta `dist` y las mismas dos variables.

---

## 11. Actualizar la aplicación

```bash
# 1. Haces cambios en el código
npm run dev            # los pruebas en local
npm run build          # compruebas que compila

# 2. Los publicas
git add .
git commit -m "Descripción del cambio"
git push
```

Vercel detecta el `push` y redespliega solo. En ~1 minuto está en producción.

**Si cambias la base de datos**: escribe un fichero nuevo en `supabase/migrations/`
(`0005_lo_que_sea.sql`), ejecútalo en el SQL Editor y súbelo a Git. Así el historial del
esquema queda versionado junto al código.

**Si algo sale mal**: en Vercel → **Deployments**, cualquier despliegue anterior tiene la
opción *Promote to Production* (vuelta atrás instantánea).

---

## 12. Copias de seguridad y recuperación

Resumen; el procedimiento completo está en [`docs/BACKUP.md`](docs/BACKUP.md).

**Lo que Supabase hace por ti**

- Plan gratuito: copias diarias con **7 días** de retención, y hay que solicitarlas al
  soporte para restaurarlas. **No sustituyen a tus propias copias.**
- Plan Pro: copias diarias con 7 días y restauración desde el panel; *Point-in-Time
  Recovery* es un extra de pago.

**Lo que deberías hacer tú** (recomendado: una vez al mes y siempre antes de un cambio
gordo)

```bash
# Copia completa de la base de datos (necesita PostgreSQL instalado)
pg_dump "postgresql://postgres:[TU-PASSWORD]@db.[TU-REF].supabase.co:5432/postgres" \
  --clean --if-exists --no-owner --no-privileges \
  -f backup-eventforge-$(date +%Y-%m-%d).sql
```

La cadena de conexión exacta está en Supabase → **Project Settings → Database → Connection
string → URI**.

**Restaurar**

```bash
psql "postgresql://postgres:[TU-PASSWORD]@db.[TU-REF].supabase.co:5432/postgres" \
  -f backup-eventforge-2026-09-17.sql
```

**Exportar sin instalar nada**: Table Editor → cualquier tabla → **⋯ → Export to CSV**.

**Imágenes**: el `pg_dump` **no** incluye los ficheros de Storage. Descárgalos desde
**Storage → bucket → Download**, o con el script de `docs/BACKUP.md`.

---

## 13. Costes

| Servicio | Para qué | Plan gratuito | Cuándo empezarías a pagar |
|---|---|---|---|
| **Supabase** | PostgreSQL, Auth, Storage, Realtime, Edge Functions | 500 MB de base de datos, 1 GB de Storage, 5 GB de transferencia, 50.000 usuarios activos/mes, 500.000 invocaciones de funciones | Plan **Pro 25 $/mes** cuando superes los 500 MB de datos o 1 GB de imágenes. Un equipo pequeño con decenas de eventos tarda **años** en llegar. |
| **Vercel** | Hosting del frontend | 100 GB de transferencia/mes, despliegues ilimitados, HTTPS | Plan **Pro 20 $/mes**, solo si superas la transferencia (muy improbable en una app privada de 4 personas) |
| **GitHub** | Repositorio privado | Repositorios privados ilimitados | Nunca, para este uso |
| **Dominio propio** | *Opcional* | — | ~10–15 €/año si algún día quieres `eventos.tuempresa.com` |

**Coste realista para empezar: 0 €/mes.**

Lo que más consume es el **Storage**: cada captura de plano ocupa ~0,5–2 MB. Con 1 GB tienes
espacio para cientos de capturas y fotos. Si te acercas al límite, borra capturas antiguas
desde el propio visor del editor.

⚠️ En el plan gratuito de Supabase, un proyecto **se pausa tras 7 días sin actividad**. Se
reactiva con un clic desde el panel, pero conviene saberlo si vas a estar semanas sin
usarlo.

---

## 14. Estructura del proyecto

```text
eventforge/
├── public/
│   ├── favicon.svg
│   └── _redirects                  # SPA en Netlify / Cloudflare
├── scripts/
│   └── seed.mjs                    # crea usuarios, almacén y evento demo
├── supabase/
│   ├── config.toml
│   ├── functions/
│   │   └── access/index.ts         # puerta de entrada privada (Deno)
│   └── migrations/
│       ├── 0001_schema.sql         # tablas, índices, relaciones
│       ├── 0002_rls.sql            # seguridad, buckets, realtime
│       ├── 0003_catalog.sql        # categorías, biblioteca, vehículos
│       └── 0004_functions.sql      # duplicar evento, resumen
├── docs/
│   ├── ARQUITECTURA.md
│   ├── BACKUP.md
│   ├── SEGURIDAD.md
│   └── DESPLIEGUE.md
├── src/
│   ├── auth/                       # AuthProvider, pantalla de acceso, setup
│   ├── components/
│   │   ├── layout/                 # AppShell, Sidebar, PageHeader
│   │   └── ui/                     # Button, Modal, Field, Avatar, Meter…
│   ├── data/                       # capa de datos (React Query + Supabase)
│   │   ├── api.ts  keys.ts  realtime.ts
│   │   ├── events.ts  tasks.ts  schedule.ts
│   │   ├── plans.ts  transport.ts  warehouse.ts  profiles.ts
│   ├── features/                   # un módulo por sección
│   │   ├── dashboard/  calendar/  events/
│   │   ├── plan/                   # editor 2D + 3D, inspector, incidencias
│   │   ├── schedule/  tasks/  material/
│   │   ├── transport/              # simulación de carga 2D + 3D
│   │   ├── warehouse/              # inventario, cajas, biblioteca, categorías
│   │   └── profile/                # perfil y configuración
│   ├── lib/                        # lógica de negocio pura (sin React)
│   │   ├── issues.ts               # detección de incidencias eléctricas/red
│   │   ├── materials.ts            # plano → material → almacén
│   │   ├── packing.ts              # volumen, peso y colocación de la carga
│   │   ├── storage.ts  supabase.ts  types.ts  utils.ts  env.ts
│   ├── store/ui.ts                 # tema, menú, último evento
│   ├── App.tsx  main.tsx  index.css
├── .env.example
├── vercel.json  netlify.toml
└── README.md
```

---

## 15. Cómo funciona cada módulo

### Todo está conectado

Este es el objetivo principal del proyecto: no son seis herramientas sueltas.

```text
   PLANO  ──(objetos y cables)──►  MATERIAL  ──(comparación)──►  ALMACÉN
     │                                 │                            │
     │                                 └──────────►  TRANSPORTE  ◄───┘
     │                                                    ▲      (cajas como bulto)
     └──(análisis de conexiones)──►  INCIDENCIAS          │
                                          │               │
   HORARIOS ──►  DASHBOARD  ◄── TAREAS ◄──┘               │
                     ▲                                    │
                     └────────────(ocupación)─────────────┘
```

Si añades una mesa al plano, aparece en **Material**. Si esa mesa existe en el **Almacén**, se
cuenta como disponible. Si no hay suficientes, aparece en rojo como faltante. Al preparar el
**Transporte**, puedes añadir ese material, y si está dentro de una **caja**, cargas la caja
entera con su peso real (tara + contenido).

### Dashboard
Próximos eventos con porcentaje de preparación, eventos en curso, tareas pendientes,
próximas actividades, material que falta, incidencias del plano y resumen del almacén.
Todo leído de PostgreSQL, con actualización en vivo de eventos y tareas.

### Eventos
Crear, editar, eliminar, **duplicar**, buscar, filtrar y ordenar. Duplicar un evento copia
—en una única transacción de PostgreSQL— el plano con sus objetos y cables, los horarios,
las tareas y las cargas de transporte, desplazando todas las fechas al nuevo inicio.

### Calendario
Vistas de **mes, semana y día**. Doble clic en una casilla para crear un evento ese día y
**arrastrar un evento a otro día** para cambiar sus fechas conservando la duración.

### Editor de planos 2D
Vista cenital en **metros reales**. Rejilla configurable, zoom con rueda centrado en el
cursor, desplazamiento con espacio o botón central, ajuste a rejilla, medidas, líneas guía,
selección múltiple con marco, copiar/pegar, duplicar y **deshacer/rehacer**.

Figuras básicas: rectángulo, cuadrado, círculo, superficie, línea y texto, además de toda la
biblioteca de objetos.

Los objetos son entidades reales de la base de datos: se seleccionan, mueven, rotan (tirador
dedicado, con ajuste a 15°), redimensionan (tirador de esquina), duplican, bloquean y
eliminan. Cada uno guarda largo, ancho, alto, peso, color, forma, tipo, consumo y número de
tomas o puertos.

El **deshacer** está basado en comandos: cada acción sabe cómo revertirse escribiendo en la
base de datos, de modo que al deshacer el resto del equipo también ve el resultado.

### Imagen de fondo y calibración a escala real

Esta es la forma rápida de montar un escenario que existe de verdad:

1. **Pestaña Fondo → Añadir imagen de referencia**: subes una foto aérea, el plano del
   recinto o un croquis. Se coloca sobre el suelo respetando su proporción.
2. **Calibrar con una medida**: trazas una línea sobre algo cuya medida conozcas —una puerta,
   una pista, una fachada— e indicas cuánto mide en la realidad. Con `Mayús` la línea se
   fuerza a horizontal o vertical.
3. La aplicación **reescala la imagen y ajusta el recinto** a esas medidas. A partir de ahí,
   todo lo que coloques encima está a escala: una mesa de 2 m ocupa 2 m de la foto.

Cada imagen es una **capa** con su propia opacidad, posición, tamaño y rotación, y puedes
apilar varias (por ejemplo la foto aérea abajo y una textura o un croquis encima). Se pueden
ocultar y bloquear, y el modo *Ajustar en el plano* permite moverlas y escalarlas arrastrando.

Las capas se ven tanto en 2D (bajo la rejilla) como en **3D, proyectadas sobre el suelo**, y
viajan con el evento cuando lo duplicas o lo guardas como escenario.

### Escenarios reutilizables

Para un evento que se repite siempre en el mismo espacio, no tiene sentido rehacer el plano
cada vez. **Guardar escenario** congela el plano actual —recinto, objetos, cableado e
imágenes de fondo calibradas— como una plantilla independiente de cualquier evento.

Desde **Escenarios** puedes cargar uno en el plano actual, ya sea **reemplazando** lo que haya
o **añadiéndolo encima**. Al cargarlo, el recinto adopta las medidas del escenario.

Guardar y cargar se hacen con funciones de PostgreSQL (`save_plan_as_scenario` y
`load_scenario_into_plan`) para que sean atómicas: o se copia todo, o nada.

### Texturas de los objetos

Cada objeto de la biblioteca puede llevar una imagen. Hay dos modos:

- **Despliegue por caras (plantilla)** — el modo recomendado para objetos concretos. El botón
  **Exportar plantilla** descarga un PNG con el objeto *desplegado en cruz*: las seis caras,
  cada una en su color, con su nombre (`FRENTE`, `ATRÁS`, `IZQUIERDA`, `DERECHA`, `ARRIBA`,
  `ABAJO`) y sus medidas reales. Los recuadros son proporcionales al objeto, así que lo que
  dibujes en cada uno aparece sin deformar en su cara. Editas esa imagen en cualquier programa
  y la vuelves a subir.
- **Mosaico repetido** — una imagen que se repite en todas las caras (madera, tela, moqueta),
  con escala, desplazamiento y rotación ajustables.

En los cilindros la plantilla es la superficie lateral desenrollada (perímetro × alto), porque
las tapas no se pueden desplegar en la misma imagen sin deformarlas.

### Altura sobre el suelo

Todo objeto tiene una **altura sobre el suelo** además de su posición en planta: sirve para
colgar un foco a 2 m de la pared, poner un PC encima de una mesa o suspender algo del techo.
El inspector muestra a qué cota queda su base y su parte alta, y ofrece atajos (Suelo, Mesa
0,75 m, Pared 2 m, Alto 3 m). En 3D el objeto aparece elevado; en 2D sigue viéndose en planta.

### Editor 3D
Three.js + React Three Fiber. Cámara orbital con zoom, rotación y desplazamiento. Los
objetos tienen **volumen real** (una mesa de 2,00 × 0,80 × 0,75 m mide exactamente eso). Se
seleccionan con un clic y se arrastran sobre el suelo con ajuste a rejilla; rotación y
escala se ajustan desde el inspector. Los cables se dibujan en el espacio y las incidencias
se resaltan en rojo.

### Biblioteca de objetos y material del almacén
Al añadir un objeto puedes elegir el **origen**:

- **Biblioteca** — 30+ objetos base (mobiliario, audiovisual, electricidad, red,
  decoración, herramientas) más los que crees tú, con todas sus propiedades.
- **Almacén** — una **unidad concreta** del inventario. El objeto del plano queda enlazado a
  ese artículo, de modo que el listado sabe que ese PC es "PC Control 01" y no un PC
  cualquiera.

### Cableado, redes y conexiones
Herramientas de cable **eléctrico** y de **red**: clic en el origen, clic en el destino. La
longitud se estima por la distancia en planta más un 20 % de holgura, y se puede corregir a
mano. Cada cable guarda tipo, longitud, color, origen y destino, y **suma metros al listado
de material**.

Las regletas tienen número de tomas; los switches, número de puertos.

### Detección automática de incidencias
El sistema recorre el grafo de conexiones y avisa de:

- ⚠️ **Sin electricidad** — un aparato que necesita corriente y no tiene camino hasta una
  fuente (cuadro o toma de pared). Las regletas propagan la corriente solo si ellas mismas
  están alimentadas.
- ⚠️ **Sin red** — un aparato que necesita red y no llega a ningún switch o router.
- ⚠️ **Regleta sin alimentar** — tiene aparatos colgando pero no recibe corriente.
- ⚠️ **Tomas o puertos insuficientes** — más conexiones que tomas físicas.
- ⚠️ **Cable huérfano** — uno de sus extremos ya no existe.

Al pulsar una incidencia se selecciona el objeto implicado, tanto en 2D como en 3D.

### Capturas
Botón **Captura 2D/3D**: rasteriza la vista, sube el PNG al bucket privado `captures` y lo
registra en la tabla `snapshots`. El visor permite abrirlas y borrarlas.

### Horarios
Indicas el número de días y se generan. Cada actividad tiene título, descripción, día, hora
de inicio y fin, responsables, color y notas, y puede **duplicarse a otro día** como copia
independiente.

### Listado de material
Se genera solo a partir del plano: agrupa los objetos por entrada de biblioteca y los cables
por tipo, y lo cruza con el almacén mostrando **necesario / disponible / faltan**. Exportable
a CSV (separador `;`, compatible con Excel en español).

El cruce con el almacén se hace por unidad asignada → por objeto de biblioteca → por nombre
normalizado.

### Almacén, cajas y categorías
Inventario global con búsqueda, filtros, ordenación, foto remota, ubicación y código interno.
Las **cajas** guardan físicamente su contenido (`warehouse_box_items`), con volumen ocupado y
peso total calculados. Las **categorías** tienen color propio, que se usa en todo el sistema.

### Tareas
Tablero de tres columnas (Pendiente / En proceso / Hecha) con responsable, prioridad, fecha
límite y aviso de retraso. Un clic en el icono cambia el estado.

### Transporte y simulación de carga
Eliges vehículo (cuatro plantillas o uno personalizado con tus medidas) y añades bultos desde
el material del evento, desde las cajas del almacén, desde el inventario o a medida.

Vista **2D cenital** con arrastre y ajuste de 5 cm —los bultos se apilan solos cuando se
colocan encima de otro— y vista **3D** con volumen real. El botón *Colocar automáticamente*
aplica un algoritmo de estanterías por capas que ordena por superficie y rellena filas.

Se calcula en tiempo real: volumen usado, volumen del vehículo, **porcentaje de ocupación**,
peso total frente al máximo legal, bultos que sobresalen, bultos que se solapan y cuántos
m³ faltan si no cabe todo.

---

## 16. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| «Falta configuración» al abrir la app | No hay `.env` o falta alguna variable | Crea `.env` a partir de `.env.example` y **reinicia** `npm run dev` |
| «El servidor no tiene configurado el código de acceso» | Falta el secreto `ACCESS_CODE` | Añádelo en Edge Functions → access → Secrets |
| «Código de acceso incorrecto» y estás seguro de que es el bueno | El secreto tiene espacios o la función no se redesplegó | Vuelve a guardar el secreto y redespliega la función |
| La pantalla de perfiles sale vacía | No has ejecutado la semilla | `npm run seed` |
| `npm run seed` dice que no puede leer `object_catalog` | Faltan migraciones | Ejecuta los cuatro `.sql` en orden |
| «No tienes permisos para realizar esta acción» | No eres miembro de ese evento | Añádete en *Editar evento → Responsables* (lo hace un miembro actual) |
| Recargar `/eventos/123/plano` da 404 | Faltan las reescrituras SPA | `vercel.json` / `_redirects` deben estar subidos a Git |
| Los cambios de otro usuario no aparecen | Realtime no está publicando | Vuelve a ejecutar la sección final de `0002_rls.sql`; en cualquier caso, al recargar siempre se ven |
| La captura 3D sale en negro | El canvas se redibujó antes de leerlo | Vuelve a pulsar el botón; la vista 2D siempre funciona |
| El proyecto de Supabase "está pausado" | 7 días sin uso en el plan gratuito | Reactívalo desde el panel |

---

## 17. Qué se puede mejorar en la v2

Está construido para crecer; estas son las evoluciones naturales:

1. **Transporte**: el algoritmo actual es de estanterías por capas. Puede evolucionar a un
   empaquetado 3D con huecos (*maximal rectangles*), restricciones de fragilidad, apilado
   máximo y orden de descarga. La base de datos ya guarda posición y rotación por bulto, así
   que no hace falta migrar nada.
2. **Edición colaborativa en vivo del plano**: hoy el realtime refresca los datos; el
   siguiente paso serían cursores compartidos y bloqueo optimista por objeto.
3. **Autenticación por persona**: magic links por email o WebAuthn. La arquitectura ya usa
   sesiones reales de Supabase Auth (ver `docs/SEGURIDAD.md`).
4. **Reservas de material por fechas**: hoy la disponibilidad es el stock total. Se puede
   descontar el material comprometido en eventos solapados.
5. **Cableado con trazado real**: los cables se dibujan en línea recta y la longitud se
   estima. Podrían tener puntos intermedios y seguir rutas por el suelo o el techo.
6. **Aplicación móvil / PWA offline** para el montaje, con sincronización diferida.
7. **Exportación a PDF** del dossier del evento (plano, horarios, material y carga).

---

## Licencia

Proyecto privado. Todos los derechos reservados.
