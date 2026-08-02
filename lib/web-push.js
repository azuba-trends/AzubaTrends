// lib/web-push.js
//
// Sends a Web Push notification to a single browser subscription, fully
// self-contained (no npm 'web-push' package, no nodejs_compat compat
// flag) — everything here runs on plain Web Crypto (SubtleCrypto), which
// Cloudflare Workers supports natively. This mirrors how
// lib/firestore-rest.js already replaces firebase-admin: fewer/lighter
// dependencies, same result.
//
// References:
//   RFC 8291 — Message Encryption for Web Push (the aes128gcm scheme)
//   RFC 8292 — Voluntary Application Server Identification (VAPID)
//
// If you ever need to debug a delivery failure, the most common causes
// are: (1) VAPID_PRIVATE_KEY env var missing/wrong, (2) the subscription
// itself is stale (push service returns 404/410 — see pruning in
// functions/api/send-push.js), or (3) payload too large (push services
// cap this around 4KB; keep title/body short, which the admin form's
// maxlength already enforces).

function base64UrlToUint8Array(base64Url) {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function uint8ArrayToBase64Url(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatUint8Arrays(arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

// ---- VAPID: builds the "Authorization: vapid t=<jwt>, k=<publicKey>"
// header value (RFC 8292). ---------------------------------------------
async function buildVapidAuthHeader(vapidPublicKeyB64Url, vapidPrivateKeyB64Url, endpoint, subjectMailto) {
  const publicKeyBytes = base64UrlToUint8Array(vapidPublicKeyB64Url); // 65 bytes: 0x04 || X(32) || Y(32)
  const x = publicKeyBytes.slice(1, 33);
  const y = publicKeyBytes.slice(33, 65);
  const d = base64UrlToUint8Array(vapidPrivateKeyB64Url); // 32-byte private scalar

  const jwk = {
    kty: "EC", crv: "P-256",
    x: uint8ArrayToBase64Url(x), y: uint8ArrayToBase64Url(y), d: uint8ArrayToBase64Url(d),
    ext: true
  };
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const audience = new URL(endpoint).origin; // push service's own origin, e.g. https://fcm.googleapis.com
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h, well under the 24h max
    sub: subjectMailto
  };
  const enc = (obj) => uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${enc(header)}.${enc(payload)}`;

  // Web Crypto's ECDSA sign() already returns raw (r||s) — exactly the
  // format a JWS ES256 signature needs, no DER conversion required.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${uint8ArrayToBase64Url(new Uint8Array(signature))}`;

  return `vapid t=${jwt}, k=${vapidPublicKeyB64Url}`;
}

// ---- Payload encryption (RFC 8291, the aes128gcm content-encoding) ----
async function encryptPayload(payloadObj, subscriberPublicKeyB64Url, subscriberAuthSecretB64Url) {
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
  // A single 0x02 delimiter byte marks "no padding follows" — RFC 8291 §4.
  const paddedPlaintext = concatUint8Arrays([plaintext, new Uint8Array([2])]);

  const subscriberPublicKeyBytes = base64UrlToUint8Array(subscriberPublicKeyB64Url); // uncompressed P-256 point
  const authSecret = base64UrlToUint8Array(subscriberAuthSecretB64Url); // 16 bytes

  const subscriberPublicKey = await crypto.subtle.importKey(
    "raw", subscriberPublicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
  );

  // Ephemeral local ECDH keypair — one per message, per RFC 8291.
  const localKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const localPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey("raw", localKeyPair.publicKey));

  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberPublicKey }, localKeyPair.privateKey, 256
  );
  const ecdhSecret = new Uint8Array(sharedSecretBits);

  async function hkdf(saltBytes, ikmBytes, infoBytes, lengthBytes) {
    const key = await crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: saltBytes, info: infoBytes }, key, lengthBytes * 8
    );
    return new Uint8Array(bits);
  }

  // Step 1: combine the ECDH secret with the subscription's auth secret.
  const keyInfo = concatUint8Arrays([
    new TextEncoder().encode("WebPush: info\0"), subscriberPublicKeyBytes, localPublicKeyBytes
  ]);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // Step 2: derive the actual content-encryption key + nonce from a
  // fresh random salt (this salt also travels in the message header).
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, paddedPlaintext)
  );

  // aes128gcm binary header (RFC 8188 §2.1): salt(16) || rs(4, record
  // size) || idlen(1) || keyid(our ephemeral public key, 65 bytes)
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096); // one record — payload is always well under 4096 bytes here
  const idLen = new Uint8Array([localPublicKeyBytes.length]);

  return concatUint8Arrays([salt, recordSize, idLen, localPublicKeyBytes, ciphertext]);
}

/**
 * Sends one push notification to one subscription.
 * @returns {Promise<{ok: boolean, status: number, stale: boolean}>}
 *   `stale` is true on 404/410 — the push service is telling us this
 *   subscription is dead and should be deleted (handled by the caller).
 */
export async function sendWebPush(env, subscription, payloadObj) {
  const vapidPublicKey = env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set as environment variables.");
  }

  const authHeader = await buildVapidAuthHeader(
    vapidPublicKey, vapidPrivateKey, subscription.endpoint,
    (env.VAPID_SUBJECT_EMAIL && `mailto:${env.VAPID_SUBJECT_EMAIL}`) || "mailto:admin@azubatrends.com"
  );
  const body = await encryptPayload(payloadObj, subscription.keys.p256dh, subscription.keys.auth);

  const resp = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400", // push service may hold the message up to 24h if the device is offline
      "Authorization": authHeader
    },
    body
  });

  return { ok: resp.ok, status: resp.status, stale: resp.status === 404 || resp.status === 410 };
}
