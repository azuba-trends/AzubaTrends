// functions/share.js
// Maps clean URL /share -> the same logic as functions/api/share.js with
// type=product hardcoded. Lives at the Pages Functions root (not under
// api/) because Cloudflare Pages Functions map file path -> URL path
// literally, and the clean URL here has no /api prefix.
import { onRequestGet as shareHandler } from "./api/share.js";

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  url.searchParams.set("type", "product");
  const request = new Request(url.toString(), { headers: context.request.headers, method: "GET" });
  return shareHandler({ ...context, request });
}
