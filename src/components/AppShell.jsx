// src/components/AppShell.jsx
//
// The persistent navigation frame for the whole app. Five top-level
// destinations live here (Dashboard, Tag New, Inventory, Gold Rate,
// Settings) instead of the old "stack of buttons on Home" pattern —
// they're always one tap away no matter what screen you're on.
//
// Rendered twice on purpose: as a left sidebar on wide screens and as
// a bottom tab bar on narrow ones. Which one shows is pure CSS
// (media query), so there's no layout flicker or JS breakpoint logic.

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '🏠', match: (p) => p === '/' },
  { to: '/tag', label: 'Tag New', icon: '💎', match: (p) => p === '/tag' },
  {
    to: '/inventory/list',
    label: 'Inventory',
    icon: '📦',
    match: (p) => p.startsWith('/inventory') || p.startsWith('/articles/'),
  },
  { to: '/rate', label: 'Gold Rate', icon: '💰', match: (p) => p === '/rate' },
  { to: '/settings', label: 'Settings', icon: '⚙️', match: (p) => p === '/settings' },
];

export default function AppShell({ title, showBack, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  return (
    <div className="app-shell-v2">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark">💎</span>
          <div>
            <div className="sidebar-brand-name">Jewelry Shop</div>
            <div className="sidebar-brand-sub">Inventory Manager</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.to}
              className={`sidebar-link ${item.match(path) ? 'active' : ''}`}
              onClick={() => navigate(item.to)}
              type="button"
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="topbar-v2">
          {showBack && (
            <button className="back" onClick={() => navigate(-1)} aria-label="Go back" type="button">
              ←
            </button>
          )}
          <div>
            <span className="eyebrow">Jewelry Shop</span>
            <h1>{title}</h1>
          </div>
        </header>
        <main className="shell-content">{children}</main>
      </div>

      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.to}
            className={`bottom-nav-link ${item.match(path) ? 'active' : ''}`}
            onClick={() => navigate(item.to)}
            type="button"
          >
            <span className="bottom-nav-icon">{item.icon}</span>
            <span className="bottom-nav-label">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
