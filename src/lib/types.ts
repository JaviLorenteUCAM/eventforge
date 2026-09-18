/**
 * Tipos de dominio (espejo del esquema SQL de supabase/migrations).
 *
 * Nota: si prefieres tipos generados automaticamente desde la base de datos:
 *   npx supabase gen types typescript --project-id <REF> > src/lib/database.types.ts
 * y tipa el cliente con createClient<Database>(...). Este fichero cumple la
 * misma funcion sin depender del CLI.
 */

// --- Uniones de estado -----------------------------------------------------
export const EVENT_STATUSES = [
  'planning',
  'preparation',
  'setup',
  'live',
  'teardown',
  'finished',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  planning: 'Planificación',
  preparation: 'Preparación',
  setup: 'Montaje',
  live: 'En curso',
  teardown: 'Desmontaje',
  finished: 'Finalizado',
};

export const EVENT_STATUS_COLOR: Record<EventStatus, string> = {
  planning: '#8b93a7',
  preparation: '#6366f1',
  setup: '#f59e0b',
  live: '#34d399',
  teardown: '#f472b6',
  finished: '#64748b',
};

export const TASK_STATUSES = ['pending', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En proceso',
  done: 'Hecha',
};

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};
export const TASK_PRIORITY_COLOR: Record<TaskPriority, string> = {
  low: '#64748b',
  medium: '#6366f1',
  high: '#f59e0b',
  urgent: '#f87171',
};

export const OBJECT_KINDS = [
  'generic',
  'furniture',
  'av',
  'power_source',
  'power_strip',
  'power_sink',
  'network_switch',
  'network_router',
  'network_node',
  'network_source',
  'decor',
  'tool',
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const OBJECT_KIND_LABEL: Record<ObjectKind, string> = {
  generic: 'Genérico',
  furniture: 'Mobiliario',
  av: 'Audiovisual',
  power_source: 'Fuente eléctrica',
  power_strip: 'Regleta / alargadera',
  power_sink: 'Consumidor eléctrico',
  network_switch: 'Switch',
  network_router: 'Router',
  network_node: 'Punto de red',
  network_source: 'Punto de red principal',
  decor: 'Decoración',
  tool: 'Herramienta',
};

export type Shape = 'box' | 'cylinder' | 'plane' | 'text' | 'line';
export type ConnectionKind = 'power' | 'network';
export type Unit = 'ud' | 'm' | 'kg' | 'l' | 'pack';
export type VehicleType = 'van' | 'truck' | 'trailer' | 'custom';

// --- Filas -----------------------------------------------------------------
export interface Profile {
  id: string;
  name: string;
  role_title: string;
  avatar_url: string | null;
  color: string;
  is_active: boolean;
  is_admin: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  name: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  status: EventStatus;
  cover_path: string | null;
  notes: string;
  color: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventMember {
  event_id: string;
  profile_id: string;
  role: 'owner' | 'manager' | 'member';
  created_at: string;
}

export interface Task {
  id: string;
  event_id: string;
  title: string;
  description: string;
  assignee_id: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  position: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleDay {
  id: string;
  event_id: string;
  day_index: number;
  date: string | null;
  label: string;
  created_at: string;
}

export interface ScheduleActivity {
  id: string;
  event_id: string;
  day_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  color: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface MaterialCategory {
  id: string;
  name: string;
  slug: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface CatalogObject {
  id: string;
  name: string;
  category_id: string | null;
  kind: ObjectKind;
  length_m: number;
  width_m: number;
  height_m: number;
  weight_kg: number;
  color: string;
  material: string;
  notes: string;
  shape: 'box' | 'cylinder' | 'plane';
  requires_power: boolean;
  requires_network: boolean;
  power_w: number;
  outlet_count: number;
  port_count: number;
  is_system: boolean;
  texture_path: string | null;
  texture_mode: TextureMode;
  texture_scale: number;
  texture_offset_x: number;
  texture_offset_y: number;
  texture_rotation: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TextureMode = 'atlas' | 'tile';

/**
 * Material del almacén. Desde la versión 0006 es TAMBIÉN la definición del
 * objeto que se coloca en el plano: lleva forma, tipo, comportamiento
 * eléctrico/red y textura. La biblioteca (object_catalog) queda para objetos
 * puntuales de un evento, sin existencias.
 */
export interface WarehouseItem {
  id: string;
  name: string;
  category_id: string | null;
  catalog_id: string | null;
  quantity: number;
  unit: Unit;
  length_m: number;
  width_m: number;
  height_m: number;
  weight_kg: number;
  photo_path: string | null;
  description: string;
  location: string;
  internal_code: string | null;
  kind: ObjectKind;
  shape: 'box' | 'cylinder' | 'plane';
  color: string;
  requires_power: boolean;
  requires_network: boolean;
  power_w: number;
  outlet_count: number;
  port_count: number;
  texture_path: string | null;
  texture_mode: TextureMode;
  texture_scale: number;
  texture_offset_x: number;
  texture_offset_y: number;
  texture_rotation: number;
  created_at: string;
  updated_at: string;
}

/**
 * ESTILO DE UN MATERIAL
 *
 * Mismo objeto, distinto acabado: los cinco photocalls con cinco dibujos, las
 * mesas con mantel negro o rojo. Cada estilo tiene sus propias unidades y su
 * propia textura, y decide si además cuenta como material aparte (el mantel
 * hay que llevarlo; el dibujo del photocall no es un bulto).
 */
export interface WarehouseItemVariant {
  id: string;
  item_id: string;
  name: string;
  quantity: number;
  /** Sin color propio se hereda el del material. */
  color: string | null;
  texture_path: string | null;
  texture_mode: TextureMode;
  texture_scale: number;
  texture_offset_x: number;
  texture_offset_y: number;
  texture_rotation: number;
  /** ¿Aparece como línea propia en el listado de material del evento? */
  adds_material: boolean;
  /** Con qué nombre aparece ahí. Vacío = el del estilo. */
  material_name: string;
  material_unit: Unit;
  sort_order: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

/** Existencias de un artículo frente a lo ya colocado en el plano. */
export interface StockInfo {
  total: number;
  used: number;
  available: number;
}

export interface WarehouseBox {
  id: string;
  code: string;
  name: string;
  length_m: number;
  width_m: number;
  height_m: number;
  empty_weight_kg: number;
  location: string;
  color: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface WarehouseBoxItem {
  id: string;
  box_id: string;
  item_id: string;
  quantity: number;
  created_at: string;
}

export interface Plan {
  id: string;
  event_id: string;
  name: string;
  width_m: number;
  depth_m: number;
  height_m: number;
  grid_size_m: number;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanObject {
  id: string;
  plan_id: string;
  catalog_id: string | null;
  warehouse_item_id: string | null;
  /** Estilo concreto del material con el que se colocó, si lo tiene. */
  variant_id: string | null;
  label: string;
  kind: ObjectKind;
  category_id: string | null;
  x: number;
  y: number;
  z: number;
  rotation: number;
  length_m: number;
  width_m: number;
  height_m: number;
  weight_kg: number;
  color: string;
  shape: Shape;
  requires_power: boolean;
  requires_network: boolean;
  power_w: number;
  outlet_count: number;
  port_count: number;
  locked: boolean;
  props: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Punto del trazado de un cable, en metros sobre el plano. */
export interface Waypoint {
  x: number;
  y: number;
}

export interface PlanConnection {
  id: string;
  plan_id: string;
  kind: ConnectionKind;
  from_object_id: string;
  to_object_id: string;
  cable_type: string;
  length_m: number;
  color: string;
  notes: string;
  /**
   * Puntos intermedios por los que pasa el cable. Vacío = línea recta entre
   * los dos aparatos, que es como se comportaban todos los cables antes.
   */
  waypoints: Waypoint[];
  created_at: string;
  updated_at: string;
}

export interface TransportVehicle {
  id: string;
  name: string;
  vehicle_type: VehicleType;
  length_m: number;
  width_m: number;
  height_m: number;
  max_weight_kg: number;
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

export interface TransportLoad {
  id: string;
  event_id: string;
  vehicle_id: string | null;
  name: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface TransportItem {
  id: string;
  load_id: string;
  source_kind: 'item' | 'box' | 'custom';
  item_id: string | null;
  box_id: string | null;
  label: string;
  quantity: number;
  x: number;
  y: number;
  z: number;
  rotation: number;
  length_m: number;
  width_m: number;
  height_m: number;
  weight_kg: number;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface Snapshot {
  id: string;
  event_id: string;
  plan_id: string | null;
  kind: '2d' | '3d' | 'transport';
  storage_path: string;
  title: string;
  created_by: string | null;
  created_at: string;
}

// --- Modelos derivados (calculados en cliente) ------------------------------
export interface MaterialNeed {
  key: string;
  name: string;
  catalogId: string | null;
  categoryId: string | null;
  needed: number;
  available: number;
  missing: number;
  unit: Unit;
  warehouseItemId: string | null;
  /** Si la línea sale de un estilo (un mantel, una funda), cuál. */
  variantId?: string | null;
  totalWeightKg: number;
  totalVolumeM3: number;
}

export type IssueSeverity = 'error' | 'warning';

export interface PlanIssue {
  id: string;
  objectId: string | null;
  severity: IssueSeverity;
  kind: 'no_power' | 'no_network' | 'overloaded_strip' | 'overloaded_switch' | 'orphan_cable';
  title: string;
  detail: string;
}

// --- Imágenes de fondo del plano -------------------------------------------
/**
 * Capa de imagen bajo (o sobre) el plano. (x, y) es la ESQUINA SUPERIOR
 * IZQUIERDA en metros; width_m/height_m son su tamaño real una vez calibrada.
 * z_index 0 = pegada al suelo; valores mayores se dibujan encima.
 */
export interface PlanBackground {
  id: string;
  plan_id: string;
  storage_path: string;
  label: string;
  opacity: number;
  x: number;
  y: number;
  width_m: number;
  height_m: number;
  rotation: number;
  z_index: number;
  visible: boolean;
  locked: boolean;
  created_at: string;
  updated_at: string;
}

// --- Escenarios reutilizables ----------------------------------------------
export interface Scenario {
  id: string;
  name: string;
  description: string;
  location: string;
  width_m: number;
  depth_m: number;
  height_m: number;
  grid_size_m: number;
  thumbnail_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScenarioObject extends Omit<PlanObject, 'plan_id' | 'updated_at'> {
  scenario_id: string;
}

export interface ScenarioBackground
  extends Omit<PlanBackground, 'plan_id' | 'updated_at'> {
  scenario_id: string;
}
