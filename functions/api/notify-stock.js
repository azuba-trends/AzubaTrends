// functions/api/notify-stock.js
//
// Backs the "Notify Me" button on product.html for out-of-stock products.
// Same shape as api/submit-review.js: guests can never write the
// `stock_notifications` collection directly from the browser (see
// firestore.rules) — this is the only path in, using server-side Firestore
// REST calls, so the simple rate-limit below can't be bypassed by hitting
// Firestore directly.
//
// Push-based (not email): the "device" here is the same per-browser
// azuba_device_id already used for order-status push (see
// js/layout.js's getDeviceId()) and js/push-subscribe's push_subscriptions
// collection. A tap on "Notify Me" subscribes the browser to push (if not
// already) and records ONE waiting-list row here. When the admin later
// brings the product back in stock (js/admin.js's handleProductSave),
// functions/api/notify-restock.js looks up every waiting row for that
// product, pushes "Back in Stock" to each device, and clears the rows —
// no email/SMS provider needed, and nothing for the admin or the customer
// to do beyond what they were already doing (saving stock / tapping the
// button once).

import { getDocs, createDoc, runTransaction, increment } from "../../lib/firestore-rest.js";

const MAX_REQUESTS_PER_IP_PER_DAY = 10;

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
    const { productId, productTitle, productUrl, deviceId, website } = body || {};

    // Honeypot — same pattern used across the rest of the site.
    if (website) return json({ ok: true });

    if (!productId || typeof productId !== "string") {
      return json({ error: "Missing product." }, 400);
    }
    if (!deviceId || typeof deviceId !== "string") {
      // Storage disabled / private browsing — js/layout.js's getDeviceId()
      // can return null in that case. Nothing to key the waiting-list row
      // on, so fail clearly instead of silently recording a useless row.
      return json({ error: "Couldn't enable notifications on this browser. Please check your browser settings and try again." }, 400);
    }

    const ip = getClientIp(request);
    const { allowed } = await checkAndIncrementRateLimit(env, ip);
    if (!allowed) {
      return json({ error: "Too many requests from this device today. Please try again tomorrow." }, 429);
    }

    // Don't stack up duplicate waiting-list rows for the same product+device.
    const existing = await getDocs(env, "stock_notifications", {
      where: [
        ["productId", "==", productId],
        ["deviceId", "==", deviceId],
        ["notified", "==", false]
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
        productUrl: productUrl ? String(productUrl).slice(0, 300) : "/",
        deviceId,
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
