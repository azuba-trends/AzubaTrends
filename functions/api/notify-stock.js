// functions/api/notify-stock.js
//
// Backs the "Notify Me" button on product.html for out-of-stock products
// (see js/reviews.js's sibling module js/notify-stock.js on the frontend).
// Same shape as api/submit-review.js: guests can never write the
// `stock_notifications` collection directly from the browser (see
// firestore.rules) — this is the only path in, using server-side Firestore
// REST calls, so the simple rate-limit below can't be bypassed by hitting
// Firestore directly.
//
// NOTE: this only RECORDS interest. Actually emailing/texting people once
// the product is restocked is a separate job the store owner runs later
// (e.g. exporting this collection, or a future scheduled function) — not
// implemented here, since sending real notifications needs an email/SMS
// provider that hasn't been wired up yet.

import { getDocs, createDoc, runTransaction, increment } from "../../lib/firestore-rest.js";

const MAX_REQUESTS_PER_IP_PER_DAY = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getClientIp(request) {
  // Cloudflare's own header is the most trustworthy source of the real
  // client IP on this platform (it's set by Cloudflare's edge itself, not
  // forwarded by an upstream we don't control) — prefer it over
  // x-forwarded-for, which Vercel's Node runtime relied on.
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

async function checkAndIncrementRateLimit(env, ip) {
  const today = new Date().toISOString().slice(0, 10);
  const ipHash = await sha256Hex(String(ip));
  const path = `notify_rate_limits/${ipHash.slice(0, 24)}_${today}`;

  return runTransaction(env, async (tx) => {
    const snap = await tx.get(path);
    const current = snap ? Number(snap.count || 0) : 0;
    if (current >= MAX_REQUESTS_PER_IP_PER_DAY) return { allowed: false };
    // increment(1) instead of re-reading-then-writing an explicit count:
    // it's the atomic primitive the contract gives us for exactly this
    // read-check-then-bump pattern, and it also transparently creates the
    // doc (with count starting from 0+1) on a brand-new IP+day combo,
    // since Firestore's PATCH/update semantics upsert by default.
    await tx.update(path, { count: increment(1), lastSubmittedAt: new Date().toISOString() });
    return { allowed: true };
  });
}

// Cloudflare Workers don't have Node's `crypto` module import the Vercel
// version used (`await import("crypto")`) — Web Crypto (globalThis.crypto)
// is available instead and is the standard way to hash on this runtime.
async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  try {
    const { productId, productTitle, email, website } = body || {};

    // Honeypot — same pattern used across the rest of the site.
    if (website) return json({ ok: true });

    if (!productId || typeof productId !== "string") {
      return json({ error: "Missing product." }, 400);
    }
    const trimmedEmail = String(email || "").trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      return json({ error: "Please enter a valid email address." }, 400);
    }

    const ip = getClientIp(request);
    const { allowed } = await checkAndIncrementRateLimit(env, ip);
    if (!allowed) {
      return json({ error: "Too many requests from this device today. Please try again tomorrow." }, 429);
    }

    // Don't stack up duplicate requests for the same product+email.
    const existing = await getDocs(env, "stock_notifications", {
      where: [
        ["productId", "==", productId],
        ["email", "==", trimmedEmail.toLowerCase()]
      ]
    });

    if (!existing || existing.length === 0) {
      // firestore-rest.js's createDoc requires an explicit doc ID (there's
      // no Firestore-style auto-ID "add" helper in the shared contract),
      // so we generate one ourselves the same way Firestore's client SDKs
      // do internally — a random ID, not anything derived from user input.
      const id = crypto.randomUUID();
      await createDoc(env, "stock_notifications", id, {
        productId,
        productTitle: productTitle ? String(productTitle).slice(0, 200) : "",
        email: trimmedEmail.toLowerCase(),
        notified: false,
        createdAt: new Date().toISOString()
      });
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
