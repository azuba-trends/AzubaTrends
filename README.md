# [Your Store Name] — E-commerce Site

A static, no-backend, guest-checkout e-commerce site built for GitHub Pages / Vercel deployment. Delivery restricted to West Bengal, India only.

## Tech Stack
Plain HTML, CSS, and vanilla JavaScript. No frameworks, no build step, no server. Products are individual JSON files. Deployable directly by pushing to GitHub and connecting the repo to Vercel or GitHub Pages.

## Full Directory Structure

```
ecommerce-site/
├── index.html                 [Claude 2] Home page
├── product.html                [Claude 2] Product detail page (reads ?id= from URL)
├── category.html                [Claude 2] Category listing page
├── checkout.html                [Claude 3] Cart + checkout page
├── about.html                   [Claude 2] About page
├── terms.html                   [Claude 2] Terms & Conditions page
├── 404.html                     [Claude 2] Optional not-found page
│
├── assets/
│   └── images/
│       ├── logo-placeholder.png [blank — Google Drive link added later via SITE_CONFIG.logoUrl]
│       └── products/            [product images referenced by products/*.json]
│
├── css/
│   ├── main.css                [Claude 2] Global styles, layout, responsive rules
│   └── components.css          [Claude 2] Product cards, nav bar, buttons, badges
│
├── js/
│   ├── site-config.js          [Claude 1 — DONE] Shared constants (currency, COD charge, EmailJS IDs, etc.)
│   ├── security.js             [Claude 1 — DONE] XSS escaping, honeypot, rate limiting, validators
│   ├── geo-restriction.js      [Claude 1 — DONE] West Bengal delivery validation
│   ├── emailjs-integration.js [Claude 1 — DONE] Sends order details via EmailJS
│   ├── product-loader.js       [Claude 2] Fetches all products/*.json, renders cards
│   ├── search.js               [Claude 2] Fuzzy search, autosuggest, out-of-stock ranking
│   ├── cart.js                 [Claude 3] Cart state (add/remove/update qty), localStorage persistence
│   ├── coupon.js               [Claude 3] Validates & applies coupons/config/coupons.json
│   ├── checkout.js             [Claude 3] Guest checkout form, order assembly, geo + payment flow
│   └── qr-generator.js         [Claude 3] Generates UPI QR code client-side
│
├── products/
│   ├── product-001.json        [sample — Claude 1 provided schema]
│   └── product-002.json        [sample, includes stock:0 for testing out-of-stock ranking]
│
├── config/
│   ├── geo-config.json         [Claude 1 — DONE] Admin-editable allowed state/cities/pincodes
│   └── coupons.json            [sample — Claude 1 provided schema, Claude 3 builds logic against it]
│
├── vercel.json                 [Claude 1 — DONE] Security headers + clean URLs
├── .gitignore                  [Claude 1 — DONE]
└── README.md                   [this file]
```

## Shared Data Contracts (read this before writing code — keeps all 3 AI's work compatible)

### Product object (`products/*.json`)
```json
{
  "id": "prod-001",
  "title": "string",
  "slug": "string",
  "category": "string",
  "tags": ["string"],
  "shortDescription": "string",
  "description": "string",
  "mrp": 999,
  "sellingPrice": 749,
  "stock": 12,
  "sku": "string",
  "images": ["path/to/image.jpg"],
  "createdDate": "YYYY-MM-DD"
}
```
- Discount % is **calculated on the frontend**, never stored: `Math.round(((mrp - sellingPrice) / mrp) * 100)`.
- `stock: 0` means out of stock — sort these to the bottom in listings/search (single source of truth is this field).
- One file per product. Adding a new `.json` file to `/products/` should make it appear on the site automatically (Claude 2's product-loader.js fetches a manifest or directory listing — see note below).

> **Heads up for Claude 2:** static sites can't list a folder's contents at runtime without a server. The simplest robust fix: maintain a small `products/index.json` (an array of filenames) that gets updated whenever a product is added, and have `product-loader.js` fetch that manifest first, then fetch each listed product file. Please implement this manifest pattern rather than trying to "read a folder" in JS.

### Cart item (in-memory / localStorage — owned by Claude 3, referenced by Claude 2's "Add to Cart" buttons)
```json
{
  "productId": "prod-001",
  "title": "string",
  "price": 749,
  "quantity": 2,
  "image": "path/to/image.jpg"
}
```

### Coupon object (`config/coupons.json`)
```json
{
  "code": "WELCOME10",
  "type": "percentage",
  "value": 10,
  "minOrderValue": 500,
  "maxDiscount": 200,
  "expiryDate": "YYYY-MM-DD",
  "active": true
}
```

### Order email payload (passed to `OrderEmail.send()` in `emailjs-integration.js`)
```js
{
  orderId, customerName, customerPhone, customerAddress, customerCity,
  customerPincode, items, subtotal, discount, codCharge, finalTotal,
  paymentMethod // "COD" | "UPI"
}
```

## Setup Instructions

### 1. EmailJS (order email automation)
1. Create a free account at emailjs.com.
2. Add an Email Service (e.g. Gmail) and connect `azubatrends@gmail.com`.
3. Create an Email Template with variables matching the order email payload above (`{{order_id}}`, `{{customer_name}}`, `{{order_items}}`, `{{final_total}}`, etc.).
4. Copy your Public Key, Service ID, and Template ID into `js/site-config.js`.
5. **Security step (do this, it matters):** In EmailJS dashboard → Account → Security → "Allowed origins", add only your live domain (e.g. `https://yourstore.vercel.app`). This is what actually prevents someone from copying your public key and using it on a different website — hiding the key itself isn't possible in a static frontend, restricting its allowed origin is the real control.
6. Optionally set a monthly send-quota alert in EmailJS to catch abuse early.

### 2. Geo-restriction (delivery area)
- Edit `config/geo-config.json` directly to add/remove allowed cities or adjust pincode ranges. No code changes needed.
- Commit and push — GitHub Pages/Vercel will redeploy automatically and the new rules apply immediately.
- Current default: PIN codes 700000–743999 (West Bengal, per India Post). Note that 744xxx belongs to Andaman & Nicobar Islands, not West Bengal, so it's excluded — double check any edge-case PIN codes against indiapost.gov.in before adding overrides.

### 3. UPI Payments
- UPI ID used for QR generation: `azubatrends@naviaxis` (configured in `site-config.js`, consumed by Claude 3's `qr-generator.js`).
- No backend payment verification exists — orders paid via UPI are marked "pending verification" and the admin manually confirms receipt against their UPI/bank statement using the generated Order ID.

### 4. Logo
- `SITE_CONFIG.logoUrl` in `js/site-config.js` is intentionally blank. Add your Google Drive (or any hosted) image URL there once ready — Claude 2's header should read from this variable, not a hardcoded path.

## Known Limitations (please read — these are architectural realities of a no-backend static site, not oversights)

1. **Geo-restriction validates form input, not real GPS location.** There's no way to verify a user's true location without a backend or asking browser permission for Geolocation (not implemented here). This stops honest mistakes and casual out-of-zone orders, not deliberate spoofing.
2. **EmailJS credentials are visible in browser DevTools no matter what.** This is normal for any client-side email/API integration — protect via the "Allowed origins" domain restriction in the EmailJS dashboard, not by trying to hide the key in code.
3. **No order database.** Orders exist only as emails sent to the admin inbox. There's no order history, tracking page, or inventory auto-deduction — if you need that later, you'll need a lightweight backend (e.g. a free-tier Firebase/Supabase project).
4. **Review images can't be truly "uploaded"** without file storage, which a static site doesn't have. Recommended approach: validate file type/size client-side, then either (a) attach small compressed images to the review-notification email via EmailJS for admin to manually approve and add to the product JSON, or (b) integrate a free image host (e.g. Cloudinary's free tier) if persistent user-uploaded review photos are a hard requirement. Claude 2 should implement whichever approach you choose — flag this decision before they start.
5. **Client-side rate limiting/spam protection can be bypassed** by anyone bypassing the browser entirely (e.g. scripting requests directly to EmailJS). It stops casual bots and accidental spam, not a targeted attacker.

## Deployment (Vercel — recommended)
1. Push this repo to GitHub.
2. Import the repo in Vercel (vercel.com) → Framework preset: "Other" → no build command needed (static site).
3. Deploy. `vercel.json` handles clean URLs and security headers automatically.

## Deployment (GitHub Pages — alternative)
1. Push to GitHub → repo Settings → Pages → deploy from `main` branch, root folder.
2. Note: GitHub Pages ignores `vercel.json` (security headers won't apply) — Vercel is recommended if those headers matter to you.
