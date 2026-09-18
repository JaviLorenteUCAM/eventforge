import { useEffect, useState } from 'react';
import { Outlet, useLocation, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, Menu, Moon, Sun, Wifi, WifiOff, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { Avatar, Button, IconButton } from '@/components/ui';
import { useUi } from '@/store/ui';
import { Sidebar } from './Sidebar';

export function AppShell() {
  const { profile, signOut } = useAuth();
  const theme = useUi((s) => s.theme);
  const toggleTheme = useUi((s) => s.toggleTheme);
  const setLastEvent = useUi((s) => s.setLastEvent);
  const params = useParams();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    if (params.eventId) setLastEvent(params.eventId);
  }, [params.eventId, setLastEvent]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* Menu fijo en escritorio */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Menu deslizante en movil */}
      <AnimatePresence>
        {drawerOpen ? (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 lg:hidden"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
              className="fixed inset-y-0 left-0 z-50 lg:hidden"
            >
              <Sidebar onNavigate={() => setDrawerOpen(false)} />
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-[color-mix(in_oklab,var(--ef-canvas)_78%,transparent)] px-4 backdrop-blur-xl sm:px-6">
          <IconButton
            label={drawerOpen ? 'Cerrar menú' : 'Abrir menú'}
            className="lg:hidden"
            onClick={() => setDrawerOpen((v) => !v)}
            icon={drawerOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          />

          <div className="min-w-0 flex-1" />

          <span
            className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted sm:inline-flex"
            title={online ? 'Conectado al servidor' : 'Sin conexión'}
          >
            {online ? (
              <Wifi className="size-3.5 text-ok" />
            ) : (
              <WifiOff className="size-3.5 text-danger" />
            )}
            {online ? 'En línea' : 'Sin conexión'}
          </span>

          <IconButton
            label={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            onClick={toggleTheme}
            icon={theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          />

          {profile ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2 py-1.5">
              <Avatar
                name={profile.name}
                avatarUrl={profile.avatar_url}
                color={profile.color}
                size="sm"
              />
              <div className="hidden min-w-0 sm:block">
                <p className="truncate text-[12.5px] font-medium leading-tight text-ink">
                  {profile.name}
                </p>
                <p className="truncate text-[11px] leading-tight text-dim">{profile.role_title}</p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Cerrar sesión"
                title="Cerrar sesión"
                onClick={() => void signOut()}
                icon={<LogOut className="size-4" />}
              />
            </div>
          ) : null}
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
