// api/telegram-test.js
//
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = req.headers["x-api-key"];
  if (!process.env.TELEGRAM_NOTIFY_API_KEY || apiKey !== process.env.TELEGRAM_NOTIFY_API_KEY) {
    return res.status(401).json({ error: "Invalid or missing API key." });
  }

  const { action, token, chatId } = req.body || {};
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
          text: "✅ Test message from AzubaTrends.\n\nIf you can see this, your bot + chat ID are connected correctly.",
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
