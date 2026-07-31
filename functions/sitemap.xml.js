// functions/sitemap.xml.js
// Maps clean URL /sitemap.xml -> api/site-meta.js's handler with
// type=sitemap hardcoded.
import { onRequestGet as siteMetaHandler } from "./api/site-meta.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "sitemap");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return siteMetaHandler({ ...context, request });
}
