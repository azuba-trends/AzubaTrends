// api/products.js
//
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------
// Previously every page (index.html, category.html, product.html...)
// opened the Firebase client SDK straight from the browser and read the
// whole `products` collection directly from Firestore, every single page
// load — no caching at all beyond a single in-tab JS variable that's
// thrown away the moment the shopper clicks to another page.
//
// This endpoint moves that read to the server and lets Vercel's Edge
// Network cache the JSON response for everyone:
//   - Cache-Control: s-maxage=60, stale-while-revalidate=30
//     -> Vercel serves the cached copy for 60s without touching Firestore
//        at all. For the next 30s after that, it still serves the (now
//        "stale") cached copy INSTANTLY while quietly re-fetching a fresh
//        copy in the background for the next visitor.
//   - There is no per-product manual purge here (that needs a framework
//     like Next.js with on-demand ISR, which this project isn't). The
//     short TTL is the whole mechanism: any product edit in Admin Panel
//     shows up for every shopper within, worst case, ~60-90 seconds,
//     completely automatically — nobody has to clear anything, and nobody
//     can ever be shown data older than that window.
// This is deliberately simple and safe over "clever": no client-side
// cache is used anywhere, so there is no risk of a shopper's browser
// showing a wrong price/stock number indefinitely.
//
// Frontend usage: js/product-loader.js fetches this endpoint first, and
// only falls back to the old direct-Firestore-from-browser path if this
// route isn't available (e.g. hosted somewhere without serverless
// functions, like a plain static export).

import { getDb } from "../lib/firebase-admin.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const db = getDb();
    const snap = await db.collection("products").where("status", "==", "active").get();
    const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // See the big comment above — this is the entire caching strategy.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res.status(200).json({ products, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error("api/products failed:", err.message);
    // Fail with a normal error response (not a 500 HTML page) so the
    // frontend's fallback-to-Firestore logic can detect this cleanly and
    // still work even if the service account isn't configured yet.
    return res.status(503).json({ error: "Products service temporarily unavailable." });
  }
}
