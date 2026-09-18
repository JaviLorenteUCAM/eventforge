# Copias de seguridad y recuperación

Tus datos de eventos son importantes. Este documento explica qué hace Supabase por ti, qué
deberías hacer tú, y cómo recuperar la aplicación si algo sale mal.

---

## 1. Qué hace Supabase automáticamente

| Plan | Copias | Retención | Restauración | Limitaciones |
|---|---|---|---|---|
| **Free** | Diarias | 7 días | Hay que **abrir un ticket al soporte** | No hay botón de restaurar. El proyecto **se pausa a los 7 días sin actividad**. |
| **Pro (25 $/mes)** | Diarias | 7 días | Desde el panel, en unos minutos | *Point-in-Time Recovery* (restaurar a un minuto concreto) es un extra de pago |

**Conclusión honesta**: en el plan gratuito, las copias automáticas son una red de seguridad
parcial. **Haz tus propias copias.**

---

## 2. Tu copia de seguridad (recomendado)

### 2.1 Obtener la cadena de conexión

Supabase → **Project Settings → Database → Connection string → URI**. Tiene esta forma:

```text
postgresql://postgres:[TU-PASSWORD]@db.abcdefghijklm.supabase.co:5432/postgres
```

Sustituye `[TU-PASSWORD]` por la contraseña de base de datos que guardaste al crear el
proyecto. Si la has perdido, puedes regenerarla en esa misma pantalla.

### 2.2 Copia completa

Necesitas las herramientas de PostgreSQL instaladas (`pg_dump`, `psql`). En Windows vienen con
[PostgreSQL](https://www.postgresql.org/download/windows/); en macOS, con `brew install
libpq`.

```bash
pg_dump "postgresql://postgres:TU-PASSWORD@db.TU-REF.supabase.co:5432/postgres" \
  --clean --if-exists --no-owner --no-privileges \
  -f backup-eventforge-2026-09-17.sql
```

En PowerShell:

```powershell
pg_dump "postgresql://postgres:TU-PASSWORD@db.TU-REF.supabase.co:5432/postgres" `
  --clean --if-exists --no-owner --no-privileges `
  -f "backup-eventforge-$(Get-Date -Format yyyy-MM-dd).sql"
```

El fichero resultante contiene **el esquema y todos los datos**. Guárdalo fuera del
ordenador de trabajo (disco externo, Drive, Dropbox…).

### 2.3 Solo los datos (sin estructura)

Útil para reimportar sobre una base de datos ya migrada:

```bash
pg_dump "postgresql://..." --data-only --no-owner \
  --table='public.*' -f datos-2026-09-17.sql
```

### 2.4 Exportar sin instalar nada

Supabase → **Table Editor** → elige la tabla → menú **⋯** → **Export to CSV**.

Tablas que conviene exportar si haces esto a mano:
`profiles`, `events`, `event_members`, `tasks`, `schedule_days`, `schedule_activities`,
`plans`, `plan_objects`, `plan_connections`, `warehouse_items`, `warehouse_boxes`,
`warehouse_box_items`, `object_catalog`, `transport_loads`, `transport_items`,
`material_categories`.

---

## 3. Copia de las imágenes

⚠️ **`pg_dump` no incluye los ficheros de Storage.** Guarda las rutas, no las imágenes.

### Opción A · Manual

Supabase → **Storage** → cada bucket → seleccionar → **Download**.

### Opción B · Script

Guarda esto como `scripts/backup-storage.mjs` y ejecútalo con `node scripts/backup-storage.mjs`
(usa las variables de `.env`):

```js
import { createClient } from '@supabase/supabase-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

process.loadEnvFile('.env');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUCKETS = ['avatars', 'event-media', 'warehouse-photos', 'captures'];
const OUT = `backup-storage-${new Date().toISOString().slice(0, 10)}`;

async function walk(bucket, prefix = '') {
  const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;

  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      await walk(bucket, path); // es una carpeta
      continue;
    }
    const file = await db.storage.from(bucket).download(path);
    if (file.error) {
      console.warn('  ! no se pudo descargar', path);
      continue;
    }
    const dest = join(OUT, bucket, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(await file.data.arrayBuffer()));
    console.log('  ✓', bucket, path);
  }
}

for (const bucket of BUCKETS) {
  console.log(bucket);
  await walk(bucket);
}
console.log(`\nListo → ${OUT}/`);
```

---

## 4. Restaurar

### 4.1 Restaurar la base de datos completa

```bash
psql "postgresql://postgres:TU-PASSWORD@db.TU-REF.supabase.co:5432/postgres" \
  -f backup-eventforge-2026-09-17.sql
```

El volcado se hizo con `--clean --if-exists`, así que borra lo existente antes de recrearlo.
**Asegúrate de que es lo que quieres.**

### 4.2 Recuperación total desde cero

Si pierdes el proyecto de Supabase entero:

1. Crea un proyecto nuevo en Supabase.
2. Ejecuta las cuatro migraciones de `supabase/migrations/` en orden.
3. Restaura los datos con `psql -f tu-backup.sql`.
4. Vuelve a desplegar la Edge Function `access` y a configurar el secreto `ACCESS_CODE`.
5. Sube las imágenes guardadas a sus buckets (Storage → *Upload files*, respetando las
   carpetas).
6. Actualiza `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en Vercel y redespliega.

Tiempo estimado: unos 20 minutos.

### 4.3 Si lo que falla es el frontend

El código está en GitHub y Vercel guarda todos los despliegues:

- **Vercel → Deployments →** elige uno anterior **→ Promote to Production**. Vuelta atrás en
  segundos, sin tocar la base de datos.
- O `git revert <commit>` y `git push`.

### 4.4 Si alguien borra un evento por error

- Dentro del editor de planos, `Ctrl+Z` deshace los últimos 60 cambios de esa sesión.
- Para un evento completo eliminado hace falta restaurar desde una copia. Por eso conviene
  hacer una antes de cualquier limpieza grande.

---

## 5. Rutina recomendada

| Cuándo | Qué |
|---|---|
| **Antes de cada evento importante** | `pg_dump` completo |
| **Una vez al mes** | `pg_dump` + copia de Storage |
| **Antes de aplicar una migración nueva** | `pg_dump` completo |
| **Cada 6 meses** | Probar una restauración en un proyecto de Supabase de pruebas: una copia que nunca se ha probado no es una copia |

---

## 6. Automatizar (opcional)

### Con GitHub Actions

`.github/workflows/backup.yml` — copia semanal guardada como artefacto:

```yaml
name: Copia de seguridad semanal
on:
  schedule: [{ cron: '0 3 * * 1' }]   # lunes a las 03:00 UTC
  workflow_dispatch:

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Instalar cliente de PostgreSQL
        run: sudo apt-get update && sudo apt-get install -y postgresql-client

      - name: Volcar la base de datos
        env:
          DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: |
          pg_dump "$DB_URL" --clean --if-exists --no-owner --no-privileges \
            -f backup-$(date +%Y-%m-%d).sql

      - uses: actions/upload-artifact@v4
        with:
          name: backup-eventforge
          path: backup-*.sql
          retention-days: 90
```

Añade `SUPABASE_DB_URL` en **Settings → Secrets and variables → Actions** del repositorio.

> Los artefactos de GitHub caducan. Para conservarlos más tiempo, súbelos a un bucket de
> almacenamiento externo o descárgalos periódicamente.
