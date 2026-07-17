// api/telegram-notify.js
//
// Generic notification endpoint — the AzubaTrends equivalent of the
// WordPress plugin's `/wp-json/azh-tg/v1/notify`. Anything (browser JS on
// this site, or an external system later) can POST { event, data } here
// with the right API key, and it gets forwarded to whichever Telegram
// bots are subscribed to that event.
//
// The API key here is a lightweight ABUSE THROTTLE, not a high-security
// secret — it stops random strangers from spamming your Telegram group
// through this endpoint. It's safe to expose it in client-side JS (same
// exposure model as the EmailJS/ImgBB keys already used on this site).
// The actual secret (bot tokens) never leaves the server — see lib/telegram.js.

import { getDb } from "../lib/firebase-admin.js";
import { dispatchTelegramEvent } from "../lib/telegram.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"];
  if (!process.env.TELEGRAM_NOTIFY_API_KEY || apiKey !== process.env.TELEGRAM_NOTIFY_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  const { event, data } = req.body || {};
  if (!event || typeof event !== "string") {
    return res.status(400).json({ error: "Missing 'event' field." });
  }

  try {
    const db = getDb();
    const results = await dispatchTelegramEvent(db, event, data || {});
    return res.status(200).json({ ok: true, results });
  } catch (err) {
    // Telegram/Firestore trouble should never look like a hard failure to
    // whatever called this (reviews.js, admin.js) — they don't need to
    // handle this as an error, just note it didn't send.
    console.error("telegram-notify failed:", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
}
