// api/telegram.js
//
// MERGED FILE (2026-07-22) — this used to be two separate files,
// api/telegram-notify.js and api/telegram-test.js. Vercel's Hobby (free)
// plan caps a deployment at 12 serverless functions total, and this repo's
// /api folder had grown to 13 files, which made every deploy fail with
// "No more than 12 Serverless Functions can be added to a Deployment on
// the Hobby plan." Merging these two into one file (they already shared
// the same auth check and are both small) brings the count back to 12
// without losing any feature or changing behavior. See CHANGELOG-updates.md.
//
// Both original responsibilities are preserved below, dispatched by which
// field is present in the request body:
//   - body.event  present -> old telegram-notify.js behavior (forward an
//     event to whichever bots are subscribed to it)
//   - body.action present -> old telegram-test.js behavior (fetchChatId / test)
//
// ---------------------------------------------------------------------
// ORIGINAL api/telegram-notify.js HEADER COMMENT (kept for context):
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
//
// ORIGINAL api/telegram-test.js HEADER COMMENT (kept for context):
// Backs two buttons in Admin Panel -> Settings -> Telegram Integration:
//   - "Fetch Chat ID": reads recent messages the bot has seen (getUpdates)
//     and returns the most recent chat ID, so the admin doesn't have to
//     find it manually.
//   - "Test": sends a real test message to a given chat ID right now.
//
// This operates ONLY on whatever token/chatId the admin has typed into the
// form (not yet saved to Firestore), so it does NOT need the service
// account — it's a thin, direct proxy to the Telegram Bot API. It's
// server-side (not a direct browser fetch to api.telegram.org) so it isn't
// at the mercy of Telegram's CORS behavior, and to avoid putting the bot
// token in a client-side network request the browser's dev tools would log
// under a third-party domain.

import { getDb } from "../lib/firebase-admin.js";
import { dispatchTelegramEvent } from "../lib/telegram.js";

async function handleNotify(req, res) {
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
    console.error("telegram notify failed:", err.message);
    return res.status(200).json({ ok: false, error: err.message });
  }
}

async function handleTest(req, res) {
  const { action, token, chatId, storeName } = req.body || {};
  if (!token) return res.status(400).json({ error: "Missing bot token." });

  try {
    if (action === "fetchChatId") {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=5`);
      const data = await r.json();
      if (!data.ok) {
        return res.status(400).json({ error: data.description || "Telegram rejected this token." });
      }
      const updates = data.result || [];
      if (updates.length === 0) {
        return res.status(200).json({
          ok: false,
          error: "No recent messages found. Add the bot to your group/chat, send any message there, then try Fetch again."
        });
      }
      const last = updates[updates.length - 1];
      const chat = (last.message && last.message.chat) || (last.channel_post && last.channel_post.chat);
      if (!chat) return res.status(200).json({ ok: false, error: "Couldn't find a chat in the recent messages." });
      return res.status(200).json({ ok: true, chatId: chat.id, chatTitle: chat.title || chat.username || chat.first_name || "" });
    }

    if (action === "test") {
      if (!chatId) return res.status(400).json({ error: "Missing chat ID to send the test message to." });
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `✅ Test message from ${storeName || "your store"}.\n\nIf you can see this, your bot + chat ID are connected correctly.`,
          parse_mode: "HTML"
        })
      });
      const data = await r.json();
      if (!data.ok) return res.status(400).json({ error: data.description || "Telegram rejected this request." });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action — expected 'fetchChatId' or 'test'." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not reach Telegram. Please try again." });
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"];
  if (!process.env.TELEGRAM_NOTIFY_API_KEY || apiKey !== process.env.TELEGRAM_NOTIFY_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  const body = req.body || {};
  if (body.event) return handleNotify(req, res);
  if (body.action) return handleTest(req, res);
  return res.status(400).json({ error: "Request body must include either 'event' (notify) or 'action' (fetchChatId/test)." });
}
