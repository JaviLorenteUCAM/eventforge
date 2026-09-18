import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { type BucketName, removeFile, resolveUrl, uploadFile } from '@/lib/storage';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { Spinner } from './Feedback';

/**
 * Subida de imagenes a Supabase Storage (almacenamiento REMOTO).
 * Devuelve la ruta dentro del bucket; nunca guarda la imagen en el navegador.
 */
export function ImageUpload({
  bucket,
  folder,
  path,
  onChange,
  label = 'Imagen',
  aspect = 'video',
  className,
  rounded = 'rounded-2xl',
}: {
  bucket: BucketName;
  folder: string;
  path: string | null;
  onChange: (path: string | null) => void;
  label?: string;
  aspect?: 'video' | 'square';
  className?: string;
  rounded?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void resolveUrl(bucket, path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [bucket, path]);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const newPath = await uploadFile(bucket, folder, file);
      const old = path;
      onChange(newPath);
      if (old) void removeFile(bucket, old);
      toast.success('Imagen subida');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido subir la imagen');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-[12px] font-medium text-muted">{label}</p>

      <div
        className={cn(
          'group relative flex w-full items-center justify-center overflow-hidden border border-dashed border-line-strong bg-surface-2',
          aspect === 'video' ? 'aspect-video' : 'aspect-square',
          rounded,
        )}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void handleFile(f);
        }}
      >
        {url ? (
          <img src={url} alt={label} className="size-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1.5 text-dim">
            <ImagePlus className="size-6" />
            <p className="text-[12px]">Arrastra una imagen o pulsa Subir</p>
          </div>
        )}

        {busy ? (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <Spinner />
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          icon={<Upload className="size-3.5" />}
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          Subir
        </Button>
        {path ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            disabled={busy}
            onClick={() => {
              void removeFile(bucket, path);
              onChange(null);
              setUrl(null);
            }}
          >
            Quitar
          </Button>
        ) : null}
      </div>
    </div>
  );
}
