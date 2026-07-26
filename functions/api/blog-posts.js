// functions/api/blog-posts.js
// Same reasoning as functions/api/products.js — /api/blog-posts needs
// its own file since query-param rewrites aren't possible on Cloudflare
// Pages routing config.
import { onRequestGet as listHandler } from "./list.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "posts");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return listHandler({ ...context, request });
}
