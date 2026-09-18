# Despliegue paso a paso

De «el código está en mi ordenador» a «mi equipo lo usa desde cualquier sitio».
Sin ser experto en servidores. Tiempo estimado: **30–40 minutos** la primera vez.

```text
   Tu ordenador                GitHub                 Vercel              Supabase
        │                        │                       │                    │
   ①  npm install                │                       │                    │
   ②  ────────────────────────────────────────────────────────────►  crear proyecto
   ③  ────────────────────────────────────────────────────────────►  4 migraciones SQL
   ④  .env con las claves ◄──────────────────────────────────────────  copiar claves
   ⑤  npm run seed  ──────────────────────────────────────────────►  usuarios + demo
   ⑥  ────────────────────────────────────────────────────────────►  Edge Function + código
   ⑦  git push  ───────────────► repo privado
   ⑧                             └──────────────────────► importar
   ⑨                                                     variables + Deploy
   ⑩                                                     URL pública ──────►  añadir a Auth
   ⑪  Probar desde 2 dispositivos
```

---

## ① Preparar el proyecto

```bash
cd eventforge
npm install
```

---

## ② Crear el proyecto de Supabase

1. <https://supabase.com> → **Start your project** → inicia sesión con GitHub.
2. **New project**
   - *Name*: `eventforge`
   - *Database Password*: genera una y **guárdala** (la necesitarás para las copias).
   - *Region*: la más cercana a tu equipo.
3. Espera 1–2 minutos.

---

## ③ Crear las tablas

**SQL Editor → New query**. Ejecuta uno por uno, **en orden**, el contenido de:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_rls.sql`
3. `supabase/migrations/0003_catalog.sql`
4. `supabase/migrations/0004_functions.sql`

Cada uno debe responder `Success. No rows returned`.

Comprobación: **Table Editor** muestra 19 tablas y **Storage** muestra 4 buckets.

---

## ④ Configurar las variables locales

```bash
cp .env.example .env
```

Rellena con los valores de Supabase → **Project Settings**:

```dotenv
VITE_SUPABASE_URL=https://abcdefghijklm.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
VITE_APP_NAME=EventForge

SUPABASE_URL=https://abcdefghijklm.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6...
ACCESS_CODE=montaje-2026
```

| Valor | Dónde está |
|---|---|
| `VITE_SUPABASE_URL` | Project Settings → **Data API** → *Project URL* |
| `VITE_SUPABASE_ANON_KEY` | Project Settings → **API Keys** → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → **API Keys** → `service_role` (pulsa *Reveal*) |

---

## ⑤ Crear los usuarios y los datos de ejemplo

```bash
npm run seed
```

Crea Juan, María, Pedro y Ana, el almacén de ejemplo y el **Evento Demo 2026** completo.

---

## ⑥ Desplegar la puerta de entrada

Supabase → **Edge Functions** → **Deploy a new function**:

1. Nombre: `access`
2. Pega el contenido de `supabase/functions/access/index.ts`
3. **Desactiva** *Verify JWT* (esta función se llama sin sesión)
4. **Deploy**
5. Entra en la función → **Secrets** → **Add new secret**:
   - `ACCESS_CODE` = `montaje-2026` (el que hayas elegido)

Con el CLI, en vez de lo anterior:

```bash
npx supabase login
npx supabase link --project-ref TU-REF
npx supabase secrets set ACCESS_CODE=montaje-2026
npx supabase functions deploy access --no-verify-jwt
```

**Prueba en local:**

```bash
npm run dev
```

Abre <http://localhost:5173>, introduce el código y elige un perfil. Si entras, todo lo
importante está bien configurado.

---

## ⑦ Subir el código a GitHub

```bash
git init
git add .
git commit -m "EventForge: versión inicial"
git branch -M main
```

Crea un repositorio **privado** en <https://github.com/new> llamado `eventforge`, **sin**
inicializarlo con README ni .gitignore. Después:

```bash
git remote add origin https://github.com/TU-USUARIO/eventforge.git
git push -u origin main
```

✅ Comprueba en GitHub que **no aparece `.env`**.

---

## ⑧ Importar en Vercel

1. <https://vercel.com> → *Sign up* con GitHub.
2. **Add New… → Project**.
3. Busca `eventforge` → **Import**.
4. Vercel detecta Vite solo. No cambies *Build Command* ni *Output Directory*.

---

## ⑨ Variables de entorno y despliegue

Despliega **Environment Variables** y añade **solo estas dos**:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://abcdefghijklm.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGci...` |

> 🚫 **No añadas `SUPABASE_SERVICE_ROLE_KEY` ni `ACCESS_CODE` aquí.** La primera se saltaría
> toda la seguridad; el segundo dejaría de ser un secreto de servidor.

Pulsa **Deploy**. En 1–2 minutos tendrás algo como:

```text
https://eventforge-abc123.vercel.app
```

Puedes cambiar el subdominio en **Settings → Domains → Edit** (por ejemplo
`eventforge-tuequipo.vercel.app`).

---

## ⑩ Conectar la URL con Supabase

1. Supabase → **Authentication → URL Configuration**
   - *Site URL*: `https://eventforge-abc123.vercel.app`
   - *Redirect URLs*: añade esa misma URL y `http://localhost:5173`
2. *(Recomendado)* Supabase → **Edge Functions → access → Secrets** → añade
   `ALLOWED_ORIGINS` con:
   ```text
   https://eventforge-abc123.vercel.app,http://localhost:5173
   ```
   Así solo tu web puede llamar a la función.

---

## ⑪ Probar de verdad

1. Abre la URL en tu ordenador → código → perfil **Juan** → deberías ver el Evento Demo.
2. Abre la misma URL en el móvil → código → perfil **María**.
3. Crea una tarea desde el móvil.
4. Recarga en el ordenador: la tarea está ahí.

Si esto funciona, tienes una aplicación web real: frontend en Internet, base de datos remota,
almacenamiento remoto y datos compartidos entre dispositivos.

---

## Lista de comprobación final

**Aplicación**
- [ ] La web se abre desde Internet
- [ ] Los datos persisten al recargar
- [ ] Dos dispositivos ven los mismos datos
- [ ] Se puede elegir perfil
- [ ] Se puede editar el perfil (nombre, cargo, foto)

**Eventos**
- [ ] Crear, editar, eliminar y duplicar
- [ ] El calendario muestra los eventos y permite arrastrarlos

**Almacén**
- [ ] Material, categorías, inventario
- [ ] Cajas con contenido

**Plano**
- [ ] Vista 2D y 3D
- [ ] Objetos con dimensiones y etiquetas
- [ ] Mover, rotar, duplicar
- [ ] Deshacer y rehacer
- [ ] Cableado eléctrico y de red
- [ ] Incidencias detectadas
- [ ] Capturas guardadas en Storage

**Horarios**
- [ ] Días, actividades, duplicación, colores, responsables

**Material**
- [ ] Generación automática desde el plano
- [ ] Comparación con el almacén y faltantes

**Tareas**
- [ ] Crear, asignar, cambiar estado y prioridad

**Almacén**
- [ ] Alta, edición, duplicado y baja de material
- [ ] Unidades disponibles en el editor de planos (`1/4 uds`)
- [ ] Cajas con contenido y duplicado de cajas
- [ ] Exportar a hoja de cálculo

**Personas**
- [ ] Añadir y eliminar perfiles desde Configuración (como administrador)

**Móvil**
- [ ] El plano se desplaza con un dedo y hace zoom con dos
- [ ] Las hojas de objetos, propiedades y opciones se abren y cierran

**Infraestructura**
- [ ] Base de datos remota
- [ ] Storage configurado
- [ ] Variables de entorno fuera del código
- [ ] RLS activa
- [ ] Copia de seguridad hecha
- [ ] README y despliegue documentados

---

## Problemas frecuentes en el despliegue

| Error | Solución |
|---|---|
| Build falla en Vercel con `tsc` | Ejecuta `npm run build` en local primero; el error será el mismo y más fácil de leer |
| La web carga pero dice «Falta configuración» | Faltan las variables en Vercel. Añádelas y pulsa **Redeploy** (no basta con guardarlas) |
| «Código de acceso incorrecto» en producción pero bien en local | El secreto `ACCESS_CODE` no está puesto en Supabase, o la función no se ha redesplegado |
| Error de CORS al pedir los perfiles | `ALLOWED_ORIGINS` no incluye la URL de Vercel |
| Recargar una ruta interna da 404 | `vercel.json` no está subido a Git |
| Las fotos de perfil no se ven | El bucket `avatars` no es público: vuelve a ejecutar el bloque de Storage de `0002_rls.sql` |
