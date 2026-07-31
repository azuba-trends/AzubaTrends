// functions/api/list.js
//
// Cloudflare Pages Functions port of the old Vercel api/list.js. Same job,
// same response shape, same caching strategy — see that file's original
// header comment for the full "why one merged endpoint" explanation, which
// still applies as-is. Only the Firestore access layer changed: this now
// calls lib/firestore-rest.js (Firestore REST API over fetch()) instead of
// firebase-admin, because firebase-admin doesn't run in the Workers runtime.
//
// Routing: on Vercel this was reached via vercel.json rewrites
// (/api/products -> /api/list?type=products, /api/blog-posts ->
// /api/list?type=posts). Cloudflare Pages' _routes.json cannot express a
// query-string-appending rewrite like that (see _routes.json's own header
// comment and REPORT.md for why) — so /api/products and /api/blog-posts
// need their own small Pages Functions files that call the handlers below
// directly with a hardcoded `type`, OR something else on the team needs to
// wire that up. This file still answers /api/list?type=... today exactly
// like before, in case a redirect/rewrite mechanism does end up handling it.
//
// Frontend code (js/product-loader.js, js/blog-loader.js) is untouched.

import { getDoc, getDocs } from "../../lib/firestore-rest.js";
import { applyStoreMargin } from "../../lib/pricing.js";

// A deterministic pseudo-random order seeded by today's date + product id.
// Same order for every visitor all day (so the s-maxage=60 cache below
// stays meaningful), but reshuffles once the date rolls over — so across
// days, no product is permanently stuck first or always last. Customers
// can still override this with an explicit sort (price/rating/newest/
// bestselling) picked in the filter bar; this is only the *default*.
function fairDailyShuffle(products) {
  const daySeed = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return products
    .map((p) => {
      let hash = 0;
      const str = daySeed + p.id;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return { p, sortKey: hash };
    })
    .sort((a, b) => a.sortKey - b.sortKey)
    .map((x) => x.p);
}

function jsonResponse(body, { status = 200, cache = "public, s-maxage=60, stale-while-revalidate=30" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
    },
  });
}

async function handleProducts(env) {
  const [docs, settingsDoc] = await Promise.all([
    getDocs(env, "products", { where: [["status", "==", "active"]] }),
    getDoc(env, "settings/store_config"),
  ]);
  const settings = settingsDoc || {};

  // costPrice is internal-only (what the seller pays, used for profit
  // reports in the admin panel) and must never reach a customer's
  // browser — strip it here rather than trusting every future frontend
  // call site to remember not to display it.
  //
  // Parent "template" products (hasVariants:true) are never sellable
  // themselves — only their size/color variants are real, orderable
  // products — so they're excluded here too. Everything else (plain
  // products AND variant products, which are ordinary docs with
  // isVariant:true/parentId set) passes through untouched.
  // A variant doc (isVariant:true, parentId:<x>) is only a real, sellable
  // product as long as its parent "template" doc still exists — the parent
  // is what a shopper actually browses to get here (category/listing
  // pages only ever show the parent's card), and it's also where the admin
  // panel's product table anchors it (js/admin.js only renders variants
  // nested under their parent row). If the parent was ever deleted without
  // its children — e.g. the admin bulk-delete bug that only removed the
  // parent, or a manual Firestore edit — the child becomes an orphan:
  // still status:"active" in Firestore, but invisible/unmanageable from
  // the admin panel and with no listing card that could have linked to
  // it. Filtering those out here (rather than only fixing the bulk-delete
  // button) means any orphan created any other way is also hidden, not
  // just future ones from this one code path.
  const parentIds = new Set(docs.filter((d) => d.hasVariants).map((d) => d.id));
  let products = docs
    .filter((d) => !d.hasVariants)
    .filter((d) => !d.isVariant || parentIds.has(d.parentId))
    .map((d) => {
      const { costPrice, ratingSum, ratingCount, ...publicData } = d;
      // Store Margin markup applied here — this is what every shopper
      // sees as the product's price. mrp is left untouched.
      publicData.sellingPrice = applyStoreMargin(publicData.sellingPrice, settings);
      // rating/reviewCount computed here from the raw sum+count (kept off
      // the public payload) so a display-ready number goes out — same
      // pattern as the price margin above.
      publicData.rating = ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0;
      publicData.reviewCount = ratingCount || 0;
      // orderCount (bestseller signal) already public-safe, passes
      // through untouched via the spread above.
      return publicData;
    });

  products = fairDailyShuffle(products);

  return jsonResponse({ products, generatedAt: new Date().toISOString() });
}

async function handlePosts(env) {
  // Only status == "published" posts are ever returned here — drafts stay
  // invisible to the public site the same way inactive products do.
  const posts = await getDocs(env, "blogPosts", { where: [["status", "==", "published"]] });
  return jsonResponse({ posts, generatedAt: new Date().toISOString() });
}

async function handleCategories(env) {
  // No status/where filter — the whole `categories` collection is small
  // and public (see firestore.rules), same as the old direct-Firestore
  // read CategoryLoader used to do client-side. Serving it from here
  // instead just moves that read behind the same edge cache as
  // /api/products, so product.html's breadcrumb (which needs the full
  // category tree whenever a product has a categoryId) doesn't have to
  // wait on a slow browser->Firestore realtime channel anymore.
  const categories = await getDocs(env, "categories");
  return jsonResponse({ categories, generatedAt: new Date().toISOString() });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const type = new URL(request.url).searchParams.get("type");

  try {
    if (type === "products") return await handleProducts(env);
    if (type === "posts") return await handlePosts(env);
    if (type === "categories") return await handleCategories(env);
    return jsonResponse({ error: "Unknown or missing 'type' query param." }, { status: 400, cache: "no-store" });
  } catch (err) {
    console.error(`api/list (type=${type}) failed:`, err.message);
    // Fail with a normal error response (not a 500 HTML page) so the
    // frontend's fallback-to-Firestore logic can detect this cleanly and
    // still work even if the service account isn't configured yet.
    const service = type === "posts" ? "Blog" : type === "categories" ? "Category" : "Products";
    return jsonResponse(
      { error: `${service} service temporarily unavailable.` },
      { status: 503, cache: "no-store" }
    );
  }
}
