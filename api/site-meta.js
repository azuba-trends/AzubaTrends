// api/site-meta.js
//
// MERGED FILE (2026-07-24) — this used to be two separate files,
// api/manifest.js and api/sitemap.js. Adding the new invoice/CSV-export
// endpoint (api/admin-tools.js) for the "download invoice" feature would
// have pushed /api past Vercel's Hobby-plan cap of 12 serverless
// functions. Both of these were small, GET-only, Firestore-read-only
// endpoints already following the same "dispatch by query param" pattern
// used elsewhere in this repo (api/list.js, api/share.js), so merging
// them was the natural first place to free up a slot — same idea as the
// telegram.js merge, see CHANGELOG-updates.md.
//
// Dispatched by ?type=:
//   - type=manifest -> old api/manifest.js behavior (manifest.webmanifest)
//   - type=sitemap   -> old api/sitemap.js behavior (sitemap.xml)
// vercel.json's rewrites for /manifest.webmanifest and /sitemap.xml were
// updated to point at /api/site-meta?type=... accordingly.
//
// ---------------------------------------------------------------------
// ORIGINAL api/manifest.js HEADER COMMENT (kept for context):
// Serves manifest.webmanifest dynamically instead of as a static file, so
// the "name" shown when someone adds this site to their home screen
// always matches whatever the admin has actually set as the store name
// in Settings — no code edit needed if this codebase gets reused for a
// different brand. Falls back to sensible generic defaults if Firestore
// isn't reachable, so this never hard-fails.
//
// ORIGINAL api/sitemap.js HEADER COMMENT (kept for context):
// Generates sitemap.xml on the fly from whatever is actually in Firestore
// right now — products and categories. This means it's always accurate
// (a new product shows up in the sitemap automatically, a deleted one
// disappears) without anyone having to remember to regenerate a static
// file. Exposed at the clean URL /sitemap.xml via the rewrite in
// vercel.json, which is the URL to give Google Search Console.
// ---------------------------------------------------------------------

import { getDb } from "../lib/firebase-admin.js";

function xmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function handleManifest(req, res) {
  let storeName = "AzubaTrends";
  let themeColor = "#1F3A5F";

  try {
    const db = getDb();
    const doc = await db.collection("settings").doc("store_config").get();
    if (doc.exists) {
      const data = doc.data();
      storeName = data.storeName || storeName;
      themeColor = data.themeColor || themeColor;
    }
  } catch (err) {
    console.error("site-meta(manifest): could not load settings, using defaults:", err.message);
  }

  const manifest = {
    name: storeName,
    short_name: storeName.length > 12 ? storeName.slice(0, 12) : storeName,
    description: `Shop ${storeName} — order online, delivered to your door.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F7F3EC",
    theme_color: themeColor,
    orientation: "portrait-primary",
    icons: [
      { src: "/images/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };

  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(JSON.stringify(manifest));
}

async function handleSitemap(req, res) {
  const host = req.headers.host;
  const baseUrl = `https://${host}`;

  const staticUrls = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/category", priority: "0.7", changefreq: "weekly" },
    { loc: "/blog", priority: "0.6", changefreq: "weekly" }
  ];

  let blogUrls = [];
  let productUrls = [];
  let categoryUrls = [];
  let blogCategoryUrls = [];
  let pageUrls = [];

  try {
    const db = getDb();

    const productsSnap = await db.collection("products").get();
    productsSnap.forEach((doc) => {
      const p = doc.data();
      if (p.status !== "active") return;
      if (p.hasVariants) return; // parent is a template only, never itself a real page
      const loc = (p.isVariant && p.parentId && p.variantSlug)
        ? `/products/${encodeURIComponent(p.parentId)}/${encodeURIComponent(p.variantSlug)}`
        : (p.slug ? `/products/${encodeURIComponent(p.slug)}` : `/product.html?id=${encodeURIComponent(doc.id)}`);
      productUrls.push({
        loc,
        priority: "0.8",
        changefreq: "weekly",
        lastmod: p.updatedAt || p.createdAt || undefined
      });
    });

    const categoriesSnap = await db.collection("categories").get();
    categoriesSnap.forEach((doc) => {
      const c = doc.data();
      categoryUrls.push({
        loc: `/category/${encodeURIComponent(c.slug || doc.id)}`,
        priority: "0.6",
        changefreq: "weekly"
      });
    });

    const blogSnap = await db.collection("blogPosts").where("status", "==", "published").get();
    blogSnap.forEach((doc) => {
      const p = doc.data();
      if (!p.slug) return;
      blogUrls.push({
        loc: `/blog/${encodeURIComponent(p.slug)}`,
        priority: "0.5",
        changefreq: "monthly",
        lastmod: p.updatedAt || p.createdAt || undefined
      });
    });

    const blogCategoriesSnap = await db.collection("blogCategories").get();
    blogCategoriesSnap.forEach((doc) => {
      const c = doc.data();
      blogCategoryUrls.push({
        loc: `/blog/category/${encodeURIComponent(c.slug || doc.id)}`,
        priority: "0.5",
        changefreq: "weekly"
      });
    });

    const pagesSnap = await db.collection("pages").where("status", "==", "published").get();
    pagesSnap.forEach((doc) => {
      const p = doc.data();
      if (!p.slug || p.slug === "home" || p.slug === "404") return;
      pageUrls.push({
        loc: `/${encodeURIComponent(p.slug)}`,
        priority: p.isDefault ? "0.5" : "0.6",
        changefreq: "monthly",
        lastmod: p.updatedAt || p.createdAt
      });
    });
  } catch (err) {
    console.error("site-meta(sitemap): could not load products/categories/blogCategories/pages:", err.message);
  }

  const allUrls = [...staticUrls, ...categoryUrls, ...productUrls, ...blogUrls, ...blogCategoryUrls, ...pageUrls];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${xmlEscape(baseUrl + u.loc)}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${u.lastmod ? `\n    <lastmod>${xmlEscape(new Date(u.lastmod).toISOString().slice(0, 10))}</lastmod>` : ""}
  </url>`
  )
  .join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).send(body);
}

export default async function handler(req, res) {
  const { type } = req.query;
  if (type === "manifest") return handleManifest(req, res);
  if (type === "sitemap") return handleSitemap(req, res);
  return res.status(400).json({ error: "Unknown or missing type. Use ?type=manifest or ?type=sitemap." });
}
