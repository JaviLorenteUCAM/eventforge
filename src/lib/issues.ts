import type { ObjectKind, PlanConnection, PlanIssue, PlanObject } from './types';

/**
 * DETECCION AUTOMATICA DE PROBLEMAS EN EL PLANO
 *
 * Electricidad: un objeto con `requires_power` esta bien alimentado si existe un
 * camino por cables de tipo "power" hasta una FUENTE (`power_source`, p.ej. el
 * cuadro electrico o una toma de pared). Las regletas y alargaderas propagan la
 * corriente, pero solo si ellas mismas estan alimentadas.
 *
 * Red: un objeto con `requires_network` esta bien conectado si existe un camino
 * por cables de tipo "network" hasta un switch o un router.
 *
 * Ademas se avisa de regletas y switches con mas tomas ocupadas de las que
 * tienen fisicamente.
 */

const POWER_SOURCES: ObjectKind[] = ['power_source'];
const POWER_RELAYS: ObjectKind[] = ['power_strip'];
/**
 * Origen de red: los switches y routers reparten, y el «punto de red
 * principal» es la acometida del edificio (la roseta que trae Internet). Sin
 * ninguno de los tres en el plano, nada tiene red.
 */
const NETWORK_SOURCES: ObjectKind[] = ['network_switch', 'network_router', 'network_source'];

function buildAdjacency(connections: PlanConnection[], kind: 'power' | 'network') {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b);
    else adj.set(a, [b]);
  };

  for (const c of connections) {
    if (c.kind !== kind) continue;
    link(c.from_object_id, c.to_object_id);
    link(c.to_object_id, c.from_object_id);
  }
  return adj;
}

/** Conjunto de ids alcanzables desde cualquiera de las fuentes. */
function reachableFrom(
  sources: string[],
  adj: Map<string, string[]>,
  canRelay: (id: string) => boolean,
): Set<string> {
  const seen = new Set<string>(sources);
  const queue = [...sources];

  while (queue.length) {
    const current = queue.shift()!;
    for (const next of adj.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      // Solo seguimos propagando a traves de nodos que "reparten" (regletas,
      // switches...). Un PC no alimenta a otro PC.
      if (canRelay(next)) queue.push(next);
    }
  }
  return seen;
}

export function analyzePlan(objects: PlanObject[], connections: PlanConnection[]): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const byId = new Map(objects.map((o) => [o.id, o]));
  const nameOf = (o: PlanObject) => o.label?.trim() || 'Objeto sin nombre';

  // ---------------------------------------------------------------- POWER --
  const powerAdj = buildAdjacency(connections, 'power');
  const powerSources = objects.filter((o) => POWER_SOURCES.includes(o.kind)).map((o) => o.id);
  const poweredSet = reachableFrom(powerSources, powerAdj, (id) => {
    const o = byId.get(id);
    return Boolean(o && (POWER_RELAYS.includes(o.kind) || POWER_SOURCES.includes(o.kind)));
  });

  for (const o of objects) {
    if (!o.requires_power) continue;
    if (!poweredSet.has(o.id)) {
      issues.push({
        id: `no_power:${o.id}`,
        objectId: o.id,
        severity: 'error',
        kind: 'no_power',
        title: `${nameOf(o)} — Sin electricidad`,
        detail:
          powerSources.length === 0
            ? 'No hay ningún punto de luz en el plano (cuadro, toma de pared o acometida).'
            : 'No hay ningún cable que lleve corriente hasta este objeto.',
      });
    }
  }

  // Regletas sin alimentar (aunque no consuman, si no llega corriente no sirven)
  for (const o of objects) {
    if (!POWER_RELAYS.includes(o.kind)) continue;
    const hasChildren = (powerAdj.get(o.id) ?? []).length > 0;
    if (hasChildren && !poweredSet.has(o.id)) {
      issues.push({
        id: `no_power_relay:${o.id}`,
        objectId: o.id,
        severity: 'error',
        kind: 'no_power',
        title: `${nameOf(o)} — Regleta sin alimentar`,
        detail: 'Tiene aparatos conectados pero no recibe corriente de ninguna fuente.',
      });
    }
  }

  // -------------------------------------------------------------- NETWORK --
  const netAdj = buildAdjacency(connections, 'network');
  const netSources = objects.filter((o) => NETWORK_SOURCES.includes(o.kind)).map((o) => o.id);
  const networkedSet = reachableFrom(netSources, netAdj, (id) => {
    const o = byId.get(id);
    return Boolean(o && (NETWORK_SOURCES.includes(o.kind) || o.kind === 'network_node'));
  });

  for (const o of objects) {
    if (!o.requires_network) continue;
    if (!networkedSet.has(o.id)) {
      issues.push({
        id: `no_network:${o.id}`,
        objectId: o.id,
        severity: 'error',
        kind: 'no_network',
        title: `${nameOf(o)} — Sin red`,
        detail:
          netSources.length === 0
            ? 'No hay ningún punto de red principal, switch ni router en el plano.'
            : 'No hay ningún cable de red que llegue hasta este objeto.',
      });
    }
  }

  // ----------------------------------------------------------- SATURACION --
  const powerDegree = new Map<string, number>();
  const netDegree = new Map<string, number>();
  for (const c of connections) {
    const target = c.kind === 'power' ? powerDegree : netDegree;
    target.set(c.from_object_id, (target.get(c.from_object_id) ?? 0) + 1);
    target.set(c.to_object_id, (target.get(c.to_object_id) ?? 0) + 1);
  }

  for (const o of objects) {
    if (POWER_RELAYS.includes(o.kind) || POWER_SOURCES.includes(o.kind)) {
      // Una toma la ocupa su propia alimentacion: descontamos 1 si esta alimentada.
      const used = (powerDegree.get(o.id) ?? 0) - (POWER_SOURCES.includes(o.kind) ? 0 : 1);
      if (o.outlet_count > 0 && used > o.outlet_count) {
        issues.push({
          id: `overloaded_strip:${o.id}`,
          objectId: o.id,
          severity: 'warning',
          kind: 'overloaded_strip',
          title: `${nameOf(o)} — Tomas insuficientes`,
          detail: `Hay ${used} aparatos conectados y solo dispone de ${o.outlet_count} tomas.`,
        });
      }
    }

    if (NETWORK_SOURCES.includes(o.kind) && o.port_count > 0) {
      const used = netDegree.get(o.id) ?? 0;
      if (used > o.port_count) {
        issues.push({
          id: `overloaded_switch:${o.id}`,
          objectId: o.id,
          severity: 'warning',
          kind: 'overloaded_switch',
          title: `${nameOf(o)} — Puertos insuficientes`,
          detail: `Hay ${used} cables conectados y solo tiene ${o.port_count} puertos.`,
        });
      }
    }
  }

  // ------------------------------------------------------- CABLES HUERFANOS -
  for (const c of connections) {
    if (!byId.has(c.from_object_id) || !byId.has(c.to_object_id)) {
      issues.push({
        id: `orphan_cable:${c.id}`,
        objectId: null,
        severity: 'warning',
        kind: 'orphan_cable',
        title: 'Cable sin extremo válido',
        detail: 'Uno de los objetos conectados ya no existe en el plano.',
      });
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Consumo eléctrico total y por rama, en vatios. */
export function powerBudget(objects: PlanObject[]) {
  const total = objects.reduce((sum, o) => sum + (o.requires_power ? Number(o.power_w) || 0 : 0), 0);
  return {
    totalW: Math.round(total),
    amps230: Math.round((total / 230) * 10) / 10,
    consumers: objects.filter((o) => o.requires_power).length,
  };
}
