// functions/_middleware.js
//
// DOMAIN-PROOFING MIDDLEWARE
// ---------------------------------------------------------------------
// WHY THIS EXISTS
// Static HTML files (about.html, terms.html, index.html, and the pre-JS
// fallback tags in blog.html/blog-post.html/category.html/product.html)
// each hardcode an absolute URL in their canonical / og:url / og:image /
// twitter:image tags. That's not a mistake — those tags are required by
// spec to be a full "https://..." URL, relative paths aren't valid there,
// and plain static files have no server-side templating of their own to
// fill that in per-request the way functions/api/site-meta.js's
// sitemap.xml already does.
//
// This middleware is what gives static HTML the same "derive the domain
// from the request, don't hardcode it" behavior that sitemap.xml and
// functions/api/page.js / functions/api/share.js already have. It runs on
// every response, and — using Cloudflare's streaming HTMLRewriter —
// rewrites ONLY the origin (the https://domain part, never the path) of
// four specific self-referential tags to whatever domain the request
// actually came in on:
//   <link rel="canonical" href="...">
//   <meta property="og:url" content="...">
//   <meta property="og:image" content="...">
//   <meta name="twitter:image" content="...">
//
// End result: whatever domain is baked into the HTML source no longer
// has to be correct. If this site ever moves to a new domain again (a
// custom domain instead of *.pages.dev, or anything else), NOTHING here
// needs a manual find-and-replace — the right domain is filled in fresh
// on every single request.
//
// It deliberately does NOT touch any other absolute URL (fonts, gstatic,
// Firebase, etc.) — only the four tags above, which are the only ones on
// this site that are supposed to always point back at itself.
//
// TRADE-OFF TO KNOW ABOUT: for this to run at all on pages like /about or
// /terms, those paths had to be removed from _routes.json's `exclude`
// list (previously they skipped Cloudflare Pages Functions entirely and
// were served as pure static assets — the fastest possible path). Now
// every page view invokes this Function once. For a normal store's
// traffic this is not something you'll notice or need to think about —
// but it's a real, intentional trade-off (a tiny bit of latency + a
// Functions invocation counted against Cloudflare's usage, instead of a
// pure static-asset hit) made in exchange for never having to hand-edit
// a domain into these files again. If that one-time invocation overhead
// ever actually matters for your traffic volume, the alternative is
// reverting _routes.json's excludes and going back to manually updating
// the hardcoded URLs in about.html/terms.html/etc. whenever the domain
// changes.
// ---------------------------------------------------------------------

function rewriteOrigin(value, correctOrigin) {
  if (!value) return value;
  try {
    const current = new URL(value);
    const wanted = new URL(correctOrigin);
    current.protocol = wanted.protocol;
    current.host = wanted.host;
    return current.toString();
  } catch {
    // Not an absolute URL (or malformed) — leave it exactly as-is rather
    // than risk corrupting something this wasn't meant to touch.
    return value;
  }
}

class AttributeOriginRewriter {
  constructor(attrName, correctOrigin) {
    this.attrName = attrName;
    this.correctOrigin = correctOrigin;
  }
  element(el) {
    const current = el.getAttribute(this.attrName);
    if (!current) return;
    const fixed = rewriteOrigin(current, this.correctOrigin);
    if (fixed !== current) el.setAttribute(this.attrName, fixed);
  }
}

export async function onRequest(context) {
  const response = await context.next();

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const correctOrigin = new URL(context.request.url).origin;

  return new HTMLRewriter()
    .on('link[rel="canonical"]', new AttributeOriginRewriter("href", correctOrigin))
    .on('meta[property="og:url"]', new AttributeOriginRewriter("content", correctOrigin))
    .on('meta[property="og:image"]', new AttributeOriginRewriter("content", correctOrigin))
    .on('meta[name="twitter:image"]', new AttributeOriginRewriter("content", correctOrigin))
    .transform(response);
}
