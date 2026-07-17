// api/place-order.js
//
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------
// Re-computes subtotal, coupon discount, delivery fee, and COD charge from
// the REAL data in Firestore (current product prices, current coupon
// rules, current settings) and writes the order using THOSE numbers — the
// client's own totals are never trusted or stored. See the original
// comment history in CHANGELOG-updates.md for the full backstory.
//
// AS OF THIS UPDATE: now uses the Firebase Admin SDK (service account)
// instead of the public Firestore REST API. Two reasons forced this
// upgrade:
//   1. Stock auto-decrement. Previously, stock was never reduced when an
//      order was placed — it stayed a manual, admin-only number. Products
//      require `allow write: if isAdmin()`, so a plain unauthenticated
//      REST call could never have decremented it anyway. The Admin SDK
//      bypasses Firestore rules by design, which is exactly what's needed
//      for trusted server code like this.
//   2. Telegram notifications need to read the (admin-only, for security
//      reasons) `telegram_bots` collection — see lib/telegram.js.
//
// IMPORTANT — VERCEL ONLY, and now also REQUIRES the service account env
// var (FIREBASE_SERVICE_ACCOUNT_KEY). See SERVICE-ACCOUNT-SETUP-GUIDE.md.
// checkout.js still falls back to the old direct client-side write if this
// route 404s (e.g. hosted somewhere without serverless functions) — on
// that fallback path, stock does NOT auto-decrement and Telegram
// notifications do NOT fire, since neither is possible without a server.

import { getDb } from "../lib/firebase-admin.js";
import { dispatchTelegramEvent } from "../lib/telegram.js";

const LOW_STOCK_THRESHOLD = 3;

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function computeCouponDiscount(coupon, subtotal) {
  let discount;
  if (coupon.type === "percentage") {
    discount = subtotal * (Number(coupon.value) / 100);
    if (coupon.maxDiscount !== null && coupon.maxDiscount !== undefined && coupon.maxDiscount !== "") {
      discount = Math.min(discount, Number(coupon.maxDiscount));
    }
  } else {
    discount = Number(coupon.value);
  }
  discount = Math.max(0, Math.min(discount, subtotal));
  return Math.round(discount * 100) / 100;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let db;
  try {
    db = getDb();
  } catch (err) {
    // Service account not set up yet — fail closed with a clear message
    // rather than a cryptic 500, so this is easy to diagnose during setup.
    console.error(err.message);
    return res.status(500).json({ error: "Server is not fully configured yet (missing service account). Please try again shortly, or contact the site owner." });
  }

  try {
    const body = req.body || {};
    const { orderId, items, deliveryDetails, paymentMethod, couponCode, upiTxnRef } = body;

    if (!orderId || !Array.isArray(items) || items.length === 0 || !deliveryDetails) {
      return res.status(400).json({ error: "Missing required order fields." });
    }
    if (paymentMethod !== "COD" && paymentMethod !== "UPI") {
      return res.status(400).json({ error: "Invalid payment method." });
    }
    if (paymentMethod === "UPI" && (!upiTxnRef || String(upiTxnRef).replace(/\D/g, "").length < 4)) {
      return res.status(400).json({ error: "A valid UPI Transaction ID/UTR (at least 4 digits) is required." });
    }

    // 1. Re-fetch REAL prices/stock/deliveryFee/sourcePlatformUrl — never
    //    trust what the browser sent for these.
    const productsSnap = await db.collection("products").get();
    const productsById = {};
    productsSnap.forEach((doc) => { productsById[doc.id] = { id: doc.id, ...doc.data() }; });

    let subtotal = 0;
    let deliveryFee = 0;
    const verifiedItems = [];
    for (const reqItem of items) {
      const product = productsById[reqItem.productId];
      if (!product) return res.status(400).json({ error: "A product in your cart is no longer available." });
      if (product.status && product.status !== "active") {
        return res.status(400).json({ error: `"${product.title}" is no longer available.` });
      }
      const qty = Math.max(1, Math.floor(Number(reqItem.quantity) || 1));
      const currentStock = product.stock !== undefined && product.stock !== null ? Number(product.stock) : null;
      if (currentStock !== null && qty > currentStock) {
        return res.status(400).json({ error: `Only ${currentStock} of "${product.title}" left in stock.` });
      }
      const price = Number(product.sellingPrice);
      subtotal += price * qty;
      deliveryFee += Number(product.deliveryFee) || 0;
      verifiedItems.push({
        productId: reqItem.productId,
        title: product.title,
        price,
        quantity: qty,
        sourcePlatformUrl: product.sourcePlatformUrl || null
      });
    }

    // 2. Re-validate the coupon server-side, same rules coupon.js uses.
    let discount = 0;
    let verifiedCouponCode = null;
    if (couponCode) {
      const couponsSnap = await db.collection("coupons").get();
      let match = null;
      couponsSnap.forEach((doc) => {
        const c = doc.data();
        if (String(c.code || "").toUpperCase() === String(couponCode).toUpperCase()) match = c;
      });
      if (match && match.active && (!match.expiryDate || match.expiryDate >= todayString())) {
        const minOrder = Number(match.minOrderValue) || 0;
        if (subtotal >= minOrder) {
          discount = computeCouponDiscount(match, subtotal);
          verifiedCouponCode = match.code;
        }
      }
      // If it no longer qualifies, it's silently dropped rather than
      // failing the whole order — same behaviour the client already had.
    }

    // 3. COD charge from real Settings, not the client.
    let codCharge = 0;
    if (paymentMethod === "COD") {
      const settingsDoc = await db.collection("settings").doc("store_config").get();
      const settings = settingsDoc.exists ? settingsDoc.data() : {};
      codCharge = Number(settings.codExtraCharge) || 0;
    }

    const finalTotal = Math.max(0, subtotal - discount + codCharge + deliveryFee);
    const createdAt = new Date().toISOString();

    const orderPayload = {
      orderId,
      customerName: deliveryDetails.name,
      customerPhone: deliveryDetails.phone,
      customerEmail: deliveryDetails.email,
      customerAddress: deliveryDetails.address,
      customerCity: deliveryDetails.city,
      customerState: "West Bengal",
      customerPincode: deliveryDetails.pincode,
      items: verifiedItems.map(({ sourcePlatformUrl, ...rest }) => rest), // don't bloat every stored order with this — it's looked up fresh from the product at notify/admin-view time instead
      subtotal,
      discount,
      couponCode: verifiedCouponCode,
      deliveryFee,
      codCharge,
      finalTotal,
      paymentMethod,
      upiTxnRef: paymentMethod === "UPI" ? String(upiTxnRef).replace(/\D/g, "") : null,
      status: "Pending",
      createdAt,
      verifiedServerSide: true
    };

    // 4. Write the order.
    await db.collection("orders").doc(orderId).create(orderPayload);

    // 5. Decrement stock for every item that tracks stock (stock === null
    //    means "not tracked for this product" — never decrement past that).
    const batch = db.batch();
    const stockUpdates = [];
    for (const item of verifiedItems) {
      const product = productsById[item.productId];
      if (product.stock === undefined || product.stock === null) continue;
      const newStock = Math.max(0, Number(product.stock) - item.quantity);
      batch.update(db.collection("products").doc(item.productId), { stock: newStock });
      stockUpdates.push({ product, newStock });
    }
    if (stockUpdates.length > 0) {
      await batch.commit();
    }

    // 6. Telegram: new_order, then out_of_stock/low_stock for anything
    //    that just crossed a threshold. All of this is fire-and-forget
    //    from the customer's point of view — dispatchTelegramEvent never
    //    throws, so none of this can fail the order that was already saved.
    const host = req.headers.host;
    const adminOrderUrl = host ? `https://${host}/admin.html` : null;

    await dispatchTelegramEvent(db, "new_order", {
      ...orderPayload,
      items: verifiedItems, // include sourcePlatformUrl here, unlike what's stored on the order doc
      adminOrderUrl
    });

    for (const { product, newStock } of stockUpdates) {
      if (newStock === 0) {
        await dispatchTelegramEvent(db, "out_of_stock", {
          title: product.title,
          sku: product.sku,
          sourcePlatformUrl: product.sourcePlatformUrl || null,
          lastOrderId: orderId,
          adminEditUrl: adminOrderUrl
        });
      } else if (newStock <= LOW_STOCK_THRESHOLD) {
        await dispatchTelegramEvent(db, "low_stock", {
          title: product.title,
          sku: product.sku,
          sourcePlatformUrl: product.sourcePlatformUrl || null,
          stockLeft: newStock,
          adminEditUrl: adminOrderUrl
        });
      }
    }

    return res.status(200).json({ success: true, order: orderPayload });
  } catch (err) {
    console.error(err);
    if (err.code === 6 || /already exists/i.test(err.message || "")) {
      // Firestore's .create() throws ALREADY_EXISTS instead of silently
      // overwriting — surfaces a duplicate orderId instead of masking it.
      return res.status(409).json({ error: "This order was already placed. Please refresh before trying again." });
    }
    return res.status(500).json({ error: "Something went wrong placing the order. Please try again." });
  }
}
