-- ===========================================================================
-- EventForge · 0008 · Estilos (variantes) del material
-- ===========================================================================
--
-- El problema
-- -----------
-- Hay cinco photocalls, pero cada uno lleva un dibujo distinto. Hay siete
-- mesas iguales, pero seis van con mantel negro y una con mantel rojo. Con una
-- sola ficha por material no había forma de decirlo: o se daban de alta cinco
-- materiales distintos (y entonces «photocall» dejaba de ser una cosa sola), o
-- se perdía la diferencia.
--
-- La solución
-- -----------
-- Un material del almacén puede tener varios ESTILOS. Cada estilo tiene:
--
--   · su nombre                 «Mantel rojo», «Photocall Feria 2026»
--   · sus propias unidades      cuántos hay de ESE estilo
--   · su textura y su color     lo que se ve en el plano, en 2D y en 3D
--   · si cuenta como material aparte
--
-- Esto último es la diferencia entre los dos casos de arriba:
--
--   · El photocall con otro dibujo NO añade material: sigue siendo un
--     photocall, solo que ese en concreto.
--   · La mesa con mantel rojo SÍ añade material: además de la mesa hay que
--     llevar el mantel. Si se ponen tres mesas, dos con mantel negro y una con
--     rojo, el listado del evento pide 3 mesas, 2 manteles negros y 1 rojo.
--
-- Cada objeto del plano recuerda con qué estilo se colocó (`variant_id`), así
-- que se pueden seleccionar por separado y el listado sabe qué hay que cargar.
--
-- Migración aditiva: no borra ni reescribe datos.
-- ===========================================================================

create table if not exists public.warehouse_item_variants (
  id               uuid primary key default gen_random_uuid(),
  item_id          uuid not null references public.warehouse_items(id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 120),
  -- Unidades de ESTE estilo. Puede no cuadrar con las del material: cinco
  -- photocalls con cinco dibujos son 5 y 1+1+1+1+1.
  quantity         numeric(10,2) not null default 1 check (quantity >= 0),
  -- Sin color propio se hereda el del material.
  color            text,
  texture_path     text,
  texture_mode     text not null default 'atlas' check (texture_mode in ('atlas','tile')),
  texture_scale    numeric(6,3) not null default 1 check (texture_scale > 0),
  texture_offset_x numeric(6,3) not null default 0,
  texture_offset_y numeric(6,3) not null default 0,
  texture_rotation numeric(6,2) not null default 0,
  -- ¿Se suma al listado de material del evento como línea aparte?
  adds_material    boolean not null default false,
  -- Con qué nombre aparece ahí. Vacío = el del propio estilo.
  material_name    text not null default '',
  material_unit    text not null default 'ud',
  sort_order       integer not null default 0,
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint warehouse_item_variants_unique_name unique (item_id, name)
);

create index if not exists warehouse_item_variants_item_idx
  on public.warehouse_item_variants (item_id, sort_order);

drop trigger if exists warehouse_item_variants_updated on public.warehouse_item_variants;
create trigger warehouse_item_variants_updated before update on public.warehouse_item_variants
  for each row execute function public.tg_set_updated_at();

comment on table public.warehouse_item_variants is
  'Estilos de un material: mismo objeto, distinto acabado, con sus propias unidades.';

-- --- Con qué estilo se colocó cada objeto ---------------------------------
alter table public.plan_objects
  add column if not exists variant_id uuid
  references public.warehouse_item_variants(id) on delete set null;

alter table public.scenario_objects
  add column if not exists variant_id uuid
  references public.warehouse_item_variants(id) on delete set null;

create index if not exists plan_objects_variant_idx on public.plan_objects (variant_id);

-- --- Seguridad -------------------------------------------------------------
-- Mismo criterio que el resto del almacén: cualquier perfil activo lo ve y lo
-- edita. El almacén es común a todo el equipo, no de un evento concreto.
alter table public.warehouse_item_variants enable row level security;

drop policy if exists "variants_select" on public.warehouse_item_variants;
create policy "variants_select" on public.warehouse_item_variants
  for select using (public.is_active_profile());

drop policy if exists "variants_insert" on public.warehouse_item_variants;
create policy "variants_insert" on public.warehouse_item_variants
  for insert with check (public.is_active_profile());

drop policy if exists "variants_update" on public.warehouse_item_variants;
create policy "variants_update" on public.warehouse_item_variants
  for update using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists "variants_delete" on public.warehouse_item_variants;
create policy "variants_delete" on public.warehouse_item_variants
  for delete using (public.is_active_profile());

-- --- Las copias arrastran el estilo ---------------------------------------
-- Las tres funciones son las de 0007 con `variant_id` añadido a los INSERT de
-- objetos. Lo demás queda igual.

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
       x, y, z, rotation, length_m, width_m, height_m, weight_kg, color, shape,
       requires_power, requires_network, power_w, outlet_count, port_count, locked, props)
    values
      (v_scenario, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.variant_id, v_obj.label, v_obj.kind,
       v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.length_m,
       v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
       v_obj.requires_power, v_obj.requires_network, v_obj.power_w, v_obj.outlet_count,
       v_obj.port_count, v_obj.locked, v_obj.props)
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
     z_index, visible, locked)
  select v_scenario, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
         b.rotation, b.z_index, b.visible, b.locked
  from public.plan_backgrounds b
  where b.plan_id = p_plan;

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
       x, y, z, rotation, length_m, width_m, height_m, weight_kg, color, shape,
       requires_power, requires_network, power_w, outlet_count, port_count, locked, props)
    values
      (p_plan, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.variant_id, v_obj.label, v_obj.kind,
       v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.length_m,
       v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
       v_obj.requires_power, v_obj.requires_network, v_obj.power_w, v_obj.outlet_count,
       v_obj.port_count, v_obj.locked, v_obj.props)
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
     z_index, visible, locked)
  select p_plan, b.storage_path, b.label, b.opacity, b.x, b.y, b.width_m, b.height_m,
         b.rotation, b.z_index, b.visible, b.locked
  from public.scenario_backgrounds b
  where b.scenario_id = p_scenario;

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
           x, y, z, rotation, length_m, width_m, height_m, weight_kg, color, shape,
           requires_power, requires_network, power_w, outlet_count, port_count, locked, props)
        values
          (v_new_plan, v_obj.catalog_id, v_obj.warehouse_item_id, v_obj.variant_id, v_obj.label, v_obj.kind,
           v_obj.category_id, v_obj.x, v_obj.y, v_obj.z, v_obj.rotation, v_obj.length_m,
           v_obj.width_m, v_obj.height_m, v_obj.weight_kg, v_obj.color, v_obj.shape,
           v_obj.requires_power, v_obj.requires_network, v_obj.power_w, v_obj.outlet_count,
           v_obj.port_count, v_obj.locked, v_obj.props)
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

-- --- Tiempo real -----------------------------------------------------------
-- Los estilos se editan entre varios: si alguien añade «mantel rojo», el resto
-- debe verlo sin recargar.
do $do$
begin
  begin
    alter publication supabase_realtime add table public.warehouse_item_variants;
  exception
    when duplicate_object then null;
    when undefined_object then null;
  end;
end
$do$;
