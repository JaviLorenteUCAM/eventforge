-- ===========================================================================
-- EventForge · 0021 · Materiales para estilos (compartidos entre objetos)
-- ===========================================================================
--
-- El problema
-- -----------
-- Hay 6 manteles «UCAM Esports». Cinco van en mesas plegables y uno en el
-- mostrador. Hasta ahora el estilo era de UN material del almacén: el de la
-- mesa plegable contaba sus 6 manteles y, si se creaba el mismo estilo en el
-- mostrador, salía como otro material distinto con sus propias unidades. El
-- listado pedía «Mantel UCAM Esports» dos veces y las existencias no cuadraban.
--
-- La solución
-- -----------
-- En el almacén se dan de alta los MATERIALES PARA ESTILOS (manteles, fundas,
-- vinilos…) con sus unidades. Un estilo de cualquier objeto puede ENLAZARSE a
-- uno de ellos: entonces lo que añade al listado es ese material, y todos los
-- estilos enlazados al mismo restan de las mismas existencias. Cinco mesas y
-- un mostrador con el mantel UCAM piden 6 «Mantel UCAM Esports» de los 6 que
-- hay.
--
-- Un estilo sin enlazar se comporta como antes (sus propias unidades).
--
-- Migración aditiva: una tabla nueva y una columna opcional en los estilos.
-- No hace falta tocar las funciones de copia: los estilos y estos materiales
-- son del almacén (comunes), no del plano.
-- ===========================================================================

create table if not exists public.style_materials (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 120),
  quantity     numeric(10,2) not null default 1 check (quantity >= 0),
  unit         text not null default 'ud' check (unit in ('ud','m','kg','l','pack')),
  category_id  uuid references public.material_categories(id) on delete set null,
  -- Para reconocerlo en las listas (la muestra de color).
  color        text,
  notes        text not null default '' check (length(notes) <= 1000),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint style_materials_unique_name unique (name)
);

create index if not exists style_materials_category_idx on public.style_materials (category_id);

drop trigger if exists style_materials_updated on public.style_materials;
create trigger style_materials_updated before update on public.style_materials
  for each row execute function public.tg_set_updated_at();

comment on table public.style_materials is
  'Material que llevan los estilos (manteles, fundas…), con unidades compartidas entre objetos.';

-- --- El enlace desde cada estilo -------------------------------------------
-- Al borrar el material, los estilos se quedan sin enlace y vuelven a contar
-- sus propias unidades.
alter table public.warehouse_item_variants
  add column if not exists style_material_id uuid
  references public.style_materials(id) on delete set null;

create index if not exists warehouse_item_variants_style_material_idx
  on public.warehouse_item_variants (style_material_id);

-- --- Seguridad -------------------------------------------------------------
-- Como el resto del almacén: común a todo el equipo.
alter table public.style_materials enable row level security;

drop policy if exists "style_materials_select" on public.style_materials;
create policy "style_materials_select" on public.style_materials
  for select using (public.is_active_profile());

drop policy if exists "style_materials_insert" on public.style_materials;
create policy "style_materials_insert" on public.style_materials
  for insert with check (public.is_active_profile());

drop policy if exists "style_materials_update" on public.style_materials;
create policy "style_materials_update" on public.style_materials
  for update using (public.is_active_profile()) with check (public.is_active_profile());

drop policy if exists "style_materials_delete" on public.style_materials;
create policy "style_materials_delete" on public.style_materials
  for delete using (public.is_active_profile());

-- ===========================================================================
-- REALTIME
-- ===========================================================================
do $do$
begin
  alter publication supabase_realtime add table public.style_materials;
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$do$;
