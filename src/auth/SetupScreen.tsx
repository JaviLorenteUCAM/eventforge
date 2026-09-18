import { ExternalLink, Settings2 } from 'lucide-react';
import { missingEnvVars } from '@/lib/env';

/** Se muestra cuando faltan las variables de entorno de Supabase. */
export function SetupScreen() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="card w-full max-w-lg p-7">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-line bg-surface-2 text-warn">
            <Settings2 className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-ink">Falta configuración</h1>
            <p className="text-[13px] text-muted">La aplicación aún no sabe a qué servidor conectarse.</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-muted">
          Crea un fichero <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">.env</code> en
          la raíz del proyecto (puedes copiar{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">.env.example</code>) con estas
          variables:
        </p>

        <ul className="mt-3 space-y-1.5">
          {missingEnvVars.map((v) => (
            <li
              key={v}
              className="rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-[12.5px] text-ink"
            >
              {v}=…
            </li>
          ))}
        </ul>

        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          Los valores están en tu proyecto de Supabase, en{' '}
          <strong className="text-ink">Project Settings → API</strong>. Después reinicia el servidor
          de desarrollo (<code className="rounded bg-surface-2 px-1.5 py-0.5">npm run dev</code>).
        </p>

        <a
          href="https://supabase.com/dashboard"
          target="_blank"
          rel="noreferrer"
          className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-soft hover:underline"
        >
          Abrir el panel de Supabase <ExternalLink className="size-3.5" />
        </a>

        <p className="mt-6 border-t border-line pt-4 text-[12px] text-dim">
          Guía completa paso a paso en el <strong>README.md</strong> del proyecto.
        </p>
      </div>
    </div>
  );
}
