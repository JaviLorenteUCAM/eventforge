import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Formato ---------------------------------------------------------------
const nf = (digits: number) =>
  new Intl.NumberFormat('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: digits });

export const fmtNum = (v: number, digits = 2) => nf(digits).format(v ?? 0);
export const fmtMeters = (v: number) => `${fmtNum(v, 2)} m`;
export const fmtKg = (v: number) => `${fmtNum(v, v < 10 ? 2 : 0)} kg`;
export const fmtM3 = (v: number) => `${fmtNum(v, 2)} m³`;
export const fmtPct = (v: number) => `${Math.round(v)}%`;

export function fmtDate(value: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', opts ?? { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
}

export function fmtDateTime(value: string | Date | null | undefined) {
  return fmtDate(value, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtDateRange(a: string, b: string) {
  const d1 = new Date(a);
  const d2 = new Date(b);
  const sameDay = d1.toDateString() === d2.toDateString();
  if (sameDay) return fmtDate(d1, { day: '2-digit', month: 'long', year: 'numeric' });
  const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();
  if (sameMonth) {
    return `${d1.getDate()}–${fmtDate(d2, { day: '2-digit', month: 'long', year: 'numeric' })}`;
  }
  return `${fmtDate(d1, { day: '2-digit', month: 'short' })} – ${fmtDate(d2, { day: '2-digit', month: 'short', year: 'numeric' })}`;
}

/** "Hoy", "Mañana", "En 4 días", "Hace 2 días". */
export function relativeDay(value: string | Date | null | undefined) {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  const today = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((a.getTime() - b.getTime()) / 86_400_000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days === -1) return 'Ayer';
  if (days > 1) return `En ${days} días`;
  return `Hace ${Math.abs(days)} días`;
}

/** HH:MM a partir de "09:00:00" o "09:00". */
export const hhmm = (time: string) => (time ?? '').slice(0, 5);

/** Minutos desde medianoche. */
export function timeToMinutes(time: string): number {
  const [h, m] = hhmm(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesToTime(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function durationLabel(start: string, end: string) {
  const mins = Math.max(0, timeToMinutes(end) - timeToMinutes(start));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${m} min`;
}

// --- Varios ----------------------------------------------------------------
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const round = (v: number, decimals = 3) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

export function snap(value: number, step: number) {
  if (!step) return value;
  return round(Math.round(value / step) * step);
}

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

export function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Normaliza texto para busquedas (sin acentos, minusculas). */
export const normalize = (s: string) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Contraste automatico de texto sobre un color hex. */
export function readableOn(hex: string): string {
  const c = hex.replace('#', '');
  if (c.length !== 6) return '#fff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#0b1020' : '#ffffff';
}

export function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(clamp(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 300) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Descarga un blob en el navegador. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const volumeOf = (l: number, w: number, h: number) => round(l * w * h, 4);

/** Divide un array en grupos segun una clave. */
export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Record<K, T[]> {
  return items.reduce(
    (acc, item) => {
      const k = key(item);
      (acc[k] ||= []).push(item);
      return acc;
    },
    {} as Record<K, T[]>,
  );
}
