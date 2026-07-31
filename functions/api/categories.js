// functions/api/categories.js
// Dedicated file so the clean URL /api/categories works without a
// query-string rewrite (same reasoning as functions/api/products.js —
// see that file's comment and _routes.json's header for why).
// Just forwards to api/list.js's handler with type=categories hardcoded.
import { onRequestGet as listHandler } from "./list.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "categories");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return listHandler({ ...context, request });
}
