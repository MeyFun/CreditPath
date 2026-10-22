import { useQuery } from "@tanstack/react-query";
import {
  Bell,
  Building2,
  Calculator,
  ClipboardList,
  FileClock,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  ScrollText,
  Settings2,
  ShieldCheck,
  Users,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Logo } from "./ui";

const NAV = {
  client: [
    { to: "/app", label: "Главная", icon: LayoutDashboard, end: true },
    { to: "/app/applications", label: "Мои заявки", icon: ClipboardList, end: true },
    { to: "/app/applications/new", label: "Новая заявка", icon: Plus, end: true },
    { to: "/app/products", label: "Продукты", icon: FolderKanban },
    { to: "/app/company", label: "Профиль компании", icon: Building2 },
    { to: "/app/notifications", label: "Уведомления", icon: Bell }
  ],
  employee: [
    { to: "/staff", label: "Очередь заявок", icon: ClipboardList, end: true },
    { to: "/staff?scope=mine", label: "Мои заявки", icon: FileClock }
  ],
  admin: [
    { to: "/admin/users", label: "Пользователи и роли", icon: Users },
    { to: "/admin/applications", label: "Все заявки", icon: ClipboardList },
    { to: "/admin/audit", label: "Журнал аудита", icon: ScrollText },
    { to: "/admin/dictionaries", label: "Справочники", icon: Settings2 }
  ]
};

const ROLE_LABEL = {
  client: "Кабинет предпринимателя",
  employee: "Рабочее место сотрудника",
  admin: "Администрирование"
};

export function AppShell({ role }: { role: "client" | "employee" | "admin" }) {
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
        <Link className="icon-button badge-host" to={`/${role === "client" ? "app" : role === "employee" ? "staff" : "admin"}/notifications`} aria-label="Уведомления">
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
        <div className="role-chip">{ROLE_LABEL[role]}</div>
        <nav className="side-nav" aria-label="Основная навигация">
          {NAV[role].map((item) => {
            const Icon = item.icon;
            const active = isNavActive(item, location.pathname, location.search);
            return (
              <Link key={item.to} to={item.to} className={active ? "active" : ""}>
                <Icon size={19} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        {role === "client" && (
          <div className="sidebar-note">
            <Calculator size={18} />
            <div>
              <strong>Демо-режим</strong>
              <p>Все компании, реестры и решения — синтетические. Подписание и выдача имитируются.</p>
            </div>
          </div>
        )}
        {role === "admin" && (
          <div className="sidebar-note">
            <ShieldCheck size={18} />
            <div>
              <strong>Только администрирование</strong>
              <p>Кредитные решения принимают сотрудники банка. Журнал аудита неизменяем.</p>
            </div>
          </div>
        )}
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
            <span>{ROLE_LABEL[role]}</span>
            {user.company_inn && role === "client" && <span className="muted">ИНН {user.company_inn}</span>}
          </div>
          <div className="topbar-actions">
            <Link className="topbar-bell" to={role === "client" ? "/app/notifications" : role === "employee" ? "/staff/notifications" : "/admin/notifications"} aria-label="Центр уведомлений">
              <Bell size={19} />
              {(notifications.data?.unread ?? 0) > 0 && <span className="badge-count">{notifications.data?.unread}</span>}
            </Link>
            <span className="avatar avatar-small">{initials(user.full_name)}</span>
            <div className="topbar-user">
              <strong>{user.full_name}</strong>
              <small>{role === "client" ? "Клиент" : role === "employee" ? "Сотрудник банка" : "Администратор"}</small>
            </div>
            <button className="icon-button" onClick={handleLogout} title="Выйти" aria-label="Выйти">
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
        <footer className="app-footer">
          <span>CreditPath · демонстрационный прототип</span>
          <span>Данные синтетические. Подписание и зачисление имитируются.</span>
        </footer>
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
