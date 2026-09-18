-- ============================================================================
-- EventForge · 0001_schema.sql
-- Esquema relacional completo (PostgreSQL / Supabase)
-- ----------------------------------------------------------------------------
-- Convenciones:
--   * Todas las claves primarias son uuid (gen_random_uuid()).
--   * Longitudes/dimensiones en METROS (numeric(10,3)).
--   * Pesos en KILOGRAMOS (numeric(10,3)).
--   * Los "enums" se modelan como text + CHECK para poder ampliarlos sin
--     bloqueos de migracion (ALTER TYPE ... ADD VALUE no es transaccional).
--   * created_at / updated_at en timestamptz (UTC).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Utilidad: trigger de updated_at
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ===========================================================================
-- 1. PERFILES  (1:1 con auth.users)
-- ===========================================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text        not null check (length(trim(name)) between 1 and 80),
  role_title    text        not null default '' check (length(role_title) <= 80),
  avatar_url    text,
  color         text        not null default '#6366f1',
  is_active     boolean     not null default true,
  is_admin      boolean     not null default false,
  sort_order    integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists profiles_active_idx on public.profiles (is_active, sort_order);

drop trigger if exists profiles_updated on public.profiles;
create trigger profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- Helpers de seguridad -------------------------------------------------------
-- security definer + search_path fijo para evitar recursion en las policies.
create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$fn$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.is_admin
  );
$fn$;

-- ===========================================================================
-- 2. EVENTOS
-- ===========================================================================
create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null check (length(trim(name)) between 1 and 140),
  description   text        not null default '',
  location      text        not null default '',
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text        not null default 'planning'
                check (status in ('planning','preparation','setup','live','teardown','finished')),
  cover_path    text,
  notes         text        not null default '',
  color         text        not null default '#6366f1',
  created_by    uuid        references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint events_dates_ck check (ends_at >= starts_at)
);
create index if not exists events_starts_idx on public.events (starts_at desc);
create index if not exists events_status_idx on public.events (status);

drop trigger if exists events_updated on public.events;
create trigger events_updated before update on public.events
  for each row execute function public.tg_set_updated_at();

create table if not exists public.event_members (
  event_id    uuid not null references public.events(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner','manager','member')),
  created_at  timestamptz not null default now(),
  primary key (event_id, profile_id)
);
create index if not exists event_members_profile_idx on public.event_members (profile_id);

-- Pertenencia (usado por las policies de todas las tablas hijas)
create or replace function public.is_event_member(p_event uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select public.is_admin() or exists (
    select 1 from public.event_members m
    where m.event_id = p_event and m.profile_id = auth.uid()
  );
$fn$;

-- El creador entra automaticamente como owner
create or replace function public.tg_event_add_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.created_by is not null then
    insert into public.event_members (event_id, profile_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$fn$;

drop trigger if exists events_add_owner on public.events;
create trigger events_add_owner after insert on public.events
  for each row execute function public.tg_event_add_owner();

-- ===========================================================================
-- 3. TAREAS
-- ===========================================================================
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 200),
  description  text not null default '',
  assignee_id  uuid references public.profiles(id) on delete set null,
  priority     text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  status       text not null default 'pending' check (status in ('pending','in_progress','done')),
  due_date     date,
  position     integer not null default 0,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists tasks_event_idx on public.tasks (event_id, status);
create index if not exists tasks_assignee_idx on public.tasks (assignee_id, status);
create index if not exists tasks_due_idx on public.tasks (due_date);

drop trigger if exists tasks_updated on public.tasks;
create trigger tasks_updated before update on public.tasks
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- 4. HORARIOS
-- ===========================================================================
create table if not exists public.schedule_days (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  day_index  integer not null check (day_index >= 1),
  date       date,
  label      text not null default '',
  created_at timestamptz not null default now(),
  unique (event_id, day_index)
);
create index if not exists schedule_days_event_idx on public.schedule_days (event_id, day_index);

create table if not exists public.schedule_activities (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  day_id      uuid not null references public.schedule_days(id) on delete cascade,
  title       text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  starts_at   time not null default '09:00',
  ends_at     time not null default '10:00',
  color       text not null default '#6366f1',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists schedule_activities_day_idx on public.schedule_activities (day_id, starts_at);
create index if not exists schedule_activities_event_idx on public.schedule_activities (event_id);

drop trigger if exists schedule_activities_updated on public.schedule_activities;
create trigger schedule_activities_updated before update on public.schedule_activities
  for each row execute function public.tg_set_updated_at();

create table if not exists public.schedule_activity_members (
  activity_id uuid not null references public.schedule_activities(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (activity_id, profile_id)
);
create index if not exists schedule_activity_members_profile_idx
  on public.schedule_activity_members (profile_id);

-- ===========================================================================
-- 5. ALMACEN / MATERIAL
-- ===========================================================================
create table if not exists public.material_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (length(trim(name)) between 1 and 60),
  slug       text not null unique,
  color      text not null default '#64748b',
  icon       text not null default 'package',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Biblioteca de objetos reutilizables (mesa, silla, switch, regleta...)
create table if not exists public.object_catalog (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (length(trim(name)) between 1 and 120),
  category_id      uuid references public.material_categories(id) on delete set null,
  kind             text not null default 'generic'
                   check (kind in ('generic','furniture','av','power_source','power_strip','power_sink',
                                   'network_switch','network_router','network_node','decor','tool')),
  length_m         numeric(10,3) not null default 1 check (length_m > 0),
  width_m          numeric(10,3) not null default 1 check (width_m  > 0),
  height_m         numeric(10,3) not null default 1 check (height_m > 0),
  weight_kg        numeric(10,3) not null default 0 check (weight_kg >= 0),
  color            text not null default '#94a3b8',
  material         text not null default '',
  notes            text not null default '',
  shape            text not null default 'box' check (shape in ('box','cylinder','plane')),
  requires_power   boolean not null default false,
  requires_network boolean not null default false,
  power_w          numeric(10,2) not null default 0 check (power_w >= 0),
  outlet_count     integer not null default 0 check (outlet_count >= 0),
  port_count       integer not null default 0 check (port_count  >= 0),
  is_system        boolean not null default false,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists object_catalog_category_idx on public.object_catalog (category_id);
create index if not exists object_catalog_name_idx on public.object_catalog (lower(name));

drop trigger if exists object_catalog_updated on public.object_catalog;
create trigger object_catalog_updated before update on public.object_catalog
  for each row execute function public.tg_set_updated_at();

-- Inventario real
create table if not exists public.warehouse_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 140),
  category_id   uuid references public.material_categories(id) on delete set null,
  catalog_id    uuid references public.object_catalog(id) on delete set null,
  quantity      numeric(12,2) not null default 0 check (quantity >= 0),
  unit          text not null default 'ud' check (unit in ('ud','m','kg','l','pack')),
  length_m      numeric(10,3) not null default 0 check (length_m >= 0),
  width_m       numeric(10,3) not null default 0 check (width_m  >= 0),
  height_m      numeric(10,3) not null default 0 check (height_m >= 0),
  weight_kg     numeric(10,3) not null default 0 check (weight_kg >= 0),
  photo_path    text,
  description   text not null default '',
  location      text not null default '',
  internal_code text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists warehouse_items_category_idx on public.warehouse_items (category_id);
create index if not exists warehouse_items_name_idx on public.warehouse_items (lower(name));

drop trigger if exists warehouse_items_updated on public.warehouse_items;
create trigger warehouse_items_updated before update on public.warehouse_items
  for each row execute function public.tg_set_updated_at();

create table if not exists public.warehouse_boxes (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique check (length(trim(code)) between 1 and 40),
  name             text not null default '',
  length_m         numeric(10,3) not null default 0.6 check (length_m > 0),
  width_m          numeric(10,3) not null default 0.4 check (width_m  > 0),
  height_m         numeric(10,3) not null default 0.4 check (height_m > 0),
  empty_weight_kg  numeric(10,3) not null default 0 check (empty_weight_kg >= 0),
  location         text not null default '',
  color            text not null default '#f59e0b',
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

drop trigger if exists warehouse_boxes_updated on public.warehouse_boxes;
create trigger warehouse_boxes_updated before update on public.warehouse_boxes
  for each row execute function public.tg_set_updated_at();

create table if not exists public.warehouse_box_items (
  id         uuid primary key default gen_random_uuid(),
  box_id     uuid not null references public.warehouse_boxes(id) on delete cascade,
  item_id    uuid not null references public.warehouse_items(id) on delete cascade,
  quantity   numeric(12,2) not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (box_id, item_id)
);
create index if not exists warehouse_box_items_item_idx on public.warehouse_box_items (item_id);

-- ===========================================================================
-- 6. PLANOS 2D / 3D
-- ===========================================================================
create table if not exists public.plans (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null default 'Plano principal',
  width_m      numeric(10,3) not null default 20 check (width_m  > 0),
  depth_m      numeric(10,3) not null default 14 check (depth_m  > 0),
  height_m     numeric(10,3) not null default 4  check (height_m > 0),
  grid_size_m  numeric(10,3) not null default 0.5 check (grid_size_m > 0),
  is_default   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists plans_event_idx on public.plans (event_id);

drop trigger if exists plans_updated on public.plans;
create trigger plans_updated before update on public.plans
  for each row execute function public.tg_set_updated_at();

create table if not exists public.plan_objects (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.plans(id) on delete cascade,
  catalog_id        uuid references public.object_catalog(id) on delete set null,
  warehouse_item_id uuid references public.warehouse_items(id) on delete set null,
  label             text not null default '' check (length(label) <= 120),
  kind              text not null default 'generic',
  category_id       uuid references public.material_categories(id) on delete set null,
  -- Posicion sobre el plano: x = izquierda->derecha, y = arriba->abajo (metros)
  x                 numeric(10,3) not null default 0,
  y                 numeric(10,3) not null default 0,
  z                 numeric(10,3) not null default 0,
  rotation          numeric(6,2)  not null default 0,
  length_m          numeric(10,3) not null default 1 check (length_m > 0),
  width_m           numeric(10,3) not null default 1 check (width_m  > 0),
  height_m          numeric(10,3) not null default 1 check (height_m > 0),
  weight_kg         numeric(10,3) not null default 0 check (weight_kg >= 0),
  color             text not null default '#94a3b8',
  shape             text not null default 'box' check (shape in ('box','cylinder','plane','text','line')),
  requires_power    boolean not null default false,
  requires_network  boolean not null default false,
  power_w           numeric(10,2) not null default 0 check (power_w >= 0),
  outlet_count      integer not null default 0 check (outlet_count >= 0),
  port_count        integer not null default 0 check (port_count  >= 0),
  locked            boolean not null default false,
  props             jsonb  not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists plan_objects_plan_idx on public.plan_objects (plan_id);
create index if not exists plan_objects_catalog_idx on public.plan_objects (catalog_id);
create index if not exists plan_objects_warehouse_idx on public.plan_objects (warehouse_item_id);

drop trigger if exists plan_objects_updated on public.plan_objects;
create trigger plan_objects_updated before update on public.plan_objects
  for each row execute function public.tg_set_updated_at();

create table if not exists public.plan_connections (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.plans(id) on delete cascade,
  kind           text not null check (kind in ('power','network')),
  from_object_id uuid not null references public.plan_objects(id) on delete cascade,
  to_object_id   uuid not null references public.plan_objects(id) on delete cascade,
  cable_type     text not null default '',
  length_m       numeric(10,3) not null default 0 check (length_m >= 0),
  color          text not null default '#22d3ee',
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint plan_connections_not_self check (from_object_id <> to_object_id)
);
create index if not exists plan_connections_plan_idx on public.plan_connections (plan_id, kind);
create index if not exists plan_connections_from_idx on public.plan_connections (from_object_id);
create index if not exists plan_connections_to_idx   on public.plan_connections (to_object_id);

drop trigger if exists plan_connections_updated on public.plan_connections;
create trigger plan_connections_updated before update on public.plan_connections
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- 7. TRANSPORTE
-- ===========================================================================
create table if not exists public.transport_vehicles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 1 and 120),
  vehicle_type  text not null default 'van' check (vehicle_type in ('van','truck','trailer','custom')),
  length_m      numeric(10,3) not null default 3 check (length_m > 0),
  width_m       numeric(10,3) not null default 1.7 check (width_m > 0),
  height_m      numeric(10,3) not null default 1.8 check (height_m > 0),
  max_weight_kg numeric(10,2) not null default 1000 check (max_weight_kg > 0),
  is_template   boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

drop trigger if exists transport_vehicles_updated on public.transport_vehicles;
create trigger transport_vehicles_updated before update on public.transport_vehicles
  for each row execute function public.tg_set_updated_at();

create table if not exists public.transport_loads (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events(id) on delete cascade,
  vehicle_id  uuid references public.transport_vehicles(id) on delete set null,
  name        text not null default 'Carga 1',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists transport_loads_event_idx on public.transport_loads (event_id);

drop trigger if exists transport_loads_updated on public.transport_loads;
create trigger transport_loads_updated before update on public.transport_loads
  for each row execute function public.tg_set_updated_at();

create table if not exists public.transport_items (
  id          uuid primary key default gen_random_uuid(),
  load_id     uuid not null references public.transport_loads(id) on delete cascade,
  source_kind text not null default 'item' check (source_kind in ('item','box','custom')),
  item_id     uuid references public.warehouse_items(id) on delete set null,
  box_id      uuid references public.warehouse_boxes(id) on delete set null,
  label       text not null default '',
  quantity    integer not null default 1 check (quantity > 0),
  -- Posicion dentro de la caja de carga (metros, origen esquina delantera izq.)
  x           numeric(10,3) not null default 0,
  y           numeric(10,3) not null default 0,
  z           numeric(10,3) not null default 0,
  rotation    numeric(6,2)  not null default 0,
  length_m    numeric(10,3) not null default 0.5 check (length_m > 0),
  width_m     numeric(10,3) not null default 0.5 check (width_m  > 0),
  height_m    numeric(10,3) not null default 0.5 check (height_m > 0),
  weight_kg   numeric(10,3) not null default 0 check (weight_kg >= 0),
  color       text not null default '#38bdf8',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists transport_items_load_idx on public.transport_items (load_id);

drop trigger if exists transport_items_updated on public.transport_items;
create trigger transport_items_updated before update on public.transport_items
  for each row execute function public.tg_set_updated_at();

-- ===========================================================================
-- 8. CAPTURAS / SNAPSHOTS
-- ===========================================================================
create table if not exists public.snapshots (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  plan_id      uuid references public.plans(id) on delete set null,
  kind         text not null check (kind in ('2d','3d','transport')),
  storage_path text not null,
  title        text not null default '',
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists snapshots_event_idx on public.snapshots (event_id, created_at desc);

-- ===========================================================================
-- 9. VISTAS DE APOYO
-- ===========================================================================

-- Progreso de tareas por evento (para dashboards).
create or replace view public.v_event_task_progress as
select
  e.id                                                      as event_id,
  count(t.id)                                               as total,
  count(t.id) filter (where t.status = 'done')              as done,
  count(t.id) filter (where t.status = 'in_progress')       as in_progress,
  count(t.id) filter (where t.status = 'pending')           as pending
from public.events e
left join public.tasks t on t.event_id = e.id
group by e.id;
