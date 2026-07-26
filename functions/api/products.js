// functions/api/products.js
// Dedicated file so the clean URL /api/products works without a
// query-string rewrite (Cloudflare Pages' _routes.json/_redirects can't
// append query params — see lib/firestore-rest.js author's REPORT.md).
// Just forwards to api/list.js's handler with type=products hardcoded.
import { onRequestGet as listHandler } from "./list.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "products");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return listHandler({ ...context, request });
}
