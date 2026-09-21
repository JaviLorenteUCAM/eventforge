-- ===========================================================================
-- EventForge · 0011 · Color transparente en las texturas
-- ===========================================================================
--
-- El caso que lo pide: un soporte de televisión. Son dos patas y el centro
-- hueco, pero la textura se pinta sobre una caja, así que el hueco salía
-- tapado. Hasta ahora no había forma de decir «esta parte no existe».
--
-- Dos caminos, y los dos funcionan:
--
--   1. Subir un PNG CON TRANSPARENCIA. Lo que esté borrado en la imagen se ve
--      hueco. No necesita ninguna columna: basta con que el material recorte
--      por alfa, que es lo que se activa en el código.
--
--   2. Marcar un COLOR como transparente. Pintas el hueco de un color que no
--      aparezca en el resto del dibujo —el magenta chillón de toda la vida— y
--      lo eliges aquí. Es la vía para quien edita con Paint o con cualquier
--      programa que no guarde transparencia.
--
-- `texture_key_color` guarda ese color en hexadecimal (null = sin recorte) y
-- `texture_key_tolerance` cuánto se parecen los píxeles que también caen: 0 es
-- solo el color exacto y 1 se lo lleva todo. Se necesita tolerancia porque al
-- guardar en JPEG, o al reescalar, el color se ensucia por los bordes.
--
-- Migración aditiva: no borra ni reescribe datos.
-- ===========================================================================

do $do$
declare
  t text;
begin
  foreach t in array array['object_catalog','warehouse_items','warehouse_item_variants'] loop
    execute format(
      'alter table public.%I add column if not exists texture_key_color text', t);
    execute format(
      'alter table public.%I add column if not exists texture_key_tolerance numeric(4,3) not null default 0.120', t);
    begin
      execute format(
        'alter table public.%I add constraint %I check (texture_key_tolerance >= 0 and texture_key_tolerance <= 1)',
        t, t || '_texture_key_tolerance_check');
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$do$;

comment on column public.warehouse_items.texture_key_color is
  'Color que se vuelve transparente, en hexadecimal (#ff00ff). Null = sin recorte.';
comment on column public.warehouse_items.texture_key_tolerance is
  'Cuánto se parecen los píxeles que también se recortan: 0 exacto, 1 todo.';
