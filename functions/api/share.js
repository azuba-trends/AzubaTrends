// functions/api/share.js
//
// CLOUDFLARE PAGES FUNCTIONS PORT of api/share.js.
// Response HTML, headers, and behavior are unchanged from the Vercel
// version — only the data-access layer and request/response plumbing
// have been swapped.
//
// Merged replacement for the old api/product.js + api/blog-post.js.
// Both did the exact same job for a different collection (WhatsApp/
// Facebook/Twitter's preview bots don't run JavaScript, so the client-side
// title/meta tags set by product.html / blog-post.html after their loader
// scripts run are invisible to them — this route builds that HTML
// server-side instead, then bounces real browsers on to the real page).
//
// Routing is via a `type` query param, same as before:
//   /share       -> /api/share?type=product
//   /share-blog  -> /api/share?type=blog
// (The _redirects/_routes.json rewrites that map those clean URLs to this
// function are routing config, not covered by lib/firestore-rest.js's
// contract or this worker's assigned files — same note as api/page.js.)

import { getDocs, getDoc } from "../../lib/firestore-rest.js";

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

function previewResponse({ title, description, imageUrl, redirectPath, ogType, canonicalUrl }) {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImage = escapeHtml(imageUrl);
  const safeRedirectForScript = escapeForScript(redirectPath);

  const html = `
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
  `;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30"
    }
  });
}

function redirect(path, request) {
  // Resolve against the incoming request's own origin (rather than a
  // hardcoded domain) so this works the same on a preview deployment,
  // the production domain, or a custom domain — Response.redirect needs
  // an absolute URL.
  return Response.redirect(new URL(path, request.url).toString(), 301);
}

async function handleProduct(url, env, request) {
  const id = url.searchParams.get("id");
  const slug = url.searchParams.get("slug");
  const parentId = url.searchParams.get("parentId");
  const variantSlug = url.searchParams.get("variantSlug");
  if (!id && !slug && !(parentId && variantSlug)) return redirect("/", request);

  let product;
  let resolvedSlug = slug;

  if (parentId && variantSlug) {
    const matches = await getDocs(env, "products", {
      where: [["parentId", "==", parentId], ["variantSlug", "==", variantSlug]]
    });
    product = matches[0] || null;
  } else if (slug) {
    const matches = await getDocs(env, "products", { where: [["slug", "==", slug]] });
    product = matches[0] || null;
  } else {
    product = await getDoc(env, `products/${id}`);
    resolvedSlug = product?.slug || null;
  }

  const title = product?.seoTitle || product?.title || "AzubaTrends Product";
  const description = product?.seoDesc || product?.shortDescription || "Buy amazing products on AzubaTrends.";
  const imageUrl = (Array.isArray(product?.images) && product.images[0]) || `${url.origin}/images/logo-placeholder.png`;
  const redirectPath = (product?.isVariant && product?.parentId && product?.variantSlug)
    ? `/products/${encodeURIComponent(product.parentId)}/${encodeURIComponent(product.variantSlug)}`
    : (resolvedSlug ? `/products/${encodeURIComponent(resolvedSlug)}` : `/?id=${encodeURIComponent(id || "")}`);

  return previewResponse({ title, description, imageUrl, redirectPath, ogType: "product" });
}

async function handleBlog(url, env, request) {
  const slug = url.searchParams.get("slug");
  if (!slug) return redirect("/blog", request);

  const matches = await getDocs(env, "blogPosts", { where: [["slug", "==", slug]] });
  const post = matches[0];
  if (!post) return redirect("/blog", request);

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
  const imageUrl = post.coverImage || `${url.origin}/images/logo-placeholder.png`;
  const redirectPath = `/blog/${encodeURIComponent(slug)}`;
  const canonicalUrl = `${url.origin}${redirectPath}`;

  return previewResponse({ title, description, imageUrl, redirectPath, ogType: "article", canonicalUrl });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const type = url.searchParams.get("type");

  try {
    if (type === "blog") return await handleBlog(url, env, request);
    if (type === "product") return await handleProduct(url, env, request);
    return redirect("/", request);
  } catch (error) {
    console.error("api/share failed:", error);
    return redirect("/", request);
  }
}
