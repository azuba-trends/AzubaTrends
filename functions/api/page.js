// functions/api/page.js
//
// CLOUDFLARE PAGES FUNCTIONS PORT of api/page.js.
// Response HTML, headers, and behavior are unchanged from the Vercel
// version — only the data-access layer (firebase-admin -> firestore-rest)
// and the request/response plumbing have been swapped.
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
// ROUTING NOTE FOR THE MANAGER: on Vercel, vercel.json's catch-all rewrite
// ("/:slug" -> "/api/page") sent any unmatched URL here as a ?slug= query
// param, which this file still reads the same way. Cloudflare Pages needs
// an equivalent rewrite (a _routes.json / _redirects entry, or a catch-all
// functions/[[slug]].js that forwards to this handler) — that routing
// config is outside lib/firestore-rest.js's contract and outside this
// worker's assigned files, so it isn't included here; flagging so whoever
// owns _redirects/_routes.json wires it up.
//
// Header/footer are still filled in client-side via layout.js's
// #header-mount/#footer-mount, same as every other page on the site —
// that keeps the nav in exactly one place (partials/header.html) instead
// of a second server-side copy that could drift out of sync.

import { getDocs } from "../../lib/firestore-rest.js";

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

function htmlResponse(html, status, cacheControl) {
  const headers = { "Content-Type": "text/html; charset=utf-8" };
  if (cacheControl) headers["Cache-Control"] = cacheControl;
  return new Response(html, { status, headers });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  if (!slug) {
    return htmlResponse(notFoundHtml(), 404);
  }

  try {
    // NOTE: the shared contract's getDocs(opts.where) has no `limit`
    // option, so unlike the original db.collection(...).limit(1).get(),
    // this fetches every "pages" doc matching slug==slug (normally just
    // one, since slugs are meant to be unique) and takes the first.
    // Flagging for the Manager in case a `limit` option gets added to
    // firestore-rest.js later — worth using here once it exists.
    const matches = await getDocs(env, "pages", { where: [["slug", "==", slug]] });
    const page = matches[0];

    if (!page || page.status !== "published") {
      return htmlResponse(notFoundHtml(), 404);
    }

    const title = escapeHtml(page.metaTitle || page.heading);
    const description = escapeHtml(page.metaDesc || "");
    const heading = escapeHtml(page.heading || "");
    const image = page.image || "";
    const pageUrl = `https://azuba-trends.vercel.app/${encodeURIComponent(slug)}`;
    // page.content comes only from the admin's own rich-text editor
    // (Admin -> Pages), never from public/user input, so it's trusted the
    // same way product/blog HTML content already is elsewhere in this app.
    const contentHtml = page.content || "";

    const schema = {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.heading,
      description: page.metaDesc || undefined,
      url: pageUrl,
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
      <link rel="canonical" href="${pageUrl}">
      <meta property="og:type" content="website">
      <meta property="og:title" content="${title}">
      <meta property="og:description" content="${description}">
      ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ""}
      <meta property="og:url" content="${pageUrl}">
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

    // Short cache — an admin's SEO/content edit shows up within about a
    // minute, without needing a redeploy (same reasoning as api/share.js).
    return htmlResponse(html, 200, "public, s-maxage=60, stale-while-revalidate=30");
  } catch (error) {
    console.error("api/page failed:", error);
    return htmlResponse(notFoundHtml(), 500);
  }
}
