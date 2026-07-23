// api/page.js
//
// Full server-side rendering for custom Pages (Admin -> Pages -> Add Page).
// Unlike product.html/blog-post.html (which are static files that fetch
// their data client-side, with api/share.js as a separate bot-only preview
// route), Pages don't need cart/gallery/etc. — they're simple enough that
// we can render the REAL page here directly. That means the very first
// byte sent to anyone — a real visitor, Googlebot's first pass, or a
// WhatsApp link-preview bot that never runs JavaScript at all — already
// has the correct <title>, meta description, canonical/OG tags and the
// actual page content. No "wait for JS to fill it in" step, no separate
// preview-only route needed.
//
// vercel.json's catch-all rewrite ("/:slug" -> "/api/page") sends any URL
// that isn't a real file and isn't a more specific route (products/blog/
// category/etc.) here. Header/footer are still filled in client-side via
// layout.js's #header-mount/#footer-mount, same as every other page on the
// site — that keeps the nav in exactly one place (partials/header.html)
// instead of a second server-side copy that could drift out of sync.

import { getDb } from "../lib/firebase-admin.js";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notFoundHtml() {
  return `
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Page not found — AzubaTrends</title>
      <meta name="robots" content="noindex">
      <link rel="stylesheet" href="/css/main.css">
      <link rel="stylesheet" href="/css/components.css">
    </head>
    <body>
      <div id="header-mount"></div>
      <main>
        <div class="notfound">
          <div class="notfound__code">404</div>
          <h1>This page wandered off</h1>
          <p style="max-width:44ch; margin-top:8px;">The page you're looking for doesn't exist, or the link may be out of date.</p>
          <p style="margin-top:24px;"><a class="btn btn-primary" href="/">Back to shop</a></p>
        </div>
      </main>
      <div id="footer-mount"></div>
      <script src="/js/site-config.js"></script>
      <script src="/js/tracking.js"></script>
      <script src="/js/security.js"></script>
      <script src="/js/layout.js"></script>
      <script src="/js/cart.js"></script>
      <script src="/js/product-loader.js"></script>
      <script>window.addEventListener("layout:ready", () => ProductLoader.initHeader());</script>
    </body>
    </html>
  `;
}

export default async function handler(req, res) {
  const slugParam = req.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam[0] : slugParam;

  if (!slug) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(404).send(notFoundHtml());
  }

  try {
    const db = getDb();
    const snap = await db.collection("pages").where("slug", "==", slug).limit(1).get();

    if (snap.empty || snap.docs[0].data().status !== "published") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(404).send(notFoundHtml());
    }

    const page = snap.docs[0].data();
    const title = escapeHtml(page.metaTitle || page.heading);
    const description = escapeHtml(page.metaDesc || "");
    const heading = escapeHtml(page.heading || "");
    const image = page.image || "";
    const url = `https://azuba-trends.vercel.app/${encodeURIComponent(slug)}`;
    // page.content comes only from the admin's own rich-text editor
    // (Admin -> Pages), never from public/user input, so it's trusted the
    // same way product/blog HTML content already is elsewhere in this app.
    const contentHtml = page.content || "";

    const schema = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.heading,
      description: page.metaDesc || undefined,
      url,
      isPartOf: { "@type": "WebSite", name: "AzubaTrends", url: "https://azuba-trends.vercel.app/" }
    };

    const html = `
      <!doctype html>
      <html lang="en">
      <head>
      <meta charset="UTF-8">
      <link rel="icon" type="image/svg+xml" href="/images/favicon.svg">
      <link rel="manifest" href="/manifest.webmanifest">
      <meta name="theme-color" content="#1F3A5F">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} — AzubaTrends</title>
      <meta name="description" content="${description}">
      <link rel="canonical" href="${url}">
      <meta property="og:type" content="website">
      <meta property="og:title" content="${title}">
      <meta property="og:description" content="${description}">
      ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
      <meta property="og:url" content="${url}">
      <meta property="og:site_name" content="AzubaTrends">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="${title}">
      <meta name="twitter:description" content="${description}">
      ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ""}
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <link rel="stylesheet" href="/css/main.css">
      <link rel="stylesheet" href="/css/components.css">
      <script type="application/ld+json">${JSON.stringify(schema)}</script>
      </head>
      <body>
      <div id="header-mount"></div>
      <main>
        <div class="container">
          <section class="page-header">
            <div class="breadcrumb"><a href="/">Home</a> / ${heading}</div>
            <h1>${heading}</h1>
          </section>
          ${image ? `<img src="${escapeHtml(image)}" alt="${heading}" style="width:100%;max-height:420px;object-fit:cover;border-radius:8px;margin-bottom:24px;">` : ""}
          <article class="prose">${contentHtml}</article>
        </div>
      </main>
      <div id="footer-mount"></div>
      <script src="/js/site-config.js"></script>
      <script src="/js/tracking.js"></script>
      <script src="/js/security.js"></script>
      <script src="/js/layout.js"></script>
      <script src="/js/cart.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.min.js"></script>
      <script src="/js/product-loader.js"></script>
      <script src="/js/search.js"></script>
      <script>window.addEventListener("layout:ready", () => ProductLoader.initHeader());</script>
      </body>
      </html>
    `;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Short cache — an admin's SEO/content edit shows up within about a
    // minute, without needing a redeploy (same reasoning as api/share.js).
    res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=30");
    return res.status(200).send(html);
  } catch (error) {
    console.error("api/page failed:", error);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(500).send(notFoundHtml());
  }
}
