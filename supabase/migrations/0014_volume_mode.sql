-- ===========================================================================
-- EventForge · 0014 · Modo volumen: la forma sale de las vistas
-- ===========================================================================
--
-- El problema que resuelve
-- ------------------------
-- Con la plantilla en cruz y el fondo de cada foto recortado, una silla gaming
-- acababa siendo cuatro fotos planas alrededor de una caja vacía: desde
-- cualquier ángulo se veían todas a la vez, como un farolillo. La silueta
-- tampoco servía, porque solo extruye la vista de frente.
--
-- El modo `volume` usa la misma plantilla de seis caras, pero cruza los
-- contornos de todas las vistas recortadas para tallar la forma del objeto y
-- pinta cada parte con la foto que la ve de frente. Así la marca del respaldo
-- sale donde está en la foto, sin modelar ni texturizar nada en 3D.
--
-- Migración aditiva: solo amplía la lista de modos permitidos (mismo patrón
-- que 0012).
-- ===========================================================================

do $do$
declare
  t text;
  c text;
begin
  foreach t in array array['object_catalog','warehouse_items','warehouse_item_variants'] loop
    for c in
      select conname from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%texture_mode%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c);
    end loop;

    execute format(
      'alter table public.%I add constraint %I check (texture_mode in (%L, %L, %L, %L))',
      t, t || '_texture_mode_ck', 'atlas', 'tile', 'silhouette', 'volume');
  end loop;
end
$do$;

comment on column public.warehouse_items.texture_mode is
  'atlas = despliegue por caras · tile = mosaico · silhouette = vista de frente extruida · volume = forma tallada con las vistas de la plantilla.';
