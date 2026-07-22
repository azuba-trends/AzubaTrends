// lib/firebase-admin.js
//
// Shared Firebase Admin SDK setup. Any serverless function that needs to
// read/write Firestore data protected by "allow ...: if isAdmin()" rules
// (currently: telegram_bots, and product stock writes) imports getDb() from
// here instead of re-initializing the SDK itself.
//
// Deliberately placed OUTSIDE the /api folder — files directly under /api
// become public routes on Vercel, and this file exports no HTTP handler, so
// it doesn't belong there.
//
// Requires the FIREBASE_SERVICE_ACCOUNT_KEY environment variable (base64-
// encoded service account JSON) to be set in Vercel. See
// SERVICE-ACCOUNT-SETUP-GUIDE.md for how to create and set that.

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

let cachedDb = null;

function ensureAppInitialized() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not set. Follow SERVICE-ACCOUNT-SETUP-GUIDE.md, " +
      "add it in Vercel -> Settings -> Environment Variables, then redeploy."
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch (err) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY could not be parsed — make sure you pasted the " +
      "base64-encoded value (see SERVICE-ACCOUNT-SETUP-GUIDE.md Step 2), not the raw JSON file."
    );
  }

  if (!getApps().length) {
    initializeApp({ credential: cert(serviceAccount) });
  }
}

export function getDb() {
  if (cachedDb) return cachedDb;
  ensureAppInitialized();
  cachedDb = getFirestore();
  return cachedDb;
}

// ---------------------------------------------------------------------
// verifyAdminToken(req)
// ---------------------------------------------------------------------
// Used by any /api route that must only be usable by the logged-in admin
// (e.g. api/import-product.js). The browser sends the SAME Firebase ID
// token admin.html already gets from `auth.currentUser.getIdToken()` —
// no separate password/API key to manage. This verifies that token was
// really issued by our Firebase project and hasn't expired, using the
// Admin SDK (server-side, can't be spoofed by editing client JS).
//
// NOTE: like firestore.rules' isAdmin(), this treats "any signed-in
// Firebase user" as admin — matches this project's single-admin-account
// assumption. If you ever add non-admin logins, tighten this the same
// way you'd tighten firestore.rules.
//
// Returns the decoded token on success, or throws an Error on failure
// (missing header, invalid token, expired token, etc.) — callers should
// catch this and respond 401.
export async function verifyAdminToken(req) {
  ensureAppInitialized();
  const authHeader = req.headers["authorization"] || req.headers["Authorization"];
  const match = /^Bearer (.+)$/.exec(authHeader || "");
  if (!match) {
    throw new Error("Missing Authorization: Bearer <idToken> header.");
  }
  return getAuth().verifyIdToken(match[1]);
}
