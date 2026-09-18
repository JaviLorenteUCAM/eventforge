/**
 * EVENTFORGE · FORMATO DEL ALMACÉN EN GOOGLE SHEETS
 * =================================================
 *
 * Qué hace
 * --------
 * Deja la hoja del almacén presentable de una pasada: cabecera fija y con
 * color, anchos de columna, números alineados, filas alternas, filtro y
 * resaltado en rojo del material del que no queda ninguna unidad.
 *
 * Cómo se instala (una sola vez)
 * ------------------------------
 *  1. Abre tu hoja de cálculo en Google Sheets.
 *  2. Menú «Extensiones» › «Apps Script».
 *  3. Borra lo que haya y pega TODO este archivo.
 *  4. Guarda (icono del disquete) y cierra la pestaña de Apps Script.
 *  5. Vuelve a la hoja y recárgala (F5). Aparecerá un menú nuevo:
 *     «EventForge».
 *
 * Cómo se usa cada vez
 * --------------------
 *  1. En EventForge: Almacén › «Exportar a hoja de cálculo».
 *     (copia la tabla al portapapeles y además descarga un CSV de respaldo)
 *  2. En la hoja: clic en la celda A1 y Ctrl+V.
 *  3. Menú «EventForge» › «Dar formato al almacén».
 *
 * No necesita claves ni permisos de EventForge: el script solo toca la hoja
 * en la que está instalado.
 */

var HEADERS = [
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
];

var WIDTHS = [230, 110, 140, 150, 90, 80, 95, 95, 95, 160, 120, 140, 110, 320];

var COLORS = {
  header: '#1e293b',
  headerText: '#ffffff',
  band: '#f1f5f9',
  border: '#cbd5e1',
  zero: '#fee2e2',
  zeroText: '#991b1b',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('EventForge')
    .addItem('Dar formato al almacén', 'formatWarehouse')
    .addItem('Insertar cabeceras vacías', 'writeHeaders')
    .addToUi();
}

/** Escribe la fila de cabeceras en A1 (por si se pega sin ella). */
function writeHeaders() {
  var sheet = SpreadsheetApp.getActiveSheet();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  formatWarehouse();
}

function formatWarehouse() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  var cols = HEADERS.length;

  if (lastRow < 1) {
    SpreadsheetApp.getUi().alert('La hoja está vacía. Pega antes la tabla exportada desde EventForge.');
    return;
  }

  // Si sobran columnas de una exportación anterior, se dejan tal cual: solo
  // damos formato a las que conocemos.
  var all = sheet.getRange(1, 1, lastRow, cols);
  all.setFontFamily('Inter').setFontSize(10).setVerticalAlignment('middle');
  all.setBorder(true, true, true, true, true, true, COLORS.border, SpreadsheetApp.BorderStyle.SOLID);

  // Cabecera
  var header = sheet.getRange(1, 1, 1, cols);
  header
    .setBackground(COLORS.header)
    .setFontColor(COLORS.headerText)
    .setFontWeight('bold')
    .setFontSize(10)
    .setHorizontalAlignment('center')
    .setWrap(true);
  sheet.setRowHeight(1, 34);
  sheet.setFrozenRows(1);

  if (lastRow < 2) return;

  var rows = lastRow - 1;
  var body = sheet.getRange(2, 1, rows, cols);
  body.setBackground(null).setFontColor('#0f172a');

  // Filas alternas, para poder seguir la línea con la vista.
  for (var r = 2; r <= lastRow; r++) {
    if (r % 2 === 0) sheet.getRange(r, 1, 1, cols).setBackground(COLORS.band);
  }

  // Alineación: los números a la derecha, el texto a la izquierda.
  sheet.getRange(2, 1, rows, 4).setHorizontalAlignment('left');
  sheet.getRange(2, 5, rows, 1).setHorizontalAlignment('right').setNumberFormat('0');
  sheet.getRange(2, 6, rows, 1).setHorizontalAlignment('center');
  sheet.getRange(2, 7, rows, 3).setHorizontalAlignment('right').setNumberFormat('0');
  sheet.getRange(2, 10, rows, 3).setHorizontalAlignment('left');
  sheet.getRange(2, 12, rows, 1).setHorizontalAlignment('center');
  sheet.getRange(2, 13, rows, 1).setHorizontalAlignment('right').setNumberFormat('0');
  sheet.getRange(2, 14, rows, 1).setWrap(false);

  sheet.getRange(2, 1, rows, 1).setFontWeight('bold');

  // Anchos
  for (var c = 0; c < cols; c++) sheet.setColumnWidth(c + 1, WIDTHS[c]);

  // Sin existencias -> en rojo, que es lo que habrá que alquilar o comprar.
  var rules = [];
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$E2=0')
      .setBackground(COLORS.zero)
      .setFontColor(COLORS.zeroText)
      .setRanges([sheet.getRange(2, 1, rows, cols)])
      .build(),
  );
  sheet.setConditionalFormatRules(rules);

  // Filtro para poder ordenar y buscar por columna.
  var existing = sheet.getFilter();
  if (existing) existing.remove();
  sheet.getRange(1, 1, lastRow, cols).createFilter();

  SpreadsheetApp.getActiveSpreadsheet().toast(rows + ' materiales con formato aplicado.', 'EventForge', 5);
}
