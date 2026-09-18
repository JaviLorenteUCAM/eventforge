/**
 * Capturas del plano.
 *
 * 2D: se serializa el SVG, se rasteriza en un <canvas> y se obtiene un PNG.
 * 3D: se fuerza un render y se lee el canvas de WebGL (necesita
 *     preserveDrawingBuffer: true, ya configurado en el <Canvas>).
 *
 * El PNG resultante se sube a Supabase Storage (bucket `captures`), nunca se
 * queda solo en el navegador.
 */

/** Sustituye las variables CSS por valores concretos para que el PNG no salga vacío. */
const CSS_VAR_FALLBACKS: Record<string, string> = {
  '--ef-canvas': '#070a12',
  '--ef-canvas-2': '#0b1020',
  '--ef-grid': 'rgba(255,255,255,0.06)',
  '--ef-grid-strong': 'rgba(255,255,255,0.14)',
  '--ef-line': 'rgba(255,255,255,0.09)',
  '--ef-line-strong': 'rgba(255,255,255,0.18)',
  '--ef-text': '#e8ecf6',
  '--ef-muted': '#97a1bb',
  '--ef-accent': '#6366f1',
  '--ef-accent-soft': '#818cf8',
  '--ef-cyan': '#22d3ee',
  '--ef-danger': '#f87171',
};

function inlineCssVariables(markup: string): string {
  let out = markup;
  for (const [name, value] of Object.entries(CSS_VAR_FALLBACKS)) {
    out = out.replaceAll(`var(${name})`, value);
  }
  // color-mix() no lo entiende el rasterizador de imágenes: lo simplificamos.
  out = out.replace(/color-mix\([^)]*\)/g, 'rgba(99,102,241,0.25)');
  return out;
}

export async function captureSvg(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const width = svg.width.baseVal.value || svg.clientWidth || 1200;
  const height = svg.height.baseVal.value || svg.clientHeight || 800;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));

  const markup = inlineCssVariables(new XMLSerializer().serializeToString(clone));
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;

  const image = new Image();
  image.crossOrigin = 'anonymous';

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('No se ha podido generar la imagen del plano.'));
    image.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite generar la captura.');

  ctx.fillStyle = CSS_VAR_FALLBACKS['--ef-canvas-2'];
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se ha podido generar el PNG.'))),
      'image/png',
      0.95,
    );
  });
}

export async function captureCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se ha podido generar el PNG.'))),
      'image/png',
      0.95,
    );
  });
}
