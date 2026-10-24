import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  ClipboardList,
  FileClock,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ScrollText,
  Settings2,
  Users,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { SiteFooter } from "./Footer";
import { useAuth } from "../auth";
import { Logo, prefersReducedMotion } from "./ui";
import type { Role } from "../types";

type Area = "client" | "employee" | "admin";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

const CLIENT_NAV: NavItem[] = [
  { to: "/app", label: "Главная", icon: LayoutDashboard, end: true },
  { to: "/app/applications", label: "Мои заявки", icon: ClipboardList, end: true },
  { to: "/app/applications/new", label: "Новая заявка", icon: Plus, end: true },
  { to: "/app/products", label: "Продукты", icon: FolderKanban },
  { to: "/app/company", label: "Профиль компании", icon: Building2 },
  { to: "/app/notifications", label: "Уведомления", icon: Bell }
];

const STAFF_NAV: NavItem[] = [
  { to: "/staff", label: "Очередь заявок", icon: ClipboardList, end: true },
  { to: "/staff?scope=mine", label: "Назначенные заявки", icon: FileClock }
];

const ADMIN_NAV: NavItem[] = [
  { to: "/admin/users", label: "Пользователи и роли", icon: Users },
  { to: "/admin/applications", label: "Все заявки", icon: ClipboardList },
  { to: "/admin/audit", label: "Журнал аудита", icon: ScrollText },
  { to: "/admin/dictionaries", label: "Справочники", icon: Settings2 }
];

const AREA_LABEL: Record<Area, string> = {
  client: "Кабинет предпринимателя",
  employee: "Рабочее место сотрудника",
  admin: "Администрирование"
};

const ROLE_LABEL: Record<Role, string> = {
  client: "Клиент",
  employee: "Сотрудник банка",
  admin: "Администратор"
};

// Рабочие и клиентские учётки разделены: у каждой роли только своё меню.
const NAV_BY_AREA: Record<Area, NavItem[]> = {
  client: CLIENT_NAV,
  employee: STAFF_NAV,
  admin: ADMIN_NAV
};

export function AppShell({ role }: { role: Area }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ["notifications", "badge"],
    queryFn: api.notifications.list,
    refetchInterval: 30000
  });

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  if (!user) return null;

  const groups: NavGroup[] = [{ items: NAV_BY_AREA[role] }];
  const notificationPath = role === "client" ? "/app/notifications" : role === "employee" ? "/staff/notifications" : "/admin/notifications";

  // Плавная смена страницы через View Transitions API; без поддержки — обычный переход ссылки.
  function softNavigate(event: MouseEvent<HTMLAnchorElement>, to: string) {
    if (!document.startViewTransition || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    if (prefersReducedMotion()) return;
    event.preventDefault();
    document.startViewTransition(() => flushSync(() => navigate(to)));
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="app-shell">
      <header className="mobile-header">
        <button className="icon-button" onClick={() => setOpen(true)} aria-label="Открыть меню">
          <Menu size={22} />
        </button>
        <Logo compact />
        <Link className="icon-button badge-host" to={notificationPath} aria-label="Уведомления">
          <Bell size={20} />
          {(notifications.data?.unread ?? 0) > 0 && <span className="badge-count">{notifications.data?.unread}</span>}
        </Link>
      </header>

      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="sidebar-head">
          <Link to={role === "client" ? "/app" : role === "employee" ? "/staff" : "/admin/users"}>
            <Logo />
          </Link>
          <button className="icon-button sidebar-close" onClick={() => setOpen(false)} aria-label="Закрыть меню">
            <X size={20} />
          </button>
        </div>
        <div className="role-chip">{AREA_LABEL[role]}</div>
        <nav className="side-nav" aria-label="Основная навигация">
          {groups.map((group, groupIndex) => (
            <div className="side-nav-group" key={group.title ?? `group-${groupIndex}`}>
              {group.title && <span className="side-nav-label">{group.title}</span>}
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item, location.pathname, location.search);
                return (
                  <Link key={`${groupIndex}-${item.to}`} to={item.to} className={active ? "active" : ""} onClick={(event) => softNavigate(event, item.to)}>
                    <Icon size={19} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="avatar">{initials(user.full_name)}</span>
          <div>
            <strong>{user.full_name}</strong>
            <small>@{user.username}</small>
          </div>
          <button className="icon-button" onClick={handleLogout} title="Выйти" aria-label="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      {open && <button className="sidebar-scrim" onClick={() => setOpen(false)} aria-label="Закрыть меню" />}

      <div className="app-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>{AREA_LABEL[role]}</span>
            {user.company_inn && <span className="muted">ИНН {user.company_inn}</span>}
          </div>
          <div className="topbar-actions">
            <Link className="topbar-bell" to={notificationPath} aria-label="Центр уведомлений">
              <Bell size={19} />
              {(notifications.data?.unread ?? 0) > 0 && <span className="badge-count">{notifications.data?.unread}</span>}
            </Link>
            <span className="avatar avatar-small">{initials(user.full_name)}</span>
            <div className="topbar-user">
              <strong>{user.full_name}</strong>
              <small>{ROLE_LABEL[user.role]}</small>
            </div>
            <button className="icon-button" onClick={handleLogout} title="Выйти" aria-label="Выйти">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
        <SiteFooter compact />
      </div>
    </div>
  );
}

function isNavActive(
  item: { to: string; end?: boolean },
  pathname: string,
  search: string
): boolean {
  const [path, query] = item.to.split("?");
  if (query?.includes("scope=mine")) {
    return pathname === path && new URLSearchParams(search).get("scope") === "mine";
  }
  if (path === "/staff") {
    return pathname === path && new URLSearchParams(search).get("scope") !== "mine";
  }
  if (item.end) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
