// functions/api/send-push.js
//
// Two ways this gets called:
//   1. Targeted: { deviceId, title, body, url, image? } — fired automatically
//      by admin.js right after an order's status changes, so only the
//      customer who placed THAT order gets notified.
//   2. Broadcast: { broadcast: true, title, body, url, image? } — the
//      Notifications panel in admin.html (custom announcements), AND the
//      "Push Notify" button on a product row (semi-automatic New Arrival
//      announcement) — both send to every subscriber.
//
// `image` is optional and just a hosted image URL (this store already
// hosts every product photo that way) — see sw.js's push handler for how
// it turns into the big banner-style picture inside the notification.
//
// Admin-auth-protected either way — this endpoint can push arbitrary
// text to real devices, so it must never be callable by an unauthenticated
// visitor (that would be an open notification-spam/phishing vector).
import { requireAdmin } from "../../lib/auth.js";
import { getDocs, createDoc, deleteDoc } from "../../lib/firestore-rest.js";
import { sendWebPush } from "../../lib/web-push.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    await requireAdmin(request, env);
  } catch (err) {
    return json({ error: "Unauthorized." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid request body." }, 400);
  }

  try {
    const { deviceId, broadcast, title, body: message, url, image, buttonText } = body || {};
    if (!title || !message) return json({ error: "Title and message are required." }, 400);
    if (!broadcast && !deviceId) return json({ error: "Missing deviceId (or set broadcast: true)." }, 400);

    const subs = broadcast
      ? await getDocs(env, "push_subscriptions")
      : await getDocs(env, "push_subscriptions", { where: [["deviceId", "==", deviceId]] });

    const payload = { title, body: message, url: url || "/" };
    // Keep the payload lean when there's no image — cheaper to encrypt/send
    // and avoids shipping a stray `image: undefined` key.
    if (image && typeof image === "string") payload.image = image;
    // Optional action button label (e.g. "Shop Now") — sw.js turns this
    // into a tappable `actions` entry on platforms that support it; tapping
    // it (or anywhere else on the notification) opens the same `url` above.
    if (buttonText && typeof buttonText === "string") payload.buttonText = buttonText;
    let delivered = 0;
    const staleIds = [];

    await Promise.all(subs.map(async (sub) => {
      try {
        const result = await sendWebPush(env, sub, payload);
        if (result.ok) delivered++;
        else if (result.stale) staleIds.push(sub.id);
      } catch (err) {
        console.error("send-push: failed for subscription", sub.id, err.message);
      }
    }));

    // Clean up subscriptions the push service told us are dead — best
    // effort, doesn't affect the response either way.
    await Promise.all(staleIds.map((id) => deleteDoc(env, `push_subscriptions/${id}`).catch(() => {})));

    // Log every broadcast (not every targeted auto-send — that would
    // flood the history table with one row per order) so the admin
    // panel's "Send History" table has something to show.
    if (broadcast) {
      await createDoc(env, "push_log", crypto.randomUUID().replace(/-/g, ""), {
        title, body: message, url: url || "/", image: payload.image || null, buttonText: payload.buttonText || null,
        attempted: subs.length, delivered,
        sentAt: new Date().toISOString()
      }).catch((err) => console.error("send-push: history log failed (non-fatal):", err.message));
    }

    return json({ ok: true, attempted: subs.length, delivered });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong sending the notification." }, 500);
  }
}
