// functions/api/notify-restock.js
//
// The "back in stock" half of the Notify Me feature (see
// functions/api/notify-stock.js for the "waiting list" half). Called from
// js/admin.js's handleProductSave() right after a product/variant save
// succeeds, for every product whose stock just went from 0 (or unset) to
// something > 0 — same save action the admin was already doing, nothing
// extra to click.
//
// For each productId given:
//   1. Look up every `stock_notifications` row for it that isn't notified
//      yet.
//   2. For each distinct device on that list, look up its current push
//      subscription(s) (a device can have more than one, e.g. it
//      resubscribed after clearing site data) and push "Back in Stock".
//   3. Delete every waiting-list row for that product either way (a
//      device with no live subscription anymore just can't be reached —
//      no point leaving a dead row around to retry forever).
//
// Admin-auth-protected, same reasoning as send-push.js: this fans out to
// real devices, so it must never be triggerable by an unauthenticated
// visitor.

import { requireAdmin } from "../../lib/auth.js";
import { getDocs, batchWrite } from "../../lib/firestore-rest.js";
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
    // items: [{ productId, title?, url?, image? }] — title/url/image are
    // the product's OWN current values (admin.js already has them at save
    // time), used to personalize the push; falls back to a generic
    // message if omitted.
    const { items } = body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return json({ ok: true, notified: 0, productsProcessed: 0 });
    }

    let notified = 0;

    await Promise.all(items.slice(0, 50).map(async (item) => {
      const productId = item && item.productId;
      if (!productId || typeof productId !== "string") return;

      const waitingRows = await getDocs(env, "stock_notifications", {
        where: [["productId", "==", productId], ["notified", "==", false]]
      });
      if (!waitingRows || waitingRows.length === 0) return;

      const deviceIds = [...new Set(waitingRows.map((w) => w.deviceId).filter(Boolean))];
      const title = "✅ Back in Stock";
      const messageBody = item.title
        ? `${item.title} is back in stock — grab it before it sells out again!`
        : "An item you were waiting on is back in stock!";
      const payload = { title, body: messageBody, url: item.url || "/" };
      if (item.image) payload.image = item.image;

      await Promise.all(deviceIds.map(async (deviceId) => {
        const subs = await getDocs(env, "push_subscriptions", { where: [["deviceId", "==", deviceId]] });
        for (const sub of subs) {
          try {
            const result = await sendWebPush(env, sub, payload);
            if (result.ok) notified++;
          } catch (err) {
            console.error("notify-restock: push failed for device", deviceId, err.message);
          }
        }
      }));

      // Clear the waiting list for this product regardless of individual
      // delivery success — a stale subscription just means that device
      // can't be reached, retrying it later won't fix that.
      //
      // Batched via batchWrite() (single atomic :commit) instead of one
      // deleteDoc() round trip per row — same fix as recalcRatings() in
      // admin-tools.js. Chunked at 400 (Firestore's per-commit write
      // limit is 500) even though a single product's waiting list is
      // realistically far smaller than that, so this stays correct if it
      // ever isn't. Wrapped in try/catch (not per-row .catch()) since
      // batchWrite is all-or-nothing per chunk — a failed chunk just
      // means those rows are retried next time this product restocks,
      // same "not the end of the world" outcome the old per-row .catch()
      // silently allowed.
      const deleteBatchSize = 400;
      for (let i = 0; i < waitingRows.length; i += deleteBatchSize) {
        const chunk = waitingRows.slice(i, i + deleteBatchSize);
        try {
          await batchWrite(env, chunk.map((w) => ({ type: "delete", path: `stock_notifications/${w.id}` })));
        } catch (err) {
          console.error("notify-restock: batch delete failed for waiting-list chunk", err.message);
        }
      }
    }));

    return json({ ok: true, notified, productsProcessed: items.length });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong sending restock notifications." }, 500);
  }
}