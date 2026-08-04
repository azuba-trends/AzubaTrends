// functions/api/delete-review.js
//
// Lets a review get deleted — two different callers, two different checks:
//
//   1. The guest who wrote it, from product.html's own "Delete" button on
//      their review. There's no account system on this store, so "is this
//      your review?" can't be checked via auth — submit-review.js instead
//      hands back a random `deleteToken` once, at creation time, which the
//      browser keeps in localStorage (see reviews.js). Only a SHA-256 HASH
//      of that token is ever stored on the (publicly-readable) review
//      document — this endpoint re-hashes whatever token it's given and
//      compares hashes, so the raw token itself never sits in a field
//      anyone could read off the doc.
//
//   2. The admin, from EITHER product.html (moderating live, same "Delete"
//      button — reviews.js shows it to a signed-in admin on every review,
//      not just their own) OR the "Reviews" panel in admin.html. Sends a
//      normal `Authorization: Bearer <idToken>` header instead of a
//      deleteToken — checked first, and if it's a valid admin token this
//      can delete ANY review, no ownership check needed.
import { getDoc, deleteDoc, updateDoc, increment } from "../../lib/firestore-rest.js";
import { requireAdmin } from "../../lib/auth.js";

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

    // Admin path: a Bearer token present at all means "try admin auth" —
    // if it's invalid this is a straight 401, it never silently falls
    // through to the guest-token check below (that would let a bad admin
    // token be quietly retried as a deleteToken, which it structurally
    // can't be anyway, but the intent should be explicit either way).
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
    let isAdmin = false;
    if (authHeader) {
      try {
        await requireAdmin(request, env);
        isAdmin = true;
      } catch (err) {
        return json({ error: "Unauthorized." }, 401);
      }
    }

    if (!isAdmin && (!deleteToken || typeof deleteToken !== "string")) {
      return json({ error: "Missing delete token." }, 400);
    }

    const review = await getDoc(env, `reviews/${reviewId}`);
    if (!review) {
      // Already gone — treat as success so a retry/double-click can't error.
      return json({ ok: true });
    }

    if (!isAdmin) {
      const providedHash = await sha256Hex(deleteToken);
      if (!review.deleteTokenHash || review.deleteTokenHash !== providedHash) {
        // Either this review predates the deleteTokenHash field, or the
        // token just doesn't match — either way, this isn't the person who
        // wrote it, so refuse.
        return json({ error: "You can only delete your own reviews." }, 403);
      }
    }

    await deleteDoc(env, `reviews/${reviewId}`);

    // Keep the product's displayed rating in sync — AWAITED, unlike a
    // typical "fire and forget" background update: this is the very last
    // thing this function does before returning, so on Cloudflare Pages
    // Functions a non-awaited promise here would very often get cut off
    // mid-write the instant the response is sent (the isolate can be torn
    // down right after `return`, unless the promise is either awaited or
    // handed to `context.waitUntil()`). That's exactly why deleting a
    // review was leaving the OLD rating/count still showing on every
    // product card — the decrement almost never actually reached
    // Firestore. Awaiting it adds one small round-trip, but the delete
    // itself already isn't a hot/critical path, so that's the right
    // trade for "always correct" over "usually fast."
    if (review.productId && Number.isFinite(Number(review.rating))) {
      try {
        await updateDoc(env, `products/${review.productId}`, {
          ratingSum: increment(-Number(review.rating)),
          ratingCount: increment(-1)
        });
      } catch (err) {
        // The review is already deleted either way — don't fail the
        // whole request over the aggregate not updating, just log it.
        console.error("Rating aggregate update failed (non-fatal):", err.message);
      }
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong deleting your review. Please try again." }, 500);
  }
}

