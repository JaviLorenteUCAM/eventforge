-- ===========================================================================
-- EventForge · 0019 · Zonas del plano
-- ===========================================================================
--
-- Para el montaje hace falta poder decir «esto es la Zona Fripozo»: un área
-- marcada con cuatro pines, con número y nombre, que aparece rotulada en el
-- plano exportado («1 - Zona Fripozo») y en su leyenda.
--
-- · plan_zones: número, nombre, color y los vértices en metros del plano
--   (jsonb, lista de {x, y}; cuatro al crearla, pero admite más).
-- · scenario_zones: lo mismo dentro de un escenario reutilizable.
-- · Mismas reglas de acceso que los fondos: lee cualquier perfil activo,
--   escribe quien puede editar el plano.
-- · Las tres funciones de copia son las de 0018 con las zonas añadidas:
--   guardar escenario, cargarlo (si reemplaza, borra las zonas de antes) y
--   duplicar el evento.
--
-- Migración aditiva.
-- ===========================================================================

create table if not exists public.plan_zones (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.plans(id) on delete cascade,
  number      integer not null default 1 check (number between 0 and 9999),
  name        text not null default '' check (length(name) <= 120),
  color       text not null default '#22d3ee',
  points      jsonb not null default '[]'::jsonb check (jsonb_typeof(points) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists plan_zones_plan_idx on public.plan_zones (plan_id, number);

drop trigger if exists plan_zones_updated on public.plan_zones;
create trigger plan_zones_updated before update on public.plan_zones
  for each row execute function public.tg_set_updated_at();

create table if not exists public.scenario_zones (
  id           uuid primary key default gen_random_uuid(),
  scenario_id  uuid not null references public.scenarios(id) on delete cascade,
  number       integer not null default 1 check (number between 0 and 9999),
  name         text not null default '' check (length(name) <= 120),
  color        text not null default '#22d3ee',
  points       jsonb not null default '[]'::jsonb check (jsonb_typeof(points) = 'array'),
  created_at   timestamptz not null default now()
);
create index if not exists scenario_zones_scenario_idx on public.scenario_zones (scenario_id);

alter table public.plan_zones     enable row level security;
alter table public.scenario_zones enable row level security;

drop policy if exists plan_zones_select on public.plan_zones;
create policy plan_zones_select on public.plan_zones
  for select to authenticated using (public.is_active_profile());
drop policy if exists plan_zones_write on public.plan_zones;
create policy plan_zones_write on public.plan_zones
  for all to authenticated
  using (public.can_edit_plan(plan_id))
  with check (public.can_edit_plan(plan_id));

drop policy if exists scenario_zones_all on public.scenario_zones;
create policy scenario_zones_all on public.scenario_zones
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

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
      (scenario_id, catalog_id, warehouse_item_id, variant_id, label, kind, category_id,
       x, y, z, rotation, tilt, roll, length_m, width_m, height_m, weight_kg, color, shape,
       requires_power, requires_network, requires_signal, requires_usb,
       power_w, outlet_count, port_count, signal_out_count, usb_port_count,
       locked, props)
    values
      (v_scenario, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.variant_id, v_obj.label, v_obj.kind,
       v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.tilt, v_obj.roll, v_obj.length_m,
       v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
       v_obj.requires_power, v_obj.requires_network, v_obj.requires_signal, v_obj.requires_usb,
       v_obj.power_w, v_obj.outlet_count,
       v_obj.port_count, v_obj.signal_out_count, v_obj.usb_port_count, v_obj.locked, v_obj.props)
    returning id into v_new_obj;

    v_map := v_map || jsonb_build_object(v_obj.id::text, v_new_obj::text);
  end loop;

  insert into public.scenario_connections
    (scenario_id, kind, from_object_id, to_object_id, cable_type, length_m, color, notes, waypoints)
  select
    v_scenario, c.kind,
    (v_map ->> c.from_object_id::text)::uuid,
    (v_map ->> c.to_object_id::text)::uuid,
    c.cable_type, c.length_m, c.color, c.notes, c.waypoints
  from public.plan_connections c
  where c.plan_id = p_plan
    and v_map ? c.from_object_id::text
    and v_map ? c.to_object_id::text;

  insert into public.scenario_backgrounds
    (scenario_id, storage_path, label, opacity, x, y, width_m, height_m, rotation,
     z_index, visible, locked, model_path,
     model_offset_x, model_offset_y, model_rotation, model_scale)
  select v_scenario, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
         b.rotation, b.z_index, b.visible, b.locked, b.model_path,
         b.model_offset_x, b.model_offset_y, b.model_rotation, b.model_scale
  from public.plan_backgrounds b
  where b.plan_id = p_plan;

  insert into public.scenario_zones (scenario_id, number, name, color, points)
  select v_scenario, z.number, z.name, z.color, z.points
  from public.plan_zones z
  where z.plan_id = p_plan;

  return v_scenario;
end;
$fn$;

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
    delete from public.plan_zones       where plan_id = p_plan;
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
      (plan_id, catalog_id, warehouse_item_id, variant_id, label, kind, category_id,
       x, y, z, rotation, tilt, roll, length_m, width_m, height_m, weight_kg, color, shape,
       requires_power, requires_network, requires_signal, requires_usb,
       power_w, outlet_count, port_count, signal_out_count, usb_port_count,
       locked, props)
    values
      (p_plan, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.variant_id, v_obj.label, v_obj.kind,
       v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.tilt, v_obj.roll, v_obj.length_m,
       v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
       v_obj.requires_power, v_obj.requires_network, v_obj.requires_signal, v_obj.requires_usb,
       v_obj.power_w, v_obj.outlet_count,
       v_obj.port_count, v_obj.signal_out_count, v_obj.usb_port_count, v_obj.locked, v_obj.props)
    returning id into v_new_obj;

    v_map := v_map || jsonb_build_object(v_obj.id::text, v_new_obj::text);
    v_count := v_count + 1;
  end loop;

  insert into public.plan_connections
    (plan_id, kind, from_object_id, to_object_id, cable_type, length_m, color, notes, waypoints)
  select
    p_plan, c.kind,
    (v_map ->> c.from_object_id::text)::uuid,
    (v_map ->> c.to_object_id::text)::uuid,
    c.cable_type, c.length_m, c.color, c.notes, c.waypoints
  from public.scenario_connections c
  where c.scenario_id = p_scenario
    and v_map ? c.from_object_id::text
    and v_map ? c.to_object_id::text;

  insert into public.plan_backgrounds
    (plan_id, storage_path, label, opacity, x, y, width_m, height_m, rotation,
     z_index, visible, locked, model_path,
     model_offset_x, model_offset_y, model_rotation, model_scale)
  select p_plan, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
         b.rotation, b.z_index, b.visible, b.locked, b.model_path,
         b.model_offset_x, b.model_offset_y, b.model_rotation, b.model_scale
  from public.scenario_backgrounds b
  where b.scenario_id = p_scenario;

  insert into public.plan_zones (plan_id, number, name, color, points)
  select p_plan, z.number, z.name, z.color, z.points
  from public.scenario_zones z
  where z.scenario_id = p_scenario;

  return v_count;
end;
$fn$;

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
          (plan_id, catalog_id, warehouse_item_id, variant_id, label, kind, category_id,
           x, y, z, rotation, tilt, roll, length_m, width_m, height_m, weight_kg, color, shape,
           requires_power, requires_network, requires_signal, requires_usb,
       power_w, outlet_count, port_count, signal_out_count, usb_port_count,
       locked, props)
        values
          (v_new_plan, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.variant_id, v_obj.label, v_obj.kind,
           v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.tilt, v_obj.roll, v_obj.length_m,
           v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
           v_obj.requires_power, v_obj.requires_network, v_obj.requires_signal, v_obj.requires_usb,
       v_obj.power_w, v_obj.outlet_count,
           v_obj.port_count, v_obj.signal_out_count, v_obj.usb_port_count, v_obj.locked, v_obj.props)
        returning id into v_new_obj;

        v_obj_map := v_obj_map || jsonb_build_object(v_obj.id::text, v_new_obj::text);
      end;
    end loop;

    insert into public.plan_connections
      (plan_id, kind, from_object_id, to_object_id, cable_type, length_m, color, notes, waypoints)
    select
      v_new_plan, c.kind,
      (v_obj_map ->> c.from_object_id::text)::uuid,
      (v_obj_map ->> c.to_object_id::text)::uuid,
      c.cable_type, c.length_m, c.color, c.notes, c.waypoints
    from public.plan_connections c
    where c.plan_id = v_plan.id
      and v_obj_map ? c.from_object_id::text
      and v_obj_map ? c.to_object_id::text;

    -- NUEVO: las imágenes de fondo calibradas viajan con la copia.
    insert into public.plan_backgrounds
      (plan_id, storage_path, label, opacity, x, y, width_m, height_m, rotation,
       z_index, visible, locked, model_path,
     model_offset_x, model_offset_y, model_rotation, model_scale)
    select v_new_plan, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
           b.rotation, b.z_index, b.visible, b.locked, b.model_path,
         b.model_offset_x, b.model_offset_y, b.model_rotation, b.model_scale
    from public.plan_backgrounds b
    where b.plan_id = v_plan.id;

    insert into public.plan_zones (plan_id, number, name, color, points)
    select v_new_plan, z.number, z.name, z.color, z.points
    from public.plan_zones z
    where z.plan_id = v_plan.id;
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

-- ===========================================================================
-- REALTIME
-- ===========================================================================
do $do$
begin
  alter publication supabase_realtime add table public.plan_zones;
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$do$;
