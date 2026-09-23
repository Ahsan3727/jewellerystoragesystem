// src/pages/Settings.jsx  (was Backup.jsx)
//
// Backup/restore was previously its own top-level nav destination —
// used rarely, but sat at the same level as Tag/Articles/Rate even
// though it's an occasional admin task, not daily workflow. It now
// lives under Settings, alongside a short "About this catalog" panel
// so a shop owner has one place to check where their data lives.

import React, { useEffect, useRef, useState } from 'react';
import {
  exportDatabase,
  importDatabase,
  getShopInfo,
  setShopInfo,
  getInventoryThresholds,
  setInventoryThresholds,
} from '../db';

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function readFileAsJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error('That file isn\u2019t valid JSON.'));
      }
    };
    reader.readAsText(file);
  });
}

export default function Settings() {
  const fileInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingFile, setPendingFile] = useState(null); // { backup, name }
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Shop Details (Phase 4) — name/address/phone/invoice-prefix, shown
  // on the printed bill header (see BillView.jsx). Loaded once on
  // mount; savingShop is separate from `busy` above since it guards a
  // different button and the two actions are unrelated (no reason a
  // slow export should also disable Save Shop Details, or vice versa).
  const [shopForm, setShopForm] = useState({ name: '', address: '', phone: '', invoice_prefix: '' });
  const [shopUpdatedAt, setShopUpdatedAt] = useState(null);
  const [savingShop, setSavingShop] = useState(false);

  // Inventory Nudges (Phase 5C) — low-stock-count / aging-days
  // thresholds that drive the Dashboard's nudge panel. Same
  // load-once-on-mount / independent-busy-flag pattern as Shop Details
  // above — a slow export shouldn't disable this Save button either.
  const [thresholdsForm, setThresholdsForm] = useState({ low_stock_count: '2', aging_days: '60' });
  const [thresholdsUpdatedAt, setThresholdsUpdatedAt] = useState(null);
  const [savingThresholds, setSavingThresholds] = useState(false);

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    getShopInfo().then((info) => {
      setShopForm({
        name: info.name,
        address: info.address,
        phone: info.phone,
        invoice_prefix: info.invoice_prefix,
      });
      setShopUpdatedAt(info.updated_at);
    });
  }, []);

  useEffect(() => {
    getInventoryThresholds().then((t) => {
      setThresholdsForm({ low_stock_count: String(t.low_stock_count), aging_days: String(t.aging_days) });
      setThresholdsUpdatedAt(t.updated_at);
    });
  }, []);

  const handleShopFieldChange = (field) => (e) => {
    setShopForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSaveShopDetails = async () => {
    setSavingShop(true);
    try {
      const row = await setShopInfo(shopForm);
      setShopUpdatedAt(row.updated_at);
      notify('Shop details saved — the next bill you print will use them.');
    } catch (e) {
      notify(e.message || 'Could not save shop details.');
    } finally {
      setSavingShop(false);
    }
  };

  const handleThresholdFieldChange = (field) => (e) => {
    setThresholdsForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSaveThresholds = async () => {
    setSavingThresholds(true);
    try {
      const row = await setInventoryThresholds(thresholdsForm);
      setThresholdsUpdatedAt(row.updated_at);
      notify('Inventory thresholds saved — the Dashboard nudges use them from the next load.');
    } catch (e) {
      notify(e.message || 'Could not save inventory thresholds.');
    } finally {
      setSavingThresholds(false);
    }
  };

  const handleExport = async () => {
    setBusy(true);
    try {
      const backup = await exportDatabase();
      const stamp = new Date().toISOString().slice(0, 10);
      downloadJson(backup, `jewelry-shop-backup-${stamp}.json`);
      notify(`Exported ${backup.counts.articles} article${backup.counts.articles === 1 ? '' : 's'}.`);
    } catch (e) {
      notify(e.message || 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChosen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file later
    if (!file) return;
    setBusy(true);
    try {
      const backup = await readFileAsJson(file);
      if (!backup?.data?.articles) {
        throw new Error('That file doesn\u2019t look like a jewelry shop backup.');
      }
      setPendingFile({ backup, name: file.name });
      setConfirmOpen(true);
    } catch (e2) {
      notify(e2.message || 'Could not read that backup file.');
    } finally {
      setBusy(false);
    }
  };

  const runImport = async (mode) => {
    if (!pendingFile) return;
    setBusy(true);
    setConfirmOpen(false);
    try {
      const result = await importDatabase(pendingFile.backup, { mode });
      notify(
        mode === 'replace'
          ? `Restored — ${result.articlesImported} article${result.articlesImported === 1 ? '' : 's'} loaded.`
          : `Merged in ${result.articlesImported} article${result.articlesImported === 1 ? '' : 's'}.`
      );
    } catch (e) {
      notify(e.message || 'Restore failed.');
    } finally {
      setBusy(false);
      setPendingFile(null);
    }
  };

  return (
    <div>
      <section className="panel" style={{ marginTop: 0 }}>
        <h2 className="panel-title">Shop Details</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14, textAlign: 'left' }}>
          Shown on every printed bill's header. Leave the invoice prefix
          blank to print plain bill numbers ("Bill #42"), or set one
          (e.g. "INV-") to print "INV-42" instead — on both the invoice
          and the Billing list.
        </p>

        <label className="field-label">Shop Name</label>
        <input
          className="field"
          type="text"
          placeholder="e.g. Al-Karam Jewellers"
          value={shopForm.name}
          onChange={handleShopFieldChange('name')}
          style={{ marginBottom: 12 }}
        />

        <label className="field-label">Address</label>
        <input
          className="field"
          type="text"
          placeholder="e.g. Shop 12, Sarafa Bazaar, Lahore"
          value={shopForm.address}
          onChange={handleShopFieldChange('address')}
          style={{ marginBottom: 12 }}
        />

        <label className="field-label">Phone</label>
        <input
          className="field"
          type="tel"
          placeholder="e.g. 0300-1234567"
          value={shopForm.phone}
          onChange={handleShopFieldChange('phone')}
          style={{ marginBottom: 12 }}
        />

        <label className="field-label">Invoice Prefix (optional)</label>
        <input
          className="field"
          type="text"
          placeholder="e.g. INV-"
          value={shopForm.invoice_prefix}
          onChange={handleShopFieldChange('invoice_prefix')}
          style={{ marginBottom: 14 }}
        />

        <button className="btn btn-gold btn-block" onClick={handleSaveShopDetails} disabled={savingShop} type="button">
          {savingShop ? 'Saving…' : 'Save Shop Details'}
        </button>

        {shopUpdatedAt && (
          <p className="hint" style={{ textAlign: 'left' }}>
            Last updated{' '}
            {new Date(shopUpdatedAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
      </section>

      <section className="panel" style={{ marginTop: 14 }}>
        <h2 className="panel-title">Inventory Nudges</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14, textAlign: 'left' }}>
          Powers the Dashboard's low-stock and aging-inventory nudges.
          These sensible defaults apply even if you never open this
          panel.
        </p>

        <label className="field-label">Low stock threshold (pieces)</label>
        <input
          className="field"
          type="number"
          inputMode="numeric"
          min="0"
          value={thresholdsForm.low_stock_count}
          onChange={handleThresholdFieldChange('low_stock_count')}
          style={{ marginBottom: 12 }}
        />

        <label className="field-label">Aging threshold (days)</label>
        <input
          className="field"
          type="number"
          inputMode="numeric"
          min="0"
          value={thresholdsForm.aging_days}
          onChange={handleThresholdFieldChange('aging_days')}
          style={{ marginBottom: 14 }}
        />

        <button
          className="btn btn-gold btn-block"
          onClick={handleSaveThresholds}
          disabled={savingThresholds}
          type="button"
        >
          {savingThresholds ? 'Saving…' : 'Save Inventory Nudges'}
        </button>

        {thresholdsUpdatedAt && (
          <p className="hint" style={{ textAlign: 'left' }}>
            Last updated{' '}
            {new Date(thresholdsUpdatedAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
      </section>

      <p className="hint" style={{ marginTop: 18, marginBottom: 18 }}>
        Everything in this app — every article, weight, description, and
        photo — lives only in this browser. Nothing is backed up
        anywhere else. If you clear browser data, switch phones, or the
        browser evicts old storage, the catalog is gone for good unless
        you've exported it here first.
      </p>

      <div className="nav-card" style={{ cursor: 'default' }}>
        <div className="nav-card-title">⬇️ Export Everything</div>
        <div className="nav-card-sub" style={{ marginBottom: 14 }}>
          Downloads one JSON file with every article and the gold rate.
          Keep it somewhere safe — email it to yourself, save it to
          Drive, whatever's easiest.
        </div>
        <button className="btn btn-gold btn-block" onClick={handleExport} disabled={busy}>
          Download Backup
        </button>
      </div>

      <div className="nav-card" style={{ cursor: 'default', marginTop: 14 }}>
        <div className="nav-card-title">⬆️ Restore From Backup</div>
        <div className="nav-card-sub" style={{ marginBottom: 14 }}>
          Load a backup file exported from this app — use this after
          getting a new phone, switching browsers, or if you just want
          today's catalog back.
        </div>
        <button className="btn btn-outline btn-block" onClick={handlePickFile} disabled={busy}>
          Choose Backup File
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChosen}
          style={{ display: 'none' }}
        />
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <h2 className="panel-title">About This Catalog</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 8, textAlign: 'left' }}>
          Data is stored in this browser's IndexedDB — per browser, per
          device. Nothing is sent to a server.
        </p>
        <p className="hint" style={{ marginTop: 0, textAlign: 'left' }}>
          Jewelry Shop · Inventory Manager · v3.0
        </p>
      </section>

      {toast && <div className="toast">{toast}</div>}

      {confirmOpen && pendingFile && (
        <div className="modal-overlay" onClick={() => setConfirmOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">Restore "{pendingFile.name}"?</div>
            <p className="hint" style={{ marginTop: 0 }}>
              This file has {pendingFile.backup?.data?.articles?.length ?? 0}{' '}
              article{(pendingFile.backup?.data?.articles?.length ?? 0) === 1 ? '' : 's'}. Choose how to bring it in:
            </p>
            <p className="hint" style={{ marginTop: 0 }}>
              <strong>Replace</strong> wipes the current catalog on this
              device and loads the backup instead.
              <br />
              <strong>Merge</strong> keeps what's already here and adds
              the backup's articles alongside it (you may end up with
              duplicates if they overlap).
            </p>
            <div className="modal-actions" style={{ flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-gold btn-block" onClick={() => runImport('replace')} disabled={busy}>
                Replace Current Catalog
              </button>
              <button className="btn btn-outline btn-block" onClick={() => runImport('merge')} disabled={busy}>
                Merge Into Current Catalog
              </button>
              <button
                className="btn btn-ghost btn-block"
                onClick={() => {
                  setConfirmOpen(false);
                  setPendingFile(null);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
