// functions/api/admin-tools.js
//
// Admin-only order-tools endpoint (?action=). Auth via lib/auth.js's
// requireAdmin(), which wraps the shared contract's verifyIdToken(). No
// public path to this endpoint.
//
// GET ?action=recalc-ratings   -> unchanged from the original.
// GET ?action=invoice&orderId= -> streams back one order's invoice as a PDF.
// GET ?action=invoice-bulk     -> streams back a ZIP of every order's invoice.
//
// ---------------------------------------------------------------------
// PDF/ZIP GENERATION (Cloudflare Workers-safe)
//
// The original Vercel version used `pdfkit` (Node-stream based) and
// `archiver` (pulls in Node's stream/zlib/fs) — neither is safe on
// Cloudflare Workers. This version uses:
//   - `pdf-lib` for invoice drawing (see lib/invoice.js — pure JS,
//     confirmed working on Workers, no nodejs_compat flag needed).
//   - `fflate`'s `zipSync()` for the bulk ZIP (pure JS, also
//     Workers-safe). Both are declared in package.json.
//
// zipSync builds the whole archive in memory before returning it (no
// streaming start the way `archiver` had) — fine for a normal store's
// order volume, but if this store ever has thousands of orders, watch
// Worker CPU-time/memory limits and consider batching into multiple ZIPs
// or moving to an R2-backed background job instead.
// ---------------------------------------------------------------------

import { getDoc, getDocs, batchWrite } from "../../lib/firestore-rest.js";
import { requireAdmin } from "../../lib/auth.js";
import { generateInvoicePdf } from "../../lib/invoice.js";
import { zipSync } from "fflate";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function loadSettings(env) {
  const settings = await getDoc(env, "settings/store_config");
  return settings || {};
}

// ---------------------------------------------------------------------
// action=recalc-ratings — fully converted.
// Same "fully overwrite, never increment" semantics as the original, so
// re-running this is always safe and can never double-count. Original
// used db.batch()/batch.commit() in chunks of 400 (Firestore's write
// limit per batch/commit is 500) — same chunking here via batchWrite().
// ---------------------------------------------------------------------
async function recalcRatings(env) {
  const reviews = await getDocs(env, "reviews", {});
  const totals = {}; // productId -> { sum, count }
  for (const r of reviews || []) {
    if (!r.productId) continue;
    const rating = Number(r.rating) || 0;
    if (!totals[r.productId]) totals[r.productId] = { sum: 0, count: 0 };
    totals[r.productId].sum += rating;
    totals[r.productId].count += 1;
  }

  const productIds = Object.keys(totals);
  // A review can outlive the product it was for (product later deleted).
  // The shared contract's batchWrite is atomic (all-or-nothing per call —
  // see lib/firestore-rest.js's REPORT.md note), so an update targeting a
  // now-missing product doc would fail that WHOLE chunk's commit, not
  // just that one write. Filter orphaned productIds out first, same as
  // the original did for its own (different) reason.
  const existingProducts = await getDocs(env, "products", {});
  const existingIds = new Set((existingProducts || []).map((p) => p.id));
  const validProductIds = productIds.filter((pid) => existingIds.has(pid));

  const batchSize = 400;
  for (let i = 0; i < validProductIds.length; i += batchSize) {
    const chunk = validProductIds.slice(i, i + batchSize);
    await batchWrite(
      env,
      chunk.map((pid) => ({
        type: "update",
        path: `products/${pid}`,
        data: { ratingSum: totals[pid].sum, ratingCount: totals[pid].count }
      }))
    );
  }

  return json({ ok: true, productsUpdated: validProductIds.length });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    await requireAdmin(request, env);
  } catch (err) {
    return json({ error: "Unauthorized: " + err.message }, 401);
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    if (action === "recalc-ratings") {
      return await recalcRatings(env);
    }

    if (action === "invoice") {
      const orderId = searchParams.get("orderId");
      if (!orderId) return json({ error: "Missing orderId" }, 400);
      const [order, settings] = await Promise.all([
        getDoc(env, `orders/${orderId}`),
        loadSettings(env)
      ]);
      if (!order) return json({ error: "Order not found" }, 404);
      const pdfBytes = await generateInvoicePdf(order, settings);
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="Invoice-${order.orderId}.pdf"`
        }
      });
    }

    if (action === "invoice-bulk") {
      const [orders, settings] = await Promise.all([
        getDocs(env, "orders", {}),
        loadSettings(env)
      ]);
      if (!orders || orders.length === 0) return json({ error: "No orders found" }, 404);

      const files = {};
      for (const order of orders) {
        try {
          const pdfBytes = await generateInvoicePdf(order, settings);
          files[`Invoice-${order.orderId || order.id}.pdf`] = pdfBytes;
        } catch (err) {
          console.error(`admin-tools: failed to generate invoice for order ${order.id}:`, err.message);
          // Skip this one order rather than failing the whole ZIP — one
          // malformed order shouldn't block every other invoice.
        }
      }

      const zipBytes = zipSync(files, { level: 6 });
      return new Response(zipBytes, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="Invoices-${new Date().toISOString().slice(0, 10)}.zip"`
        }
      });
    }

    return json(
      { error: "Unknown or missing action. Use ?action=recalc-ratings, ?action=invoice&orderId=..., or ?action=invoice-bulk" },
      400
    );
  } catch (err) {
    console.error("admin-tools error:", err);
    return json({ error: "Something went wrong running this admin action." }, 500);
  }
}
