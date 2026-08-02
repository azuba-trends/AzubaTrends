// lib/firestore-rest.js
//
// Cloudflare-Workers-compatible replacement for firebase-admin's Firestore
// client. firebase-admin uses Node APIs (net/tls sockets, Node's `crypto`
// module, gRPC) that don't exist in the Workers runtime, so this talks to
// Firestore directly over its public REST API using plain fetch(), and
// authenticates as the service account by signing its own OAuth2 JWT with
// the Web Crypto API (globalThis.crypto.subtle).
//
// Reads env.FIREBASE_SERVICE_ACCOUNT_KEY — the SAME base64-encoded service
// account JSON that Vercel used (see SERVICE-ACCOUNT-SETUP-GUIDE.md). No
// env var rename needed.
//
// Every exported function signature below matches the SHARED CONTRACT the
// rest of the migration team is coding against. Do not rename anything here.

const FIRESTORE_HOST = "https://firestore.googleapis.com/v1";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DATASTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
// JWK (not the legacy x509) endpoint for Firebase Auth's ID-token signing
// keys — lets us use crypto.subtle.importKey("jwk", ...) directly instead
// of writing an ASN.1/X.509 certificate parser to pull the key out by hand.
const FIREBASE_JWK_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// ---------------------------------------------------------------------
// Module-level caches. Cloudflare Workers/Pages Functions reuse the same
// isolate across many requests (it's a long-lived JS context, not a fresh
// process per-request), so caching the parsed service account, the signed
// access token, and Firebase's public keys here is safe AND desirable —
// it avoids re-signing a JWT and re-hitting Google's token endpoint on
// every single request. Each is scoped to this module only (nothing is
// ever shared across different Cloudflare accounts/deployments).
// ---------------------------------------------------------------------
let cachedServiceAccount = null;
let cachedAccessToken = null; // { token, expiresAt } (expiresAt = unix seconds)
let cachedFirebaseJwks = null; // { keys: {...}, expiresAt }

// =======================================================================
// Base64 / PEM helpers (Workers has atob/btoa but not Node's Buffer)
// =======================================================================

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecodeToBytes(str) {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64DecodeToString(b64) {
  // Standard (non-URL-safe) base64 decode -> UTF-8 string. Used for the
  // FIREBASE_SERVICE_ACCOUNT_KEY env var, which is plain base64 (not
  // base64url) — same encoding Vercel's Buffer.from(raw, "base64") used.
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

function pemToDerBytes(pem) {
  const cleaned = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/[\r\n\s]/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonToBase64Url(obj) {
  return base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(obj)));
}

function decodeJwtSegment(segment) {
  return JSON.parse(new TextDecoder("utf-8").decode(base64UrlDecodeToBytes(segment)));
}

// =======================================================================
// Service account + OAuth2 access token (for calling Firestore's own API)
// =======================================================================

function getServiceAccount(env) {
  if (cachedServiceAccount) return cachedServiceAccount;
  const raw = env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY is not set. Add it in Cloudflare Pages -> " +
        "Settings -> Environment Variables (same base64-encoded value used on Vercel), then redeploy."
    );
  }
  try {
    cachedServiceAccount = JSON.parse(base64DecodeToString(raw));
  } catch (err) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY could not be parsed — make sure it's the base64-encoded " +
        "value (see SERVICE-ACCOUNT-SETUP-GUIDE.md), not the raw JSON file."
    );
  }
  return cachedServiceAccount;
}

async function importSigningKey(pem) {
  const der = pemToDerBytes(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function getAccessToken(env) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && cachedAccessToken.expiresAt - 60 > nowSec) {
    return cachedAccessToken.token;
  }

  const sa = getServiceAccount(env);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: DATASTORE_SCOPE,
    aud: TOKEN_URI,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(claims)}`;
  const key = await importSigningKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput)
  );
  const assertion = `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`;

  const resp = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent(
      "urn:ietf:params:oauth:grant-type:jwt-bearer"
    )}&assertion=${encodeURIComponent(assertion)}`,
  });
  if (!resp.ok) {
    throw new Error(`Failed to obtain Google OAuth2 access token: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  cachedAccessToken = { token: data.access_token, expiresAt: nowSec + (data.expires_in || 3600) };
  return cachedAccessToken.token;
}

function documentsRoot(sa) {
  return `projects/${sa.project_id}/databases/(default)/documents`;
}

async function firestoreFetch(env, pathSuffix, options = {}) {
  const token = await getAccessToken(env);
  const sa = getServiceAccount(env);
  const url = `${FIRESTORE_HOST}/${documentsRoot(sa)}${pathSuffix}`;
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

async function throwIfNotOk(resp, label) {
  if (!resp.ok) {
    throw new Error(`${label} failed: ${resp.status} ${await resp.text()}`);
  }
}

// =======================================================================
// Firestore typed-value <-> plain JS conversion
// =======================================================================

const INCREMENT_MARKER = Symbol("firestoreIncrement");

export function increment(n) {
  return { [INCREMENT_MARKER]: true, value: n };
}

function isIncrementMarker(v) {
  return v !== null && typeof v === "object" && v[INCREMENT_MARKER] === true;
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (isIncrementMarker(value)) {
    // increment() is only meaningful as a TOP-LEVEL field value inside
    // updateDoc()'s data object (it becomes a fieldTransform there, not a
    // plain value) — see updateDoc(). It can't be nested inside an array
    // or map, so reaching this branch is a caller bug.
    throw new Error("increment() can only be used as a top-level field in updateDoc(env, path, data).");
  }
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(value)) fields[k] = toFirestoreValue(v);
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported value type for Firestore: ${typeof value}`);
}

function fromFirestoreValue(fv) {
  if (!fv) return null;
  if ("nullValue" in fv) return null;
  if ("stringValue" in fv) return fv.stringValue;
  if ("booleanValue" in fv) return fv.booleanValue;
  if ("integerValue" in fv) return Number(fv.integerValue);
  if ("doubleValue" in fv) return fv.doubleValue;
  // Returned as an ISO string (same as calling .toDate().toISOString() on
  // an Admin SDK Timestamp) rather than a Firestore Timestamp instance —
  // there's no Timestamp class here. Callers that need a Date should wrap
  // with `new Date(value)`.
  if ("timestampValue" in fv) return fv.timestampValue;
  if ("mapValue" in fv) return fromFirestoreFields(fv.mapValue.fields || {});
  if ("arrayValue" in fv) return (fv.arrayValue.values || []).map(fromFirestoreValue);
  if ("referenceValue" in fv) return fv.referenceValue;
  if ("geoPointValue" in fv) return fv.geoPointValue;
  if ("bytesValue" in fv) return fv.bytesValue;
  return null;
}

function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}

// Splits a plain data object into: fields that convert directly to
// Firestore values, and increment() markers that must become
// fieldTransforms instead (increments can't be expressed as a plain value).
function splitPlainAndIncrements(data) {
  const plainFields = {};
  const transforms = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (isIncrementMarker(v)) {
      transforms.push({
        fieldPath: k,
        increment: Number.isInteger(v.value) ? { integerValue: String(v.value) } : { doubleValue: v.value },
      });
    } else {
      plainFields[k] = toFirestoreValue(v);
    }
  }
  return { plainFields, transforms };
}

function docIdFromName(name) {
  return name.split("/").pop();
}

function docFromApiDoc(apiDoc) {
  if (!apiDoc || !apiDoc.name) return null;
  return { id: docIdFromName(apiDoc.name), ...fromFirestoreFields(apiDoc.fields) };
}

// =======================================================================
// Public API — see SHARED CONTRACT for exact signatures
// =======================================================================

export async function getDoc(env, path) {
  const resp = await firestoreFetch(env, `/${path}`, { method: "GET" });
  if (resp.status === 404) return null;
  await throwIfNotOk(resp, `getDoc(${path})`);
  return docFromApiDoc(await resp.json());
}

// Deletes a document. Silently no-ops (doesn't throw) if it's already
// gone, so a double-click on a "Delete" button in the UI can't surface an
// error for something that already succeeded.
export async function deleteDoc(env, path) {
  const resp = await firestoreFetch(env, `/${path}`, { method: "DELETE" });
  if (resp.status === 404) return;
  await throwIfNotOk(resp, `deleteDoc(${path})`);
}

const OP_MAP = {
  "==": "EQUAL",
  "<": "LESS_THAN",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  ">=": "GREATER_THAN_OR_EQUAL",
  "!=": "NOT_EQUAL",
  "array-contains": "ARRAY_CONTAINS",
  in: "IN",
  "array-contains-any": "ARRAY_CONTAINS_ANY",
  "not-in": "NOT_IN",
};

export async function getDocs(env, collectionPath, opts = {}) {
  // NOTE: assumes collectionPath is a TOP-LEVEL collection (e.g.
  // "products"), which is all this codebase currently queries. The
  // `from.collectionId` + documents-root `parent` below only address a
  // top-level collection; a nested subcollection path (e.g.
  // "stores/abc/products") would need `parent` set to that subcollection's
  // parent document instead. Flagged in REPORT.md as a risk area.
  const collectionId = collectionPath.split("/").pop();
  const structuredQuery = { from: [{ collectionId }] };

  const filters = (opts.where || []).map(([field, op, value]) => ({
    fieldFilter: { field: { fieldPath: field }, op: OP_MAP[op], value: toFirestoreValue(value) },
  }));
  if (filters.length === 1) {
    structuredQuery.where = filters[0];
  } else if (filters.length > 1) {
    structuredQuery.where = { compositeFilter: { op: "AND", filters } };
  }

  const resp = await firestoreFetch(env, ":runQuery", {
    method: "POST",
    body: JSON.stringify({ structuredQuery }),
  });
  await throwIfNotOk(resp, `getDocs(${collectionPath})`);
  const rows = await resp.json(); // array of { document?, readTime }
  return (rows || []).filter((r) => r.document).map((r) => docFromApiDoc(r.document));
}

export async function getAll(env, paths) {
  if (!paths.length) return [];
  const sa = getServiceAccount(env);
  const base = documentsRoot(sa);
  const fullNames = paths.map((p) => `${base}/${p}`);

  const resp = await firestoreFetch(env, ":batchGet", {
    method: "POST",
    body: JSON.stringify({ documents: fullNames }),
  });
  await throwIfNotOk(resp, "getAll");
  const rows = await resp.json(); // array of { found?, missing?, readTime }

  // Firestore's batchGet response order is NOT guaranteed to match the
  // request order, so we index by full document name and re-map to the
  // caller's original path order ourselves.
  const byName = new Map();
  for (const row of rows || []) {
    if (row.found) byName.set(row.found.name, docFromApiDoc(row.found));
    else if (row.missing) byName.set(row.missing, null);
  }
  return fullNames.map((name) => (byName.has(name) ? byName.get(name) : null));
}

export async function createDoc(env, collectionPath, id, data) {
  const { plainFields } = splitPlainAndIncrements(data);
  const resp = await firestoreFetch(env, `/${collectionPath}?documentId=${encodeURIComponent(id)}`, {
    method: "POST",
    body: JSON.stringify({ fields: plainFields }),
  });
  if (resp.status === 409) {
    throw new Error(`createDoc: document already exists at ${collectionPath}/${id}`);
  }
  await throwIfNotOk(resp, `createDoc(${collectionPath}/${id})`);
  return docFromApiDoc(await resp.json());
}

export async function setDoc(env, path, data, merge) {
  const { plainFields } = splitPlainAndIncrements(data);
  let suffix = `/${path}`;
  if (merge) {
    const maskParams = Object.keys(plainFields)
      .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
      .join("&");
    if (maskParams) suffix += `?${maskParams}`;
  }
  // No updateMask at all (merge falsy) means Firestore replaces the WHOLE
  // document with exactly these fields — matches Admin SDK's
  // db.doc(path).set(data) (no merge) semantics.
  const resp = await firestoreFetch(env, suffix, {
    method: "PATCH",
    body: JSON.stringify({ fields: plainFields }),
  });
  await throwIfNotOk(resp, `setDoc(${path})`);
  return docFromApiDoc(await resp.json());
}

export async function updateDoc(env, path, data) {
  const sa = getServiceAccount(env);
  const name = `${documentsRoot(sa)}/${path}`;
  const { plainFields, transforms } = splitPlainAndIncrements(data);

  const write = {
    update: { name, fields: plainFields },
    updateMask: { fieldPaths: Object.keys(plainFields) },
  };
  if (transforms.length) write.updateTransforms = transforms;

  const resp = await firestoreFetch(env, ":commit", {
    method: "POST",
    body: JSON.stringify({ writes: [write] }),
  });
  await throwIfNotOk(resp, `updateDoc(${path})`);
  // commit's response is {writeResults, commitTime}, not the updated
  // document — callers that need the post-update doc should re-getDoc().
  return await resp.json();
}

export async function runTransaction(env, fn, maxAttempts = 5) {
  const sa = getServiceAccount(env);
  const base = documentsRoot(sa);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const beginResp = await firestoreFetch(env, ":beginTransaction", {
      method: "POST",
      body: JSON.stringify({}),
    });
    await throwIfNotOk(beginResp, "runTransaction:beginTransaction");
    const { transaction } = await beginResp.json();

    const pendingWrites = [];
    const txnHandle = {
      async get(path) {
        const resp = await firestoreFetch(
          env,
          `/${path}?transaction=${encodeURIComponent(transaction)}`,
          { method: "GET" }
        );
        if (resp.status === 404) return null;
        await throwIfNotOk(resp, `runTransaction:get(${path})`);
        return docFromApiDoc(await resp.json());
      },
      update(path, data) {
        // Matches Admin SDK transaction semantics: update() only queues
        // the write — nothing is sent to Firestore until commit, below.
        const docName = `${base}/${path}`;
        const { plainFields, transforms } = splitPlainAndIncrements(data);
        const write = {
          update: { name: docName, fields: plainFields },
          updateMask: { fieldPaths: Object.keys(plainFields) },
        };
        if (transforms.length) write.updateTransforms = transforms;
        pendingWrites.push(write);
      },
    };

    let result;
    try {
      result = await fn(txnHandle);
    } catch (err) {
      // Best-effort rollback so Firestore frees the transaction early;
      // swallow rollback errors since the original error is what matters.
      await firestoreFetch(env, ":rollback", {
        method: "POST",
        body: JSON.stringify({ transaction }),
      }).catch(() => {});
      throw err;
    }

    const commitResp = await firestoreFetch(env, ":commit", {
      method: "POST",
      body: JSON.stringify({ transaction, writes: pendingWrites }),
    });
    if (commitResp.ok) return result;

    const bodyText = await commitResp.text();
    const isConflict = commitResp.status === 409 || /ABORTED/i.test(bodyText);
    if (isConflict && attempt < maxAttempts - 1) continue; // retry with a brand-new transaction
    throw new Error(`runTransaction:commit failed: ${commitResp.status} ${bodyText}`);
  }
  throw new Error("runTransaction: exceeded max retries due to repeated conflicts");
}

export async function batchWrite(env, operations) {
  const sa = getServiceAccount(env);
  const base = documentsRoot(sa);

  // Implemented via Firestore's atomic `:commit` endpoint (all-writes-or-
  // none), NOT the REST API's separate `:batchWrite` endpoint (which
  // applies each write independently/non-atomically and reports a
  // per-write status). Chosen because every other multi-write path in
  // this file (updateDoc, runTransaction) is atomic, and "batch" call
  // sites migrating off the Admin SDK's db.batch() also expect atomic
  // commit-or-fail. Flagged in REPORT.md — please confirm this matches
  // what your call site actually needs.
  const writes = operations.map((op) => {
    const name = `${base}/${op.path}`;
    if (op.type === "delete") return { delete: name };

    const { plainFields, transforms } = splitPlainAndIncrements(op.data || {});
    const write = { update: { name, fields: plainFields } };
    if (op.type === "update") {
      write.updateMask = { fieldPaths: Object.keys(plainFields) };
    }
    // op.type === "set": no updateMask -> full-document overwrite, same
    // as setDoc(env, path, data, /* merge */ false).
    if (transforms.length) write.updateTransforms = transforms;
    return write;
  });

  const resp = await firestoreFetch(env, ":commit", {
    method: "POST",
    body: JSON.stringify({ writes }),
  });
  await throwIfNotOk(resp, "batchWrite");
  return await resp.json();
}

// =======================================================================
// verifyIdToken — validates a Firebase Auth ID token WITHOUT the Admin SDK
// =======================================================================

async function getFirebaseJwks() {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedFirebaseJwks && cachedFirebaseJwks.expiresAt > nowSec) {
    return cachedFirebaseJwks.keys;
  }
  const resp = await fetch(FIREBASE_JWK_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase Auth public keys: ${resp.status} ${await resp.text()}`);
  }
  const keys = await resp.json(); // { keys: [ {kid, ...jwk}, ... ] }
  // Respect the endpoint's Cache-Control max-age like the Admin SDK does,
  // falling back to 1 hour if it's missing/unparseable.
  const cacheControl = resp.headers.get("cache-control") || "";
  const maxAgeMatch = /max-age=(\d+)/.exec(cacheControl);
  const maxAge = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  cachedFirebaseJwks = { keys, expiresAt: nowSec + maxAge };
  return keys;
}

export async function verifyIdToken(env, idToken) {
  const parts = (idToken || "").split(".");
  if (parts.length !== 3) throw new Error("verifyIdToken: malformed token (not a JWT).");

  const header = decodeJwtSegment(parts[0]);
  const payload = decodeJwtSegment(parts[1]);
  const nowSec = Math.floor(Date.now() / 1000);

  if (header.alg !== "RS256") throw new Error("verifyIdToken: unexpected alg (expected RS256).");
  if (!header.kid) throw new Error("verifyIdToken: token header missing 'kid'.");
  if (!payload.exp || payload.exp <= nowSec) throw new Error("verifyIdToken: token expired.");
  if (!payload.iat || payload.iat > nowSec + 60) throw new Error("verifyIdToken: token issued in the future.");

  const sa = getServiceAccount(env);
  const projectId = sa.project_id;
  if (payload.aud !== projectId) throw new Error("verifyIdToken: audience does not match this Firebase project.");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error("verifyIdToken: issuer does not match this Firebase project.");
  }
  if (!payload.sub || typeof payload.sub !== "string") throw new Error("verifyIdToken: missing subject (uid).");
  if (payload.auth_time && payload.auth_time > nowSec + 60) {
    throw new Error("verifyIdToken: auth_time is in the future.");
  }

  const { keys } = await getFirebaseJwks();
  const jwk = (keys || []).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("verifyIdToken: no matching public key for token's 'kid' (keys may have rotated).");

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlDecodeToBytes(parts[2]);
  const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, publicKey, signature, signedData);
  if (!valid) throw new Error("verifyIdToken: signature verification failed.");

  // Matches Admin SDK's verifyIdToken() return shape closely enough for
  // this repo's only use (an isAdmin()-style "is this a real signed-in
  // Firebase user" check) — full decoded claims, uid available as both
  // `.sub` and `.uid` since Admin SDK callers commonly read `.uid`.
  return { ...payload, uid: payload.sub };
}