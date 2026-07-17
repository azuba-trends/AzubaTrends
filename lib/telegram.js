// lib/telegram.js
//
// Central place for: (1) building the message text + inline-keyboard
// buttons for each event type, (2) calling the real Telegram Bot API,
// (3) looping over every configured bot in Firestore and sending to
// whichever ones are subscribed to a given event.
//
// IMPORTANT: dispatchTelegramEvent() NEVER throws. Every call site
// (checkout, admin, reviews) treats Telegram as "nice to have" — if it's
// unconfigured, misconfigured, or Telegram itself is down, the real
// operation (placing an order, saving a review, updating a status) must
// still succeed. This mirrors the original WordPress plugin's
// AZH_TG_Debug::safe() wrapper pattern.

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  } catch (err) {
    return iso || "";
  }
}

// ---------------------------------------------------------------------
// Message builders — each returns { text, buttons }
// buttons = [{ label, url }] rendered as one Telegram inline-keyboard
// button per row.
// ---------------------------------------------------------------------

function buildNewOrder(data) {
  const items = data.items || [];
  const itemLines = items
    .map((it, i) => `${i + 1}. ${esc(it.title)} x${it.quantity} @ ${money(it.price)}`)
    .join("\n");

  let text = `🛒 <b>NEW ORDER!</b>\n━━━━━━━━━━━━━━━━━━\n`;
  text += `📦 Order ID: <b>${esc(data.orderId)}</b>\n`;
  text += `🕐 Time: ${formatDate(data.createdAt)}\n`;
  text += `💳 Payment: ${esc(data.paymentMethod)}${data.upiTxnRef ? ` (Ref: ${esc(data.upiTxnRef)})` : ""}\n`;
  text += `📊 Status: ${esc(data.status || "Pending")}\n\n`;

  text += `👤 <b>CUSTOMER</b>\n`;
  text += `Name: ${esc(data.customerName)}\n`;
  text += `Phone: ${esc(data.customerPhone)}\n`;
  text += `Email: ${esc(data.customerEmail)}\n`;
  text += `Address: ${esc(data.customerAddress)}, ${esc(data.customerCity)} - ${esc(data.customerPincode)}\n\n`;

  text += `💰 <b>PAYMENT BREAKDOWN</b>\n`;
  text += `Subtotal: ${money(data.subtotal)}\n`;
  if (data.discount) text += `Coupon (${esc(data.couponCode || "")}): -${money(data.discount)}\n`;
  if (data.deliveryFee) text += `Delivery Fee: ${money(data.deliveryFee)}\n`;
  if (data.codCharge) text += `COD Charge: ${money(data.codCharge)}\n`;
  text += `<b>Final Total: ${money(data.finalTotal)}</b>\n\n`;

  text += `📦 <b>ITEMS (x${items.length})</b>\n${itemLines}`;

  const buttons = items
    .filter((it) => it.sourcePlatformUrl)
    .map((it) => ({ label: `🔗 Source: ${it.title}`.slice(0, 64), url: it.sourcePlatformUrl }));
  if (data.adminOrderUrl) buttons.push({ label: "👁 View in Admin Panel", url: data.adminOrderUrl });

  return { text, buttons };
}

function buildOutOfStock(data) {
  let text = `⚠️ <b>OUT OF STOCK!</b>\n━━━━━━━━━━━━━━━━━━\n`;
  text += `📦 Product: ${esc(data.title)}\n`;
  if (data.sku) text += `🏷 SKU: ${esc(data.sku)}\n`;
  if (data.lastOrderId) text += `📉 Emptied by order: ${esc(data.lastOrderId)}\n`;
  text += `\nRestock this soon to avoid losing sales.`;

  const buttons = [];
  if (data.sourcePlatformUrl) buttons.push({ label: "🔗 Source Platform", url: data.sourcePlatformUrl });
  if (data.adminEditUrl) buttons.push({ label: "✏️ Edit in Admin Panel", url: data.adminEditUrl });
  return { text, buttons };
}

function buildLowStock(data) {
  let text = `🟡 <b>LOW STOCK WARNING</b>\n━━━━━━━━━━━━━━━━━━\n`;
  text += `📦 Product: ${esc(data.title)}\n`;
  text += `📉 Only ${esc(data.stockLeft)} left\n\n`;
  text += `Restock soon before it runs out completely.`;

  const buttons = [];
  if (data.sourcePlatformUrl) buttons.push({ label: "🔗 Source Platform", url: data.sourcePlatformUrl });
  if (data.adminEditUrl) buttons.push({ label: "✏️ Edit in Admin Panel", url: data.adminEditUrl });
  return { text, buttons };
}

function buildNewReview(data) {
  const stars = "★".repeat(Number(data.rating) || 0) + "☆".repeat(5 - (Number(data.rating) || 0));
  let text = `⭐ <b>NEW REVIEW</b>\n━━━━━━━━━━━━━━━━━━\n`;
  text += `📦 Product: ${esc(data.productTitle || data.productId)}\n`;
  text += `Rating: ${stars}\n`;
  text += `"${esc((data.comment || "").slice(0, 300))}"\n\n`;
  text += `Check it isn't spam — you can delete it from the Admin Panel if needed.`;

  const buttons = [];
  if (data.productUrl) buttons.push({ label: "👁 View Product Page", url: data.productUrl });
  return { text, buttons };
}

function buildOrderCancelled(data) {
  let text = `❌ <b>ORDER CANCELLED</b>\n━━━━━━━━━━━━━━━━━━\n`;
  text += `📦 Order ID: ${esc(data.orderId)}\n`;
  text += `👤 Customer: ${esc(data.customerName)}\n`;
  text += `💰 Value: ${money(data.finalTotal)}`;

  const buttons = [];
  if (data.adminOrderUrl) buttons.push({ label: "👁 View in Admin Panel", url: data.adminOrderUrl });
  return { text, buttons };
}

function buildDailyDigest(data) {
  let text = `📊 <b>DAILY SUMMARY — ${esc(data.date)}</b>\n━━━━━━━━━━━━━━━━━━\n`;
  text += `🛒 Orders today: ${data.ordersToday}\n`;
  text += `💰 Revenue today: ${money(data.revenueToday)}\n`;

  if (data.pendingUpiOrders && data.pendingUpiOrders.length > 0) {
    text += `\n⏳ <b>UPI orders still awaiting verification</b> (${data.pendingUpiOrders.length}):\n`;
    text += data.pendingUpiOrders
      .slice(0, 10)
      .map((o) => `• ${esc(o.orderId)} — ${money(o.finalTotal)} (Ref: ${esc(o.upiTxnRef || "not given")})`)
      .join("\n");
  }

  if (data.couponsExpiringSoon && data.couponsExpiringSoon.length > 0) {
    text += `\n\n🏷 <b>Coupons expiring in the next 2 days</b>:\n`;
    text += data.couponsExpiringSoon.map((c) => `• ${esc(c.code)} (expires ${esc(c.expiryDate)})`).join("\n");
  }

  return { text, buttons: [] };
}

function buildTest() {
  return {
    text: "✅ <b>Test message from AzubaTrends</b>\n\nIf you can see this, your bot + chat ID are connected correctly.",
    buttons: []
  };
}

function buildMessage(event, data) {
  switch (event) {
    case "new_order": return buildNewOrder(data);
    case "out_of_stock": return buildOutOfStock(data);
    case "low_stock": return buildLowStock(data);
    case "new_review": return buildNewReview(data);
    case "order_cancelled": return buildOrderCancelled(data);
    case "daily_digest": return buildDailyDigest(data);
    case "test": return buildTest();
    default:
      return { text: `📩 <b>${esc(event)}</b>\n${esc(JSON.stringify(data).slice(0, 500))}`, buttons: [] };
  }
}

// ---------------------------------------------------------------------
// Telegram Bot API call
// ---------------------------------------------------------------------

export async function sendTelegramMessage(token, chatId, text, buttons = []) {
  const body = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (buttons.length > 0) {
    body.reply_markup = { inline_keyboard: buttons.map((b) => [{ text: b.label, url: b.url }]) };
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return res.json();
}

/**
 * Sends `event` (with `data`) to every active bot in Firestore that's
 * subscribed to that event. NEVER throws — logs and returns [] on any
 * failure, so callers can always safely `await` this without try/catch.
 */
export async function dispatchTelegramEvent(db, event, data) {
  const results = [];
  try {
    const snap = await db.collection("telegram_bots").get();
    const { text, buttons } = buildMessage(event, data);

    for (const doc of snap.docs) {
      const bot = doc.data();
      if (!bot.active) continue;
      if (!Array.isArray(bot.events) || !bot.events.includes(event)) continue;
      if (!bot.token || !bot.chatId) continue;

      try {
        const r = await sendTelegramMessage(bot.token, bot.chatId, text, buttons);
        results.push({ bot: bot.name, ok: !!r.ok, error: r.ok ? null : r.description });
      } catch (err) {
        console.error(`Telegram send failed for bot "${bot.name}":`, err.message);
        results.push({ bot: bot.name, ok: false, error: err.message });
      }
    }
  } catch (err) {
    // Covers: no service account configured yet, Firestore unreachable,
    // telegram_bots collection doesn't exist yet, etc. Never re-thrown —
    // the calling order/review/status-update flow must not be affected by
    // Telegram being unconfigured or temporarily broken.
    console.error("Telegram dispatch skipped (non-fatal):", err.message);
  }
  return results;
}
