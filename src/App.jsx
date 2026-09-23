import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { initDatabase } from './db';
import AppShell from './components/AppShell';

import Dashboard from './pages/Dashboard';
import ArticleTagger from './pages/ArticleTagger';
import InventoryLayout from './pages/InventoryLayout';
import ArticleList from './pages/ArticleList';
import ImageBoard from './pages/ImageBoard';
import ArticleForm from './pages/ArticleForm';
import GoldRate from './pages/GoldRate';
import Calculator from './pages/Calculator';
import BillNew from './pages/BillNew';
import BillingHome from './pages/BillingHome';
import BillView from './pages/BillView';
import CustomerDetail from './pages/CustomerDetail';
import Settings from './pages/Settings';

// Every "top level" screen — reachable directly from the sidebar/bottom
// nav — gets a fixed title and no back button. Anything not listed here
// is a screen you drilled into (edit one article, manage one photo's
// blocks), so it gets a back arrow instead.
const TITLES = {
  '/': 'Dashboard',
  '/tag': 'Tag New Article',
  '/inventory/list': 'Inventory',
  '/inventory/board': 'Inventory · By Photo',
  '/rate': 'Gold Rate',
  '/calculator': 'Calculator',
  '/billing': 'Billing',
  '/settings': 'Settings',
};

function titleFor(pathname) {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/articles/')) return 'Edit Article';
  if (pathname.startsWith('/inventory/board/')) return 'Manage Blocks';
  if (pathname === '/billing/new') return 'New Bill';
  // Any other /billing/:id is a single bill's read-only invoice — same
  // "generic title for a drill-down screen" pattern as "Manage Blocks"
  // above, rather than pulling the specific bill number in here.
  if (pathname.startsWith('/billing/')) return 'Invoice';
  // /customers/:id — reached by tapping a customer's name on a bill's
  // "Billed To" section (Phase 4). Same generic-title convention.
  if (pathname.startsWith('/customers/')) return 'Customer';
  return 'Jewelry Shop';
}

function isTopLevel(pathname) {
  return Object.prototype.hasOwnProperty.call(TITLES, pathname);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const location = useLocation();

  useEffect(() => {
    initDatabase()
      .then(() => setReady(true))
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="boot-screen">
        <p className="boot-text boot-error">Database failed to start: {error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="boot-screen">
        <p className="boot-text">Setting up local database…</p>
      </div>
    );
  }

  return (
    <AppShell title={titleFor(location.pathname)} showBack={!isTopLevel(location.pathname)}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/tag" element={<ArticleTagger />} />

        <Route path="/inventory" element={<InventoryLayout />}>
          <Route index element={<Navigate to="list" replace />} />
          <Route path="list" element={<ArticleList />} />
          <Route path="board" element={<ImageBoard />} />
          <Route path="board/:imageId" element={<ImageBoard />} />
        </Route>

        <Route path="/articles/:id" element={<ArticleForm />} />
        <Route path="/rate" element={<GoldRate />} />
        <Route path="/calculator" element={<Calculator />} />
        <Route path="/billing" element={<BillingHome />} />
        <Route path="/billing/new" element={<BillNew />} />
        <Route path="/billing/:id" element={<BillView />} />
        <Route path="/customers/:id" element={<CustomerDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </AppShell>
  );
}
