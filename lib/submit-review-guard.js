// lib/submit-review-guard.js
//
// All the server-side validation for a guest-submitted review, used only
// by api/submit-review.js. Kept in lib/ (not api/) since it exports no
// HTTP handler.

import { PROFANITY_WORDS } from "./profanity-list.js";

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
 */
export async function checkAndIncrementRateLimit(db, ip) {
  const crypto = await import("crypto");
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const ipHash = crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
  const docId = `${ipHash}_${today}`;
  const ref = db.collection("review_rate_limits").doc(docId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.data().count || 0) : 0;
    if (current >= MAX_REVIEWS_PER_IP_PER_DAY) {
      return { allowed: false, remaining: 0 };
    }
    tx.set(ref, { count: current + 1, lastSubmittedAt: new Date().toISOString() }, { merge: true });
    return { allowed: true, remaining: MAX_REVIEWS_PER_IP_PER_DAY - current - 1 };
  });
}

export const REVIEW_LIMITS = { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH, MAX_REVIEWS_PER_IP_PER_DAY };
