// src/pages/InventoryLayout.jsx
//
// "Inventory" used to be two separate top-level nav destinations
// (Articles, View Photo Blocks) even though they're just two ways of
// looking at the same articles. This wraps both under one section
// with a tab switcher, so there's one less thing competing for a slot
// in the main navigation.
//
// The tabs only show on the two "top" screens (/inventory/list and
// /inventory/board). Once you drill into a specific photo
// (/inventory/board/:imageId) the back arrow in the top bar takes
// over — showing tabs there too would just be noise above a screen
// that's already one level deep.

import React from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

export default function InventoryLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const showTabs = location.pathname === '/inventory/list' || location.pathname === '/inventory/board';

  return (
    <div>
      {showTabs && (
        <div className="tab-row">
          <button
            className={`tab-btn ${location.pathname === '/inventory/list' ? 'active' : ''}`}
            onClick={() => navigate('/inventory/list')}
            type="button"
          >
            📋 All Articles
          </button>
          <button
            className={`tab-btn ${location.pathname === '/inventory/board' ? 'active' : ''}`}
            onClick={() => navigate('/inventory/board')}
            type="button"
          >
            🗂️ By Photo
          </button>
        </div>
      )}
      <Outlet />
    </div>
  );
}
