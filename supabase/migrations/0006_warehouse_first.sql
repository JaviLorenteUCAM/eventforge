-- ============================================================================
-- EventForge · 0006_warehouse_first.sql
--
-- CAMBIO DE MODELO: el ALMACÉN pasa a ser la fuente de objetos del plano.
--
-- Antes había dos sitios de donde sacar objetos y resultaba confuso:
--   · object_catalog ("biblioteca")  -> definía forma, tipo, consumo, textura…
--   · warehouse_items ("almacén")    -> solo existencias y medidas
--
-- Ahora warehouse_items lleva TODO lo necesario para colocarse en un plano, y
-- la biblioteca queda vacía, reservada a objetos puntuales de un evento
-- concreto (una alfombra a medida, un photocall) que no son material de stock.
--
--   ALMACÉN    -> material real, con unidades. Es lo que se usa el 99 % del tiempo.
--   BIBLIOTECA -> objetos sueltos sin existencias, creados para un evento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. El material del almacén gana las propiedades de objeto colocable
-- ---------------------------------------------------------------------------
alter table public.warehouse_items
  add column if not exists kind             text not null default 'generic',
  add column if not exists shape            text not null default 'box',
  add column if not exists color            text not null default '#94a3b8',
  add column if not exists requires_power   boolean not null default false,
  add column if not exists requires_network boolean not null default false,
  add column if not exists power_w          numeric(10,2) not null default 0,
  add column if not exists outlet_count     integer not null default 0,
  add column if not exists port_count       integer not null default 0,
  add column if not exists texture_path     text,
  add column if not exists texture_mode     text not null default 'atlas',
  add column if not exists texture_scale    numeric(6,3) not null default 1,
  add column if not exists texture_offset_x numeric(6,3) not null default 0,
  add column if not exists texture_offset_y numeric(6,3) not null default 0,
  add column if not exists texture_rotation numeric(6,2) not null default 0;

do $do$
begin
  alter table public.warehouse_items
    add constraint warehouse_items_shape_ck check (shape in ('box','cylinder','plane'));
exception when duplicate_object then null;
end $do$;

do $do$
begin
  alter table public.warehouse_items
    add constraint warehouse_items_texture_mode_ck check (texture_mode in ('atlas','tile'));
exception when duplicate_object then null;
end $do$;

do $do$
begin
  alter table public.warehouse_items
    add constraint warehouse_items_texture_scale_ck check (texture_scale > 0);
exception when duplicate_object then null;
end $do$;

-- ---------------------------------------------------------------------------
-- 2. Trasvase: lo que ya estaba enlazado a la biblioteca conserva sus datos
-- ---------------------------------------------------------------------------
update public.warehouse_items w
   set kind             = c.kind,
       shape            = c.shape,
       color            = c.color,
       requires_power   = c.requires_power,
       requires_network = c.requires_network,
       power_w          = c.power_w,
       outlet_count     = c.outlet_count,
       port_count       = c.port_count,
       length_m         = case when w.length_m > 0 then w.length_m else c.length_m end,
       width_m          = case when w.width_m  > 0 then w.width_m  else c.width_m  end,
       height_m         = case when w.height_m > 0 then w.height_m else c.height_m end
  from public.object_catalog c
 where w.catalog_id = c.id;

-- Los objetos ya colocados en planos quedan enlazados a su artículo de almacén
-- cuando se pueda deducir por el objeto de biblioteca del que salieron.
update public.plan_objects po
   set warehouse_item_id = w.id
  from public.warehouse_items w
 where po.warehouse_item_id is null
   and po.catalog_id is not null
   and w.catalog_id = po.catalog_id;

-- ---------------------------------------------------------------------------
-- 3. Vaciar la biblioteca: fuera el catálogo de sistema
-- ---------------------------------------------------------------------------
-- plan_objects.catalog_id y warehouse_items.catalog_id son ON DELETE SET NULL,
-- así que no se pierde ningún objeto ya colocado ni ningún material.
delete from public.object_catalog where is_system;

-- A partir de ahora la biblioteca solo guarda objetos propios de un evento.
comment on table public.object_catalog is
  'Objetos puntuales creados para un evento (sin existencias). El material con stock vive en warehouse_items.';

-- ---------------------------------------------------------------------------
-- 4. Índice para el cálculo de existencias comprometidas
-- ---------------------------------------------------------------------------
create index if not exists plan_objects_warehouse_item_idx
  on public.plan_objects (warehouse_item_id);

-- ---------------------------------------------------------------------------
-- 5. Transporte
-- ---------------------------------------------------------------------------
-- La sección se ha retirado de la aplicación. Las tablas se mantienen para no
-- destruir datos y para poder recuperarla sin una migración inversa; no se
-- consultan desde ninguna parte del frontend.
comment on table public.transport_loads is
  'RETIRADO de la interfaz. Se conserva por si se recupera la sección de transporte.';
