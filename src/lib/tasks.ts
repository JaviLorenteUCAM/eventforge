import type { Task } from './types';

/**
 * Las personas de una tarea, en orden. Lee la lista (`assignee_ids`) y, si
 * viene vacía en una fila antigua, la persona única de antes (`assignee_id`).
 */
export function assigneesOf(task: Pick<Task, 'assignee_id' | 'assignee_ids'>): string[] {
  const list = task.assignee_ids ?? [];
  if (list.length) return list;
  return task.assignee_id ? [task.assignee_id] : [];
}

/** ¿Está esta persona entre las de la tarea? */
export function isAssignedTo(
  task: Pick<Task, 'assignee_id' | 'assignee_ids'>,
  profileId: string | null | undefined,
): boolean {
  return Boolean(profileId) && assigneesOf(task).includes(profileId as string);
}
