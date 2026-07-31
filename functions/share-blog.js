// functions/share-blog.js
// Maps clean URL /share-blog -> functions/api/share.js with type=blog.
import { onRequestGet as shareHandler } from "./api/share.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "blog");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return shareHandler({ ...context, request });
}
