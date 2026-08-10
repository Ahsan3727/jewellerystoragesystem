import React, { useEffect, useState } from 'react';
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { initDatabase } from './db';

import Home from './pages/Home';
import ArticleTagger from './pages/ArticleTagger';
import ArticleList from './pages/ArticleList';
import ArticleForm from './pages/ArticleForm';
import GoldRate from './pages/GoldRate';
import ImageBoard from './pages/ImageBoard';
import Backup from './pages/Backup';

const TITLES = {
  '/': 'Jewelry Shop',
  '/tag': 'Tag New Article',
  '/articles': 'Articles',
  '/rate': 'Gold Rate',
  '/view': 'Photos',
  '/backup': 'Backup & Restore',
};

function titleFor(pathname) {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith('/articles/')) return 'Edit Article';
  if (pathname.startsWith('/view/')) return 'Manage Blocks';
  return 'Jewelry Shop';
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    initDatabase()
      .then(() => setReady(true))
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="app-shell">
        <main>
          <p style={{ color: '#e0645a', textAlign: 'center', marginTop: 60 }}>
            Database failed to start: {error}
          </p>
        </main>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="app-shell">
        <main>
          <p style={{ color: '#d4af37', textAlign: 'center', marginTop: 60 }}>
            Setting up local database…
          </p>
        </main>
      </div>
    );
  }

  const isHome = location.pathname === '/';

  return (
    <div className="app-shell">
      <header className="topbar">
        {!isHome && (
          <button className="back" onClick={() => navigate(-1)} aria-label="Go back">
            ←
          </button>
        )}
        <div>
          <span className="eyebrow">Jewelry Shop</span>
          <h1>{titleFor(location.pathname)}</h1>
        </div>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tag" element={<ArticleTagger />} />
          <Route path="/articles" element={<ArticleList />} />
          <Route path="/articles/:id" element={<ArticleForm />} />
          <Route path="/rate" element={<GoldRate />} />
          <Route path="/view" element={<ImageBoard />} />
          <Route path="/view/:imageId" element={<ImageBoard />} />
          <Route path="/backup" element={<Backup />} />
        </Routes>
      </main>
    </div>
  );
}
