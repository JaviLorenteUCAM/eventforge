import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { GateScreen } from '@/auth/GateScreen';
import { SetupScreen } from '@/auth/SetupScreen';
import { AppShell } from '@/components/layout/AppShell';
import { LoadingState } from '@/components/ui';
import { isConfigured } from '@/lib/env';
import { useUi } from '@/store/ui';

import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { EventsPage } from '@/features/events/EventsPage';
import { EventLayout } from '@/features/events/EventLayout';
import { EventOverviewPage } from '@/features/events/EventOverviewPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { WarehousePage } from '@/features/warehouse/WarehousePage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { SchedulePage } from '@/features/schedule/SchedulePage';
import { MaterialPage } from '@/features/material/MaterialPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { SettingsPage } from '@/features/profile/SettingsPage';

// Los editores 2D/3D cargan three.js: los separamos del bundle principal.
const PlanPage = lazy(() =>
  import('@/features/plan/PlanPage').then((m) => ({ default: m.PlanPage })),
);

export default function App() {
  const { booting, session } = useAuth();
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!isConfigured) return <SetupScreen />;

  if (booting) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <LoadingState label="Conectando con el servidor…" />
      </div>
    );
  }

  if (!session) return <GateScreen />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="calendario" element={<CalendarPage />} />
        <Route path="eventos" element={<EventsPage />} />
        <Route path="eventos/:eventId" element={<EventLayout />}>
          <Route index element={<EventOverviewPage />} />
          <Route
            path="plano"
            element={
              <Suspense fallback={<LoadingState label="Cargando editor de planos…" />}>
                <PlanPage />
              </Suspense>
            }
          />
          <Route path="horarios" element={<SchedulePage />} />
          <Route path="material" element={<MaterialPage />} />
          <Route path="tareas" element={<TasksPage />} />
        </Route>
        <Route path="almacen" element={<WarehousePage />} />
        <Route path="perfil" element={<ProfilePage />} />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
