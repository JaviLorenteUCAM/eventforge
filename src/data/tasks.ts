import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Task } from '@/lib/types';
import { deleteRow, insertRow, selectAll, updateRow } from './api';
import { qk } from './keys';

export function useTasks(eventId?: string) {
  return useQuery({
    queryKey: qk.tasks(eventId),
    queryFn: () =>
      selectAll<Task>('tasks', (q) => {
        const base = eventId ? q.eq('event_id', eventId) : q;
        return base.order('position', { ascending: true }).order('created_at', { ascending: true });
      }),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>, eventId?: string) {
  void qc.invalidateQueries({ queryKey: ['tasks'] });
  if (eventId) void qc.invalidateQueries({ queryKey: qk.tasks(eventId) });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<Task>) => insertRow<Task>('tasks', values),
    onSuccess: (task) => invalidate(qc, task.event_id),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<Task> }) =>
      updateRow<Task>('tasks', input.id, input.patch),
    onSuccess: (task) => invalidate(qc, task.event_id),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; eventId: string }) => deleteRow('tasks', input.id),
    onSuccess: (_d, vars) => invalidate(qc, vars.eventId),
  });
}
