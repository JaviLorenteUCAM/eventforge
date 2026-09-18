import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'dark' | 'light';

interface UiState {
  theme: Theme;
  sidebarCollapsed: boolean;
  /** Ultimo evento abierto, para el bloque "EVENTO ACTUAL" del menu. */
  lastEventId: string | null;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;
  setLastEvent: (id: string | null) => void;
}

/**
 * Estado de INTERFAZ (no de negocio). Se puede guardar en el navegador sin
 * problema: son preferencias locales del dispositivo, no datos compartidos.
 */
export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      lastEventId: null,
      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme;
        set({ theme });
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setLastEvent: (lastEventId) => set({ lastEventId }),
    }),
    {
      name: 'eventforge.ui',
      onRehydrateStorage: () => (state) => {
        if (state) document.documentElement.dataset.theme = state.theme;
      },
    },
  ),
);
