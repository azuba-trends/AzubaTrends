# AzubaTrends — Update Changelog

## 2026-07-25 (2) — Rich-text product descriptions, product page reorder, Auto Fetch on the form, global loading overlay

**1. Short/Long Description are now real rich-text editors.**
Were plain `<textarea>`s (the "drag the corner to resize" complaint). Both
now use the same Visual/Code editor pattern as Blog/Pages — built as a
new reusable `createRTE()` factory in `js/admin.js` rather than a third
hand-copy of the blog editor's wiring. Short Description gets a compact
toolbar (bold/italic/underline/strike, lists, align, link); Long
Description gets the full toolbar including headings, text size, and
image insert. Auto-grows with content instead of a fixed box size.
Rendered on the product page as real HTML now (previously forced through
`textContent`, which would have shown literal `<b>` tags instead of bold
text).

**2. Product page reordered.**
Add to Cart / Buy Now now sit above Short Description (were below it).
Long Description moved OUT of the right column entirely — it's now its
own full-width section, positioned above Reviews, with a "Show more /
Show less" toggle that only appears if the content actually overflows
the collapsed height. Reviews now sit in the narrower column where
Description used to be.

**3. Buttons had no color.**
Both Add to Cart and Buy Now were `.btn-outline` (transparent, no fill) —
that's the "buttons look bad" issue. Buy Now is now `.btn-primary`
(solid), Add to Cart is `.btn-accent` (solid), matching the color
language used everywhere else on the site.

**4. "Auto Fetch" is now on the actual Add/Edit Product form.**
Was previously only reachable via a separate, unlinked
`product-import-tester.html`. Added a button next to Source Platform URL
on the real product form — pulls title/description/main image from that
URL via the existing `api/import-product.js` (same og:title/og:description/
og:image approach), same admin-token auth pattern as the invoice
download. Price and stock are still never auto-filled, by design.

**5. New: global loading overlay (`js/loading-overlay.js`).**
A subtle, low-opacity white veil (page stays visible underneath) with an
orange spinner, included on every page. The spin animation is an
**infinite CSS loop with no fixed length** — it's `LoadingOverlay.show()`/
`.hide()` (reference-counted) that controls whether it's on screen, not
a timer. Wired into: product page's initial load, admin product save
(image uploads + Firestore write), CSV/invoice downloads, and Auto Fetch.
**Left checkout's existing order-processing overlay alone** — it already
ties its "processing" phase to real completion (not a fixed timer), it
just uses a branded GIF instead of the new spinner style; only its
post-success celebration animation has a fixed duration, which is a
different thing (a deliberate confirmation animation, not a loading
indicator pretending to be done early).

**Files changed:** `admin.html`, `js/admin.js`, `css/components.css`,
`product.html`, `js/cart-button-ui.js`, new `js/loading-overlay.js`, and
the loading-overlay `<script>` tag added to every page (customer-facing
+ admin.html). Zero new `/api` files.

---

## 2026-07-25 — Product Variants (Size × Color), explicit GST toggle

**1. Explicit "GST-registered" toggle in Settings.**
Tax on invoices was already opt-in (blank GSTIN = no tax), but that was
implicit. Added `set-tax-enabled` checkbox — Settings → Account →
Invoice/Seller Details — as the single, explicit source of truth.
`api/admin-tools.js`'s invoice generator now checks `settings.taxEnabled`
directly rather than inferring intent from whether a GSTIN happens to be
filled in.

**2. New: Product Variants (Size × Color).**
Big one. A parent product can now be marked "has variants," given a
comma-separated Sizes list and Colors list, and "Add Variants" generates
one box per size×color combination — each gets its own optional
MRP/Sale Price/HSN/Source URL (falls back to the parent's value, snapshotted
once at creation — not a live link) and a required Stock count.

Each variant is created as its own **ordinary product document** in the
same `products` collection (`isVariant:true`, `parentId`, `size`, `color`)
rather than a separate data structure — that one decision is what let
cart, checkout, stock/price verification, sitemap, and the Google/Meta
shopping feed all pick variants up with little-to-no extra code, since
they already just query `products`. The parent itself (`hasVariants:true`)
is excluded from every public-facing query (`api/list.js`,
`js/product-loader.js`'s Firestore fallback, `api/product-feed.js`,
sitemap) — it's an admin-only template from then on, never itself
orderable.

**URL scheme:** normal products stay at `/products/{slug}`; a variant is
`/products/{parentId}/{variantSlug}` — the parentId in the path is what
keeps two unrelated products' variants from ever colliding even with
identical size/color text. New `vercel.json` rewrite added for the nested
path; `js/product-loader.js` gained `productUrl()`,
`getProductByParentAndVariantSlug()`, and `getVariantSiblings()` as the
shared building blocks every other file uses instead of constructing
product URLs by hand.

**Product page:** two independent selector rows (Color swatches, Size
buttons — not one combined dropdown). Picking a color keeps the current
size if that combo exists, else jumps to the first size that does;
either way, selecting something **navigates** to that variant's own URL
(matches Amazon/Myntra), it doesn't swap data in place under one URL.
Unavailable combinations show disabled/greyed.

**Admin Products list:** a parent with variants gets a ▸ expand arrow
(same visual language as the sidebar's own nav arrows); expanding shows
each variant as an indented row with the exact same Edit/Delete/Pause
buttons as any other product. Editing a variant directly hides the
Variants section (parent-only) and shows a **"🔄 Auto Sync from Parent"**
button instead — pulls the parent's current Name/Description/Category/
Brand/Tags/Delivery/Images onto this variant on demand; its own Size,
Color, MRP, Sale Price, HSN and Source URL are left alone, both by Auto
Sync and by the parent's own normal re-saves (a variant's already-set
override fields are never silently touched by editing the parent again —
only blank-at-creation fields ever inherited from the parent, and only
once).

**Everywhere else variants now show up:** Cart (`js/cart.js`,
`js/cart-button-ui.js`, `cart.html`) and Checkout (`js/checkout.js`)
display Size/Color and carry it into the order — no special stock/price
logic was needed there since each variant already has its own unique
`productId`, so the existing per-product cart/checkout code just works.
`api/place-order.js` snapshots `size`/`color`/`hsnCode` onto each order
item (same pattern as `costPrice`); stock/price re-verification already
happens against the correct variant's own document with zero changes,
for the same reason. Telegram alerts (`lib/telegram.js`) and order emails
(`js/emailjs-integration.js`) show `[Size/Color]` next to affected items;
low-stock/out-of-stock alerts specify which variant. Invoice PDFs
(`api/admin-tools.js`) print size/color under the item title. CSV exports
(Products, Orders) gained Size/Color columns; the Products export leaves
out parent template rows (never sellable). `js/search.js`'s Fuse index
now also matches on size/color text, and its result rows/subtitles show
the variant. Related-products on the product page no longer recommends a
product's own other sizes/colors as if they were separate items.

**A subtle bug caught and fixed while building this:** the first version
copied the parent's `slug` field onto every variant (harmless-seeming,
since variants route by `parentId`+`variantSlug`, not `slug`). But that
meant `ensureUniqueSlug()` would then see the parent's own slug as
"already taken" (by its own children) on the parent's next save, and
silently append "-2", "-3", etc. each time. Fixed two ways: variants no
longer get a `slug` field at all (only `variantSlug`, which is what
their routing actually uses), and `ensureUniqueSlug()` now excludes
`isVariant` docs from its collision check as a second layer of defense.

**Files changed:** `admin.html`, `js/admin.js` (bulk of the admin-side
logic), `js/product-loader.js`, `product.html`, `css/components.css`,
`vercel.json`, `js/cart.js`, `js/cart-button-ui.js`, `cart.html`,
`js/checkout.js`, `js/search.js`, `js/emailjs-integration.js`,
`api/place-order.js`, `api/admin-tools.js`, `api/list.js`,
`api/site-meta.js`, `api/product-feed.js`, `api/share.js`,
`lib/telegram.js`. **Zero new `/api` files** — still 11.

---

## 2026-07-24 — Cost Price + profit reporting, CSV exports, order invoices (PDF+ZIP), A2HS prompt, About/Terms edit-blank fix

**1. Fix: editing About/Terms in the admin showed a blank content editor.**
Root cause: `about.html`/`terms.html` ship with real placeholder copy baked
into the static HTML, but the matching Firestore `pages` docs are seeded
with `content: ""` on purpose (so a blank first save never silently wipes
the live page). The admin editor read straight from that empty Firestore
field, so it looked like the existing content had vanished. Fix: added
`DEFAULT_PAGE_LIVE_CONTENT` in `js/admin.js` — `editPage()` now pre-fills
the editor with the actual live static copy when the Firestore field is
still empty (display-only, until Publish is pressed, at which point it's
saved for real like any other page).

**2. New: mandatory product Cost Price + profit reporting.**
Products previously had no way to record what the seller actually paid —
only Selling Price. Added a required `costPrice` field (Product form,
`admin.html`/`js/admin.js`), snapshotted onto each order line at checkout
time (`api/place-order.js`, same pattern as `price`) so historical profit
stays accurate even if cost price changes later. Existing products saved
before this field existed are NOT required retroactively — they show a
"⚠ Cost price missing" badge in the Products table instead, and their
profit shows as N/A in reports rather than crashing anything.

**3. New: CSV exports — Overview / Products / Brands / Coupons / Orders.**
All built entirely client-side in `js/admin.js` against data already
loaded live via the existing `onSnapshot` listeners (`productsList` /
`brandsList` / `couponsList` / `ordersList`) — **zero new `/api` routes**.
Overview export includes a date-range picker (Last 7/28 days, This/Prev
Month, This Year, All Time, Custom) and reports revenue, discounts,
profit, order-status breakdown, top products, and coupon usage for that
range.

**4. New: order invoices — single PDF + bulk ZIP.**
Every order row now has a "⬇ Invoice" button; All Orders also has a
"⬇ Download All Invoices (ZIP)" button. Backed by a new admin-only
route, `api/admin-tools.js` (`?action=invoice&orderId=`, `?action=
invoice-bulk`), authenticated the same way as `api/import-product.js`
(`Authorization: Bearer <admin's Firebase ID token>`). PDFs are drawn
directly with `pdfkit` (no headless-Chromium dependency — keeps this
viable on Vercel Hobby's function-size limits); bulk mode streams a ZIP
built with `archiver`. Invoice layout follows the seller-agnostic
"Tax Invoice/Bill of Supply/Cash Memo" format (works whether or not the
reseller has a GSTIN) — new Settings → Account → "Invoice/Seller
Details" fields (Seller Name/ID/Address/State, GSTIN, Tax Rate) feed it.
Tax, when shown, is backed OUT of the already-agreed checkout price
(tax-inclusive), never added on top — the invoice total always matches
what the customer actually paid. Added optional per-product `hsnCode`
field (shown on invoice line items when set), also snapshotted onto
order items at checkout.

**5. `/api` file count — merged `manifest.js` + `sitemap.js` → `site-meta.js`.**
Adding `api/admin-tools.js` for #4 would have pushed `/api` to 11 files;
comfortably under the Hobby cap, but to leave headroom, `api/manifest.js`
and `api/sitemap.js` (both small, GET-only, Firestore-read-only, already
following the `?type=` dispatch pattern used by `api/list.js`) were
merged into `api/site-meta.js` (`?type=manifest` / `?type=sitemap`).
`vercel.json`'s rewrites for `/manifest.webmanifest` and `/sitemap.xml`
were updated to match. Net result: **11 files** (was 11 before this
update too — the merge exactly offset the one new file added).

**6. New: "Add to Home Screen" prompt.**
New `js/a2hs.js`, included on every customer-facing page (not
`admin.html`). Shows once per first visit (not every reload); if
dismissed (✕ or "Remind me later"), won't reappear for 2 hours, even
across closing/reopening the browser. Never shows if already installed.
Uses the real native `beforeinstallprompt` flow on Android/Chrome/Edge;
on iOS Safari (no such API exists) shows manual "Tap Share → Add to Home
Screen" instructions instead.

**Security fix found & closed while building #2:** `costPrice` would
otherwise have been readable by any visitor — `api/list.js`'s public
`/api/products` response and `api/place-order.js`'s order-confirmation
response both used to spread every field of a product/order doc verbatim.
Both now explicitly strip `costPrice` before responding to the browser.
**Known limitation:** `js/product-loader.js`'s direct-Firestore fallback
(only used if `/api/products` itself is unreachable) still reads full
product docs client-side, since Firestore security rules can't hide a
single field without moving it to a separate admin-only document — this
is a pre-existing pattern for every product field, not something new,
but worth knowing if that fallback path ever becomes the normal path.

**Files changed:**
| File | What changed |
|---|---|
| `js/admin.js` | `DEFAULT_PAGE_LIVE_CONTENT` fallback + `editPage()` fix; Cost Price + HSN Code fields (product form/save/edit/table badge); CSV export engine + button wiring (Overview/Products/Brands/Coupons/Orders); invoice download + bulk ZIP wiring; Settings load/save for new Seller/Invoice fields. |
| `admin.html` | Cost Price (required) + HSN Code fields on product form; Export CSV buttons (Products/Brands/Coupons/Orders); Download-All-Invoices button + status line; Overview "Export Report (CSV)" card with date-range picker; Settings → Account → "Invoice / Seller Details" section. |
| `api/admin-tools.js` | **New** — admin-only invoice PDF (single + bulk ZIP) generator. |
| `api/site-meta.js` | **New** — merged replacement for `api/manifest.js` + `api/sitemap.js`. |
| `api/manifest.js`, `api/sitemap.js` | **Deleted** — logic moved into `api/site-meta.js`. |
| `api/place-order.js` | Snapshots `costPrice`/`hsnCode` onto order items; strips `costPrice` from the client-facing response. |
| `api/list.js` | Strips `costPrice` from the public `/api/products` response. |
| `js/a2hs.js` | **New** — Add to Home Screen prompt. |
| `css/components.css` | Styles for the A2HS banner. |
| `index.html`, `blog.html`, `blog-post.html`, `cart.html`, `checkout.html`, `category.html`, `about.html`, `terms.html`, `product.html`, `404.html` | Added `<script src=".../js/a2hs.js">` (not `admin.html`, by design). |
| `vercel.json` | `/manifest.webmanifest` and `/sitemap.xml` rewrites now point at `/api/site-meta?type=...`. |
| `package.json` | Added `pdfkit` and `archiver` dependencies. |

---

## 2026-07-22 (later same day) — Fixed deploy failure: 13 serverless functions on Hobby plan

**What broke:** After pushing the previous update, Vercel deploys started
failing with: `No more than 12 Serverless Functions can be added to a
Deployment on the Hobby plan.` The `/api` folder had grown to 13 files —
Vercel's free plan hard-caps a deployment at 12, regardless of file size.

**Fix:** Merged `api/telegram-notify.js` and `api/telegram-test.js` (both
small, both already used the same `TELEGRAM_NOTIFY_API_KEY` auth check)
into a single new file, `api/telegram.js`. It dispatches internally based
on the request body: `{ event, ... }` → old notify behavior, `{ action,
... }` → old fetchChatId/test behavior. No feature was removed or changed
— only the file layout. Back down to 12 functions, deploy should succeed.

**Files changed:**
| File | What changed |
|---|---|
| `api/telegram.js` | **New** — merged replacement for the two files below. |
| `api/telegram-notify.js`, `api/telegram-test.js` | **Deleted** — logic moved into `api/telegram.js`. |
| `js/admin.js` | Both `fetch("/api/telegram-notify", ...)` and `fetch("/api/telegram-test", ...)` calls now point at `fetch("/api/telegram", ...)`; updated the 404 error-message text to match. |
| `js/site-config.js`, `SERVICE-ACCOUNT-SETUP-GUIDE.md` | Fixed a comment/doc reference to the old `api/telegram-notify.js` filename. |
| `README.md` | Updated the `api/` directory listing, and added a new Known Limitations item explaining the 12-function Hobby-plan cap so this doesn't silently break again if another `/api` file is ever added. |

**If you add another `/api` file in the future:** you must merge it into
an existing file (same pattern as above) or the next deploy will fail the
same way. See the new Known Limitations item in `README.md`.

---

## 2026-07-22 — SEO fixes, real-time geo verification, new favicon/icons

| File | What changed |
|---|---|
| `index.html`, `category.html`, `blog.html`, `about.html`, `terms.html` | Added `og:title`, `og:description`, `og:image`, `og:url`, `og:site_name`, and Twitter Card tags, plus a `canonical` link. These pages previously had none — sharing their links on WhatsApp/Instagram showed a blank/generic preview card. |
| `blog-post.html` | Existing dynamic OG block only set `og:title`/`og:description`/`og:image`; added `og:url`, `og:type`, `og:site_name`, and full Twitter Card tags, now filled in by the same inline script that already runs per-post. |
| `admin.html` | Added `<meta name="robots" content="noindex, nofollow">` — defense-in-depth on top of the existing `robots.txt` disallow. |
| `js/geo-restriction.js` | **New function** `verifyPincodeRealtime()` — calls India Post's free public API (`api.postalpincode.in`, no key needed) to confirm a typed PIN code is real and actually registered in West Bengal, instead of only checking it falls inside a numeric range. Returns the real district name too. Fails gracefully (falls back to the existing static range check) if the API is unreachable. |
| `js/checkout.js` | Wired `verifyPincodeRealtime()` into both the live-typing pincode feedback and the final delivery-form submit check. Falls back to the old static `GeoRestriction.validate()` check if the real-time API doesn't respond, so checkout is never blocked by a third-party outage. The submit handler is now `async` to support this. |
| `favicon.ico`, `images/favicon.svg`, `images/icons/*.png` | Regenerated from a new logo (orange/white shopping-bag "A", replacing the old navy/gold design) — `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png` (180×180, solid cream background), `icon-192.png`, `icon-512.png`, and `icon-512-maskable.png` (icon scaled to ~62% with cream-fill safe-zone padding so Android's mask crop never cuts it off). No HTML/manifest changes needed — every page and `api/manifest.js` already reference these same file paths. |

**Verified, no code change needed (already correct):**
- `api/place-order.js` re-verifies price/stock/coupon/COD-charge server-side from Firestore before writing an order — confirmed this already works as intended, browser total is never trusted.
- `js/reviews.js` is already Firestore-backed (`reviews` collection), not localStorage — confirmed reviews are shared across visitors correctly.

**Explicitly decided against:** browser Geolocation (GPS) permission prompt for delivery-address verification. Real fulfillment for this store goes through Meesho, which does its own address verification — GPS would only confirm where the shopper's phone is at checkout time, not the delivery address itself, and adds checkout friction for no real fraud protection here.

**Still pending / discussed but not yet done:** cleaning up the deprecated `products/*.json`, `config/coupons.json`, and `assets/` folder — see the "Housekeeping" note in `README.md`'s Directory Structure section for the exact list of what's safe to delete.

---

This zip contains ONLY the files that changed (plus this changelog + one new
tester page). Copy these over the same paths in your existing project — do
not need to touch anything else.

## Files changed / added

| File | What changed |
|---|---|
| `checkout.html` | Added a "Last 6 digits of UPI Transaction ID / UTR" field before the "I have paid" button. |
| `js/checkout.js` | (1) Requires + saves the UTR field on UPI orders. (2) Live coupon re-check on `cart:updated`, not just at final submit. (3) Now tries `POST /api/place-order` first (server-verified total) and only falls back to the old direct write if that route 404s. |
| `cart.html` | Coupon is now re-validated against the current subtotal every time the cart changes (qty +/-, remove) — fixes it staying "applied" after the cart drops below `minOrderValue`. |
| `js/reviews.js` | Fully rewritten: Firestore-backed (`reviews` collection) instead of localStorage. Same `init()` API, so nothing else needs to change. Includes ImgBB image upload for review photos. |
| `product.html` | Updated review-section copy ("visible to your device only" → real shared reviews) + added a honeypot field to the review form (it's now a public-write form, same spam protection pattern used elsewhere). |
| `firestore.rules` | Added a `reviews` collection: public read, public create (with basic shape checks — rating 1-5, comment ≤1000 chars), admin-only update/delete. |
| `js/site-config.js` | Now exposes `SITE_CONFIG.imgbbKey` so guest pages (reviews) can upload images the same way the admin panel does. |
| `js/admin.js` | (1) Order modal now shows the UPI txn ref. (2) Analytics: shows an explicit note when the 7-day revenue chart is empty but older orders exist. (3) "Update Status" now has an optional "email the customer" checkbox that sends a status-change email straight to the guest's own address. (4) Product form/table/order modal: full Source Platform URL feature (see below). |
| `admin.html` | (1) New Settings field: "Order Status Update Template ID". (2) "Notify customer" checkbox in the order modal. (3) New "Source Platform URL" field on the Add/Edit Product form. (4) New "Source Platform" column on the products table. |
| `api/place-order.js` | **New.** Vercel serverless function that re-fetches real prices/coupon rules/settings from Firestore and computes the order total server-side, instead of trusting the browser. No `firebase-admin` package or service account needed. |
| `api/import-product.js` | **New.** Vercel serverless function: given a third-party product URL, fetches it server-side and reads back `og:title` / `og:description` / `og:image` (+ downloads the image itself), for a one-time "import/prefill" helper — NOT a live sync. |
| `share-preview-tester.html` | **New.** Internal tool to test the WhatsApp/social link-preview feature (`api/product.js`) after deploying. |
| `product-import-tester.html` | **New.** Internal tool to test `api/import-product.js` in isolation — does not touch admin.html/admin.js, safe to try before wiring anything into the real Add Product form. |
| `products/*.json`, `config/coupons.json` | Added a loud `⚠️_STOP_DO_NOT_EDIT_THIS_FILE_⚠️` key at the top of each — these files are dead, kept only as historical backup. |
| `products/⚠️_STOP_DO_NOT_EDIT_THESE_FILES_⚠️.txt`, `config/⚠️_STOP_DO_NOT_EDIT_coupons.json_⚠️.txt` | **New.** Big plain-text warnings in both folders. |

## Source Platform URL feature — how it works

1. **Add/Edit Product form** — new "Source Platform URL" field (link only, optional). Saved as `sourcePlatformUrl` on the product document.
2. **All Products table** — new "Source Platform" column, after Status. Shows a **"Source Platform"** button per product (only if a URL was saved) that opens that link in a new tab. Shows "—" if no URL was set.
3. **Order details modal → Items Ordered** — each item now shows a **"Source Platform"** button on the right, if the product still exists and has a `sourcePlatformUrl` saved. This looks up the product by `productId` **at the time you open the order** (not a saved snapshot), so adding a source URL to a product later will also show up correctly on old orders for that product. If the product was since deleted, no button shows for that line.



## Telegram Integration — new in this update

**New files:**

| File | Purpose |
|---|---|
| `package.json` | Adds the `firebase-admin` dependency (Vercel installs it automatically on deploy). |
| `lib/firebase-admin.js` | Shared Admin SDK initializer (service-account-based, bypasses Firestore rules — used only by trusted server code). |
| `lib/telegram.js` | Builds the message text + inline buttons for every event type, sends via the real Telegram Bot API, loops over all configured bots. Never throws. |
| `api/telegram-notify.js` | Generic, API-key-protected endpoint: `POST { event, data }` → forwarded to Telegram. Called from `reviews.js` (new_review) and `admin.js` (order_cancelled). |
| `api/telegram-test.js` | Backs the "Fetch Chat ID" and "Send Test Message" buttons in the admin panel. |
| `api/cron-daily-digest.js` | Runs once a day (Vercel Cron): sales summary + UPI orders still pending verification + coupons expiring in 2 days, combined into one job (Hobby plan only allows once-daily cron cadence). |
| `SERVICE-ACCOUNT-SETUP-GUIDE.md` | Step-by-step: generate the Firebase service account key, base64-encode it, add as a Vercel env var, plus the two other env vars this needs. **Do this first — nothing Telegram-related works until you do.** |

**Rewritten:**
- `api/place-order.js` — now uses the Admin SDK instead of the public REST API. This unlocked two things at once: (1) **stock now actually auto-decrements after a successful order** (it never did before — it was a fully manual number), and (2) it can read the admin-only `telegram_bots` collection to fire `new_order`, and `out_of_stock`/`low_stock` when a decrement crosses a threshold (out of stock = 0 left, low stock = ≤3 left).

**Modified:**
- `firestore.rules` — new `telegram_bots` collection, admin-only read/write (bot tokens are real secrets, unlike every other key already used on this site).
- `vercel.json` — added the daily digest cron (`30 17 * * *` = 11:00 PM IST).
- `admin.html` / `js/admin.js` — new **Settings → Telegram Integration** tab: add/edit/delete bots, per-bot event checkboxes, Fetch Chat ID, Send Test Message. Also fires `order_cancelled` when an order's status is set to Cancelled.
- `js/reviews.js` / `product.html` — fires `new_review` after a review saves successfully (fire-and-forget, never blocks the review).
- `js/site-config.js` / `admin.html` Account tab — new `telegramApiKey` setting (the **abuse-throttle** key for `api/telegram-notify.js` — safe to expose publicly, this is NOT the bot token).

**Events implemented:** 🛒 New Order (full customer + payment breakdown + items with Source Platform buttons), ⚠️ Out of Stock, 🟡 Low Stock (≤3 left), ⭐ New Review, ❌ Order Cancelled, 📊 Daily Summary (sales + pending UPI + expiring coupons).

**A note on frequency:** Vercel's free Hobby plan only allows cron jobs to run **once per day** (not hourly/every-30-min). A true real-time "this UPI payment has been pending 30 minutes" reminder isn't possible on the free plan — the daily digest catches anything still pending once a day instead. If you ever want that tighter cadence, it needs Vercel Pro ($20/mo).

## Manual setup steps you must do yourself

0. **Telegram Integration needs the service account first.** Follow
   `SERVICE-ACCOUNT-SETUP-GUIDE.md` completely before anything else in this
   section — it covers the Firebase service account AND the two other env
   vars (`TELEGRAM_NOTIFY_API_KEY`, `CRON_SECRET`) this update needs.

1. **Republish Firestore rules.** Firebase Console → Firestore Database →
   Rules → paste the new `firestore.rules` contents → Publish. Without this,
   the new reviews feature will fail (permission-denied) even though the
   code is correct.

2. **Reviews image upload** needs an ImgBB key already set in
   Admin → Settings → Account (same key used for product images). If you
   haven't set one, review photo uploads will show an error, but text-only
   reviews still work fine.

3. **Customer status-update emails are OFF until you do two things:**
   - In your EmailJS dashboard, create a **second, separate template**
     (the existing one is written for notifying YOU about a new order —
     don't reuse it). Suggested variables: `{{order_id}}`,
     `{{customer_name}}`, `{{new_status}}`, `{{final_total}}`, and set the
     template's "To Email" field to `{{to_email}}`.
   - Paste that template's ID into Admin → Settings → Account →
     "Order Status Update Template ID", then Save.
   - Until both are done, the "email the customer" checkbox stays greyed
     out in the order modal (won't silently fail).

4. **`api/place-order.js` only works on Vercel** (or any host that runs
   `/api/*.js` as serverless functions) — same limitation `api/product.js`
   already had. On Vercel it just works, nothing to configure. If you ever
   move to GitHub Pages, checkout.js will automatically detect the missing
   route and fall back to the old direct write (still functional, just
   without server-side price re-verification on that host).

5. **`share-preview-tester.html`** only works once deployed on Vercel too
   (same reason as #4) — open it at
   `https://your-site.vercel.app/share-preview-tester.html` after deploying.
