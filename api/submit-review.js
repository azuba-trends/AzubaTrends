// api/submit-review.js
//
// The only path a guest review can be created through now (see
// firestore.rules — direct browser writes to `reviews` are no longer
// allowed). This exists specifically to make the protections in
// lib/submit-review-guard.js unbypassable: they run here, server-side,
// where nobody can skip past them by opening DevTools and hitting
// Firestore directly.

import { getDb } from "../lib/firebase-admin.js";
import { containsProfanity, validateCommentLength, checkAndIncrementRateLimit } from "../lib/submit-review-guard.js";
import { dispatchTelegramEvent } from "../lib/telegram.js";

function getClientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
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
    return res.status(500).json({ error: "Reviews aren't available right now. Please try again shortly." });
  }

  try {
    const { productId, rating, comment, imageUrl, website } = req.body || {};

    // Honeypot — a real visitor never fills this field in. Silently
    // "succeed" (don't tip off a bot that it was caught) rather than
    // returning an error.
    if (website) {
      return res.status(200).json({ ok: true });
    }

    if (!productId || typeof productId !== "string") {
      return res.status(400).json({ error: "Missing product." });
    }

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "Please select a rating between 1 and 5 stars." });
    }

    const trimmedComment = String(comment || "").trim();
    const lengthError = validateCommentLength(trimmedComment);
    if (lengthError) {
      return res.status(400).json({ error: lengthError });
    }

    if (containsProfanity(trimmedComment)) {
      return res.status(400).json({
        error: "Your review contains language we don't allow. Strong opinions about the product are totally fine — please just remove any abusive words and resubmit."
      });
    }

    if (imageUrl && typeof imageUrl !== "string") {
      return res.status(400).json({ error: "Invalid image." });
    }

    // Rate limit — per IP, per day.
    const ip = getClientIp(req);
    const { allowed } = await checkAndIncrementRateLimit(db, ip);
    if (!allowed) {
      return res.status(429).json({ error: "You've submitted the maximum number of reviews for today. Please try again tomorrow." });
    }

    const review = {
      productId,
      rating: ratingNum,
      comment: trimmedComment,
      imageUrl: imageUrl || null,
      authorLabel: "Guest", // placeholder — replaced right below with a unique tag
      date: new Date().toISOString()
    };

    const docRef = await db.collection("reviews").add(review);

    // Give this reviewer a unique, stable display label ("Guest #A1B2")
    // instead of every review just saying "Guest" — derived from the
    // Firestore document's own ID, so two reviewers never collide.
    const guestTag = docRef.id.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
    review.authorLabel = `Guest #${guestTag}`;
    await docRef.update({ authorLabel: review.authorLabel });

    // Best-effort Telegram alert — never blocks or fails the review, which
    // already saved successfully above.
    let productTitle = productId;
    try {
      const productDoc = await db.collection("products").doc(productId).get();
      if (productDoc.exists) productTitle = productDoc.data().title || productId;
    } catch (err) { /* non-fatal, fall back to productId */ }

    const host = req.headers.host;
    await dispatchTelegramEvent(db, "new_review", {
      productId,
      productTitle,
      rating: ratingNum,
      comment: trimmedComment,
      productUrl: host ? `https://${host}/product.html?id=${encodeURIComponent(productId)}` : null
    });

    return res.status(200).json({ ok: true, id: docRef.id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong submitting your review. Please try again." });
  }
}
