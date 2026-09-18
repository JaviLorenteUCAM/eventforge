import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ScheduleActivity, ScheduleDay } from '@/lib/types';
import { ApiError, deleteRow, insertRow, insertRows, selectAll, updateRow } from './api';
import { qk } from './keys';

export interface ActivityMemberRow {
  activity_id: string;
  profile_id: string;
}

export function useScheduleDays(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.scheduleDays(eventId ?? 'none'),
    enabled: Boolean(eventId),
    queryFn: () =>
      selectAll<ScheduleDay>('schedule_days', (q) =>
        q.eq('event_id', eventId!).order('day_index', { ascending: true }),
      ),
  });
}

export function useScheduleActivities(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.scheduleActivities(eventId ?? 'none'),
    enabled: Boolean(eventId),
    queryFn: () =>
      selectAll<ScheduleActivity>('schedule_activities', (q) =>
        q.eq('event_id', eventId!).order('starts_at', { ascending: true }),
      ),
  });
}

export function useActivityMembers(eventId: string | undefined) {
  return useQuery({
    queryKey: qk.activityMembers(eventId ?? 'none'),
    enabled: Boolean(eventId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schedule_activity_members')
        .select('activity_id, profile_id, schedule_activities!inner(event_id)')
        .eq('schedule_activities.event_id', eventId!);
      if (error) throw new ApiError(error);
      return (data ?? []).map((r) => ({
        activity_id: (r as ActivityMemberRow).activity_id,
        profile_id: (r as ActivityMemberRow).profile_id,
      }));
    },
  });
}

/** Ajusta el numero de dias del evento creando o eliminando los que sobran. */
export function useSetDayCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { eventId: string; count: number; startDate?: string | null }) => {
      const current = await selectAll<ScheduleDay>('schedule_days', (q) =>
        q.eq('event_id', input.eventId).order('day_index', { ascending: true }),
      );

      if (input.count > current.length) {
        const rows = [];
        for (let i = current.length + 1; i <= input.count; i++) {
          const date = input.startDate
            ? new Date(new Date(input.startDate).getTime() + (i - 1) * 86_400_000)
                .toISOString()
                .slice(0, 10)
            : null;
          rows.push({ event_id: input.eventId, day_index: i, date, label: `Día ${i}` });
        }
        await insertRows('schedule_days', rows);
      } else if (input.count < current.length) {
        const remove = current.slice(input.count).map((d) => d.id);
        const { error } = await supabase.from('schedule_days').delete().in('id', remove);
        if (error) throw new ApiError(error);
      }
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.scheduleDays(vars.eventId) });
      void qc.invalidateQueries({ queryKey: qk.scheduleActivities(vars.eventId) });
    },
  });
}

export function useUpdateDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; eventId: string; patch: Partial<ScheduleDay> }) =>
      updateRow<ScheduleDay>('schedule_days', input.id, input.patch),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.scheduleDays(vars.eventId) });
    },
  });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { values: Partial<ScheduleActivity>; memberIds?: string[] }) => {
      const activity = await insertRow<ScheduleActivity>('schedule_activities', input.values);
      if (input.memberIds?.length) {
        await insertRows(
          'schedule_activity_members',
          input.memberIds.map((profile_id) => ({ activity_id: activity.id, profile_id })),
        );
      }
      return activity;
    },
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: qk.scheduleActivities(a.event_id) });
      void qc.invalidateQueries({ queryKey: qk.activityMembers(a.event_id) });
    },
  });
}

export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Partial<ScheduleActivity>;
      memberIds?: string[];
    }) => {
      const activity = await updateRow<ScheduleActivity>('schedule_activities', input.id, input.patch);
      if (input.memberIds) {
        const { error } = await supabase
          .from('schedule_activity_members')
          .delete()
          .eq('activity_id', input.id);
        if (error) throw new ApiError(error);
        if (input.memberIds.length) {
          await insertRows(
            'schedule_activity_members',
            input.memberIds.map((profile_id) => ({ activity_id: input.id, profile_id })),
          );
        }
      }
      return activity;
    },
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: qk.scheduleActivities(a.event_id) });
      void qc.invalidateQueries({ queryKey: qk.activityMembers(a.event_id) });
    },
  });
}

export function useDeleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; eventId: string }) =>
      deleteRow('schedule_activities', input.id),
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: qk.scheduleActivities(vars.eventId) });
      void qc.invalidateQueries({ queryKey: qk.activityMembers(vars.eventId) });
    },
  });
}

/** Duplica una actividad (opcionalmente a otro día). El resultado es independiente. */
export function useDuplicateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      activity: ScheduleActivity;
      targetDayId: string;
      memberIds: string[];
    }) => {
      const { id: _id, created_at: _c, updated_at: _u, ...rest } = input.activity;
      const copy = await insertRow<ScheduleActivity>('schedule_activities', {
        ...rest,
        day_id: input.targetDayId,
      });
      if (input.memberIds.length) {
        await insertRows(
          'schedule_activity_members',
          input.memberIds.map((profile_id) => ({ activity_id: copy.id, profile_id })),
        );
      }
      return copy;
    },
    onSuccess: (a) => {
      void qc.invalidateQueries({ queryKey: qk.scheduleActivities(a.event_id) });
      void qc.invalidateQueries({ queryKey: qk.activityMembers(a.event_id) });
    },
  });
}
