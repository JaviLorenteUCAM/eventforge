import { NavLink, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Boxes,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Layers3,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UserCircle2,
  CalendarRange,
} from 'lucide-react';
import { useEvent } from '@/data/events';
import { useUi } from '@/store/ui';
import { EVENT_STATUS_COLOR, EVENT_STATUS_LABEL } from '@/lib/types';
import { cn } from '@/lib/utils';
import { env } from '@/lib/env';
import { Badge, IconButton } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  end?: boolean;
}

const MAIN: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: <LayoutDashboard className="size-[18px]" />, end: true },
  { to: '/calendario', label: 'Calendario', icon: <CalendarDays className="size-[18px]" /> },
  { to: '/eventos', label: 'Eventos', icon: <CalendarRange className="size-[18px]" /> },
  { to: '/almacen', label: 'Almacén', icon: <Boxes className="size-[18px]" /> },
];

const BOTTOM: NavItem[] = [
  { to: '/perfil', label: 'Perfil', icon: <UserCircle2 className="size-[18px]" /> },
  { to: '/configuracion', label: 'Configuración', icon: <Settings className="size-[18px]" /> },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  // Selectores atomicos: con zustand v5 devolver un objeto nuevo en cada render
  // provocaria re-renders infinitos.
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const params = useParams();
  const lastEventId = useUi((s) => s.lastEventId);
  const eventId = params.eventId ?? lastEventId ?? undefined;
  const { data: event } = useEvent(eventId);

  const eventNav: NavItem[] = eventId
    ? [
        { to: `/eventos/${eventId}`, label: 'Resumen', icon: <ClipboardList className="size-[18px]" />, end: true },
        { to: `/eventos/${eventId}/plano`, label: 'Plano', icon: <Layers3 className="size-[18px]" /> },
        { to: `/eventos/${eventId}/horarios`, label: 'Horarios', icon: <CalendarDays className="size-[18px]" /> },
        { to: `/eventos/${eventId}/material`, label: 'Material', icon: <Boxes className="size-[18px]" /> },
        { to: `/eventos/${eventId}/tareas`, label: 'Tareas', icon: <ListChecks className="size-[18px]" /> },
      ]
    : [];

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-line bg-[color-mix(in_oklab,var(--ef-canvas)_82%,transparent)] backdrop-blur-xl transition-[width] duration-200',
        collapsed ? 'w-[74px]' : 'w-[248px]',
      )}
    >
      {/* Marca */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-[var(--ef-cyan)] text-[13px] font-black text-white">
          EF
        </div>
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold tracking-tight text-ink">{env.appName}</p>
            <p className="truncate text-[11px] text-dim">Producción de eventos</p>
          </div>
        ) : null}
        <IconButton
          label={collapsed ? 'Expandir menú' : 'Contraer menú'}
          onClick={toggleSidebar}
          className="hidden lg:inline-flex"
          icon={collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        />
      </div>

      <nav className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
        <NavGroup items={MAIN} collapsed={collapsed} onNavigate={onNavigate} />

        {eventId && event ? (
          <>
            <div className="my-4 border-t border-line" />
            {!collapsed ? (
              <div className="mb-2 px-2">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-dim">
                  Evento actual
                </p>
                <p className="mt-1 truncate text-[13px] font-medium text-ink" title={event.name}>
                  {event.name}
                </p>
                <Badge className="mt-1.5" color={EVENT_STATUS_COLOR[event.status]} dot>
                  {EVENT_STATUS_LABEL[event.status]}
                </Badge>
              </div>
            ) : (
              <div
                className="mx-auto mb-2 size-2 rounded-full"
                style={{ background: EVENT_STATUS_COLOR[event.status] }}
                title={event.name}
              />
            )}
            <NavGroup items={eventNav} collapsed={collapsed} onNavigate={onNavigate} />
          </>
        ) : null}
      </nav>

      <div className="border-t border-line px-3 py-3">
        <NavGroup items={BOTTOM} collapsed={collapsed} onNavigate={onNavigate} />
      </div>
    </aside>
  );
}

function NavGroup({
  items,
  collapsed,
  onNavigate,
}: {
  items: NavItem[];
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.end}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors',
                collapsed && 'justify-center px-0',
                isActive ? 'text-ink' : 'text-muted hover:bg-surface-2 hover:text-ink',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? (
                  <motion.span
                    layoutId="nav-active"
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    className="absolute inset-0 rounded-xl border border-line-strong bg-surface-2"
                  />
                ) : null}
                <span className={cn('relative', isActive && 'text-accent-soft')}>{item.icon}</span>
                {!collapsed ? <span className="relative truncate">{item.label}</span> : null}
              </>
            )}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
