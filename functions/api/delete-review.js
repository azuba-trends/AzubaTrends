// functions/api/delete-review.js
//
// Lets a guest delete a review they submitted — the only path a review can
// be deleted through (see firestore.rules — direct browser deletes to
// `reviews` aren't allowed; this uses the service account, same pattern as
// submit-review.js).
//
// There's no account system on this store, so "is this your review?" can't
// be checked via auth. Instead, submit-review.js hands back a random
// `deleteToken` once, at creation time, which the browser keeps in
// localStorage (see reviews.js). Only a SHA-256 HASH of that token is ever
// stored on the (publicly-readable) review document — this endpoint
// re-hashes whatever token it's given and compares hashes, so the raw
// token itself never sits in a field anyone could read off the doc.
import { getDoc, deleteDoc, updateDoc, increment } from "../../lib/firestore-rest.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid request body." }, 400);
  }

  try {
    const { reviewId, deleteToken } = body || {};
    if (!reviewId || typeof reviewId !== "string") {
      return json({ error: "Missing review." }, 400);
    }
    if (!deleteToken || typeof deleteToken !== "string") {
      return json({ error: "Missing delete token." }, 400);
    }

    const review = await getDoc(env, `reviews/${reviewId}`);
    if (!review) {
      // Already gone — treat as success so a retry/double-click can't error.
      return json({ ok: true });
    }

    const providedHash = await sha256Hex(deleteToken);
    if (!review.deleteTokenHash || review.deleteTokenHash !== providedHash) {
      // Either this review predates the deleteTokenHash field, or the
      // token just doesn't match — either way, this isn't the person who
      // wrote it, so refuse.
      return json({ error: "You can only delete your own reviews." }, 403);
    }

    await deleteDoc(env, `reviews/${reviewId}`);

    // Keep the product's displayed rating in sync — best-effort, same as
    // submit-review.js's aggregate update (non-fatal if it fails).
    if (review.productId && Number.isFinite(Number(review.rating))) {
      updateDoc(env, `products/${review.productId}`, {
        ratingSum: increment(-Number(review.rating)),
        ratingCount: increment(-1)
      }).catch((err) => console.error("Rating aggregate update failed (non-fatal):", err.message));
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong deleting your review. Please try again." }, 500);
  }
}
