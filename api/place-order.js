// api/place-order.js
//
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------
// Previously, checkout.js wrote the order straight to Firestore from the
// browser, trusting whatever subtotal/discount/finalTotal it had computed
// client-side. Anyone with DevTools open could edit those numbers before
// they were sent — there was nothing re-checking them.
//
// This endpoint re-computes subtotal, coupon discount, delivery fee, and
// COD charge from the REAL data in Firestore (current product prices,
// current coupon rules, current settings) and writes the order using
// THOSE numbers — the client's own totals are never trusted or stored.
//
// NO firebase-admin PACKAGE, NO SERVICE ACCOUNT NEEDED. This talks to the
// public Firestore REST API directly (same technique api/product.js
// already uses for reads). Writing an order this way is allowed because
// firestore.rules already has `match /orders/{orderId} { allow create: if
// true; }` — that rule doesn't require authentication, so an unauthenticated
// server-to-server request is allowed exactly the same as the browser's
// direct write used to be.
//
// IMPORTANT — VERCEL ONLY: like api/product.js, this only runs where
// serverless functions are supported (Vercel). checkout.js therefore
// calls this first and, only if the route genuinely doesn't exist (e.g.
// you're hosting on GitHub Pages instead), falls back to the old direct
// client-side write so checkout still works — just without server-side
// verification on that host.

const PROJECT_ID = "azubatrends-32349"; // keep in sync with config/firebase-config.json + api/product.js
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  if (typeof v === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, fsValue(val)])) } };
  }
  return { stringValue: String(v) };
}

function fsParseValue(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsParseValue);
  if ("mapValue" in v) return fsParse(v.mapValue.fields);
  return null;
}

function fsParse(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fsParseValue(v);
  return out;
}

async function fetchAllDocs(collectionName) {
  let docs = [];
  let pageToken;
  do {
    const url = new URL(`${BASE}/${collectionName}`);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString());
    const data = await res.json();
    (data.documents || []).forEach((d) => {
      const id = d.name.split("/").pop();
      docs.push({ id, ...fsParse(d.fields) });
    });
    pageToken = data.nextPageToken;
  } while (pageToken);
  return docs;
}

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

    // 1. Re-fetch REAL prices/stock/deliveryFee — never trust what the
    //    browser sent for these.
    const allProducts = await fetchAllDocs("products");
    const productsById = Object.fromEntries(allProducts.map((p) => [p.id, p]));

    let subtotal = 0;
    let deliveryFee = 0;
    const verifiedItems = [];
    for (const reqItem of items) {
      const product = productsById[reqItem.productId];
      if (!product) return res.status(400).json({ error: `A product in your cart is no longer available.` });
      if (product.status && product.status !== "active") {
        return res.status(400).json({ error: `"${product.title}" is no longer available.` });
      }
      const qty = Math.max(1, Math.floor(Number(reqItem.quantity) || 1));
      if (product.stock !== undefined && product.stock !== null && qty > Number(product.stock)) {
        return res.status(400).json({ error: `Only ${product.stock} of "${product.title}" left in stock.` });
      }
      const price = Number(product.sellingPrice);
      subtotal += price * qty;
      deliveryFee += Number(product.deliveryFee) || 0;
      verifiedItems.push({ productId: reqItem.productId, title: product.title, price, quantity: qty });
    }

    // 2. Re-validate the coupon server-side, same rules coupon.js uses.
    let discount = 0;
    let verifiedCouponCode = null;
    if (couponCode) {
      const allCoupons = await fetchAllDocs("coupons");
      const match = allCoupons.find((c) => String(c.code || "").toUpperCase() === String(couponCode).toUpperCase());
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
      const settingsRes = await fetch(`${BASE}/settings/store_config`);
      const settingsData = await settingsRes.json();
      const settings = settingsData.fields ? fsParse(settingsData.fields) : {};
      codCharge = Number(settings.codExtraCharge) || 0;
    }

    const finalTotal = Math.max(0, subtotal - discount + codCharge + deliveryFee);

    const orderPayload = {
      orderId,
      customerName: deliveryDetails.name,
      customerPhone: deliveryDetails.phone,
      customerEmail: deliveryDetails.email,
      customerAddress: deliveryDetails.address,
      customerCity: deliveryDetails.city,
      customerState: "West Bengal",
      customerPincode: deliveryDetails.pincode,
      items: verifiedItems,
      subtotal,
      discount,
      couponCode: verifiedCouponCode,
      deliveryFee,
      codCharge,
      finalTotal,
      paymentMethod,
      upiTxnRef: paymentMethod === "UPI" ? String(upiTxnRef).replace(/\D/g, "") : null,
      status: "Pending",
      createdAt: new Date().toISOString(),
      verifiedServerSide: true
    };

    const writeRes = await fetch(`${BASE}/orders?documentId=${encodeURIComponent(orderId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: Object.fromEntries(Object.entries(orderPayload).map(([k, v]) => [k, fsValue(v)]))
      })
    });

    if (!writeRes.ok) {
      const errBody = await writeRes.text();
      console.error("Firestore write failed", errBody);
      return res.status(502).json({ error: "Could not save the order. Please try again." });
    }

    return res.status(200).json({ success: true, order: orderPayload });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Something went wrong placing the order. Please try again." });
  }
}
