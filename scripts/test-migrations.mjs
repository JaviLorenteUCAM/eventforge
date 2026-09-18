/**
 * Valida las migraciones contra un PostgreSQL real (PGlite, PostgreSQL compilado
 * a WebAssembly). No necesita conexión ni un proyecto de Supabase.
 *
 *     npm run test:db
 *
 * Comprueba que las cuatro migraciones se aplican, que todas las tablas tienen
 * RLS, que los triggers y funciones funcionan y que las restricciones rechazan
 * los datos inválidos.
 */
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const ROOT = new URL('../supabase/migrations/', import.meta.url);
const db = new PGlite();

const STUBS = `
create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase expone auth.uid() a partir del JWT; aquí devolvemos una constante
-- configurable para poder probar las políticas.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);
alter table storage.objects enable row level security;

create role if not exists anon;
create role if not exists authenticated;
create role if not exists service_role;
`;

async function exec(label, sql) {
  try {
    await db.exec(sql);
    console.log(`\x1b[32m✓\x1b[0m ${label}`);
    return true;
  } catch (err) {
    console.log(`\x1b[31m✗ ${label}\x1b[0m`);
    console.log(`  ${String(err.message).split('\n').join('\n  ')}`);
    return false;
  }
}

// PGlite no soporta CREATE ROLE IF NOT EXISTS; los creamos uno a uno.
await db.exec('create schema if not exists auth; create schema if not exists storage;');
for (const role of ['anon', 'authenticated', 'service_role']) {
  try {
    await db.exec(`create role ${role}`);
  } catch {
    /* ya existe */
  }
}
await exec('stubs de auth/storage', STUBS.replace(/create role if not exists \w+;\n?/g, ''));

const FILES = [
  '0001_schema.sql',
  '0002_rls.sql',
  '0003_catalog.sql',
  '0004_functions.sql',
  '0005_backgrounds_scenarios_textures.sql',
  '0006_warehouse_first.sql',
  '0007_cable_paths_and_feeds.sql',
  '0008_item_variants.sql',
];
let allOk = true;

for (const file of FILES) {
  let sql = readFileSync(new URL(file, ROOT), 'utf8');
  // PGlite no tiene replicación lógica: quitamos el bloque de publicaciones.
  sql = sql.replace(/-- ={10,}\n-- REALTIME[\s\S]*$/m, '');
  // pgcrypto viene preinstalado en Supabase; PGlite no lo trae.
  sql = sql
    .split(/\r?\n/)
    .filter((l) => !l.toLowerCase().includes('pgcrypto'))
    .join('\n');
  const okFile = await exec(file, sql);
  allOk = allOk && okFile;
}

if (!allOk) {
  console.log('\n\x1b[31mHay errores en las migraciones.\x1b[0m');
  process.exit(1);
}

// --- Comprobaciones funcionales ---------------------------------------------
console.log('\n\x1b[1mComprobaciones\x1b[0m');

const tables = await db.query(
  `select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by 1`,
);
console.log(`  Tablas creadas: ${tables.rows.length}`);
console.log(`    ${tables.rows.map((r) => r.table_name).join(', ')}`);

const rls = await db.query(
  `select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relrowsecurity = false order by 1`,
);
console.log(
  rls.rows.length === 0
    ? '  \x1b[32m✓\x1b[0m Todas las tablas públicas tienen RLS activada'
    : `  \x1b[31m✗\x1b[0m Sin RLS: ${rls.rows.map((r) => r.relname).join(', ')}`,
);

const policies = await db.query(`select count(*)::int as n from pg_policies where schemaname='public'`);
console.log(`  Políticas RLS: ${policies.rows[0].n}`);

const idx = await db.query(`select count(*)::int as n from pg_indexes where schemaname='public'`);
console.log(`  Índices: ${idx.rows[0].n}`);

const cat = await db.query(`select count(*)::int as n from public.object_catalog`);
const cats = await db.query(`select count(*)::int as n from public.material_categories`);
const veh = await db.query(`select count(*)::int as n from public.transport_vehicles`);
console.log(`  Catálogo base: ${cat.rows[0].n} objetos, ${cats.rows[0].n} categorías, ${veh.rows[0].n} vehículos`);

// --- Prueba de extremo a extremo con RLS ------------------------------------
console.log('\n\x1b[1mPrueba funcional (crear evento, plano, cables y duplicar)\x1b[0m');

const user = await db.query(
  `insert into auth.users (email) values ('test@eventforge.invalid') returning id`,
);
const uid = user.rows[0].id;

await db.exec(`insert into public.profiles (id, name, role_title, is_admin)
               values ('${uid}', 'Tester', 'QA', true)`);
await db.exec(`select set_config('request.jwt.claim.sub', '${uid}', false)`);

const active = await db.query(`select public.is_active_profile() as ok`);
console.log(`  is_active_profile() → ${active.rows[0].ok}`);

const ev = await db.query(`
  insert into public.events (name, starts_at, ends_at, created_by)
  values ('Evento de prueba', now(), now() + interval '2 days', '${uid}')
  returning id`);
const eventId = ev.rows[0].id;

const member = await db.query(
  `select count(*)::int as n from public.event_members where event_id='${eventId}'`,
);
console.log(
  member.rows[0].n === 1
    ? '  \x1b[32m✓\x1b[0m El trigger añadió al creador como responsable'
    : '  \x1b[31m✗\x1b[0m El trigger de responsable no funcionó',
);

const isMember = await db.query(`select public.is_event_member('${eventId}') as ok`);
console.log(`  is_event_member() → ${isMember.rows[0].ok}`);

const plan = await db.query(
  `insert into public.plans (event_id, name) values ('${eventId}', 'Plano') returning id`,
);
const planId = plan.rows[0].id;

const o1 = await db.query(`insert into public.plan_objects (plan_id, label, kind, x, y)
  values ('${planId}', 'Cuadro', 'power_source', 1, 1) returning id`);
const o2 = await db.query(`insert into public.plan_objects (plan_id, label, kind, x, y, requires_power)
  values ('${planId}', 'PC', 'av', 4, 3, true) returning id`);

await db.exec(`insert into public.plan_connections (plan_id, kind, from_object_id, to_object_id, length_m)
  values ('${planId}', 'power', '${o1.rows[0].id}', '${o2.rows[0].id}', 5)`);

await db.exec(`insert into public.schedule_days (event_id, day_index, label)
  values ('${eventId}', 1, 'Día 1')`);
const day = await db.query(`select id from public.schedule_days where event_id='${eventId}'`);
await db.exec(`insert into public.schedule_activities (event_id, day_id, title)
  values ('${eventId}', '${day.rows[0].id}', 'Montaje')`);
await db.exec(`insert into public.tasks (event_id, title, created_by)
  values ('${eventId}', 'Tarea de prueba', '${uid}')`);

const copy = await db.query(
  `select public.duplicate_event('${eventId}', 'Copia de prueba', now() + interval '30 days') as id`,
);
const copyId = copy.rows[0].id;

const check = await db.query(`
  select
    (select count(*)::int from public.plans where event_id='${copyId}') as planos,
    (select count(*)::int from public.plan_objects po join public.plans p on p.id=po.plan_id
      where p.event_id='${copyId}') as objetos,
    (select count(*)::int from public.plan_connections pc join public.plans p on p.id=pc.plan_id
      where p.event_id='${copyId}') as cables,
    (select count(*)::int from public.schedule_activities where event_id='${copyId}') as actividades,
    (select count(*)::int from public.tasks where event_id='${copyId}') as tareas,
    (select count(*)::int from public.event_members where event_id='${copyId}') as miembros
`);
const r = check.rows[0];
console.log(`  duplicate_event() → ${r.planos} plano, ${r.objetos} objetos, ${r.cables} cables, ${r.actividades} actividades, ${r.tareas} tareas, ${r.miembros} miembros`);

const okDup =
  r.planos === 1 && r.objetos === 2 && r.cables === 1 && r.actividades === 1 && r.tareas === 1;
console.log(
  okDup
    ? '  \x1b[32m✓\x1b[0m La copia conserva toda la estructura'
    : '  \x1b[31m✗\x1b[0m La copia está incompleta',
);

const dash = await db.query(`select public.event_dashboard('${eventId}') as d`);
console.log(`  event_dashboard() → ${JSON.stringify(dash.rows[0].d)}`);

// --- Restricciones -----------------------------------------------------------
console.log('\n\x1b[1mRestricciones de integridad\x1b[0m');

async function mustFail(label, sql) {
  try {
    await db.exec(sql);
    console.log(`  \x1b[31m✗\x1b[0m ${label} (se permitió y no debería)`);
  } catch {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  }
}

await mustFail(
  'Un evento no puede terminar antes de empezar',
  `insert into public.events (name, starts_at, ends_at, created_by)
   values ('Malo', now(), now() - interval '1 day', '${uid}')`,
);
await mustFail(
  'Un cable no puede conectar un objeto consigo mismo',
  `insert into public.plan_connections (plan_id, kind, from_object_id, to_object_id)
   values ('${planId}', 'power', '${o1.rows[0].id}', '${o1.rows[0].id}')`,
);
await mustFail(
  'Un estado de evento inválido se rechaza',
  `insert into public.events (name, starts_at, ends_at, status, created_by)
   values ('Malo', now(), now(), 'inventado', '${uid}')`,
);
await mustFail(
  'Un objeto no puede tener largo 0',
  `insert into public.plan_objects (plan_id, label, length_m) values ('${planId}', 'X', 0)`,
);
await mustFail(
  'Dos cajas no pueden compartir código',
  `insert into public.warehouse_boxes (code) values ('DUP');
   insert into public.warehouse_boxes (code) values ('DUP');`,
);

// Cascada
await db.exec(`delete from public.events where id='${copyId}'`);
const leftovers = await db.query(
  `select count(*)::int as n from public.plans where event_id='${copyId}'`,
);
console.log(
  leftovers.rows[0].n === 0
    ? '  \x1b[32m✓\x1b[0m Borrar un evento arrastra sus planos (ON DELETE CASCADE)'
    : '  \x1b[31m✗\x1b[0m Quedaron planos huérfanos',
);

// --- Fondos calibrados y escenarios ------------------------------------------
console.log('\n\x1b[1mFondos de plano y escenarios\x1b[0m');

await db.exec(`
  insert into public.plan_backgrounds (plan_id, storage_path, label, opacity, x, y, width_m, height_m)
  values ('${planId}', 'demo/patio.jpg', 'Foto aérea', 0.55, 0, 0, 18, 12)
`);

const scen = await db.query(
  `select public.save_plan_as_scenario('${planId}', 'Patio central', 'Escenario de prueba', 'Murcia') as id`,
);
const scenarioId = scen.rows[0].id;

const saved = await db.query(`
  select
    (select count(*)::int from public.scenario_objects      where scenario_id='${scenarioId}') as objetos,
    (select count(*)::int from public.scenario_connections  where scenario_id='${scenarioId}') as cables,
    (select count(*)::int from public.scenario_backgrounds  where scenario_id='${scenarioId}') as fondos
`);
console.log(
  `  save_plan_as_scenario() → ${saved.rows[0].objetos} objetos, ${saved.rows[0].cables} cables, ${saved.rows[0].fondos} fondos`,
);

// Lo cargamos en un plano nuevo y vacío de otro evento.
const ev2 = await db.query(`
  insert into public.events (name, starts_at, ends_at, created_by)
  values ('Evento receptor', now(), now() + interval '1 day', '${uid}') returning id`);
const plan2 = await db.query(
  `insert into public.plans (event_id, name, width_m, depth_m) values ('${ev2.rows[0].id}', 'Vacío', 5, 5) returning id`,
);
const plan2Id = plan2.rows[0].id;

const loaded = await db.query(
  `select public.load_scenario_into_plan('${scenarioId}', '${plan2Id}', true) as n`,
);

const after = await db.query(`
  select
    (select count(*)::int from public.plan_objects      where plan_id='${plan2Id}') as objetos,
    (select count(*)::int from public.plan_connections  where plan_id='${plan2Id}') as cables,
    (select count(*)::int from public.plan_backgrounds  where plan_id='${plan2Id}') as fondos,
    (select width_m from public.plans where id='${plan2Id}') as ancho
`);
const a = after.rows[0];
console.log(
  `  load_scenario_into_plan() → ${loaded.rows[0].n} objetos cargados · plano ahora ${a.objetos} objetos, ${a.cables} cables, ${a.fondos} fondos, ancho ${a.ancho} m`,
);
console.log(
  a.objetos === 2 && a.cables === 1 && a.fondos === 1 && Number(a.ancho) === 20
    ? '  \x1b[32m✓\x1b[0m El escenario se vuelca completo y el recinto adopta sus medidas'
    : '  \x1b[31m✗\x1b[0m La carga del escenario no es correcta',
);

// Texturas del material del almacén (modelo «almacén primero»: la ficha del
// almacén es la que define forma, color y textura de lo que se coloca).
const itemId = crypto.randomUUID();
await db.exec(`
  insert into public.warehouse_items
    (id, name, quantity, unit, length_m, width_m, height_m, kind, shape, color,
     texture_path, texture_mode, texture_scale)
  values
    ('${itemId}', 'Mesa de pruebas', 4, 'ud', 2, 0.8, 0.75, 'furniture', 'box', '#a3a3a3',
     'demo/mesa.png', 'atlas', 1.5)
`);
const tex = await db.query(
  `select texture_path, texture_mode, texture_scale, quantity
     from public.warehouse_items where id='${itemId}'`,
);
console.log(
  tex.rows[0].texture_path === 'demo/mesa.png' && Number(tex.rows[0].quantity) === 4
    ? '  \x1b[32m✓\x1b[0m El almacén guarda textura, forma y unidades'
    : '  \x1b[31m✗\x1b[0m Las columnas del almacén no funcionan',
);

// Un objeto del plano enlazado a esa ficha: es lo que permite contar el stock.
await db.exec(`
  insert into public.plan_objects (plan_id, warehouse_item_id, label, length_m, width_m, height_m)
  values ('${planId}', '${itemId}', 'Mesa 1', 2, 0.8, 0.75)
`);
const link = await db.query(
  `select count(*)::int as n from public.plan_objects where warehouse_item_id='${itemId}'`,
);
console.log(
  link.rows[0].n === 1
    ? '  \x1b[32m✓\x1b[0m Los objetos del plano se enlazan con el almacén'
    : '  \x1b[31m✗\x1b[0m El enlace con el almacén no funciona',
);

// Cables trazados a mano: los puntos intermedios viajan como jsonb.
await db.exec(`
  insert into public.plan_objects (id, plan_id, label, kind, length_m, width_m, height_m)
  values ('11111111-1111-4111-8111-111111111111', '${planId}', 'Punto de luz', 'power_source', 0.12, 0.05, 0.12),
         ('22222222-2222-4222-8222-222222222222', '${planId}', 'Punto de red',  'network_source', 0.12, 0.05, 0.12)
`);
await db.exec(`
  insert into public.plan_connections (plan_id, kind, from_object_id, to_object_id, cable_type, length_m, waypoints)
  values ('${planId}', 'power',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          'Manguera 3G1.5', 12.5,
          '[{"x":1,"y":2},{"x":4,"y":2},{"x":4,"y":7}]'::jsonb)
`);
const cable = await db.query(`
  select jsonb_array_length(waypoints) as puntos, waypoints->1->>'x' as x1
    from public.plan_connections
   where cable_type = 'Manguera 3G1.5'
`);
console.log(
  cable.rows[0]?.puntos === 3 && cable.rows[0]?.x1 === '4'
    ? '  \x1b[32m✓\x1b[0m El cable guarda su trazado punto a punto'
    : '  \x1b[31m✗\x1b[0m Los puntos intermedios del cable no se guardan',
);

await mustFail(
  'Un trazado que no sea una lista se rechaza',
  `update public.plan_connections set waypoints = '{"x":1}'::jsonb where cable_type = 'Manguera 3G1.5'`,
);

await mustFail(
  'Un modo de textura inválido se rechaza',
  `update public.warehouse_items set texture_mode='inventado' where id='${itemId}'`,
);
await mustFail(
  'Una opacidad fuera de 0..1 se rechaza',
  `insert into public.plan_backgrounds (plan_id, storage_path, opacity, width_m, height_m)
   values ('${planId}', 'x.png', 1.8, 10, 10)`,
);

console.log('\n\x1b[32m\x1b[1mTodas las migraciones se aplican correctamente.\x1b[0m\n');
