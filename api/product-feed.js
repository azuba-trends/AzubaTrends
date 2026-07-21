// api/product-feed.js
//
// One CSV feed, two destinations: Google Merchant Center (for Google
// Shopping) and Meta Commerce Manager (for Instagram/Facebook Shop +
// dynamic catalog ads) both accept this same standard column set, so
// there's no need to maintain two separate feed formats. Give the same
// feed URL to both.
//
// Generated live from Firestore on every request (cached for 1 hour) so
// price/stock/availability changes show up automatically without anyone
// having to re-export or re-upload a file manually.
//
// Exposed at the clean URL /product-feed.csv via the rewrite in
// vercel.json.

import { getDb } from "../lib/firebase-admin.js";

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export default async function handler(req, res) {
  const host = req.headers.host;
  const baseUrl = `https://${host}`;

  const columns = [
    "id", "title", "description", "link", "image_link",
    "availability", "price", "condition", "brand", "product_type", "shipping"
  ];

  let rows = [];
  try {
    const db = getDb();
    const [productsSnap, categoriesSnap] = await Promise.all([
      db.collection("products").get(),
      db.collection("categories").get()
    ]);

    const categoryNameById = {};
    categoriesSnap.forEach((doc) => { categoryNameById[doc.id] = doc.data().name || doc.id; });

    productsSnap.forEach((doc) => {
      const p = doc.data();
      if (p.status !== "active") return; // don't advertise paused/unavailable products
      if (!p.title || p.sellingPrice === undefined) return; // skip incomplete records rather than submitting a bad row

      const stock = p.stock !== undefined && p.stock !== null ? Number(p.stock) : null;
      const availability = stock === null ? "in_stock" : stock > 0 ? "in_stock" : "out_of_stock";
      const image = (p.images && p.images[0]) || p.image || "";
      const categoryName = categoryNameById[p.category] || p.category || "";

      // Per-product shipping override for Merchant Center / Meta Commerce
      // Manager. Account-level setting stays "Free shipping" (matches the
      // common case, since most products have no deliveryFee), but any
      // product the admin DOES set a deliveryFee on gets its real cost
      // reported here instead — so the feed always matches what checkout.js
      // actually charges, no manual re-sync needed when admin changes it.
      // Format required by both platforms: "country::service:price".
      const deliveryFee = p.deliveryFee ? Number(p.deliveryFee) || 0 : 0;
      const shipping = `IN::Standard:${deliveryFee.toFixed(2)} INR`;

      rows.push([
        doc.id,
        p.title,
        (p.description || p.shortDescription || p.title || "").slice(0, 5000),
        p.slug ? `${baseUrl}/products/${encodeURIComponent(p.slug)}` : `${baseUrl}/product.html?id=${encodeURIComponent(doc.id)}`,
        image,
        availability,
        `${Number(p.sellingPrice).toFixed(2)} INR`,
        "new",
        p.brand || "",
        categoryName,
        shipping
      ]);
    });
  } catch (err) {
    console.error("product-feed: could not load products:", err.message);
    // Return headers-only CSV rather than a hard error — an empty feed is
    // handled gracefully by both Merchant Center and Meta (just reports
    // 0 items), whereas an HTTP error can get the whole feed source
    // flagged as broken.
  }

  const csv = [
    columns.join(","),
    ...rows.map((row) => row.map(csvEscape).join(","))
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  return res.status(200).send(csv);
}
