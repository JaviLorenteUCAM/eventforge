-- ============================================================================
-- EventForge · 0004_functions.sql
-- Funciones de negocio ejecutadas en el servidor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- duplicate_event()
-- Copia un evento completo: miembros, planos (con objetos y conexiones),
-- horarios (dias, actividades y responsables), tareas y cargas de transporte.
-- Las fechas se desplazan al nuevo inicio.
--
-- Se ejecuta con los permisos del invocador (SECURITY INVOKER, por defecto),
-- de modo que RLS sigue aplicandose: solo puede duplicar quien puede leer el
-- evento original y crear eventos.
-- ---------------------------------------------------------------------------
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

  -- Miembros -----------------------------------------------------------------
  insert into public.event_members (event_id, profile_id, role)
  select v_new_id, m.profile_id, m.role
  from public.event_members m
  where m.event_id = p_event
  on conflict do nothing;

  -- Planos, objetos y conexiones --------------------------------------------
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
  end loop;

  -- Horarios -----------------------------------------------------------------
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

  -- Tareas (se copian como pendientes) --------------------------------------
  for v_task in select * from public.tasks where event_id = p_event loop
    insert into public.tasks
      (event_id, title, description, assignee_id, priority, status, due_date, position, created_by)
    values
      (v_new_id, v_task.title, v_task.description, v_task.assignee_id, v_task.priority,
       'pending',
       case when v_task.due_date is null then null else (v_task.due_date + v_delta)::date end,
       v_task.position, auth.uid());
  end loop;

  -- Transporte ---------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- event_dashboard()
-- Resumen agregado de un evento en una sola llamada (evita 6 consultas).
-- ---------------------------------------------------------------------------
create or replace function public.event_dashboard(p_event uuid)
returns jsonb
language sql
stable
as $fn$
  select jsonb_build_object(
    'tasks_total',      (select count(*) from public.tasks where event_id = p_event),
    'tasks_done',       (select count(*) from public.tasks where event_id = p_event and status = 'done'),
    'activities_total', (select count(*) from public.schedule_activities where event_id = p_event),
    'days_total',       (select count(*) from public.schedule_days where event_id = p_event),
    'objects_total',    (select count(*)
                           from public.plan_objects po
                           join public.plans pl on pl.id = po.plan_id
                          where pl.event_id = p_event),
    'connections_total',(select count(*)
                           from public.plan_connections pc
                           join public.plans pl on pl.id = pc.plan_id
                          where pl.event_id = p_event),
    'loads_total',      (select count(*) from public.transport_loads where event_id = p_event)
  );
$fn$;

grant execute on function public.event_dashboard(uuid) to authenticated;
