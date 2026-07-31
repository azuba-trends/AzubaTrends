// functions/[slug].js
// Cloudflare Pages Functions single-dynamic-segment file, matching the
// original vercel.json catch-all rewrite ("/:slug" -> "/api/page?slug=:slug")
// for single-path-segment URLs (custom pages like /about-us, /terms, etc,
// backed by the "pages" Firestore collection). Uses single brackets
// (one segment) rather than double brackets (catch-all/multi-segment) to
// match the original's single-segment semantics precisely.
//
// Cloudflare Pages only invokes this when no static file and no more
// specific Function route matches the request path first, so this can't
// shadow index.html, about.html, functions/api/*.js, functions/share.js,
// etc. — same effective priority order the original vercel.json rewrite
// list had (specific rewrites listed before the catch-all).
import { onRequestGet as pageHandler } from "./api/page.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const slug = context.params.slug;
  url.searchParams.set("slug", slug);
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return pageHandler({ ...context, request });
}
