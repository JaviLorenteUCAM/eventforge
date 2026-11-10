-- ===========================================================================
-- EventForge · 0016 · Modelos 3D (.glb) en el material y el catálogo
-- ===========================================================================
--
-- Hay objetos que ninguna caja pintada ni forma tallada reproduce bien: una
-- silla gaming con su base de cinco radios, sus ruedas y su marca bordada.
-- Para esos, la ficha admite un MODELO 3D en formato glTF binario (.glb) con
-- su textura incrustada. El 3D del plano lo dibuja en lugar de la caja,
-- escalado a las medidas de la ficha para que coincida con su huella del 2D.
--
-- · `model_path`: ruta del .glb en el bucket privado `models`. Null = sin
--   modelo (se dibuja como hasta ahora).
-- · Bucket `models`: privado, 30 MB por fichero, leído con URL firmada igual
--   que las texturas.
--
-- Migración aditiva.
-- ===========================================================================

alter table public.object_catalog  add column if not exists model_path text;
alter table public.warehouse_items add column if not exists model_path text;

comment on column public.warehouse_items.model_path is
  'Modelo 3D (.glb) en el bucket models. Se escala a largo × alto × ancho de la ficha.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('models', 'models', false, 31457280,
   array['model/gltf-binary', 'application/octet-stream'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Mismas reglas que los fondos y las texturas (0005): cualquier perfil activo
-- lee y escribe.
drop policy if exists "media buckets read" on storage.objects;
create policy "media buckets read" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('plan-backgrounds','textures','models') and public.is_active_profile()
  );

drop policy if exists "media buckets write" on storage.objects;
create policy "media buckets write" on storage.objects
  for all to authenticated
  using (bucket_id in ('plan-backgrounds','textures','models') and public.is_active_profile())
  with check (bucket_id in ('plan-backgrounds','textures','models') and public.is_active_profile());
