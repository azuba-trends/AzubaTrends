// api/list.js
//
// Merged replacement for the old api/products.js + api/blog-posts.js.
// Both did the exact same job for a different collection (move a public
// read off the client-side Firebase SDK so Vercel's Edge Network can
// cache the JSON response for ~60-90s instead of every visitor hitting
// Firestore directly from the browser — see the original files' comments
// for the full caching-strategy explanation, which still applies as-is).
//
// Combined into one function so the project stays under Vercel Hobby's
// 12-serverless-function cap. Routing is via a `type` query param set by
// the matching vercel.json rewrite:
//   /api/products   -> /api/list?type=products
//   /api/blog-posts -> /api/list?type=posts
//
// Frontend code (js/product-loader.js, js/blog-loader.js) is untouched —
// it still fetches "/api/products" and "/api/blog-posts" exactly as
// before; the rewrite above is what points those URLs at this file.

import { getDb } from "../lib/firebase-admin.js";

async function handleProducts(req, res) {
  const db = getDb();
  const snap = await db.collection("products").where("status", "==", "active").get();
  const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
  return res.status(200).json({ products, generatedAt: new Date().toISOString() });
}

async function handlePosts(req, res) {
  const db = getDb();
  // Only status == "published" posts are ever returned here — drafts stay
  // invisible to the public site the same way inactive products do.
  const snap = await db.collection("blogPosts").where("status", "==", "published").get();
  const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
  return res.status(200).json({ posts, generatedAt: new Date().toISOString() });
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type } = req.query;

  try {
    if (type === "products") return await handleProducts(req, res);
    if (type === "posts") return await handlePosts(req, res);
    return res.status(400).json({ error: "Unknown or missing 'type' query param." });
  } catch (err) {
    console.error(`api/list (type=${type}) failed:`, err.message);
    // Fail with a normal error response (not a 500 HTML page) so the
    // frontend's fallback-to-Firestore logic can detect this cleanly and
    // still work even if the service account isn't configured yet.
    const service = type === "posts" ? "Blog" : "Products";
    return res.status(503).json({ error: `${service} service temporarily unavailable.` });
  }
}
