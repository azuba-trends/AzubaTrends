// functions/api/product-feed.js
//
// CLOUDFLARE PAGES FUNCTIONS PORT of api/product-feed.js.
// Output CSV, headers, and behavior are unchanged from the Vercel version
// — only the data-access layer and request/response plumbing have been
// swapped. lib/pricing.js itself needed NO changes — applyStoreMargin()
// is a pure function with no Node/Firebase APIs, so it's carried over
// as-is.
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
// Exposed at the clean URL /product-feed.csv via a rewrite (routing
// config outside this worker's scope — see the note in api/page.js).

import { getDocs, getDoc } from "../../lib/firestore-rest.js";
import { applyStoreMargin } from "../../lib/pricing.js";

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  const columns = [
    "id", "title", "description", "link", "image_link",
    "availability", "price", "condition", "brand", "product_type", "shipping",
    "item_group_id", "color", "size"
  ];

  let rows = [];
  try {
    const [products, categories, settingsDoc] = await Promise.all([
      getDocs(env, "products", {}),
      getDocs(env, "categories", {}),
      getDoc(env, "settings/store_config")
    ]);
    const feedSettings = settingsDoc || {};

    const categoryNameById = {};
    categories.forEach((c) => { categoryNameById[c.id] = c.name || c.id; });

    products.forEach((p) => {
      if (p.status !== "active") return; // don't advertise paused/unavailable products
      if (p.hasVariants) return; // parent is a template only, never itself a real orderable item
      if (!p.title || p.sellingPrice === undefined) return; // skip incomplete records rather than submitting a bad row

      const stock = p.stock !== undefined && p.stock !== null ? Number(p.stock) : null;
      const availability = (p.paused === true) ? "out_of_stock" : (stock === null ? "in_stock" : stock > 0 ? "in_stock" : "out_of_stock");
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

      // item_group_id / color / size: the standard Google Merchant Center
      // + Meta Commerce Manager fields for tying size/color variants of
      // the same product together in Shopping/Instagram catalogs — set
      // to the parent's id for a variant, left blank for a plain product.
      const link = (p.isVariant && p.parentId && p.variantSlug)
        ? `${baseUrl}/products/${encodeURIComponent(p.parentId)}/${encodeURIComponent(p.variantSlug)}`
        : (p.slug ? `${baseUrl}/products/${encodeURIComponent(p.slug)}` : `${baseUrl}/product.html?id=${encodeURIComponent(p.id)}`);

      rows.push([
        p.id,
        p.title,
        (p.description || p.shortDescription || p.title || "").slice(0, 5000),
        link,
        image,
        availability,
        `${applyStoreMargin(p.sellingPrice, feedSettings).toFixed(2)} INR`,
        "new",
        p.brand || "",
        categoryName,
        shipping,
        p.isVariant ? p.parentId : "",
        p.color || "",
        p.size || ""
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

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
