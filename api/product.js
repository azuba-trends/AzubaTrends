// api/product.js
//
// Same reason api/blog-post.js exists: WhatsApp/Facebook/Twitter's preview
// bots don't run JavaScript, so product.html's client-side title/meta tags
// (set after ProductLoader loads the product) are invisible to them — they
// only ever see the raw, pre-JS HTML. This route builds that HTML server-side.
//
// Uses the Firebase Admin SDK (lib/firebase-admin.js) like every other
// server-side route in this project, rather than hand-building Firestore
// REST URLs — that keeps the Firestore project id in exactly one place
// (config/firebase-config.json, read indirectly via FIREBASE_SERVICE_ACCOUNT_KEY),
// so pointing this project at a different Firebase project later never
// requires hunting for a second hardcoded copy of the project id.

import { getDb } from "../lib/firebase-admin.js";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Safe specifically for embedding inside a <script> block as a JS string
// literal (escapeHtml alone isn't enough there — </script> or a stray quote
// could still break out).
function escapeForScript(str) {
  return String(str ?? "").replace(/[<>&'"\\]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export default async function handler(req, res) {
  const { id, slug } = req.query;

  // Agar id/slug kuch bhi nahi hai, toh normal product page bhej do
  if (!id && !slug) {
    return res.redirect(301, '/product.html');
  }

  try {
    const db = getDb();
    let product;
    let resolvedSlug = slug;

    if (slug) {
      // Slug se lookup karne ke liye field query use karna padta hai,
      // kyunki slug document-id nahi hai — ye ek field hai.
      const snap = await db.collection("products").where("slug", "==", slug).limit(1).get();
      product = snap.empty ? null : snap.docs[0].data();
    } else {
      // Purane /share?id=X links abhi bhi kaam karte rahein, isliye id-based
      // lookup fallback ke roop me rakha hai.
      const docSnap = await db.collection("products").doc(id).get();
      product = docSnap.exists ? docSnap.data() : null;
      resolvedSlug = product?.slug || null;
    }

    const rawTitle = product?.seoTitle || product?.title || "AzubaTrends Product";
    const rawDescription = product?.seoDesc || product?.shortDescription || "Buy amazing products on AzubaTrends.";
    const rawImageUrl = (Array.isArray(product?.images) && product.images[0]) || "https://yourwebsite.com/images/logo-placeholder.png";

    const title = escapeHtml(rawTitle);
    const description = escapeHtml(rawDescription);
    const imageUrl = escapeHtml(rawImageUrl);
    // Prefer the clean slug URL for the real-user redirect; fall back to the
    // old ?id= link only if this product somehow has no slug yet.
    const redirectPath = resolvedSlug
      ? `/products/${encodeURIComponent(resolvedSlug)}`
      : `/product.html?id=${encodeURIComponent(id || "")}`;
    const safeRedirectForScript = escapeForScript(redirectPath);

    // 3. Custom HTML banakar (Meta Tags ke sath) bhejna
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <!-- STANDARD SEO -->
        <title>${title} - AzubaTrends</title>
        <meta name="description" content="${description}">

        <!-- OPEN GRAPH (Facebook, WhatsApp) -->
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${description}">
        <meta property="og:image" content="${imageUrl}">
        <meta property="og:type" content="product">

        <!-- TWITTER -->
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="${title}">
        <meta name="twitter:description" content="${description}">
        <meta name="twitter:image" content="${imageUrl}">

        <!-- Redirect to real page for normal users -->
        <script>
          // Jab normal user (chrome/safari) ise open karega,
          // toh wo original product page par chala jayega jahan cart/UI load hoga.
          window.location.replace("${safeRedirectForScript}");
        </script>
      </head>
      <body>
        <!-- Bots ko sirf head tags chahiye hote hain, isliye body khali chhod sakte hain -->
        <h1>${title}</h1>
        <p>${description}</p>
        <img src="${imageUrl}" alt="${title}">
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);

  } catch (error) {
    console.error(error);
    res.redirect(301, slug ? `/products/${encodeURIComponent(slug)}` : '/product.html?id=' + encodeURIComponent(id || ""));
  }
}
