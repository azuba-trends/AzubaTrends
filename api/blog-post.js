// api/blog-post.js
//
// Same reason api/product.js exists: WhatsApp/Facebook/Twitter's preview
// bots don't run JavaScript, so blog-post.html's client-side title/meta
// tags (set after BlogLoader loads the post) are invisible to them — they
// only ever see the raw, pre-JS HTML.
//
// This route is for SHARING a post, not for normal visitors — when
// posting a blog link on WhatsApp/social media, use:
//   https://azuba-trends.vercel.app/share-blog?slug=your-post-slug
// (see vercel.json's "/share-blog" rewrite). Real visitors who land here
// get redirected straight to the normal /blog/:slug page below.

import { getDb } from "../lib/firebase-admin.js";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function handler(req, res) {
  const { slug } = req.query;

  if (!slug) {
    return res.redirect(301, "/blog");
  }

  try {
    const db = getDb();
    const snap = await db.collection("blogPosts").where("slug", "==", slug).limit(1).get();

    if (snap.empty) {
      return res.redirect(301, "/blog");
    }

    const post = snap.docs[0].data();
    const title = escapeHtml(post.seoTitle || post.title || "AzubaTrends Blog");
    const firstTextBlock = (post.blocks || []).find((b) => (b.type === "paragraph" || b.type === "heading") && b.text?.trim());
    const rawDescription = post.seoDesc || firstTextBlock?.text || "Read this post on the AzubaTrends blog.";
    const description = escapeHtml(rawDescription.length > 160 ? rawDescription.slice(0, 160).trim() + "…" : rawDescription);
    const imageUrl = escapeHtml(post.coverImage || "https://yourwebsite.com/images/logo-placeholder.png");
    const redirectPath = `/blog/${encodeURIComponent(slug)}`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Same short-cache reasoning as api/product.js — a post edit shows up
    // in shared previews within about a minute, no manual cache-busting.
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res.status(200).send(`
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>${title} - AzubaTrends</title>
        <meta name="description" content="${description}">

        <meta property="og:type" content="article">
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${description}">
        <meta property="og:image" content="${imageUrl}">
        <meta property="og:url" content="https://azuba-trends.vercel.app${redirectPath}">

        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="${title}">
        <meta name="twitter:description" content="${description}">
        <meta name="twitter:image" content="${imageUrl}">

        <meta http-equiv="refresh" content="0;url=${redirectPath}">
      </head>
      <body>
        <h1>${title}</h1>
        <p>${description}</p>
        <img src="${imageUrl}" alt="${title}">
        <script>
          // Normal browsers (chrome/safari) jump straight to the real post —
          // only bots without JS ever see the plain HTML above.
          window.location.replace("${redirectPath}");
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("api/blog-post failed:", error);
    return res.redirect(301, `/blog/${encodeURIComponent(slug)}`);
  }
}
