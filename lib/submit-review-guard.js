// lib/submit-review-guard.js
//
// All the server-side validation for a guest-submitted review, used by
// functions/api/submit-review.js. Kept in lib/ (not functions/api/) since
// it exports no HTTP handler.
//
// WORKER 2 MIGRATION NOTE: containsProfanity() and validateCommentLength()
// are pure string functions with no Firestore dependency at all — copied
// over completely unchanged. Only checkAndIncrementRateLimit() talked to
// Firestore (via the Admin SDK's `db` object + db.runTransaction), so
// that's the only function whose body changed — its NAME and its return
// shape ({ allowed, remaining }) are identical, because
// functions/api/place-order.js's new rate limit (a separate concern, see
// that file) copies this same pattern/style rather than importing this
// function directly — this file stays focused on reviews.

import { PROFANITY_WORDS } from "./profanity-list.js";
import { runTransaction } from "./firestore-rest.js";

const MIN_COMMENT_LENGTH = 10;
const MAX_COMMENT_LENGTH = 1000;
const MAX_REVIEWS_PER_IP_PER_DAY = 5;

function normalizeForProfanityCheck(text) {
  return String(text || "")
    .toLowerCase()
    // Common leetspeak substitutions
    .replace(/[@4]/g, "a")
    .replace(/3/g, "e")
    .replace(/[1!]/g, "i")
    .replace(/0/g, "o")
    .replace(/\$/g, "s")
    .replace(/[+7]/g, "t")
    // Collapse letters separated by spaces/punctuation used to dodge
    // filters ("f u c k", "f.u.c.k")
    .replace(/[^a-z0-9]+/g, "")
    // Collapse stretched-out repeats ("fuuuuck" -> "fuck")
    .replace(/(.)\1{2,}/g, "$1$1");
}

/**
 * Returns true if `text` contains profanity from the list. Checks against
 * both the normal word-boundary form (for accuracy on legitimate text)
 * and a fully-normalized/de-spaced form (to catch simple bypass tricks).
 */
export function containsProfanity(text) {
  const raw = String(text || "").toLowerCase();
  const normalized = normalizeForProfanityCheck(text);

  return PROFANITY_WORDS.some((word) => {
    const wordNormalized = normalizeForProfanityCheck(word);
    if (normalized.includes(wordNormalized)) return true;
    // Also a plain word-boundary check on the raw lowercase text, for
    // multi-word phrases like "saala kutta" where normalization collapsing
    // spaces is actually what we want, but a boundary check catches cases
    // the aggressive normalization might over- or under-match.
    const boundaryRe = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    return boundaryRe.test(raw);
  });
}

export function validateCommentLength(comment) {
  const len = String(comment || "").trim().length;
  if (len < MIN_COMMENT_LENGTH) {
    return `Please write at least ${MIN_COMMENT_LENGTH} characters.`;
  }
  if (len > MAX_COMMENT_LENGTH) {
    return `Please keep your review under ${MAX_COMMENT_LENGTH} characters.`;
  }
  return null;
}

/**
 * Rate-limits by IP using a Firestore counter doc keyed to (hashed IP +
 * today's date). Uses a Firestore transaction so concurrent submissions
 * from the same IP can't race past the limit.
 * Returns { allowed: boolean, remaining: number }.
 *
 * MIGRATION NOTE (Admin SDK -> firestore-rest.js):
 * The original used `db.runTransaction(tx => { tx.get, tx.set(merge) })`.
 * Our shared runTransaction(env, fn) only exposes get(path)/update(path,data)
 * on the transaction handle (no tx.set) — see the shared contract. We rely
 * on Firestore's REST `patch` semantics (which the contract's updateDoc is
 * built on) creating the document when it doesn't already exist, the same
 * way the original tx.set(ref, data, { merge: true }) did on a first-ever
 * request for a given IP+day. This is the one assumption in this file
 * that depends on Worker 1's implementation — flagged in REPORT.md.
 * Cloudflare Workers also don't have Node's `crypto` module the way the
 * original did (`await import("crypto")` -> Node's `createHash`), so the
 * IP hash now uses the Web Crypto API (`crypto.subtle`, globally available
 * in the Workers runtime) instead.
 */
async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function checkAndIncrementRateLimit(env, ip) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ipHash = (await sha256Hex(String(ip))).slice(0, 24);
  const docId = `${ipHash}_${today}`;
  const path = `review_rate_limits/${docId}`;

  return runTransaction(env, async (txn) => {
    const snap = await txn.get(path);
    const current = snap ? Number(snap.count || 0) : 0;
    if (current >= MAX_REVIEWS_PER_IP_PER_DAY) {
      return { allowed: false, remaining: 0 };
    }
    txn.update(path, { count: current + 1, lastSubmittedAt: new Date().toISOString() });
    return { allowed: true, remaining: MAX_REVIEWS_PER_IP_PER_DAY - current - 1 };
  });
}

export const REVIEW_LIMITS = { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH, MAX_REVIEWS_PER_IP_PER_DAY };
