import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV = [
  { to: '/dashboard', label: 'Дашборд' },
  { to: '/invoices', label: 'Накладные' },
  { to: '/suppliers', label: 'Поставщики' },
  { to: '/nomenclature', label: 'Номенклатура' },
  { to: '/vehicles', label: 'Автопарк' },
];

const ROLE_LABEL: Record<string, string> = { admin: 'Администратор', manager: 'Менеджер', viewer: 'Аудитор' };

export function Layout(): JSX.Element {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={`layout ${navOpen ? 'layout--nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Основная навигация">
        <div className="sidebar__brand">ФУРЫ ЗАПЧАСТИ</div>
        <nav className="sidebar__nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) => `navlink ${isActive ? 'navlink--active' : ''}`}
              onClick={() => setNavOpen(false)}
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {navOpen ? <div className="scrim" onClick={() => setNavOpen(false)} aria-hidden="true" /> : null}

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="topbar__burger"
            aria-label="Меню"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((v) => !v)}
          >
            ☰
          </button>
          <div className="topbar__spacer" />
          <div className="topbar__user">
            <div className="topbar__name">{user?.fullName ?? user?.username ?? 'Пользователь'}</div>
            <div className="topbar__role">{user ? (ROLE_LABEL[user.role] ?? user.role) : ''}</div>
          </div>
          <button type="button" className="btn btn--ghost" onClick={logout}>
            Выйти
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
