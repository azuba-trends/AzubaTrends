// functions/robots.txt.js
//
// Was a static file before; converted to a Function for the same reason
// sitemap.xml and manifest.webmanifest already are (see api/site-meta.js)
// — its one dynamic piece is the "Sitemap:" line, which must be an
// absolute URL. A static file can't know what domain it's being served
// from, so it used to hardcode one (and that hardcoded value silently
// went stale the day this site moved off Vercel). Deriving it from the
// incoming request, the same way sitemap.xml's handleSitemap() already
// does, means this is correct on whatever domain serves it — including
// if the domain changes again later — with zero manual edits.
export async function onRequestGet(context) {
  const origin = new URL(context.request.url).origin;

  const body = `User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /cart.html
Disallow: /checkout.html
Disallow: /share-preview-tester.html
Disallow: /product-import-tester.html
Disallow: /api/

# These two are public, read-only, and are what storefront pages actually
# fetch client-side to render their content (see js/product-loader.js and
# js/blog-loader.js) — blocking them under the blanket /api/ rule above
# stops Googlebot's own renderer from seeing product/blog content when it
# renders a page for indexing, even though the page itself indexes fine.
# Every other /api/ route stays blocked (admin tools, order actions,
# review/notify submissions — none of them are fetched passively while a
# page renders, so blocking them costs nothing).
Allow: /api/products
Allow: /api/blog-posts

# AI/LLM-friendly site map (static file, no per-request generation)
Allow: /llms.txt

Sitemap: ${origin}/sitemap.xml
`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
