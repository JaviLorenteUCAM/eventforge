-- ===========================================================================
-- EventForge · 0012 · Modo silueta: el objeto ES el recorte
-- ===========================================================================
--
-- El problema que resuelve
-- ------------------------
-- Con el color transparente ya se podía abrir un hueco en la textura, pero el
-- objeto seguía siendo una CAJA con seis caras pintadas. Al vaciar el frente y
-- el trasero de un soporte de televisión se veía a través, sí, pero los
-- laterales seguían siendo rectángulos enteros: las dos patas no se unían por
-- los lados y el conjunto quedaba flotando, como una carcasa hueca.
--
-- El modo `silhouette` cambia el enfoque: en vez de pintar una caja, se lee la
-- silueta de la imagen y se EXTRUYE. Lo que en la imagen es sólido se convierte
-- en volumen macizo con el fondo del objeto; lo que es transparente, en aire.
-- Las patas salen como dos prismas de verdad, unidos por la base, y el hueco es
-- hueco por los cuatro costados.
--
-- La imagen deja de ser el despliegue en cruz de las seis caras y pasa a ser
-- simplemente la VISTA DE FRENTE, que además es mucho más fácil de dibujar.
--
-- Migración aditiva: solo amplía la lista de modos permitidos.
-- ===========================================================================

do $do$
declare
  t text;
  c text;
begin
  foreach t in array array['object_catalog','warehouse_items','warehouse_item_variants'] loop
    -- El nombre de la restricción no es el mismo en las tres tablas: unas
    -- vienen de 0005/0006 con sufijo _ck y la de estilos la puso el CREATE
    -- TABLE de 0008 con el nombre automático de PostgreSQL.
    for c in
      select conname from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%texture_mode%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c);
    end loop;

    execute format(
      'alter table public.%I add constraint %I check (texture_mode in (%L, %L, %L))',
      t, t || '_texture_mode_ck', 'atlas', 'tile', 'silhouette');
  end loop;
end
$do$;

comment on column public.warehouse_items.texture_mode is
  'atlas = despliegue por caras · tile = mosaico · silhouette = la imagen es la vista de frente y se extruye.';
