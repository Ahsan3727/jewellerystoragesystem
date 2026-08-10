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

## Project structure

```
jewelry-shop-web/
  index.html
  package.json
  vite.config.js
  src/
    main.jsx          # entry point, router setup
    App.jsx            # top bar + route definitions
    db.js               # IndexedDB layer (same function names as the old db.js)
    imageUtils.js        # file picking → data URL, canvas crop/export
    index.css             # all styling (dark/gold theme)
    pages/
      Home.jsx
      ProductTagger.jsx    # pick photo, tap to drop a tag, save
      ProductList.jsx       # search/edit/delete/export products
      ProductForm.jsx        # edit one product
      ArticleManager.jsx      # search/edit/delete articles + stats
      ArticleForm.jsx          # add/edit one article
```

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
