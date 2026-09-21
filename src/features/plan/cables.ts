import type { ConnectionKind } from '@/lib/types';

/**
 * Cableado del plano: reglas compartidas entre la barra de herramientas, el
 * lienzo 2D y el 3D.
 *
 * Viven aparte de los componentes a propósito: si se exportan desde un archivo
 * que además exporta componentes, Vite pierde el recargado en caliente.
 */

/** ¿La herramienta activa sirve para tirar cable? */
export function isCableTool(tool: string) {
  return tool === 'power' || tool === 'network' || tool === 'signal';
}

/** Tipo de cable que crea cada herramienta. */
export function toolKind(tool: string): ConnectionKind {
  return tool === 'network' ? 'network' : tool === 'signal' ? 'signal' : 'power';
}

/**
 * Trazo de cada cableado: la corriente va continua, la red punteada y la señal
 * de raya larga. Así se distinguen aunque se impriman en blanco y negro.
 */
export function dashFor(kind: ConnectionKind, strokePx: number) {
  if (kind === 'network') return `${strokePx * 6} ${strokePx * 4}`;
  if (kind === 'signal') return `${strokePx * 14} ${strokePx * 5}`;
  return undefined;
}

/** ¿Es una acometida: el punto de luz o el punto de red de la sala? */
export function isFeed(kind: string) {
  return kind === 'power_source' || kind === 'network_source';
}
