/** Claves de React Query centralizadas para poder invalidar con precisión. */
export const qk = {
  profiles: ['profiles'] as const,

  events: ['events'] as const,
  event: (id: string) => ['events', id] as const,
  eventMembers: (id: string) => ['events', id, 'members'] as const,

  tasks: (eventId?: string) => (eventId ? (['tasks', eventId] as const) : (['tasks'] as const)),
  allTasks: ['tasks', 'all'] as const,

  scheduleDays: (eventId: string) => ['schedule', eventId, 'days'] as const,
  scheduleActivities: (eventId: string) => ['schedule', eventId, 'activities'] as const,
  activityMembers: (eventId: string) => ['schedule', eventId, 'activity-members'] as const,

  categories: ['material-categories'] as const,
  catalog: ['object-catalog'] as const,

  warehouseItems: ['warehouse-items'] as const,
  warehouseBoxes: ['warehouse-boxes'] as const,
  warehouseBoxItems: ['warehouse-box-items'] as const,

  plans: (eventId: string) => ['plans', eventId] as const,
  planObjects: (planId: string) => ['plan-objects', planId] as const,
  planConnections: (planId: string) => ['plan-connections', planId] as const,
  planBackgrounds: (planId: string) => ['plan-backgrounds', planId] as const,

  scenarios: ['scenarios'] as const,
  scenarioPreview: (id: string) => ['scenarios', id, 'preview'] as const,


  snapshots: (eventId: string) => ['snapshots', eventId] as const,
};
