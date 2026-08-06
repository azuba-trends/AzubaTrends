// functions/api/imagekit-auth.js
//
// ImageKit's client-side (browser) upload isn't a bare-public-key model
// like ImgBB's — the actual upload request must carry a short-lived
// {token, expire, signature} triple, and `signature` can only be computed
// with the account's PRIVATE key (HMAC-SHA1 of token+expire). The private
// key must never reach the browser, so this endpoint is the one place
// that ever touches it: it reads settings/imagekit_private via the
// service account (bypasses firestore.rules entirely, same as every other
// function in this folder — see lib/firestore-rest.js), signs a
// fresh token, and hands back ONLY the {token, expire, signature} triple.
// That triple is safe to expose: it's scoped to one upload and expires in
// 30 minutes, the same shape ImageKit's own docs show being served from a
// trivial, unauthenticated `/signature` route (see imagekit.io/blog/
// client-side-file-upload) — so no auth is required to call this either;
// it hands out permission to upload, not to read/change anything.
//
// Called from js/image-upload.js, shared by BOTH the admin panel (product
// images) and reviews.js (guest review photos) — whichever needs to
// upload when ImageKit is the active provider (see Settings > Image
// Hosting).

import { getDoc } from "../../lib/firestore-rest.js";

const MAX_REQUESTS_PER_IP_PER_MINUTE = 20; // generous — this just signs a token, doesn't write anything

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function getClientIp(request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

// In-memory-per-isolate throttle is good enough here — this is a light
// abuse guard (stop a script from hammering the endpoint), not a security
// boundary; the real protection is that a signed token only ever permits
// ONE actual upload to ImageKit before it's consumed/expires.
const recentRequests = new Map(); // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const timestamps = (recentRequests.get(ip) || []).filter((t) => t > windowStart);
  timestamps.push(now);
  recentRequests.set(ip, timestamps);
  return timestamps.length > MAX_REQUESTS_PER_IP_PER_MINUTE;
}

async function hmacSha1Hex(key, message) {
  const keyBytes = new TextEncoder().encode(key);
  const msgBytes = new TextEncoder().encode(message);
  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", cryptoKey, msgBytes);
  return [...new Uint8Array(sigBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (isRateLimited(getClientIp(request))) {
      return json({ error: "Too many requests. Please try again in a moment." }, 429);
    }

    const privateKeyDoc = await getDoc(env, "settings/imagekit_private");
    const privateKey = privateKeyDoc && privateKeyDoc.privateKey;
    if (!privateKey) {
      return json({ error: "ImageKit isn't configured yet — add a Private Key in Settings > Image Hosting." }, 400);
    }

    const token = crypto.randomUUID();
    const expire = Math.floor(Date.now() / 1000) + 1800; // 30 minutes — comfortably inside ImageKit's accepted window
    const signature = await hmacSha1Hex(privateKey, token + expire);

    return json({ ok: true, token, expire, signature });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't prepare the image upload. Please try again." }, 500);
  }
}
