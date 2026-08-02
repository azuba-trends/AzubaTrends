// functions/api/brands.js
// Dedicated file so the clean URL /api/brands works without a
// query-string rewrite (same reasoning as functions/api/categories.js —
// see that file's comment for why). Just forwards to api/list.js's
// handler with type=brands hardcoded.
import { onRequestGet as listHandler } from "./list.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "brands");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return listHandler({ ...context, request });
}
