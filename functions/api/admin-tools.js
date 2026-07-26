// functions/api/admin-tools.js
//
// *** RECONSTRUCTED BY THE MIGRATION MANAGER ***
// Worker 3's REPORT.md describes converting this file in detail (see
// "Status by file" -> admin-tools.js), but the actual file was missing
// from the delivered zip. This file has been rebuilt from the original
// api/admin-tools.js plus Worker 3's written description of exactly what
// changed, so behavior matches what was reported. If Worker 3 still has
// the real file, diff it against this one before deploying — this is a
// reconstruction, not a verified-identical copy.
//
// Admin-only order-tools endpoint (?action=). Auth via lib/auth.js's
// requireAdmin(), which wraps the shared contract's verifyIdToken(). No
// public path to this endpoint.
//
// GET ?action=recalc-ratings   -> fully converted, works as before.
// GET ?action=invoice&orderId= -> NOT implemented (see risk write-up below).
// GET ?action=invoice-bulk     -> NOT implemented (see risk write-up below).
//
// ---------------------------------------------------------------------
// WHY invoice / invoice-bulk return 501 instead of a converted pdfkit/
// archiver implementation (per Worker 3's REPORT.md):
//
// pdfkit was built for Node streams and is not a safe drop-in for
// Cloudflare Workers — it can load under the nodejs_compat flag, but has
// real, reported limitations (font/layout issues) once you go past basic
// text, and this was never exercised against a real Worker in this
// migration. archiver pulls in Node's stream/zlib/fs and is NOT expected
// to work on Workers at all.
//
// Recommended replacement (Worker 3's recommendation, not yet built):
//   - Invoice drawing: rewrite `drawInvoice()` against `pdf-lib` (pure JS,
//     confirmed working on Workers, no nodejs_compat flag). Since the
//     original drawInvoice() already does its own manual x/y positioning
//     rather than relying on pdfkit's auto text-flow, this is a bounded
//     rewrite, not a redesign — the Indian-numbering/currency helpers
//     below need zero changes either way.
//   - Bulk ZIP: swap `archiver` for `fflate`'s `zipSync()` (pure JS,
//     confirmed working on Workers). Build a { "Invoice-<id>.pdf":
//     Uint8Array } map as each PDF is generated in memory, then one
//     zipSync(files) call. Flag: zipSync builds the whole archive in
//     memory before returning it (no streaming start like archiver had),
//     so a store with a very large order count could hit a Worker's
//     memory/CPU-time limit — size this against real order-count
//     expectations, and consider batching into multiple ZIPs or an
//     R2-backed job if this store ever has thousands of orders.
//
// The pure numeric helpers below (amountToWords etc.) have ZERO pdfkit
// dependency and are carried over unchanged, ready for whichever PDF
// approach is picked to reuse without a rewrite.
// ---------------------------------------------------------------------

import { getDocs, batchWrite } from "../../lib/firestore-rest.js";
import { requireAdmin } from "../../lib/auth.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// ---------------------------------------------------------------------
// Number -> Indian-English words (unchanged from the original — pure
// math, no Node/Firestore dependency). Kept here, unused for now, so
// whichever pdf-lib rewrite happens later doesn't have to reproduce it.
// ---------------------------------------------------------------------
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}
function threeDigitWords(n) {
  if (n < 100) return twoDigitWords(n);
  return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigitWords(n % 100) : "");
}
function integerToWordsIndian(n) {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const rest = n;
  let parts = [];
  if (crore) parts.push(threeDigitWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitWords(thousand) + " Thousand");
  if (rest) parts.push(threeDigitWords(rest));
  return parts.join(" ");
}
function amountToWords(amount) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  let words = "Rupees " + integerToWordsIndian(rupees);
  if (paise > 0) words += " and " + twoDigitWords(paise) + " Paise";
  return words + " Only";
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

    if (action === "invoice" || action === "invoice-bulk") {
      return json(
        {
          error:
            "Invoice generation is not available on this deployment yet. " +
            "pdfkit/archiver (the original Node-based PDF/ZIP libraries) are not " +
            "safe to run as-is on Cloudflare Workers — this needs a rewrite against " +
            "pdf-lib (invoices) and fflate's zipSync (bulk ZIP) before it can ship. " +
            "See functions/api/admin-tools.js's header comment for the full plan."
        },
        501
      );
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

// Exported for the future pdf-lib rewrite, so it doesn't need to
// reimplement Indian-numbering currency formatting from scratch.
export { amountToWords, integerToWordsIndian };
