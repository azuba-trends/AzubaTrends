// functions/manifest.webmanifest.js
// Cloudflare Pages Functions map a dotted filename like this directly to
// the URL path /manifest.webmanifest. Forwards to api/site-meta.js's
// handler with type=manifest hardcoded.
import { onRequestGet as siteMetaHandler } from "./api/site-meta.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "manifest");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return siteMetaHandler({ ...context, request });
}
