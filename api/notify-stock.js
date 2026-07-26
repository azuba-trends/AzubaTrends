// api/notify-stock.js
//
// Backs the "Notify Me" button on product.html for out-of-stock products
// (see js/reviews.js's sibling module js/notify-stock.js on the frontend).
// Same shape as api/submit-review.js: guests can never write the
// `stock_notifications` collection directly from the browser (see
// firestore.rules) — this is the only path in, using the Admin SDK, so the
// simple rate-limit below can't be bypassed by hitting Firestore directly.
//
// NOTE: this only RECORDS interest. Actually emailing/texting people once
// the product is restocked is a separate job the store owner runs later
// (e.g. exporting this collection, or a future scheduled function) — not
// implemented here, since sending real notifications needs an email/SMS
// provider that hasn't been wired up yet.

import { getDb } from "../lib/firebase-admin.js";

const MAX_REQUESTS_PER_IP_PER_DAY = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

async function checkAndIncrementRateLimit(db, ip) {
  const crypto = await import("crypto");
  const today = new Date().toISOString().slice(0, 10);
  const ipHash = crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
  const ref = db.collection("notify_rate_limits").doc(`${ipHash}_${today}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data().count || 0) : 0;
    if (current >= MAX_REQUESTS_PER_IP_PER_DAY) return { allowed: false };
    tx.set(ref, { count: current + 1, lastSubmittedAt: new Date().toISOString() }, { merge: true });
    return { allowed: true };
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    console.error(err.message);
    return res.status(500).json({ error: "Not available right now. Please try again shortly." });
  }

  try {
    const { productId, productTitle, email, website } = req.body || {};

    // Honeypot — same pattern used across the rest of the site.
    if (website) return res.status(200).json({ ok: true });

    if (!productId || typeof productId !== "string") {
      return res.status(400).json({ error: "Missing product." });
    }
    const trimmedEmail = String(email || "").trim();
    if (!EMAIL_RE.test(trimmedEmail)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    const ip = getClientIp(req);
    const { allowed } = await checkAndIncrementRateLimit(db, ip);
    if (!allowed) {
      return res.status(429).json({ error: "Too many requests from this device today. Please try again tomorrow." });
    }

    // Don't stack up duplicate requests for the same product+email.
    const existing = await db.collection("stock_notifications")
      .where("productId", "==", productId)
      .where("email", "==", trimmedEmail.toLowerCase())
      .limit(1)
      .get();

    if (existing.empty) {
      await db.collection("stock_notifications").add({
        productId,
        productTitle: productTitle ? String(productTitle).slice(0, 200) : "",
        email: trimmedEmail.toLowerCase(),
        notified: false,
        createdAt: new Date().toISOString()
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
