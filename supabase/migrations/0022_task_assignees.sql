-- ===========================================================================
-- EventForge · 0022 · Tareas con varias personas asignadas
-- ===========================================================================
--
-- Hasta ahora una tarea tenía UNA persona (`assignee_id`). Ahora lleva una
-- lista (`assignee_ids`): «Montar el escenario» es de Ana, Luis y Marta.
--
-- · La lista vive en la propia tarea (un array), así las tareas se siguen
--   cargando y actualizando en tiempo real igual que antes, sin consultas
--   aparte.
-- · `assignee_id` se conserva y se mantiene solo (es la primera persona de la
--   lista) para que nada de lo que aún lo lea se rompa.
-- · Las tareas que ya tenían persona pasan a tenerla en la lista.
-- · Al borrar un perfil, se quita de las listas (como antes, que se quedaba sin
--   persona).
-- · `duplicate_event` se regenera desde 0020 copiando también la lista.
--
-- Migración aditiva: una columna, un trigger y la función de duplicar.
-- ===========================================================================

alter table public.tasks
  add column if not exists assignee_ids uuid[] not null default '{}';

-- Las que ya tenían persona.
update public.tasks
   set assignee_ids = array[assignee_id]
 where assignee_id is not null
   and cardinality(assignee_ids) = 0;

create index if not exists tasks_assignee_ids_idx on public.tasks using gin (assignee_ids);

-- Lista limpia (sin repetidos ni nulos, en el orden dado) y assignee_id = la
-- primera. Si alguien escribe solo assignee_id (código antiguo), la lista se
-- rehace con esa persona.
create or replace function public.tg_tasks_assignees()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.assignee_id is distinct from old.assignee_id
     and new.assignee_ids is not distinct from old.assignee_ids then
    new.assignee_ids := case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end;
  elsif tg_op = 'INSERT' and cardinality(coalesce(new.assignee_ids, '{}')) = 0
        and new.assignee_id is not null then
    new.assignee_ids := array[new.assignee_id];
  end if;

  new.assignee_ids := coalesce(
    (select array_agg(x order by first_pos)
       from (select x, min(pos) as first_pos
               from unnest(coalesce(new.assignee_ids, '{}')) with ordinality as u(x, pos)
              where x is not null
              group by x) d),
    '{}'::uuid[]);
  if cardinality(new.assignee_ids) > 50 then
    raise exception 'Demasiadas personas en una tarea (máximo 50)';
  end if;
  new.assignee_id := new.assignee_ids[1];
  return new;
end;
$fn$;

drop trigger if exists tasks_assignees on public.tasks;
create trigger tasks_assignees before insert or update on public.tasks
  for each row execute function public.tg_tasks_assignees();

-- Al borrar un perfil, fuera de las listas.
create or replace function public.tg_profiles_drop_from_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.tasks
     set assignee_ids = array_remove(assignee_ids, old.id)
   where assignee_ids @> array[old.id];
  return old;
end;
$fn$;

drop trigger if exists profiles_drop_from_tasks on public.profiles;
create trigger profiles_drop_from_tasks before delete on public.profiles
  for each row execute function public.tg_profiles_drop_from_tasks();

-- --- Duplicar un evento copia también la lista ------------------------------
-- Igual que en 0020, con `assignee_ids` añadido al INSERT de tareas.

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

    insert into public.plan_zones (plan_id, number, name, color, points, description)
    select v_new_plan, z.number, z.name, z.color, z.points, z.description
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
      (event_id, title, description, assignee_id, assignee_ids, priority, status, due_date, position, created_by)
    values
      (v_new_id, v_task.title, v_task.description, v_task.assignee_id, v_task.assignee_ids, v_task.priority,
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
