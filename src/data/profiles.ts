import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { ApiError, selectAll, updateRow } from './api';
import { qk } from './keys';

export function useProfiles() {
  return useQuery({
    queryKey: qk.profiles,
    queryFn: () =>
      selectAll<Profile>('profiles', (q) =>
        q.order('sort_order', { ascending: true }).order('name', { ascending: true }),
      ),
    staleTime: 5 * 60 * 1000,
  });
}

/** Mapa id -> perfil, util para pintar responsables. */
export function useProfileMap() {
  const { data } = useProfiles();
  const map = new Map<string, Profile>();
  (data ?? []).forEach((p) => map.set(p.id, p));
  return map;
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; patch: Partial<Profile> }) =>
      updateRow<Profile>('profiles', input.id, input.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
    },
  });
}

/** Cambia la contraseña/estado no: solo desactiva (el alta se hace con seed/admin). */
export function useSetProfileActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; active: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: input.active })
        .eq('id', input.id);
      if (error) throw new ApiError(error);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
    },
  });
}
