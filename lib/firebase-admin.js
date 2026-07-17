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

let cachedDb = null;

export function getDb() {
  if (cachedDb) return cachedDb;

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

  cachedDb = getFirestore();
  return cachedDb;
}
