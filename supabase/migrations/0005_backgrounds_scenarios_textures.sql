-- ============================================================================
-- EventForge · 0005_backgrounds_scenarios_textures.sql
--
--   1. Imágenes de fondo del plano (referencia calibrada + capas de textura)
--   2. Escenarios reutilizables (guardar un plano y cargarlo en otro evento)
--   3. Texturas de los objetos de la biblioteca
--   4. Actualización de duplicate_event() para que copie también los fondos
-- ============================================================================

-- ===========================================================================
-- 1. IMÁGENES DE FONDO DEL PLANO
-- ---------------------------------------------------------------------------
-- Varias capas por plano: la primera suele ser la foto aérea o el plano del
-- recinto (referencia para dibujar encima) y las siguientes, texturas.
-- La posición y el tamaño van en METROS, igual que todo lo demás, de modo que
-- tras calibrar la imagen el resto del editor encaja sin conversiones.
-- (x, y) es la esquina superior izquierda de la imagen.
-- ===========================================================================
create table if not exists public.plan_backgrounds (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  storage_path text not null,
  label       text not null default '',
  opacity     numeric(4,3) not null default 0.6 check (opacity >= 0 and opacity <= 1),
  x           numeric(10,3) not null default 0,
  y           numeric(10,3) not null default 0,
  width_m     numeric(10,3) not null check (width_m > 0),
  height_m    numeric(10,3) not null check (height_m > 0),
  rotation    numeric(6,2)  not null default 0,
  z_index     integer not null default 0,
  visible     boolean not null default true,
  locked      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists plan_backgrounds_plan_idx on public.plan_backgrounds (plan_id, z_index);

drop trigger if exists plan_backgrounds_updated on public.plan_backgrounds;
create trigger plan_backgrounds_updated before update on public.plan_backgrounds
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- 2. ESCENARIOS REUTILIZABLES
-- ---------------------------------------------------------------------------
-- Un escenario es una plantilla de plano independiente de cualquier evento:
-- recinto, objetos, cableado y fondos. Para un evento recurrente en el mismo
-- espacio, se guarda una vez y se carga en cada edición.
-- ===========================================================================
create table if not exists public.scenarios (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) between 1 and 140),
  description    text not null default '',
  location       text not null default '',
  width_m        numeric(10,3) not null default 20 check (width_m  > 0),
  depth_m        numeric(10,3) not null default 14 check (depth_m  > 0),
  height_m       numeric(10,3) not null default 4  check (height_m > 0),
  grid_size_m    numeric(10,3) not null default 0.5 check (grid_size_m > 0),
  thumbnail_path text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists scenarios_name_idx on public.scenarios (lower(name));

drop trigger if exists scenarios_updated on public.scenarios;
create trigger scenarios_updated before update on public.scenarios
  for each row execute function public.tg_set_updated_at();

create table if not exists public.scenario_objects (
  id                uuid primary key default gen_random_uuid(),
  scenario_id       uuid not null references public.scenarios(id) on delete cascade,
  catalog_id        uuid references public.object_catalog(id) on delete set null,
  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  label             text not null default '',
  kind              text not null default 'generic',
  category_id       uuid references public.material_categories(id) on delete set null,
  x                 numeric(10,3) not null default 0,
  y                 numeric(10,3) not null default 0,
  z                 numeric(10,3) not null default 0,
  rotation          numeric(6,2)  not null default 0,
  length_m          numeric(10,3) not null default 1 check (length_m > 0),
  width_m           numeric(10,3) not null default 1 check (width_m  > 0),
  height_m          numeric(10,3) not null default 1 check (height_m > 0),
  weight_kg         numeric(10,3) not null default 0 check (weight_kg >= 0),
  color             text not null default '#94a3b8',
  shape             text not null default 'box',
  requires_power    boolean not null default false,
  requires_network  boolean not null default false,
  power_w           numeric(10,2) not null default 0,
  outlet_count      integer not null default 0,
  port_count        integer not null default 0,
  locked            boolean not null default false,
  props             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);
create index if not exists scenario_objects_scenario_idx on public.scenario_objects (scenario_id);

create table if not exists public.scenario_connections (
  id             uuid primary key default gen_random_uuid(),
  scenario_id    uuid not null references public.scenarios(id) on delete cascade,
  kind           text not null check (kind in ('power','network')),
  from_object_id uuid not null references public.scenario_objects(id) on delete cascade,
  to_object_id   uuid not null references public.scenario_objects(id) on delete cascade,
  cable_type     text not null default '',
  length_m       numeric(10,3) not null default 0,
  color          text not null default '#22d3ee',
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  constraint scenario_connections_not_self check (from_object_id <> to_object_id)
);
create index if not exists scenario_connections_scenario_idx on public.scenario_connections (scenario_id);

create table if not exists public.scenario_backgrounds (
  id           uuid primary key default gen_random_uuid(),
  scenario_id  uuid not null references public.scenarios(id) on delete cascade,
  storage_path text not null,
  label        text not null default '',
  opacity      numeric(4,3) not null default 0.6 check (opacity >= 0 and opacity <= 1),
  x            numeric(10,3) not null default 0,
  y            numeric(10,3) not null default 0,
  width_m      numeric(10,3) not null check (width_m > 0),
  height_m     numeric(10,3) not null check (height_m > 0),
  rotation     numeric(6,2)  not null default 0,
  z_index      integer not null default 0,
  visible      boolean not null default true,
  locked       boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists scenario_backgrounds_scenario_idx
  on public.scenario_backgrounds (scenario_id, z_index);

-- ===========================================================================
-- 3. TEXTURAS DE LA BIBLIOTECA DE OBJETOS
-- ---------------------------------------------------------------------------
-- texture_mode:
--   'atlas' -> la imagen es el DESPLIEGUE del objeto (plantilla en cruz), cada
--              cara ocupa su recuadro. Es lo que exporta la plantilla.
--   'tile'  -> la misma imagen se repite en todas las caras (madera, tela...).
-- ===========================================================================
alter table public.object_catalog
  add column if not exists texture_path     text,
  add column if not exists texture_mode     text not null default 'atlas',
  add column if not exists texture_scale    numeric(6,3) not null default 1,
  add column if not exists texture_offset_x numeric(6,3) not null default 0,
  add column if not exists texture_offset_y numeric(6,3) not null default 0,
  add column if not exists texture_rotation numeric(6,2) not null default 0;

do $do$
begin
  alter table public.object_catalog
    add constraint object_catalog_texture_mode_ck
    check (texture_mode in ('atlas','tile'));
exception
  when duplicate_object then null;
end
$do$;

do $do$
begin
  alter table public.object_catalog
    add constraint object_catalog_texture_scale_ck check (texture_scale > 0);
exception
  when duplicate_object then null;
end
$do$;

-- ===========================================================================
-- 4. RLS
-- ===========================================================================
alter table public.plan_backgrounds      enable row level security;
alter table public.scenarios             enable row level security;
alter table public.scenario_objects      enable row level security;
alter table public.scenario_connections  enable row level security;
alter table public.scenario_backgrounds  enable row level security;

-- Fondos del plano: mismo criterio que los objetos del plano.
drop policy if exists plan_backgrounds_select on public.plan_backgrounds;
create policy plan_backgrounds_select on public.plan_backgrounds
  for select to authenticated using (public.is_active_profile());
drop policy if exists plan_backgrounds_write on public.plan_backgrounds;
create policy plan_backgrounds_write on public.plan_backgrounds
  for all to authenticated
  using (public.can_edit_plan(plan_id))
  with check (public.can_edit_plan(plan_id));

-- Escenarios: biblioteca compartida por todo el equipo, como el almacén.
drop policy if exists scenarios_all on public.scenarios;
create policy scenarios_all on public.scenarios
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists scenario_objects_all on public.scenario_objects;
create policy scenario_objects_all on public.scenario_objects
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists scenario_connections_all on public.scenario_connections;
create policy scenario_connections_all on public.scenario_connections
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists scenario_backgrounds_all on public.scenario_backgrounds;
create policy scenario_backgrounds_all on public.scenario_backgrounds
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

-- ===========================================================================
-- 5. BUCKETS NUEVOS
-- ---------------------------------------------------------------------------
-- Privados: se leen con URLs firmadas. Las texturas y los fondos los carga
-- WebGL, así que se firman con una caducidad larga (8 h) para que no expiren
-- en mitad de una sesión de edición.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('plan-backgrounds', 'plan-backgrounds', false, 15728640,
   array['image/png','image/jpeg','image/webp']),
  ('textures',         'textures',         false, 10485760,
   array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "media buckets read" on storage.objects;
create policy "media buckets read" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('plan-backgrounds','textures') and public.is_active_profile()
  );

drop policy if exists "media buckets write" on storage.objects;
create policy "media buckets write" on storage.objects
  for all to authenticated
  using (bucket_id in ('plan-backgrounds','textures') and public.is_active_profile())
  with check (bucket_id in ('plan-backgrounds','textures') and public.is_active_profile());

-- ===========================================================================
-- 6. FUNCIONES DE ESCENARIO
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- save_plan_as_scenario(): congela un plano como plantilla reutilizable.
-- ---------------------------------------------------------------------------
create or replace function public.save_plan_as_scenario(
  p_plan        uuid,
  p_name        text,
  p_description text default '',
  p_location    text default ''
)
returns uuid
language plpgsql
as $fn$
declare
  v_plan     public.plans%rowtype;
  v_scenario uuid;
  v_obj      record;
  v_new_obj  uuid;
  v_map      jsonb := '{}'::jsonb;
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found then
    raise exception 'El plano no existe o no es accesible';
  end if;

  insert into public.scenarios
    (name, description, location, width_m, depth_m, height_m, grid_size_m, created_by)
  values
    (coalesce(nullif(trim(p_name), ''), v_plan.name), p_description, p_location,
     v_plan.width_m, v_plan.depth_m, v_plan.height_m, v_plan.grid_size_m, auth.uid())
  returning id into v_scenario;

  for v_obj in select * from public.plan_objects where plan_id = p_plan loop
    insert into public.scenario_objects
      (scenario_id, catalog_id, warehouse_item_id, label, kind, category_id,
       x, y, z, rotation, length_m, width_m, height_m, weight_kg, color, shape,
       requires_power, requires_network, power_w, outlet_count, port_count, locked, props)
    values
      (v_scenario, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.label, v_obj.kind,
       v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.length_m,
       v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
       v_obj.requires_power, v_obj.requires_network, v_obj.power_w, v_obj.outlet_count,
       v_obj.port_count, v_obj.locked, v_obj.props)
    returning id into v_new_obj;

    v_map := v_map || jsonb_build_object(v_obj.id::text, v_new_obj::text);
  end loop;

  insert into public.scenario_connections
    (scenario_id, kind, from_object_id, to_object_id, cable_type, length_m, color, notes)
  select
    v_scenario, c.kind,
    (v_map ->> c.from_object_id::text)::uuid,
    (v_map ->> c.to_object_id::text)::uuid,
    c.cable_type, c.length_m, c.color, c.notes
  from public.plan_connections c
  where c.plan_id = p_plan
    and v_map ? c.from_object_id::text
    and v_map ? c.to_object_id::text;

  insert into public.scenario_backgrounds
    (scenario_id, storage_path, label, opacity, x, y, width_m, height_m, rotation,
     z_index, visible, locked)
  select v_scenario, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
         b.rotation, b.z_index, b.visible, b.locked
  from public.plan_backgrounds b
  where b.plan_id = p_plan;

  return v_scenario;
end;
$fn$;

revoke all on function public.save_plan_as_scenario(uuid, text, text, text) from public;
grant execute on function public.save_plan_as_scenario(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- load_scenario_into_plan(): vuelca un escenario sobre un plano existente.
--   p_replace = true  -> vacía antes el plano (objetos, cables y fondos)
--   p_replace = false -> añade encima de lo que ya hubiera
-- Devuelve el número de objetos cargados.
-- ---------------------------------------------------------------------------
create or replace function public.load_scenario_into_plan(
  p_scenario uuid,
  p_plan     uuid,
  p_replace  boolean default true
)
returns integer
language plpgsql
as $fn$
declare
  v_scenario public.scenarios%rowtype;
  v_obj      record;
  v_new_obj  uuid;
  v_map      jsonb := '{}'::jsonb;
  v_count    integer := 0;
begin
  select * into v_scenario from public.scenarios where id = p_scenario;
  if not found then
    raise exception 'El escenario no existe o no es accesible';
  end if;

  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'El plano de destino no existe o no es accesible';
  end if;

  if p_replace then
    delete from public.plan_objects     where plan_id = p_plan;  -- arrastra los cables
    delete from public.plan_backgrounds where plan_id = p_plan;
  end if;

  -- El recinto del escenario manda: es lo que define el espacio real.
  update public.plans
     set width_m     = v_scenario.width_m,
         depth_m     = v_scenario.depth_m,
         height_m    = v_scenario.height_m,
         grid_size_m = v_scenario.grid_size_m
   where id = p_plan;

  for v_obj in select * from public.scenario_objects where scenario_id = p_scenario loop
    insert into public.plan_objects
      (plan_id, catalog_id, warehouse_item_id, label, kind, category_id,
       x, y, z, rotation, length_m, width_m, height_m, weight_kg, color, shape,
       requires_power, requires_network, power_w, outlet_count, port_count, locked, props)
    values
      (p_plan, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.label, v_obj.kind,
       v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.length_m,
       v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
       v_obj.requires_power, v_obj.requires_network, v_obj.power_w, v_obj.outlet_count,
       v_obj.port_count, v_obj.locked, v_obj.props)
    returning id into v_new_obj;

    v_map := v_map || jsonb_build_object(v_obj.id::text, v_new_obj::text);
    v_count := v_count + 1;
  end loop;

  insert into public.plan_connections
    (plan_id, kind, from_object_id, to_object_id, cable_type, length_m, color, notes)
  select
    p_plan, c.kind,
    (v_map ->> c.from_object_id::text)::uuid,
    (v_map ->> c.to_object_id::text)::uuid,
    c.cable_type, c.length_m, c.color, c.notes
  from public.scenario_connections c
  where c.scenario_id = p_scenario
    and v_map ? c.from_object_id::text
    and v_map ? c.to_object_id::text;

  insert into public.plan_backgrounds
    (plan_id, storage_path, label, opacity, x, y, width_m, height_m, rotation,
     z_index, visible, locked)
  select p_plan, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
         b.rotation, b.z_index, b.visible, b.locked
  from public.scenario_backgrounds b
  where b.scenario_id = p_scenario;

  return v_count;
end;
$fn$;

revoke all on function public.load_scenario_into_plan(uuid, uuid, boolean) from public;
grant execute on function public.load_scenario_into_plan(uuid, uuid, boolean) to authenticated;

-- ===========================================================================
-- 7. duplicate_event() ahora copia también las imágenes de fondo
-- ===========================================================================
create or replace function public.duplicate_event(
  p_event     uuid,
  p_name      text,
  p_starts_at timestamptz
)
returns uuid
language plpgsql
as $fn$
declare
  v_src        public.events%rowtype;
  v_new_id     uuid;
  v_delta      interval;
  v_plan       record;
  v_new_plan   uuid;
  v_obj        record;
  v_day        record;
  v_new_day    uuid;
  v_act        record;
  v_new_act    uuid;
  v_task       record;
  v_load       record;
  v_new_load   uuid;
  v_obj_map    jsonb := '{}'::jsonb;
begin
  select * into v_src from public.events where id = p_event;
  if not found then
    raise exception 'El evento origen no existe o no es accesible';
  end if;

  v_delta := p_starts_at - v_src.starts_at;

  insert into public.events
    (name, description, location, starts_at, ends_at, status, cover_path, notes, color, created_by)
  values
    (coalesce(nullif(trim(p_name), ''), v_src.name || ' (copia)'),
     v_src.description, v_src.location,
     p_starts_at, v_src.ends_at + v_delta,
     'planning', v_src.cover_path, v_src.notes, v_src.color, auth.uid())
  returning id into v_new_id;

  insert into public.event_members (event_id, profile_id, role)
  select v_new_id, m.profile_id, m.role
  from public.event_members m
  where m.event_id = p_event
  on conflict do nothing;

  for v_plan in select * from public.plans where event_id = p_event loop
    insert into public.plans (event_id, name, width_m, depth_m, height_m, grid_size_m, is_default)
    values (v_new_id, v_plan.name, v_plan.width_m, v_plan.depth_m, v_plan.height_m,
            v_plan.grid_size_m, v_plan.is_default)
    returning id into v_new_plan;

    for v_obj in select * from public.plan_objects where plan_id = v_plan.id loop
      declare
        v_new_obj uuid;
      begin
        insert into public.plan_objects
          (plan_id, catalog_id, warehouse_item_id, label, kind, category_id,
           x, y, z, rotation, length_m, width_m, height_m, weight_kg, color, shape,
           requires_power, requires_network, power_w, outlet_count, port_count, locked, props)
        values
          (v_new_plan, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.label, v_obj.kind,
           v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.length_m,
           v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
           v_obj.requires_power, v_obj.requires_network, v_obj.power_w, v_obj.outlet_count,
           v_obj.port_count, v_obj.locked, v_obj.props)
        returning id into v_new_obj;

        v_obj_map := v_obj_map || jsonb_build_object(v_obj.id::text, v_new_obj::text);
      end;
    end loop;

    insert into public.plan_connections
      (plan_id, kind, from_object_id, to_object_id, cable_type, length_m, color, notes)
    select
      v_new_plan, c.kind,
      (v_obj_map ->> c.from_object_id::text)::uuid,
      (v_obj_map ->> c.to_object_id::text)::uuid,
      c.cable_type, c.length_m, c.color, c.notes
    from public.plan_connections c
    where c.plan_id = v_plan.id
      and v_obj_map ? c.from_object_id::text
      and v_obj_map ? c.to_object_id::text;

    -- NUEVO: las imágenes de fondo calibradas viajan con la copia.
    insert into public.plan_backgrounds
      (plan_id, storage_path, label, opacity, x, y, width_m, height_m, rotation,
       z_index, visible, locked)
    select v_new_plan, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
           b.rotation, b.z_index, b.visible, b.locked
    from public.plan_backgrounds b
    where b.plan_id = v_plan.id;
  end loop;

  for v_day in select * from public.schedule_days where event_id = p_event order by day_index loop
    insert into public.schedule_days (event_id, day_index, date, label)
    values (v_new_id, v_day.day_index,
            case when v_day.date is null then null else (v_day.date + v_delta)::date end,
            v_day.label)
    returning id into v_new_day;

    for v_act in select * from public.schedule_activities where day_id = v_day.id loop
      insert into public.schedule_activities
        (event_id, day_id, title, description, starts_at, ends_at, color, notes)
      values
        (v_new_id, v_new_day, v_act.title, v_act.description, v_act.starts_at,
         v_act.ends_at, v_act.color, v_act.notes)
      returning id into v_new_act;

      insert into public.schedule_activity_members (activity_id, profile_id)
      select v_new_act, am.profile_id
      from public.schedule_activity_members am
      where am.activity_id = v_act.id
      on conflict do nothing;
    end loop;
  end loop;

  for v_task in select * from public.tasks where event_id = p_event loop
    insert into public.tasks
      (event_id, title, description, assignee_id, priority, status, due_date, position, created_by)
    values
      (v_new_id, v_task.title, v_task.description, v_task.assignee_id, v_task.priority,
       'pending',
       case when v_task.due_date is null then null else (v_task.due_date + v_delta)::date end,
       v_task.position, auth.uid());
  end loop;

  for v_load in select * from public.transport_loads where event_id = p_event loop
    insert into public.transport_loads (event_id, vehicle_id, name, notes)
    values (v_new_id, v_load.vehicle_id, v_load.name, v_load.notes)
    returning id into v_new_load;

    insert into public.transport_items
      (load_id, source_kind, item_id, box_id, label, quantity, x, y, z, rotation,
       length_m, width_m, height_m, weight_kg, color)
    select v_new_load, t.source_kind, t.item_id, t.box_id, t.label, t.quantity,
           t.x, t.y, t.z, t.rotation, t.length_m, t.width_m, t.height_m, t.weight_kg, t.color
    from public.transport_items t
    where t.load_id = v_load.id;
  end loop;

  return v_new_id;
end;
$fn$;

revoke all on function public.duplicate_event(uuid, text, timestamptz) from public;
grant execute on function public.duplicate_event(uuid, text, timestamptz) to authenticated;

-- ===========================================================================
-- 8. REALTIME
-- ===========================================================================
do $do$
declare
  t text;
begin
  foreach t in array array['plan_backgrounds','scenarios','scenario_objects'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end
$do$;
