// functions/api/product.js
//
// Single-product fast path for product.html. Before this file existed,
// opening a product page meant: download the ENTIRE /api/products catalog
// (already edge-cached, but still every product's full payload) just to
// Array.find() one of them client-side, THEN separately wait on
// CategoryLoader (a direct browser->Firestore read) to resolve the
// breadcrumb. That's what caused the visible "image/title/price show up,
// then a beat later the breadcrumb pops in" delay.
//
// This endpoint answers with exactly what one product page needs — the
// product itself, every doc that shares its parentId (so the size/color
// selector never needs a second request), and the breadcrumb chain already
// resolved server-side — in a single Firestore round trip pair (product
// query + categories query, run in parallel). Cached at the edge the same
// way /api/products and /api/categories already are, so this doesn't add
// any new caching strategy to reason about.
//
// Query params (send exactly one lookup):
//   ?slug=<product-slug>              plain product, or a variant that has
//                                      its own flat slug (legacy links)
//   ?parentId=<id>&variantSlug=<slug> a color/size group — returns every
//                                      doc sharing parentId (every size AND
//                                      every other color) in one call
//   ?id=<docId>                       legacy ?id= links
//
// js/product-loader.js tries this first and falls back to the old
// full-catalog path (loadAllProducts + Array.find) if this 404s/503s, so a
// stale deploy or a lookup this endpoint doesn't recognize never breaks the
// page — it just loses the speed-up.

import { getDoc, getDocs } from "../../lib/firestore-rest.js";
import { applyStoreMargin } from "../../lib/pricing.js";

function jsonResponse(body, { status = 200, cache = "public, s-maxage=60, stale-while-revalidate=30" } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache,
    },
  });
}

// Same public-safety transform as functions/api/list.js's handleProducts —
// kept in sync with that one on purpose (costPrice must never leave the
// server, rating/reviewCount are computed the same way everywhere).
function sanitize(doc, settings) {
  const { costPrice, ratingSum, ratingCount, ...publicData } = doc;
  publicData.sellingPrice = applyStoreMargin(publicData.sellingPrice, settings);
  publicData.rating = ratingCount ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0;
  publicData.reviewCount = ratingCount || 0;
  return publicData;
}

// Mirrors js/category-loader.js's computeFullPath/breadcrumbChain exactly
// (kept as a small local copy rather than a shared import — this is a tiny
// amount of logic and the two run in different JS module worlds, browser
// vs Workers runtime).
function computeFullPath(catId, byId) {
  const seen = new Set();
  const parts = [];
  let cur = byId.get(catId);
  while (cur) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    parts.unshift(cur.slug || cur.id);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return parts.join("/");
}

function buildBreadcrumb(categoryId, categories) {
  if (!categoryId) return [];
  const byId = new Map(categories.map((c) => [c.id, c]));
  const chain = [];
  const seen = new Set();
  let cur = byId.get(categoryId);
  while (cur) {
    if (seen.has(cur.id)) break;
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return chain.map((c) => ({
    id: c.id,
    name: c.name,
    fullPath: c.fullPath || computeFullPath(c.id, byId),
  }));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const parentId = url.searchParams.get("parentId");
  const variantSlug = url.searchParams.get("variantSlug");
  const id = url.searchParams.get("id");

  if (!slug && !id && !(parentId && variantSlug)) {
    return jsonResponse(
      { error: "Provide slug, id, or parentId+variantSlug." },
      { status: 400, cache: "no-store" }
    );
  }

  try {
    const settingsPromise = getDoc(env, "settings/store_config");
    const categoriesPromise = getDocs(env, "categories");

    let matches = [];
    if (parentId) {
      // One query gets the WHOLE group — every size of every color that
      // shares this parent — which covers both "resolve this exact
      // variantSlug" and "what are the other colors for the selector"
      // in a single Firestore round trip.
      matches = await getDocs(env, "products", {
        where: [
          ["parentId", "==", parentId],
          ["isVariant", "==", true],
        ],
      });
    } else if (slug) {
      matches = await getDocs(env, "products", { where: [["slug", "==", slug]] });
    } else if (id) {
      const single = await getDoc(env, `products/${id}`);
      matches = single ? [single] : [];
    }

    matches = matches.filter((d) => d.status === "active");
    if (matches.length === 0) {
      return jsonResponse({ error: "Product not found." }, { status: 404, cache: "no-store" });
    }

    const [settingsDoc, categories] = await Promise.all([settingsPromise, categoriesPromise]);
    const settings = settingsDoc || {};
    const products = matches.map((d) => sanitize(d, settings));

    // Which one is "the" product for this request:
    //  - slug/id lookup: the single match.
    //  - parentId+variantSlug lookup: the requested color's group. The
    //    client (ProductLoader.pickDefaultVariant) still picks the exact
    //    default size the same way it always has — this just saves it
    //    from having to fetch the group in the first place.
    let product = products[0];
    if (parentId) {
      const group = products.filter((p) => p.variantSlug === variantSlug);
      if (group.length > 0) product = group[0];
    }

    const breadcrumb = buildBreadcrumb(product ? product.categoryId : null, categories);

    return jsonResponse({
      product,
      siblings: products,
      breadcrumb,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("api/product failed:", err.message);
    return jsonResponse(
      { error: "Product service temporarily unavailable." },
      { status: 503, cache: "no-store" }
    );
  }
}
