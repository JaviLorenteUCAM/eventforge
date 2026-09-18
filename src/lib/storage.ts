import { supabase } from './supabase';

/**
 * Almacenamiento remoto de imagenes (Supabase Storage).
 *
 *   avatars           PUBLICO  · fotos de perfil (se ven antes de iniciar sesion)
 *   event-media       PRIVADO  · portadas de evento
 *   warehouse-photos  PRIVADO  · fotos de material
 *   captures          PRIVADO  · capturas 2D/3D de los planos
 *
 * Los buckets privados se leen con URLs firmadas temporales.
 */
export const BUCKETS = {
  avatars: 'avatars',
  eventMedia: 'event-media',
  warehousePhotos: 'warehouse-photos',
  captures: 'captures',
  planBackgrounds: 'plan-backgrounds',
  textures: 'textures',
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

/** Límite por bucket, en bytes (debe coincidir con el de la migración). */
const MAX_BYTES: Record<string, number> = {
  avatars: 5 * 1024 * 1024,
  'event-media': 10 * 1024 * 1024,
  'warehouse-photos': 10 * 1024 * 1024,
  captures: 10 * 1024 * 1024,
  'plan-backgrounds': 15 * 1024 * 1024,
  textures: 10 * 1024 * 1024,
};

/**
 * Los fondos de plano y las texturas los carga WebGL y una sesión de edición
 * puede durar horas, así que sus URLs firmadas caducan mucho más tarde.
 */
const SIGNED_TTL_BY_BUCKET: Record<string, number> = {
  'plan-backgrounds': 8 * 60 * 60,
  textures: 8 * 60 * 60,
};

export class StorageError extends Error {}

function extensionOf(file: File): string {
  const fromName = file.name.split('.').pop()?.toLowerCase();
  if (fromName && fromName.length <= 5) return fromName;
  return file.type.split('/')[1] ?? 'png';
}

function randomName(file: File) {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${Date.now()}-${rand}.${extensionOf(file)}`;
}

/** Sube un fichero y devuelve su ruta dentro del bucket. */
export async function uploadFile(bucket: BucketName, folder: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new StorageError('El fichero debe ser una imagen (PNG, JPG o WEBP).');
  }
  const limit = MAX_BYTES[bucket] ?? 5 * 1024 * 1024;
  if (file.size > limit) {
    throw new StorageError(`La imagen supera los ${Math.round(limit / 1024 / 1024)} MB.`);
  }

  const path = `${folder.replace(/^\/|\/$/g, '')}/${randomName(file)}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });

  if (error) throw new StorageError(error.message);
  return path;
}

/** Sube un Blob ya generado (capturas del canvas). */
export async function uploadBlob(
  bucket: BucketName,
  path: string,
  blob: Blob,
  contentType = 'image/png',
): Promise<string> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { cacheControl: '3600', upsert: true, contentType });
  if (error) throw new StorageError(error.message);
  return path;
}

export async function removeFile(bucket: BucketName, path: string | null | undefined) {
  if (!path) return;
  await supabase.storage.from(bucket).remove([path]);
}

/** URL publica (solo bucket `avatars`). */
export function publicUrl(bucket: BucketName, path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

// --- URLs firmadas con cache en memoria ------------------------------------
const signedCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_TTL = 60 * 60; // segundos

export async function signedUrl(
  bucket: BucketName,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  if (path.startsWith('http')) return path;

  const key = `${bucket}:${path}`;
  const hit = signedCache.get(key);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.url;

  const ttl = SIGNED_TTL_BY_BUCKET[bucket] ?? SIGNED_TTL;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttl);
  if (error || !data?.signedUrl) return null;

  signedCache.set(key, { url: data.signedUrl, expiresAt: Date.now() + ttl * 1000 });
  return data.signedUrl;
}

/** Devuelve la URL visible de una ruta, publica o firmada segun el bucket. */
export async function resolveUrl(
  bucket: BucketName,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  if (bucket === BUCKETS.avatars) return publicUrl(bucket, path);
  return signedUrl(bucket, path);
}
