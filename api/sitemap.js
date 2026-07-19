// api/sitemap.js
//
// Generates sitemap.xml on the fly from whatever is actually in Firestore
// right now — products and categories. This means it's always accurate
// (a new product shows up in the sitemap automatically, a deleted one
// disappears) without anyone having to remember to regenerate a static
// file. Exposed at the clean URL /sitemap.xml via the rewrite in
// vercel.json, which is the URL to give Google Search Console.

import { getDb } from "../lib/firebase-admin.js";

function xmlEscape(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async function handler(req, res) {
  const host = req.headers.host;
  const baseUrl = `https://${host}`;

  const staticUrls = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/category.html", priority: "0.7", changefreq: "weekly" },
    { loc: "/about.html", priority: "0.4", changefreq: "monthly" },
    { loc: "/terms.html", priority: "0.3", changefreq: "monthly" }
  ];

  let productUrls = [];
  let categoryUrls = [];

  try {
    const db = getDb();

    const productsSnap = await db.collection("products").get();
    productsSnap.forEach((doc) => {
      const p = doc.data();
      if (p.status !== "active") return; // paused/deleted products shouldn't be indexed
      productUrls.push({
        loc: `/product.html?id=${encodeURIComponent(doc.id)}`,
        priority: "0.8",
        changefreq: "weekly",
        lastmod: p.updatedAt || p.createdAt || undefined
      });
    });

    const categoriesSnap = await db.collection("categories").get();
    categoriesSnap.forEach((doc) => {
      const c = doc.data();
      categoryUrls.push({
        loc: `/category.html?category=${encodeURIComponent(c.name || doc.id)}`,
        priority: "0.6",
        changefreq: "weekly"
      });
    });
  } catch (err) {
    // If Firestore/service-account isn't reachable, still return a valid
    // (if smaller) sitemap with just the static pages, rather than a
    // broken response — Search Console handles a small sitemap fine, but
    // a malformed one gets the whole submission flagged.
    console.error("sitemap: could not load products/categories:", err.message);
  }

  const allUrls = [...staticUrls, ...categoryUrls, ...productUrls];

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
  res.setHeader("Cache-Control", "public, max-age=3600"); // 1 hour — sitemap doesn't need to be second-fresh
  return res.status(200).send(body);
}
