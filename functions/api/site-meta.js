// functions/api/site-meta.js
//
// Cloudflare Pages Functions port of the old Vercel api/site-meta.js
// (itself a merge of the original api/manifest.js + api/sitemap.js — see
// that file's original header comment, kept below for context, which
// still applies as-is). Only the Firestore access layer changed: this now
// calls lib/firestore-rest.js instead of firebase-admin.
//
// Dispatched by ?type=:
//   - type=manifest -> manifest.webmanifest behavior
//   - type=sitemap   -> sitemap.xml behavior
//
// Routing note: on Vercel, /manifest.webmanifest and /sitemap.xml reached
// this file via vercel.json query-string rewrites. Cloudflare Pages'
// _routes.json can't express that (see _routes.json's header comment and
// REPORT.md) — the clean fix is a functions/manifest.webmanifest.js and a
// functions/sitemap.xml.js that each call the matching handler below
// directly (Pages Functions map file path -> URL path 1:1, so a literal
// dotted filename like that works and needs no rewrite at all). That's
// outside this file's scope; flagging it for whoever wires up routing.
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

import { getDoc, getDocs } from "../../lib/firestore-rest.js";

function xmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function handleManifest(env) {
  let storeName = "AzubaTrends";
  let themeColor = "#1F3A5F";

  try {
    const settings = await getDoc(env, "settings/store_config");
    if (settings) {
      storeName = settings.storeName || storeName;
      themeColor = settings.themeColor || themeColor;
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
      { src: "/images/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function handleSitemap(request, env) {
  const host = new URL(request.url).host;
  const baseUrl = `https://${host}`;

  const staticUrls = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/category", priority: "0.7", changefreq: "weekly" },
    { loc: "/blog", priority: "0.6", changefreq: "weekly" },
  ];

  let blogUrls = [];
  let productUrls = [];
  let categoryUrls = [];
  let blogCategoryUrls = [];
  let pageUrls = [];

  try {
    const [products, categories, blogPosts, blogCategories, pages] = await Promise.all([
      getDocs(env, "products"),
      getDocs(env, "categories"),
      getDocs(env, "blogPosts", { where: [["status", "==", "published"]] }),
      getDocs(env, "blogCategories"),
      getDocs(env, "pages", { where: [["status", "==", "published"]] }),
    ]);

    for (const p of products) {
      if (p.status !== "active") continue;
      if (p.hasVariants) continue; // parent is a template only, never itself a real page
      const loc =
        p.isVariant && p.parentId && p.variantSlug
          ? `/products/${encodeURIComponent(p.parentId)}/${encodeURIComponent(p.variantSlug)}`
          : p.slug
          ? `/products/${encodeURIComponent(p.slug)}`
          : `/product.html?id=${encodeURIComponent(p.id)}`;
      productUrls.push({
        loc,
        priority: "0.8",
        changefreq: "weekly",
        lastmod: p.updatedAt || p.createdAt || undefined,
      });
    }

    // Nested-category fullPath resolution — mirrors admin.js/category-
    // loader.js's parentId walk. Tolerant of categories that haven't been
    // through the admin-panel migration yet (no `parentId` key): those
    // just fall back to their own stored `slug`, same as before.
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    function resolveCategoryFullPath(cat) {
      if (cat.fullPath) return cat.fullPath;
      if (cat.parentId === undefined) return cat.slug || cat.id; // legacy, un-migrated
      const seen = new Set();
      const parts = [];
      let cur = cat;
      while (cur) {
        if (seen.has(cur.id)) break;
        seen.add(cur.id);
        parts.unshift(cur.slug || cur.id);
        cur = cur.parentId ? categoryById.get(cur.parentId) : null;
      }
      return parts.join("/");
    }
    for (const c of categories) {
      categoryUrls.push({
        loc: `/category/${resolveCategoryFullPath(c)}`,
        priority: "0.6",
        changefreq: "weekly",
      });
    }

    for (const p of blogPosts) {
      if (!p.slug) continue;
      blogUrls.push({
        loc: `/blog/${encodeURIComponent(p.slug)}`,
        priority: "0.5",
        changefreq: "monthly",
        lastmod: p.updatedAt || p.createdAt || undefined,
      });
    }

    for (const c of blogCategories) {
      blogCategoryUrls.push({
        loc: `/blog/category/${encodeURIComponent(c.slug || c.id)}`,
        priority: "0.5",
        changefreq: "weekly",
      });
    }

    for (const p of pages) {
      if (!p.slug || p.slug === "home" || p.slug === "404") continue;
      pageUrls.push({
        loc: `/${encodeURIComponent(p.slug)}`,
        priority: p.isDefault ? "0.5" : "0.6",
        changefreq: "monthly",
        lastmod: p.updatedAt || p.createdAt,
      });
    }
  } catch (err) {
    console.error(
      "site-meta(sitemap): could not load products/categories/blogCategories/pages:",
      err.message
    );
  }

  const allUrls = [...staticUrls, ...categoryUrls, ...productUrls, ...blogUrls, ...blogCategoryUrls, ...pageUrls];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${xmlEscape(baseUrl + u.loc)}</loc>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>${
      u.lastmod ? `\n    <lastmod>${xmlEscape(new Date(u.lastmod).toISOString().slice(0, 10))}</lastmod>` : ""
    }
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const type = new URL(request.url).searchParams.get("type");

  if (type === "manifest") return handleManifest(env);
  if (type === "sitemap") return handleSitemap(request, env);
  return new Response(
    JSON.stringify({ error: "Unknown or missing type. Use ?type=manifest or ?type=sitemap." }),
    { status: 400, headers: { "Content-Type": "application/json; charset=utf-8" } }
  );
}
