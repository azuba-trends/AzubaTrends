# AzubaTrends — E-commerce Site

A guest-checkout e-commerce site for West-Bengal-only delivery, deployed on
**Cloudflare Pages** (static hosting + Pages Functions for the few things
that need server-side logic) with **Firebase (Firestore + Auth) as the
database**.

> **Migrated from Vercel.** This project originally ran on Vercel; it moved
> to Cloudflare Pages because Vercel's Hobby (free) plan caps a deployment
> at 12 serverless functions total, which this project's e-commerce
> feature set (invoices, product feed, reviews, cron digest, etc.) kept
> hitting. Cloudflare Pages Functions has no equivalent cap. If you're
> reading old instructions, notes, or screenshots that mention `vercel.json`,
> `/api/*.js`, or "Vercel Hobby plan" — those describe the old setup and no
> longer apply; see "Directory Structure" and "Deployment" below for what's
> actually true today.

> **One-time action after this update:** coupons moved from
> `config/coupons.json` into a new Firestore `coupons` collection, and
> `firestore.rules` now has a rule for it. Re-paste the full contents of
> `firestore.rules` into Firebase Console -> Firestore Database -> Rules ->
> Publish, or coupon codes won't validate at checkout.

## The database question, answered directly

> "Mujhe static hosting par hi chalana hai, database kaise possible hoga?"

**Static hosting (Cloudflare Pages, GitHub Pages, etc.) and having a real
database are not in conflict — this project already proves it.** Static
hosts only serve files (HTML/CSS/JS) by default — they don't run server
code unless you explicitly add it (Cloudflare Pages Functions, in this
project's case, for the handful of things that genuinely need a server:
order placement re-verification, invoices, sitemap/feed generation, review
rate-limiting). The database itself is **Firebase Firestore**, Google's
fully-hosted cloud database. Your product pages, admin panel, and most of
checkout all talk to Firestore **directly from the browser** using
Firebase's JavaScript SDK — no server in between for that part.

This is exactly how the admin panel, products, categories, brands, and
orders already work in this repo. The only thing you must do that "pushing
to GitHub/deploying to Cloudflare" doesn't do for you is set the
**Firestore security rules** (see `firestore.rules` in this repo) — paste
them into your Firebase console once. Without rules, Firestore is either
wide open to anyone or fully locked, and neither is what you want.

**Trade-off to know about:** Firestore bills (and the free tier limits) by
number of reads/writes, not by "having a database" itself. For a small/new
store this comfortably fits the free "Spark" plan. As the store grows, keep
an eye on the Firebase console's usage tab.

## Tech Stack
Plain HTML, CSS, and vanilla JavaScript on the frontend. Firebase Firestore
for data (products, categories, brands, orders, settings) and Firebase Auth
for the single admin login. ImgBB for image hosting (free image-upload API,
key entered in Settings, not hardcoded). EmailJS for optional order-email
notifications.

## Directory Structure

```
AzubaTrends/
├── index.html, product.html, category.html   Storefront pages
├── cart.html, checkout.html                  Cart + guest checkout
├── blog.html, blog-post.html                 Blog listing + single post
├── admin.html                                Admin panel (Firebase Auth login)
├── about.html, terms.html, 404.html
│
├── images/
│   ├── favicon.svg, icons/                   Favicon + Add-to-Home-Screen icons
│   ├── logo-placeholder.svg                  Fallback image when a product has none
│   └── products/                             Product images referenced from Firestore
│
├── css/
│   ├── main.css                              Global styles, design tokens
│   └── components.css                        Product cards, nav, buttons, badges
│
├── js/
│   ├── site-config.js       Public-page Firebase init + reads /settings/store_config
│   ├── firebase-config.js   Admin-page Firebase init (adds Auth)
│   ├── security.js          XSS escaping, honeypot, rate limiting, validators
│   ├── geo-restriction.js   West Bengal delivery validation (static config/geo-config.json
│   │                        check + real-time India Post pincode verification)
│   ├── emailjs-integration.js  Sends order details via EmailJS (optional)
│   ├── product-loader.js    Reads /products from Firestore, renders cards
│   ├── blog-loader.js       Reads /blog-posts from Firestore, renders blog listing/post
│   ├── tracking.js          GA4 + Meta Pixel event firing (site-wide, once IDs are set)
│   ├── search.js            Fuzzy search, autosuggest, out-of-stock ranking
│   ├── cart.js, cart-button-ui.js  Cart state (add/remove/update qty), localStorage
│   ├── coupon.js             Validates coupons against Firestore's `coupons` collection
│   ├── checkout.js           Guest checkout: validation, geo-check, order write, payment
│   ├── qr-generator.js       Generates UPI QR code client-side
│   ├── reviews.js            Product reviews — Firestore-backed (`reviews` collection)
│   ├── layout.js             Loads partials/header.html + footer.html
│   └── admin.js              Full admin panel logic (see below)
│
├── lib/                      Server-only helpers, used by functions/api/*.js (never sent to the browser)
│   ├── firestore-rest.js     Firestore access over its REST API (Workers can't use the
│   │                         Node-only Admin SDK) — getDoc/getDocs/setDoc/batchWrite/
│   │                         verifyIdToken etc. This is the single "shared contract" every
│   │                         function talks to Firestore through.
│   ├── auth.js                requireAdmin(request, env) — wraps verifyIdToken() so every
│   │                          admin-only route shares one auth check
│   ├── invoice.js             Order-invoice PDF drawing, via pdf-lib (Workers-safe;
│   │                          replaces the old pdfkit-based version)
│   ├── telegram.js           Builds + sends Telegram notification messages
│   ├── pricing.js            Shared server-side price/margin calculation
│   ├── submit-review-guard.js  Rate-limit + shape checks for public review submissions
│   └── profanity-list.js     Word list used by the review-submission guard
│
├── partials/header.html, footer.html
├── config/
│   ├── geo-config.json      Admin-editable allowed state/cities/pincodes
│   └── firebase-config.json Firebase project config (not a secret — rules secure the data)
│
├── functions/                 Cloudflare Pages Functions (this project's server-side code)
│   ├── _middleware.js         Rewrites canonical/og:url/og:image/twitter:image tag origins
│   │                          to the real incoming request domain on every HTML response —
│   │                          see its header comment. This is what makes the domain
│   │                          "just work" even if you attach a custom domain later; you
│   │                          never need to hand-edit a domain into an HTML file again.
│   ├── [slug].js               Catch-all for single-segment URLs -> renders custom Pages
│   │                          (Admin -> Pages) via api/page.js
│   ├── robots.txt.js           Dynamic robots.txt (the Sitemap: line needs the real domain)
│   ├── sitemap.xml.js, manifest.webmanifest.js   Thin wrappers -> api/site-meta.js
│   ├── share.js, share-blog.js  Clean-URL wrappers -> api/share.js
│   ├── product-feed.csv.js     Clean-URL wrapper -> api/product-feed.js
│   └── api/
│       ├── place-order.js      Server-side price/stock/coupon re-verification + order write
│       ├── share.js            Per-item OG tags for WhatsApp/social link previews — product
│       │                       AND blog, one function (was product.js + blog-post.js)
│       ├── page.js             Full server-side rendering for custom Pages (Admin -> Pages)
│       ├── list.js, products.js, blog-posts.js, product-feed.js, site-meta.js
│       ├── admin-tools.js      Admin-only: recalc-ratings, order invoice PDF (single) +
│       │                       all-invoices ZIP — via lib/invoice.js + fflate
│       ├── import-product.js   One-time product-prefill helper from a third-party URL
│       ├── submit-review.js    Rate-limited, profanity-filtered public review submission
│       ├── notify-stock.js     Back-in-stock email signup
│       ├── telegram.js         Telegram alerts (order/review notifications)
│       └── cron-daily-digest.js  Daily rollup (pending orders, low stock, etc.) — see
│                                "Daily cron digest" below for how this actually gets called,
│                                since Cloudflare Pages Functions can't schedule themselves.
│
├── cron-worker/                A SEPARATE, tiny Cloudflare Worker (not a Pages Function —
│   ├── worker.js               Cloudflare Pages Functions have no Cron Trigger equivalent).
│   └── wrangler.toml           Its only job: call functions/api/cron-daily-digest.js once a
│                                day. See "Daily cron digest" below to deploy it.
│
├── firestore.rules           Paste into Firebase Console -> Firestore -> Rules
├── wrangler.jsonc             Cloudflare Pages project config
├── _headers                   Security headers (CSP, X-Frame-Options, etc.) — Cloudflare
│                               Pages' equivalent of vercel.json's old `headers` block
├── _redirects                  Clean-URL rewrites (/products/:slug -> /product, etc.) —
│                               Cloudflare Pages' equivalent of vercel.json's old `rewrites`
├── _routes.json                 Which paths actually invoke Functions vs. serve as plain
│                               static assets (a few low-traffic/no-domain-tag pages like
│                               /admin, /cart, /checkout, /search stay pure-static for speed)
└── README.md
```

> **Housekeeping — safe to delete, not read by the live site anymore:**
> - `products/` (whole folder — `index.json`, `product-001.json`...`product-008.json`,
>   and the STOP_DO_NOT_EDIT notice inside it) — old leftover demo data. Products
>   now live entirely in Firestore, managed from Admin → Store → All Products.
> - `config/coupons.json` and its STOP_DO_NOT_EDIT notice — coupons now live
>   in Firestore's `coupons` collection, managed from Admin → Store → All Coupons.
> - `assets/` (just one `README.txt` pointing at the old `products/*.json`
>   image convention — no longer relevant).
> - `share-preview-tester.html`, `product-import-tester.html` — internal
>   dev-only tools, already blocked in `robots.txt`. Both were written against
>   the old Vercel `/api/*` paths in their own instructional text — they still
>   work (the routes they hit exist under the same clean URLs on Cloudflare
>   too), the wording just says "Vercel" in a couple of places. Keep them if
>   you still want to test those two features; delete if not.
>
> Deleting all of the above changes nothing on the live site — everything
> real goes through Firestore and the files above.

## Admin Panel

Login at `/admin.html` with the email/password you create in **Firebase
Console -> Authentication -> Users** (there's no public sign-up — you create
this account yourself, once).

- **Everything updates live.** Products, categories, brands, coupons, and
  orders are all backed by Firestore realtime listeners (`onSnapshot`), not
  one-time reads — a new order placed on the storefront, or an edit made
  from a second tab/device, appears here immediately. No manual reload or
  hard reload needed. The panel also remembers which section you were on
  and reopens it after a browser refresh instead of always jumping back to
  Overview.
- **Dashboard**
  - *Overview* — total products, live vs paused, out-of-stock count, total
    orders, total revenue (sum of every non-Cancelled order's final total).
  - *Analytics* — revenue for the last 7 days, an orders-by-status
    breakdown, and a top-5-products-by-units-sold table. All computed
    client-side from your existing Firestore data — no extra service needed.
    Day buckets use your browser's local calendar day consistently (not a
    UTC/local mix), so orders always land on the correct day/weekday bar
    regardless of time zone. (See "Analytics at scale" below for the honest
    trade-off.)
- **Store**
  - *All Products / Add Product* — name, auto-slug (editable), category,
    brand (dropdown, managed under Brands), MRP, sale price, stock, SKU,
    tags, delivery fee, delivery partner name + logo, short/long
    description, feature image + up to 5 gallery images (all with previews),
    Publish or Save as Draft. Each row has Pause (hides from storefront
    without deleting), Edit, and Delete; multi-select + bulk delete supported.
  - *All Categories / Add Category* — name, auto-slug, Parent or Child type
    (child categories pick a parent from a dropdown of existing categories,
    slug becomes `parent-slug/child-slug`), description, SEO meta
    title/description, optional image. Edit/Delete per row.
  - *All Brands / Add Brand* — same idea as categories, without the
    parent/child concept.
  - *All Coupons / Add Coupon* — code, percentage or flat discount, max
    discount cap (percentage coupons), minimum order value, optional expiry
    date, and an Active/Inactive toggle. Coupons live in Firestore's
    `coupons` collection and are validated live from `cart.html`/
    `checkout.html` — create, edit, activate/deactivate, or delete one here
    and it's live on the storefront immediately, no git push required.
  - *All Orders* — tabbed by Active / Finished (Delivered) / Cancelled / All.
    "Process" opens the full order: customer details, full price breakdown
    (subtotal, discount, delivery fee, COD charge, final total), items, and
    a status dropdown to update it.
- **Settings** (Account / Payment / Support tabs) — store name, admin
  display name, ImgBB API key, EmailJS public key/service ID/template ID,
  UPI ID, COD extra charge, support email, support phone. **Nothing here is
  hardcoded in source anymore** — every value is read from and saved to the
  `settings/store_config` Firestore document.

### Analytics at scale
Client-side analytics (as implemented) reads every order document to compute
its charts — fine for a store with dozens or low hundreds of orders. If you
grow into thousands of orders, that read cost adds up; at that point the
right move is a scheduled Cloud Function that pre-aggregates daily/monthly
totals into a small `analytics_summary` collection, and pointing the
dashboard at that instead. Not needed to start.

## Setup Instructions

### 1. Firebase project
1. Create a project at console.firebase.google.com.
2. Enable **Firestore Database** (production mode) and **Authentication ->
   Email/Password** provider.
3. Under Authentication -> Users, add one user — this is your admin login.
4. Under Firestore -> Rules, paste in the contents of `firestore.rules` from
   this repo and Publish.
5. Under Project Settings -> General, copy your Firebase config object into
   **both** `js/site-config.js` and `js/firebase-config.js` (the
   `firebaseConfig` object). This config is not a secret — it identifies
   which Firebase project to talk to; your Firestore rules are what actually
   secure the data.

### 2. Image uploads (ImgBB)
1. Get a free API key at api.imgbb.com.
2. Log into `/admin.html` -> Settings -> Account -> paste it into "Image
   Upload API Key" -> Save. Product/category/brand image uploads will work
   from then on.

### 3. EmailJS (optional order email notifications)
1. Create a free account at emailjs.com, add an Email Service, and an Email
   Template with variables matching what `emailjs-integration.js` sends
   (`{{order_id}}`, `{{customer_name}}`, `{{order_items}}`,
   `{{final_total}}`, etc. — see that file's header comment for the full
   list).
2. Enter your Public Key / Service ID / Template ID in Admin -> Settings ->
   Account.
3. **Security step that matters:** in the EmailJS dashboard -> Account ->
   Security -> "Allowed origins", add only your live domain. This is what
   actually stops someone from copying your public key onto another site —
   the key itself can't be hidden in a browser app.

### 4. Payments
- Enter your UPI ID and any COD extra charge in Admin -> Settings -> Payment.
- There's still no automated payment verification (no backend to confirm a
  UPI transaction landed) — UPI orders are marked "pending verification" and
  you confirm manually against your bank/UPI app using the Order ID.

### 5. Order invoices
`/admin.html` -> an order's "Process" view can download that order's invoice
PDF, and All Orders has a bulk "Download all invoices (.zip)" action. Both
are generated on the fly by `functions/api/admin-tools.js` via `lib/invoice.js`
(pdf-lib) — no setup needed beyond `npm install` having actually run before
deploy (see Deployment below). GST fields (GST number, tax rate, seller
address/state) are read from Admin -> Settings; leave the "This business is
GST-registered" checkbox off if you don't have a GSTIN yet — invoices will
print as a plain Bill of Supply instead of a tax invoice.

### 6. Geo-restriction (delivery area)
- Edit `config/geo-config.json` to add/remove allowed cities or adjust
  pincode ranges — checkout's validation and its city dropdown both read
  this file directly, so editing it is enough (no code changes, just
  commit + push/redeploy).
- Default: PIN codes 700000–743999 (West Bengal per India Post), excluding
  744xxx (Andaman & Nicobar). Double-check edge-case PINs against
  indiapost.gov.in before overriding.

## Known Limitations (please read)

1. ~~Order price isn't re-verified server-side.~~ **Fixed.** `api/place-order.js`
   now re-fetches real prices/stock/coupon rules/settings from Firestore and
   computes the order total server-side — the browser's own total is never
   trusted or stored. DevTools price tampering no longer works.
2. ~~Reviews are localStorage-only.~~ **Fixed.** `js/reviews.js` is now
   Firestore-backed (`reviews` collection) — a review posted by one visitor
   is visible to every other visitor, not just the browser that posted it.
3. **EmailJS/ImgBB keys are visible in the browser** no matter where they're
   stored (this is inherent to any client-only integration) — the real
   protections are EmailJS's "Allowed origins" setting and rotating the
   ImgBB key if it's ever abused, not hiding it in code.
4. **Geo-restriction now cross-checks pincodes against India Post's real
   records in real time** (`GeoRestriction.verifyPincodeRealtime()` in
   `js/geo-restriction.js`, using the free `api.postalpincode.in` API) —
   this catches a fake-but-in-range PIN code that isn't actually assigned,
   and falls back to the old static range check if that API is ever
   unreachable. It still isn't GPS/location-based, so it can't confirm the
   shopper is physically at that address — only that the PIN code itself is
   real and in West Bengal. True physical verification would need the
   browser's Geolocation permission prompt, which this store deliberately
   does not use (real fulfillment/delivery goes through Meesho, which
   handles its own address verification).
5. **Per-product/per-post social-share preview tags (`functions/api/share.js`)
   need Cloudflare Pages Functions to run** — they work on this deployment
   (Cloudflare Pages) but would **not** work if you ever moved this specific
   piece to a pure static host like GitHub Pages, which has no serverless
   functions at all. If that ever happens, product/blog links shared on
   WhatsApp/social would show generic preview tags instead of per-item ones —
   a host limitation, not a bug. The homepage, category, blog listing, about,
   and terms pages don't have this limitation — their Open Graph/Twitter tags
   work on any host, static or not (see `functions/_middleware.js` for how
   they stay domain-correct specifically on Cloudflare).
6. **The daily digest cron (`functions/api/cron-daily-digest.js`) does not run
   on a schedule by itself.** Cloudflare Pages Functions have no Cron Trigger
   equivalent — only a plain Cloudflare Worker can schedule itself. A small
   separate worker for exactly this (`cron-worker/`) is included; see "Daily
   cron digest" below to deploy it. Until that worker is deployed and its
   secrets are set, this endpoint just sits there unused — nothing calls it.
7. **Bulk invoice ZIP (`?action=invoice-bulk`) builds the whole ZIP in memory
   in one Worker invocation** (via `pdf-lib` + `fflate`, not streamed the way
   the old Node `archiver` could). Fine for a store with dozens/low hundreds
   of orders. If this store ever accumulates thousands of orders, watch for
   Cloudflare Worker CPU-time/memory limits on that one request — the fix at
   that point is batching into multiple smaller ZIPs, not a full rewrite.

## Deployment (Cloudflare Pages)
1. Push this repo to GitHub (or GitLab).
2. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Connect to
   Git -> pick this repo. Framework preset: "None" -> no build command,
   output directory `/` (project root).
3. Before your first real deploy, run `npm install` locally once (or let
   Cloudflare's build step do it) so `pdf-lib` and `fflate` (used by
   invoice generation) actually end up in `node_modules` — see
   `package.json`.
4. Deploy. `_headers` (security headers/CSP), `_redirects` (clean URLs),
   and `_routes.json` (which paths run Functions vs. serve as static
   assets) are all picked up automatically — no manual configuration step
   for them.
5. **Attach a custom domain (optional but recommended):** Pages project ->
   Custom domains -> Add. You do **not** need to edit any file for this —
   `functions/_middleware.js` and the dynamic `sitemap.xml`/`robots.txt`
   functions all derive the domain from the actual incoming request, so a
   new custom domain works immediately with zero code changes. (If you
   ever add one, also update GA4's Data Stream "Default URL" and Firebase
   Authentication's Authorized domains — those two are dashboard settings,
   not code, and won't update themselves. See "Changing your domain"
   below.)

### Daily cron digest
`functions/api/cron-daily-digest.js` (pending-order reminders, low-stock
alerts, etc.) needs something to actually call it once a day — Cloudflare
Pages Functions can't schedule themselves. `cron-worker/` in this repo is a
small, separate Cloudflare Worker whose only job is that daily call. One-time
setup:
1. `cd cron-worker && npx wrangler deploy`
2. `npx wrangler secret put SITE_URL` — your live site's origin (e.g.
   `https://azubatrends.pages.dev`, or your custom domain).
3. `npx wrangler secret put CRON_SECRET` — must match the `CRON_SECRET`
   environment variable set on the main Pages project (Pages -> Settings ->
   Environment variables). If you haven't set one there yet, pick any long
   random string and set it in **both** places.

Full detail is in `cron-worker/worker.js`'s header comment. Default schedule
is 03:00 UTC daily — edit the `crons` line in `cron-worker/wrangler.toml` to
change it.

### Changing your domain later
If this site ever moves domains again (a different `*.pages.dev` subdomain,
or a custom domain), the code itself needs **zero edits** — every place that
used to hardcode a domain (canonical/OG tags, sitemap, robots.txt, invoice
links, share previews) now derives it from the actual request at the time,
via `functions/_middleware.js` and the various `functions/*.js` files. What
you still do need to update by hand, because they're dashboard settings, not
code:
- **Google Search Console** — domain ownership is verified per-property; a
  new domain needs its own verification (you've already done this).
- **Google Analytics (GA4)** — not domain-locked the way GSC is, so no new
  property is needed. Analytics.google.com -> Admin -> Data Streams -> your
  web stream -> update the "Default URL" field. Cosmetic, but keeps things
  tidy.
- **Firebase Console -> Authentication -> Settings -> Authorized domains** —
  add the new domain, or `/admin.html` login can start failing.
- **EmailJS -> Account -> Security -> Allowed origins** — add the new
  domain, or order-confirmation emails can silently stop sending.
- **`cron-worker`'s `SITE_URL` secret** — `npx wrangler secret put SITE_URL`
  again with the new value.
