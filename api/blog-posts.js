// api/blog-posts.js
//
// Same caching strategy as api/products.js (see that file's comment for
// the full explanation) — moves the blogPosts read server-side so Vercel's
// Edge Network can cache the JSON for ~60-90s instead of every visitor
// hitting Firestore directly from the browser.
//
// Only status == "published" posts are ever returned here — drafts stay
// invisible to the public site the same way inactive products do.

import { getDb } from "../lib/firebase-admin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = getDb();
    const snap = await db.collection("blogPosts").where("status", "==", "published").get();
    const posts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res.status(200).json({ posts, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("api/blog-posts failed:", err.message);
    return res.status(503).json({ error: "Blog service temporarily unavailable." });
  }
}
