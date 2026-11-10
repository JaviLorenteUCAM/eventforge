-- ===========================================================================
-- EventForge · 0015 · Altura del suelo del modelo
-- ===========================================================================
--
-- En los modos que sacan la forma de la imagen (silueta y volumen) el modelo
-- puede quedar flotando: si la foto deja aire por debajo, o si las ruedas de
-- una silla son tan finas que no sobreviven al cruce de las vistas, lo más
-- bajo que queda está por encima del suelo.
--
-- `texture_floor_offset` sube (positivo) o hunde (negativo) el modelo, en
-- metros. Va en la FICHA —material, estilo u objeto de catálogo— porque es una
-- propiedad de la imagen: se ajusta una vez y vale para todas las copias que
-- haya en todos los planos.
--
-- Migración aditiva: columna nueva con valor 0, que deja todo como estaba.
-- ===========================================================================

do $do$
declare
  t text;
begin
  foreach t in array array['object_catalog','warehouse_items','warehouse_item_variants'] loop
    execute format(
      'alter table public.%I add column if not exists texture_floor_offset numeric(6,3) not null default 0', t);
    begin
      execute format(
        'alter table public.%I add constraint %I check (texture_floor_offset between -2 and 2)',
        t, t || '_texture_floor_offset_check');
    exception
      when duplicate_object then null;
    end;
  end loop;
end
$do$;

comment on column public.warehouse_items.texture_floor_offset is
  'Metros que se sube (positivo) o se hunde (negativo) el modelo en los modos silueta y volumen.';
