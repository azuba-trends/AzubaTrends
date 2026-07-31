// lib/auth.js
//
// Shared admin-auth helper for Cloudflare Pages Functions routes.
// Wraps firestore-rest.js's verifyIdToken(env, idToken) with the same
// "pull the Bearer token out of the Authorization header" logic the old
// lib/firebase-admin.js's verifyAdminToken(req) used to do on Vercel —
// pulled out here so every admin-only route (admin-tools, import-product,
// and any future one) doesn't reimplement it.
//
// Same semantics as before: this treats ANY signed-in Firebase user as
// admin, matching this project's single-admin-account assumption (same
// as firestore.rules' isAdmin()). If that assumption ever changes, tighten
// both places together.
//
// Depends only on the SHARED CONTRACT's verifyIdToken(env, idToken) —
// not on how lib/firestore-rest.js is implemented, so this is safe to add
// in parallel with Worker 1 building that file.

import { verifyIdToken } from "./firestore-rest.js";

// Throws on missing/invalid/expired token (callers should catch and
// respond 401), returns the decoded token on success.
export async function requireAdmin(request, env) {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  const match = /^Bearer (.+)$/.exec(authHeader || "");
  if (!match) {
    throw new Error("Missing Authorization: Bearer <idToken> header.");
  }
  return verifyIdToken(env, match[1]);
}
