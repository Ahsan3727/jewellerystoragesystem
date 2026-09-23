# Jewelry Shop — Web App (React + Vite, deploys to Vercel)

This is a **web port** of the original Expo/React Native app. It's rebuilt
so it runs in a browser and can be deployed as a normal website — no phone,
no app store, no server, and no database to set up.

## What changed from the mobile version, and why

The mobile app stored everything in **SQLite**, a real database file that
lives on the phone. A browser can't open that kind of file, so this
version uses **IndexedDB** instead — the browser's own built-in database.
It's the closest web equivalent: no server, no signup, no config, and the
data survives closing the tab and reopening it later, exactly like the
SQLite file did on the phone.

| Original (Expo/React Native) | This version (web) |
|---|---|
| `expo-sqlite` (file on the phone) | `IndexedDB` (built into the browser) |
| `expo-image-picker` (native photo picker) | `<input type="file">` |
| `expo-image-manipulator` (native crop) | HTML `<canvas>` crop |
| React Navigation (native stack) | React Router (in-browser routes) |
| Runs in Expo Go on your phone | Runs at a URL, in any browser |

**One thing worth knowing:** because the data lives in the browser's
IndexedDB, it's stored **per browser, per device** — someone on their
laptop and someone on their phone will each have their own separate
catalog, and clearing site data/browser storage will erase it. This
mirrors exactly how the original app worked (each phone install had its
own independent SQLite file). If you ever want the same catalog to show
up for every visitor or every device, that needs a real backend database
(e.g. Vercel Postgres, Supabase) — the README in the original zip flagged
this same trade-off for the phone version.

## Project structure (v3 layout)

```
jewelry-shop-web/
  index.html
  package.json
  vite.config.js
  src/
    main.jsx                # entry point, router setup
    App.jsx                  # route definitions + page titles
    db.js                     # IndexedDB layer (articles, settings, photos, photo_history, customers, bills)
    imageUtils.js              # file picking → data URL, canvas crop/export
    priceUtils.js                # weight × gold rate → price/karat math, formatting
    billUtils.js                  # bills → daily/weekly/monthly revenue records (BillingHome.jsx)
    salesUtils.js                  # legacy: sold articles → revenue records (Dashboard.jsx's "Sold Today")
    index.css                       # all styling (dark/gold theme)
    components/
      AppShell.jsx                # persistent nav: sidebar (desktop) / bottom tab bar (mobile)
    pages/
      Dashboard.jsx                # rate ticker, stats, category breakdown, Billing snapshot, recent items
      ArticleTagger.jsx             # pick photo, tap to drop a tag, save   (/tag)
      InventoryLayout.jsx            # tab switcher wrapping the two inventory views
      ArticleList.jsx                 # searchable/filterable/sortable list + grid view (/inventory/list)
      ImageBoard.jsx                   # photo gallery + drag/resize block board (/inventory/board[/:id])
      ArticleForm.jsx                   # edit one article (/articles/:id)
      GoldRate.jsx                       # set today's rate (/rate)
      Calculator.jsx                      # standalone karat-purity quote tool, no DB writes (/calculator)
      BillNew.jsx                          # pick articles → price each line → customer → finalize (/billing/new)
      BillingHome.jsx                       # revenue KPIs + searchable bill list, replaces Sales.jsx (/billing)
      BillView.jsx                           # one bill's read-only itemized invoice + print + void (/billing/:id)
      CustomerDetail.jsx                      # one customer's purchase history (/customers/:id)
      Settings.jsx                             # shop details + backup/restore + about (/settings)
```

### What changed from v1

The original version put every destination — Tag, Articles, Photo Blocks,
Gold Rate, Backup — as a stack of buttons on the Home screen, so
navigation lived inside scrollable page content. v2 pulls navigation out
into a persistent shell (`AppShell.jsx`): a left sidebar on wide screens,
a bottom tab bar on phones, both driven by the same five-item list.

The old "Articles" list and "View Photo Blocks" gallery were two
separate top-level screens showing the same underlying data two ways.
They're now one **Inventory** section with a tab switcher
(`InventoryLayout.jsx`), and the list view gained category filter chips,
a sort control, and a grid view for browsing by photo. Backup/restore
moved under **Settings**, since it's an occasional admin task rather
than a daily one. Home became a real **Dashboard** with a per-category
weight breakdown and a "recently tagged" shortcut.

## Billing & Calculator (v3)

v3 brings the karat-purity pricing math from the standalone
`jewellery-calculator` app into this one, and builds a real Billing
feature on top of it — replacing the old single-tap "Mark as Sold"
aggregation with itemized, auditable bills.

- **Calculator** (`/calculator`) — a pure quote tool: weight, karat,
  making charge, and wastage % in, a live total out. No DB writes.
- **Billing** (`/billing`) — pick `in_stock` articles, price each line
  (karat/making/wastage chosen per line, never stored on the article
  itself), attach a customer by phone lookup, and finalize. Every
  number on a finalized bill is a frozen snapshot — exactly like an
  article's own `sold_price`, it never recomputes later even if the
  gold rate moves or the article is edited afterward. `createBill()`
  and `voidBill()` in `db.js` are each a single atomic transaction
  across `bills` + `articles` (+ `customers`), so a bill can never be
  half-created.
- **Customers** — one row per phone number, autofilled at billing time
  for repeat visits. Tap a customer's name on any invoice to see their
  full purchase history (`/customers/:id`).
- **Shop Details** (`/settings`) — shop name/address/phone and an
  optional invoice prefix (e.g. `INV-`), used on every printed bill's
  header and bill number, everywhere a bill number is shown.
- **Printing** — the browser's native `window.print()` against a
  dedicated `@media print` stylesheet. No PDF library — this project
  stays at zero dependencies beyond React + `react-router-dom`.

Bills are **voided, never deleted** (`voidBill()` restocks every
article on the bill and flips its status to `'voided'`) — the audit
trail matters more than a clean list, and a voided bill still shows up
in the Billing list and on a customer's history, just excluded from
every revenue total.

## Run it locally first (recommended)

You need [Node.js](https://nodejs.org) installed (any recent LTS version).

```bash
npm install
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). Try tagging a
product and adding an article — reload the page and confirm your data is
still there. That's IndexedDB working correctly.

## Put it on GitHub

```bash
git init
git add .
git commit -m "Jewelry shop web app"
```

Then on [github.com](https://github.com), click **New repository**, leave
it empty (no README/license — you already have files), name it something
like `jewelry-shop-web`, and create it. GitHub will show you two commands
to run — they'll look like this:

```bash
git remote add origin https://github.com/YOUR-USERNAME/jewelry-shop-web.git
git branch -M main
git push -u origin main
```

## Deploy on Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (you can sign in
   directly with your GitHub account — that's the easiest option).
2. Click **Add New → Project**.
3. Pick the `jewelry-shop-web` repo you just pushed. Click **Import**.
4. Vercel auto-detects this as a **Vite** project — the build command
   (`vite build`) and output folder (`dist`) are filled in automatically.
   You don't need to change anything.
5. Click **Deploy**. It takes about a minute.
6. You'll get a live URL like `jewelry-shop-web.vercel.app` — that's it,
   it's live.

From now on, every time you `git push` to the `main` branch, Vercel
automatically rebuilds and redeploys the site.

## Things worth knowing about the port

- **Export button**: since there's no app-private storage on the web, the
  "Export" button on the product list both saves the cropped tag image
  into IndexedDB *and* downloads it as a `.jpg` file, so you actually get
  a file out of it.
- **Crop accuracy**: the original mobile version used placeholder pixel
  math for cropping (its own README flagged this as a known bug to fix).
  This version reads the real photo dimensions before cropping, so
  exports line up correctly with where you tapped.
- **Routing**: uses `HashRouter` (URLs look like `/#/products`) so it
  works correctly on Vercel with zero extra configuration.
