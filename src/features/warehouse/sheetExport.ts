import { toast } from 'sonner';
import type { WarehouseItem } from '@/lib/types';
import { OBJECT_KIND_LABEL } from '@/lib/types';
import { downloadBlob, fmtNum } from '@/lib/utils';

/**
 * EXPORTAR EL ALMACÉN A UNA HOJA DE CÁLCULO
 *
 * EventForge no tiene (ni pide) acceso a la cuenta de Google: eso obligaría a
 * dar permisos de escritura sobre todo Drive. En su lugar genera el contenido
 * ya tabulado y lo deja en el portapapeles en formato TSV, que es exactamente
 * lo que Google Sheets espera al pegar: cada tabulador salta de columna y cada
 * salto de línea de fila. Se pega en A1 y queda la tabla entera.
 *
 * Además descarga un CSV por si se prefiere «Archivo › Importar».
 *
 * El formato bonito (cabecera fija, anchos, colores, alineación) lo aplica el
 * script de Apps Script que hay en scripts/google-sheets/EventForge.gs.
 */

export const SHEET_HEADERS = [
  'Material',
  'Código',
  'Tipo',
  'Categoría',
  'Unidades',
  'Unidad',
  'Largo (cm)',
  'Ancho (cm)',
  'Alto (cm)',
  'Ubicación',
  'Caja',
  'Necesita corriente',
  'Consumo (W)',
  'Descripción',
] as const;

const cm = (m: unknown) => fmtNum(Math.round((Number(m) || 0) * 100), 0);

export function buildSheetRows(
  items: WarehouseItem[],
  categoryName: (id: string | null) => string,
  boxLabel: (itemId: string) => string = () => '',
): string[][] {
  const rows = [...items].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return rows.map((i) => [
    i.name,
    i.internal_code ?? '',
    OBJECT_KIND_LABEL[i.kind] ?? '',
    categoryName(i.category_id),
    fmtNum(Number(i.quantity), 0),
    i.unit,
    cm(i.length_m),
    cm(i.width_m),
    cm(i.height_m),
    i.location ?? '',
    boxLabel(i.id),
    i.requires_power ? 'Sí' : 'No',
    i.requires_power ? fmtNum(Number(i.power_w), 0) : '',
    (i.description ?? '').replace(/\s+/g, ' ').trim(),
  ]);
}

function toTsv(rows: string[][]) {
  // En TSV no se escapan comillas: basta con que no haya tabuladores ni saltos.
  const clean = (c: string) => c.replace(/[\t\r\n]+/g, ' ');
  return rows.map((r) => r.map(clean).join('\t')).join('\n');
}

function toCsv(rows: string[][]) {
  return rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

export async function exportItemsToSheet(
  items: WarehouseItem[],
  categoryName: (id: string | null) => string,
  boxLabel?: (itemId: string) => string,
) {
  if (items.length === 0) {
    toast.info('No hay material que exportar.');
    return;
  }

  const rows = [SHEET_HEADERS as unknown as string[], ...buildSheetRows(items, categoryName, boxLabel)];

  // El CSV siempre se descarga: es la copia que no depende del portapapeles.
  downloadBlob(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), 'almacen-eventforge.csv');

  try {
    await navigator.clipboard.writeText(toTsv(rows));
    toast.success(
      `${items.length} materiales copiados. Pégalos en la celda A1 de tu hoja de cálculo (Ctrl+V).`,
      { duration: 7000 },
    );
  } catch {
    toast.info('CSV descargado. En Google Sheets: Archivo › Importar › Subir.', { duration: 7000 });
  }
}
