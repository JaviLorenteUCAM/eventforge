-- ============================================================================
-- EventForge · 0002_rls.sql
-- Row Level Security + politicas de acceso + politicas de Storage
-- ----------------------------------------------------------------------------
-- Modelo de seguridad:
--
--   anon            -> NO puede leer ni escribir NADA. La anon key publicada en
--                      el frontend es inutil por si sola.
--   authenticated   -> solo si existe un perfil ACTIVO con ese auth.uid()
--                      (funcion is_active_profile()).
--   catalogos globales (almacen, categorias, biblioteca de objetos, vehiculos)
--                   -> lectura/escritura para cualquier perfil activo.
--   datos de evento -> lectura para cualquier perfil activo (el equipo necesita
--                      ver el calendario global); ESCRITURA solo para miembros
--                      del evento o administradores (is_event_member()).
--   profiles        -> lectura para perfiles activos; cada uno edita el suyo;
--                      los admin editan cualquiera. El ALTA de perfiles se hace
--                      siempre con service_role (Edge Function / SQL), nunca
--                      desde el navegador.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helper: permiso de escritura sobre un plano (via su evento)
-- ---------------------------------------------------------------------------
create or replace function public.can_edit_plan(p_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.plans pl
    where pl.id = p_plan and public.is_event_member(pl.event_id)
  );
$fn$;

create or replace function public.can_edit_load(p_load uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.transport_loads l
    where l.id = p_load and public.is_event_member(l.event_id)
  );
$fn$;

create or replace function public.can_edit_activity(p_activity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.schedule_activities a
    where a.id = p_activity and public.is_event_member(a.event_id)
  );
$fn$;

-- ---------------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- ---------------------------------------------------------------------------
alter table public.profiles                  enable row level security;
alter table public.events                    enable row level security;
alter table public.event_members             enable row level security;
alter table public.tasks                     enable row level security;
alter table public.schedule_days             enable row level security;
alter table public.schedule_activities       enable row level security;
alter table public.schedule_activity_members enable row level security;
alter table public.material_categories       enable row level security;
alter table public.object_catalog            enable row level security;
alter table public.warehouse_items           enable row level security;
alter table public.warehouse_boxes           enable row level security;
alter table public.warehouse_box_items       enable row level security;
alter table public.plans                     enable row level security;
alter table public.plan_objects              enable row level security;
alter table public.plan_connections          enable row level security;
alter table public.transport_vehicles        enable row level security;
alter table public.transport_loads           enable row level security;
alter table public.transport_items           enable row level security;
alter table public.snapshots                 enable row level security;

-- ===========================================================================
-- PROFILES
-- ===========================================================================
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.is_active_profile());

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ===========================================================================
-- EVENTS
-- ===========================================================================
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated using (public.is_active_profile());

drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (public.is_active_profile() and created_by = auth.uid());

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update to authenticated
  using (public.is_event_member(id))
  with check (public.is_event_member(id));

drop policy if exists events_delete on public.events;
create policy events_delete on public.events
  for delete to authenticated using (public.is_event_member(id));

-- EVENT MEMBERS ------------------------------------------------------------
drop policy if exists event_members_select on public.event_members;
create policy event_members_select on public.event_members
  for select to authenticated using (public.is_active_profile());

drop policy if exists event_members_write on public.event_members;
create policy event_members_write on public.event_members
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

-- ===========================================================================
-- TABLAS HIJAS DE EVENTO (mismo patron: lectura global, escritura de miembros)
-- ===========================================================================
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select to authenticated using (public.is_active_profile());
drop policy if exists tasks_write on public.tasks;
create policy tasks_write on public.tasks
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

drop policy if exists schedule_days_select on public.schedule_days;
create policy schedule_days_select on public.schedule_days
  for select to authenticated using (public.is_active_profile());
drop policy if exists schedule_days_write on public.schedule_days;
create policy schedule_days_write on public.schedule_days
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

drop policy if exists schedule_activities_select on public.schedule_activities;
create policy schedule_activities_select on public.schedule_activities
  for select to authenticated using (public.is_active_profile());
drop policy if exists schedule_activities_write on public.schedule_activities;
create policy schedule_activities_write on public.schedule_activities
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

drop policy if exists schedule_activity_members_select on public.schedule_activity_members;
create policy schedule_activity_members_select on public.schedule_activity_members
  for select to authenticated using (public.is_active_profile());
drop policy if exists schedule_activity_members_write on public.schedule_activity_members;
create policy schedule_activity_members_write on public.schedule_activity_members
  for all to authenticated
  using (public.can_edit_activity(activity_id))
  with check (public.can_edit_activity(activity_id));

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated using (public.is_active_profile());
drop policy if exists plans_write on public.plans;
create policy plans_write on public.plans
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

drop policy if exists plan_objects_select on public.plan_objects;
create policy plan_objects_select on public.plan_objects
  for select to authenticated using (public.is_active_profile());
drop policy if exists plan_objects_write on public.plan_objects;
create policy plan_objects_write on public.plan_objects
  for all to authenticated
  using (public.can_edit_plan(plan_id))
  with check (public.can_edit_plan(plan_id));

drop policy if exists plan_connections_select on public.plan_connections;
create policy plan_connections_select on public.plan_connections
  for select to authenticated using (public.is_active_profile());
drop policy if exists plan_connections_write on public.plan_connections;
create policy plan_connections_write on public.plan_connections
  for all to authenticated
  using (public.can_edit_plan(plan_id))
  with check (public.can_edit_plan(plan_id));

drop policy if exists transport_loads_select on public.transport_loads;
create policy transport_loads_select on public.transport_loads
  for select to authenticated using (public.is_active_profile());
drop policy if exists transport_loads_write on public.transport_loads;
create policy transport_loads_write on public.transport_loads
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

drop policy if exists transport_items_select on public.transport_items;
create policy transport_items_select on public.transport_items
  for select to authenticated using (public.is_active_profile());
drop policy if exists transport_items_write on public.transport_items;
create policy transport_items_write on public.transport_items
  for all to authenticated
  using (public.can_edit_load(load_id))
  with check (public.can_edit_load(load_id));

drop policy if exists snapshots_select on public.snapshots;
create policy snapshots_select on public.snapshots
  for select to authenticated using (public.is_active_profile());
drop policy if exists snapshots_write on public.snapshots;
create policy snapshots_write on public.snapshots
  for all to authenticated
  using (public.is_event_member(event_id))
  with check (public.is_event_member(event_id));

-- ===========================================================================
-- CATALOGOS GLOBALES (almacen compartido por todo el equipo)
-- ===========================================================================
drop policy if exists material_categories_all on public.material_categories;
create policy material_categories_all on public.material_categories
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists object_catalog_all on public.object_catalog;
create policy object_catalog_all on public.object_catalog
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists warehouse_items_all on public.warehouse_items;
create policy warehouse_items_all on public.warehouse_items
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists warehouse_boxes_all on public.warehouse_boxes;
create policy warehouse_boxes_all on public.warehouse_boxes
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists warehouse_box_items_all on public.warehouse_box_items;
create policy warehouse_box_items_all on public.warehouse_box_items
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists transport_vehicles_all on public.transport_vehicles;
create policy transport_vehicles_all on public.transport_vehicles
  for all to authenticated
  using (public.is_active_profile()) with check (public.is_active_profile());

-- ===========================================================================
-- VISTAS: se ejecutan con los permisos del invocador (PG15+ security_invoker)
-- para que hereden las policies de las tablas base.
-- ===========================================================================
alter view public.v_event_task_progress set (security_invoker = true);

revoke all on public.v_event_task_progress from anon;
grant select on public.v_event_task_progress to authenticated;

-- ===========================================================================
-- STORAGE
-- ---------------------------------------------------------------------------
--   avatars          -> PUBLICO en lectura. Necesario para pintar las fotos en
--                       la pantalla "quien eres" ANTES de tener sesion.
--                       Escritura solo autenticado.
--   event-media      -> PRIVADO (portadas de evento).
--   warehouse-photos -> PRIVADO (fotos de material).
--   captures         -> PRIVADO (capturas 2D/3D).
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',          'avatars',          true,  5242880,  array['image/png','image/jpeg','image/webp','image/gif']),
  ('event-media',      'event-media',      false, 10485760, array['image/png','image/jpeg','image/webp']),
  ('warehouse-photos', 'warehouse-photos', false, 10485760, array['image/png','image/jpeg','image/webp']),
  ('captures',         'captures',         false, 10485760, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura publica de avatares (necesaria para la pantalla de seleccion)
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars write" on storage.objects;
create policy "avatars write" on storage.objects
  for all to authenticated
  using (bucket_id = 'avatars' and public.is_active_profile())
  with check (bucket_id = 'avatars' and public.is_active_profile());

-- Buckets privados: solo perfiles activos
drop policy if exists "private buckets read" on storage.objects;
create policy "private buckets read" on storage.objects
  for select to authenticated
  using (bucket_id in ('event-media','warehouse-photos','captures') and public.is_active_profile());

drop policy if exists "private buckets write" on storage.objects;
create policy "private buckets write" on storage.objects
  for all to authenticated
  using (bucket_id in ('event-media','warehouse-photos','captures') and public.is_active_profile())
  with check (bucket_id in ('event-media','warehouse-photos','captures') and public.is_active_profile());

-- ===========================================================================
-- REALTIME: publicar las tablas colaborativas
-- ===========================================================================
do $do$
declare
  t text;
begin
  foreach t in array array[
    'events','event_members','tasks','schedule_days','schedule_activities',
    'plans','plan_objects','plan_connections','warehouse_items','warehouse_boxes',
    'warehouse_box_items','transport_loads','transport_items','profiles','object_catalog'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end
$do$;
