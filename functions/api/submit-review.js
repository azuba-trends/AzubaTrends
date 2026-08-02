// functions/api/submit-review.js
//
// The only path a guest review can be created through now (see
// firestore.rules — direct browser writes to `reviews` are no longer
// allowed). This exists specifically to make the protections in
// lib/submit-review-guard.js unbypassable: they run here, server-side,
// where nobody can skip past them by opening DevTools and hitting
// Firestore directly.
//
// WORKER 2 MIGRATION NOTE (Vercel + Admin SDK -> Cloudflare Pages
// Functions + Firestore REST):
//   - `export default function handler(req, res)` -> `onRequestPost(context)`.
//   - `getDb()` / Admin SDK objects are gone. Every Firestore call now goes
//     through lib/firestore-rest.js, which is passed `context.env` (it
//     carries FIREBASE_SERVICE_ACCOUNT_KEY etc, same var names as before).
//   - `FieldValue.increment(n)` -> `increment(n)` from firestore-rest.js.
//   - No more `db.collection("reviews").doc()` for pre-generating an ID —
//     Firestore REST has no client-side ID generator baked into a `db`
//     object, so we generate the doc ID ourselves with `crypto.randomUUID()`
//     (built into the Workers runtime) and pass it to `createDoc`. This
//     keeps the exact same "one write, ID baked in up front" pattern the
//     original used to avoid a second sequential update just to attach
//     the "Guest #XXXX" tag.
//   - req.body -> await context.request.json(); req.headers.host ->
//     context.request.headers.get("host"); req.headers["x-forwarded-for"]
//     -> context.request.headers.get(...).
import {
  getDoc,
  createDoc,
  updateDoc,
  increment
} from "../../lib/firestore-rest.js";
import { containsProfanity, validateCommentLength, checkAndIncrementRateLimit } from "../../lib/submit-review-guard.js";
import { dispatchTelegramEvent } from "../../lib/telegram.js";

function getClientIp(request) {
  // Cloudflare always sets this on real traffic — most reliable source.
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

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
    const { productId, rating, comment, imageUrl, imageUrls, website } = body || {};

    // Honeypot — a real visitor never fills this field in. Silently
    // "succeed" (don't tip off a bot that it was caught) rather than
    // returning an error.
    if (website) {
      return json({ ok: true });
    }

    if (!productId || typeof productId !== "string") {
      return json({ error: "Missing product." }, 400);
    }

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return json({ error: "Please select a rating between 1 and 5 stars." }, 400);
    }

    const trimmedComment = String(comment || "").trim();
    const lengthError = validateCommentLength(trimmedComment);
    if (lengthError) {
      return json({ error: lengthError }, 400);
    }

    if (containsProfanity(trimmedComment)) {
      return json({
        error: "Your review contains language we don't allow. Strong opinions about the product are totally fine — please just remove any abusive words and resubmit."
      }, 400);
    }

    if (imageUrl && typeof imageUrl !== "string") {
      return json({ error: "Invalid image." }, 400);
    }

    // Up to 5 photos per review (matches the "+" image picker in the
    // review form on product.html). imageUrl (singular) is kept working
    // too, for any older client still sending just one.
    let cleanImageUrls = [];
    if (imageUrls !== undefined) {
      if (!Array.isArray(imageUrls) || imageUrls.some((u) => typeof u !== "string")) {
        return json({ error: "Invalid images." }, 400);
      }
      cleanImageUrls = imageUrls.filter(Boolean).slice(0, 5);
    } else if (imageUrl) {
      cleanImageUrls = [imageUrl];
    }

    // Rate limit — per IP, per day. Same guard function/behavior as
    // before, just now backed by firestore-rest.js under the hood.
    const ip = getClientIp(request);
    const { allowed } = await checkAndIncrementRateLimit(env, ip);
    if (!allowed) {
      return json({ error: "You've submitted the maximum number of reviews for today. Please try again tomorrow." }, 429);
    }

    // Pre-generate the doc ID locally (no network round-trip, same intent
    // as the original db.collection("reviews").doc()) so the "Guest #XXXX"
    // author tag can be baked into the SAME write instead of needing a
    // second sequential update afterwards.
    const docId = crypto.randomUUID().replace(/-/g, "");
    const guestTag = docId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();

    // There's no login system — guests are just "Guest #XXXX" — so instead
    // of tying ownership to an account, each review gets its own random
    // delete token at creation. It's returned ONCE, in this response, and
    // the browser stashes it in localStorage (see reviews.js).
    //
    // Reviews are publicly readable (see firestore.rules — anyone can read
    // the `reviews` collection, that's how the storefront shows them), so
    // the raw token itself must NEVER be written to the document — anyone
    // could open the Network tab, read another shopper's token off their
    // fetched review, and delete it. Only a SHA-256 hash of the token is
    // stored; functions/api/delete-review.js re-hashes whatever token it's
    // given and compares hashes, so the raw token — the only thing that
    // actually works — never touches a publicly-readable field.
    const deleteToken = crypto.randomUUID().replace(/-/g, "");
    const deleteTokenHash = await sha256Hex(deleteToken);

    const review = {
      productId,
      rating: ratingNum,
      comment: trimmedComment,
      imageUrl: cleanImageUrls[0] || null, // kept for older readers of this field
      imageUrls: cleanImageUrls,
      authorLabel: `Guest #${guestTag}`,
      date: new Date().toISOString(),
      deleteTokenHash
    };

    await createDoc(env, "reviews", docId, review);

    // Keep the product's displayed rating (shown on every card site-wide)
    // in sync — atomic increment, no read-before-write needed, so this
    // doesn't add a round-trip to the critical path. Fire-and-forget, same
    // as the original (non-fatal if it fails).
    updateDoc(env, `products/${productId}`, {
      ratingSum: increment(ratingNum),
      ratingCount: increment(1)
    }).catch((err) => console.error("Rating aggregate update failed (non-fatal):", err.message));

    // Everything below is best-effort (product title for the Telegram
    // message, then the Telegram alert itself) — the review is already
    // safely saved above, so none of this can ever cause the review to
    // be lost.
    let productTitle = productId;
    try {
      const productDoc = await getDoc(env, `products/${productId}`);
      if (productDoc) productTitle = productDoc.title || productId;
    } catch (err) { /* non-fatal, fall back to productId */ }

    const host = request.headers.get("host");
    // dispatchTelegramEvent's first argument used to be the Admin SDK `db`
    // object; Worker 4's converted lib/telegram.js takes `env` in that same
    // position instead (same name/signature shape, db -> env), per the
    // shared migration pattern used everywhere else in this codebase.
    await dispatchTelegramEvent(env, "new_review", {
      productId,
      productTitle,
      rating: ratingNum,
      comment: trimmedComment,
      productUrl: host ? `https://${host}/product.html?id=${encodeURIComponent(productId)}` : null
    });

    return json({ ok: true, id: docId, deleteToken });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong submitting your review. Please try again." }, 500);
  }
}