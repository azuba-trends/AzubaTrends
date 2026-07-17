# AzubaTrends — Update Changelog

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
