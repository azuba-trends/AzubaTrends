// api/manifest.js
//
// Serves manifest.webmanifest dynamically instead of as a static file, so
// the "name" shown when someone adds this site to their home screen
// always matches whatever the admin has actually set as the store name
// in Settings — no code edit needed if this codebase gets reused for a
// different brand. Falls back to sensible generic defaults if Firestore
// isn't reachable, so this never hard-fails.

import { getDb } from "../lib/firebase-admin.js";

export default async function handler(req, res) {
  let storeName = "AzubaTrends";
  let themeColor = "#1F3A5F";

  try {
    const db = getDb();
    const doc = await db.collection("settings").doc("store_config").get();
    if (doc.exists) {
      const data = doc.data();
      storeName = data.storeName || storeName;
      themeColor = data.themeColor || themeColor;
    }
  } catch (err) {
    console.error("manifest: could not load settings, using defaults:", err.message);
  }

  const manifest = {
    name: storeName,
    short_name: storeName.length > 12 ? storeName.slice(0, 12) : storeName,
    description: `Shop ${storeName} — order online, delivered to your door.`,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F7F3EC",
    theme_color: themeColor,
    orientation: "portrait-primary",
    icons: [
      { src: "/images/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };

  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Cache-Control", "public, max-age=300"); // short cache — picks up a renamed store fairly quickly
  return res.status(200).send(JSON.stringify(manifest));
}
