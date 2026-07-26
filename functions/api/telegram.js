// functions/api/telegram.js
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
// NOTE ON CLOUDFLARE MIGRATION: Cloudflare Pages Functions don't have the
// Vercel Hobby 12-function cap that motivated this merge in the first
// place, so the merge is no longer strictly necessary for that reason —
// but it's kept as-is here since splitting it back into two files is a
// separate, non-urgent cleanup the Manager can decide on later. Both
// behaviors still dispatch off the same POST /api/telegram route.
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
// form (not yet saved to Firestore), so it does NOT need Firestore at all —
// it's a thin, direct proxy to the Telegram Bot API. It's server-side (not
// a direct browser fetch to api.telegram.org) so it isn't at the mercy of
// Telegram's CORS behavior, and to avoid putting the bot token in a
// client-side network request the browser's dev tools would log under a
// third-party domain.

import { dispatchTelegramEvent } from "../../lib/telegram.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function handleNotify(env, body) {
  const { event, data } = body || {};
  if (!event || typeof event !== "string") {
    return json({ error: "Missing 'event' field." }, 400);
  }

  try {
    const results = await dispatchTelegramEvent(env, event, data || {});
    return json({ ok: true, results });
  } catch (err) {
    // Telegram/Firestore trouble should never look like a hard failure to
    // whatever called this (reviews.js, admin.js) — they don't need to
    // handle this as an error, just note it didn't send.
    console.error("telegram notify failed:", err.message);
    return json({ ok: false, error: err.message });
  }
}

async function handleTest(body) {
  const { action, token, chatId, storeName } = body || {};
  if (!token) return json({ error: "Missing bot token." }, 400);

  try {
    if (action === "fetchChatId") {
      const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=5`);
      const data = await r.json();
      if (!data.ok) {
        return json({ error: data.description || "Telegram rejected this token." }, 400);
      }
      const updates = data.result || [];
      if (updates.length === 0) {
        return json({
          ok: false,
          error: "No recent messages found. Add the bot to your group/chat, send any message there, then try Fetch again."
        });
      }
      const last = updates[updates.length - 1];
      const chat = (last.message && last.message.chat) || (last.channel_post && last.channel_post.chat);
      if (!chat) return json({ ok: false, error: "Couldn't find a chat in the recent messages." });
      return json({ ok: true, chatId: chat.id, chatTitle: chat.title || chat.username || chat.first_name || "" });
    }

    if (action === "test") {
      if (!chatId) return json({ error: "Missing chat ID to send the test message to." }, 400);
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
      if (!data.ok) return json({ error: data.description || "Telegram rejected this request." }, 400);
      return json({ ok: true });
    }

    return json({ error: "Unknown action — expected 'fetchChatId' or 'test'." }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Could not reach Telegram. Please try again." }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = request.headers.get("x-api-key");
  if (!env.TELEGRAM_NOTIFY_API_KEY || apiKey !== env.TELEGRAM_NOTIFY_API_KEY) {
    return json({ error: "Invalid or missing API key." }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  if (body.event) return handleNotify(env, body);
  if (body.action) return handleTest(body);
  return json({ error: "Request body must include either 'event' (notify) or 'action' (fetchChatId/test)." }, 400);
}

// Only onRequestPost is exported. Cloudflare Pages Functions automatically
// return 405 Method Not Allowed for any HTTP method that doesn't have a
// matching onRequest* export on this route, which reproduces the Vercel
// handler's explicit `res.status(405)` for non-POST requests without extra
// code here.
