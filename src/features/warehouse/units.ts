import type { Unit } from '@/lib/types';

/** Unidades del almacén, con su nombre para los desplegables. */
export const UNITS: { value: Unit; label: string }[] = [
  { value: 'ud', label: 'unidades' },
  { value: 'm', label: 'metros' },
  { value: 'kg', label: 'kilos' },
  { value: 'l', label: 'litros' },
  { value: 'pack', label: 'packs' },
];
