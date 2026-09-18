import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { callAccess, supabase } from '@/lib/supabase';
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

/**
 * ALTA Y BAJA DE PERSONAS
 *
 * Crear o borrar a alguien toca `auth.users`, y eso solo puede hacerse con la
 * service_role key, que jamas llega al navegador. Por eso ambas operaciones
 * pasan por la Edge Function `access`, que valida en el servidor que quien
 * llama tiene sesion y es administrador.
 */
export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; roleTitle: string; color: string; isAdmin: boolean }) =>
      callAccess<{ profile: Profile }>(
        {
          action: 'admin_create_user',
          name: input.name,
          roleTitle: input.roleTitle,
          color: input.color,
          isAdmin: input.isAdmin,
        },
        { authenticated: true },
      ).then((r) => r.profile),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
    },
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profileId: string) =>
      callAccess<{ ok: true }>(
        { action: 'admin_delete_user', profileId },
        { authenticated: true },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.profiles });
    },
  });
}

/** Desactivar es la via suave: conserva el historial y bloquea el acceso. */
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
