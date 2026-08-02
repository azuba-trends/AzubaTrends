// functions/api/push-subscribe.js
// Saves a browser's push subscription (from js/layout.js's AzubaPush.subscribe())
// to Firestore, so functions/api/send-push.js has somewhere to look up
// subscribers from later — both for automatic notifications (order
// status, back-in-stock, etc.) and admin-triggered custom ones.
import { setDoc } from "../../lib/firestore-rest.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid request body." }, 400);
  }

  try {
    const { subscription, deviceId } = body || {};
    if (!subscription || typeof subscription.endpoint !== "string" || !subscription.keys) {
      return json({ error: "Invalid subscription." }, 400);
    }

    // Deterministic id from the endpoint URL (which is itself unique per
    // browser+device+origin) — re-subscribing overwrites the same doc
    // instead of piling up duplicates every time a browser re-registers.
    const docId = await sha256Hex(subscription.endpoint);

    await setDoc(env, `push_subscriptions/${docId}`, {
      endpoint: subscription.endpoint,
      keys: subscription.keys, // { p256dh, auth }
      deviceId: deviceId || null, // links this subscription to orders placed from the same browser — see js/layout.js's getDeviceId()
      updatedAt: new Date().toISOString()
      // Further segmentation fields (e.g. which categories/wishlist this
      // device cares about) get added here later once segment targeting
      // is built — not needed for order-status + "send to everyone".
    }, /* merge */ false);

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong saving your subscription." }, 500);
  }
}
