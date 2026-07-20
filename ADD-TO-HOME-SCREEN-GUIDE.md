# Add to Home Screen — What Changed & How to Test

## What this update adds
A proper installable-app experience ("Add to Home Screen") for the
storefront — separate from the favicon (browser tab icon), which your
site already had set up correctly.

**New files:**
- `images/icons/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`,
  `apple-touch-icon.png`, `favicon-32.png` — generated from your existing
  `images/favicon.svg` design (same navy background + gold "A"), so
  everything matches your current branding automatically.
- `api/manifest.js` — generates `manifest.webmanifest` **live** from your
  real store name (Settings → Account → Store Name) instead of a static
  file, so if you ever rename the store, the home-screen app name updates
  itself without a code edit.

**Modified:**
- `vercel.json` — added the `/manifest.webmanifest` clean-URL rewrite.
- Every real customer-facing page (`index.html`, `product.html`,
  `cart.html`, `checkout.html`, `category.html`, `about.html`,
  `terms.html`, `404.html`) — added the manifest link, apple-touch-icon,
  and theme-color meta tags to each page's `<head>`. `admin.html` was
  deliberately left alone (installing the admin panel as a home-screen
  app isn't something you'd want customers doing).
- `js/product-loader.js` — the "Add to Home Screen" app name on iOS now
  also updates automatically if you rename the store (same pattern
  already used for the page `<title>`).

## How to change the icon later
Just replace `images/favicon.svg` with your new logo (square, e.g.
512×512) and re-generate the PNG sizes the same way — or send me the new
logo and I'll regenerate all the sizes for you. You do NOT need to touch
`api/manifest.js` or any HTML file again; they all reference the same
icon files, so replacing the files is enough.

## How to test "Add to Home Screen"

**Android (Chrome):**
1. Open your live site in Chrome on an Android phone.
2. Tap the ⋮ menu (top-right) → **Add to Home Screen** (or Chrome may
   show its own "Install app" banner automatically after a couple of
   visits).
3. Confirm — an icon should appear on the home screen with your navy/gold
   "A" logo and the store name underneath.
4. Tapping it should open the site in a standalone window (no browser
   address bar) — this is what `"display": "standalone"` in the manifest
   controls.

**iPhone (Safari):**
1. Open your live site in **Safari** specifically (Add to Home Screen
   from Chrome on iOS doesn't use the web manifest the same way).
2. Tap the Share icon (square with an arrow) → **Add to Home Screen**.
3. Confirm — same navy/gold icon should appear.

**If the icon looks wrong or blank right after deploying:** phones cache
icons aggressively. Remove the shortcut, clear Safari/Chrome's cache, or
just wait — it resolves itself within a day or two even without any
action, once the cache naturally expires.

## Quick sanity checks after deploying
- Open `https://your-site.vercel.app/manifest.webmanifest` directly in a
  browser — you should see JSON with your real store name in it, not an
  error.
- Open `https://your-site.vercel.app/images/icons/icon-512.png` directly
  — you should see the icon image itself.
