// api/share.js
//
// Merged replacement for the old api/product.js + api/blog-post.js.
// Both did the exact same job for a different collection (WhatsApp/
// Facebook/Twitter's preview bots don't run JavaScript, so the client-side
// title/meta tags set by product.html / blog-post.html after their loader
// scripts run are invisible to them — this route builds that HTML
// server-side instead, then bounces real browsers on to the real page).
//
// Combined into one function so a new api/page.js (full server-rendering
// for the Pages feature) fits under Vercel Hobby's 12-serverless-function
// cap without dropping anything that already worked. Routing is via a
// `type` query param set by the matching vercel.json rewrite:
//   /share       -> /api/share?type=product
//   /share-blog  -> /api/share?type=blog

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

function sendPreviewHtml(res, { title, description, imageUrl, redirectPath, ogType, canonicalUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeRedirectForScript = escapeForScript(redirectPath);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
  return res.status(200).send(`
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${safeTitle} - AzubaTrends</title>
      <meta name="description" content="${safeDescription}">

      <meta property="og:type" content="${ogType}">
      <meta property="og:title" content="${safeTitle}">
      <meta property="og:description" content="${safeDescription}">
      <meta property="og:image" content="${safeImage}">
      ${canonicalUrl ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">` : ""}

      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="${safeTitle}">
      <meta name="twitter:description" content="${safeDescription}">
      <meta name="twitter:image" content="${safeImage}">

      <meta http-equiv="refresh" content="0;url=${redirectPath}">
    </head>
    <body>
      <h1>${safeTitle}</h1>
      <p>${safeDescription}</p>
      <img src="${safeImage}" alt="${safeTitle}">
      <script>
        // Normal browsers jump straight to the real page — only bots
        // without JS ever see the plain HTML above.
        window.location.replace("${safeRedirectForScript}");
      </script>
    </body>
    </html>
  `);
}

async function handleProduct(req, res) {
  const { id, slug } = req.query;
  if (!id && !slug) return res.redirect(301, "/");

  const db = getDb();
  let product;
  let resolvedSlug = slug;

  if (slug) {
    const snap = await db.collection("products").where("slug", "==", slug).limit(1).get();
    product = snap.empty ? null : snap.docs[0].data();
  } else {
    const docSnap = await db.collection("products").doc(id).get();
    product = docSnap.exists ? docSnap.data() : null;
    resolvedSlug = product?.slug || null;
  }

  const title = product?.seoTitle || product?.title || "AzubaTrends Product";
  const description = product?.seoDesc || product?.shortDescription || "Buy amazing products on AzubaTrends.";
  const imageUrl = (Array.isArray(product?.images) && product.images[0]) || "https://azuba-trends.vercel.app/images/logo-placeholder.png";
  const redirectPath = resolvedSlug ? `/products/${encodeURIComponent(resolvedSlug)}` : `/?id=${encodeURIComponent(id || "")}`;

  return sendPreviewHtml(res, { title, description, imageUrl, redirectPath, ogType: "product" });
}

async function handleBlog(req, res) {
  const { slug } = req.query;
  if (!slug) return res.redirect(301, "/blog");

  const db = getDb();
  const snap = await db.collection("blogPosts").where("slug", "==", slug).limit(1).get();
  if (snap.empty) return res.redirect(301, "/blog");

  const post = snap.docs[0].data();
  const title = post.seoTitle || post.title || "AzubaTrends Blog";
  let fallbackText = "";
  if (post.content) {
    fallbackText = String(post.content).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  } else {
    const firstTextBlock = (post.blocks || []).find((b) => (b.type === "paragraph" || b.type === "heading") && b.text?.trim());
    fallbackText = firstTextBlock?.text || "";
  }
  const rawDescription = post.seoDesc || fallbackText || "Read this post on the AzubaTrends blog.";
  const description = rawDescription.length > 160 ? rawDescription.slice(0, 160).trim() + "…" : rawDescription;
  const imageUrl = post.coverImage || "https://azuba-trends.vercel.app/images/logo-placeholder.png";
  const redirectPath = `/blog/${encodeURIComponent(slug)}`;
  const canonicalUrl = `https://azuba-trends.vercel.app${redirectPath}`;

  return sendPreviewHtml(res, { title, description, imageUrl, redirectPath, ogType: "article", canonicalUrl });
}

export default async function handler(req, res) {
  const { type } = req.query;
  try {
    if (type === "blog") return await handleBlog(req, res);
    if (type === "product") return await handleProduct(req, res);
    return res.redirect(301, "/");
  } catch (error) {
    console.error("api/share failed:", error);
    return res.redirect(301, "/");
  }
}
