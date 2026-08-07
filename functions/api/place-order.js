// functions/api/place-order.js
//
// WHY THIS FILE EXISTS
// ---------------------------------------------------------------------
// Re-computes subtotal, coupon discount, delivery fee, and COD charge from
// the REAL data in Firestore (current product prices, current coupon
// rules, current settings) and writes the order using THOSE numbers — the
// client's own totals are never trusted or stored.
//
// WORKER 2 MIGRATION NOTE (Vercel + Admin SDK -> Cloudflare Pages
// Functions + Firestore REST API):
//   - `export default function handler(req, res)` -> `onRequestPost(context)`.
//   - No more Admin SDK / service account object (`getDb()`). Every
//     Firestore call now goes through lib/firestore-rest.js, called with
//     `context.env` (holds FIREBASE_SERVICE_ACCOUNT_KEY etc — same var
//     names Vercel used).
//   - `FieldValue.increment(n)` -> `increment(n)` from firestore-rest.js.
//   - `db.batch()` -> `batchWrite(env, operations)`.
//
// ON TOP OF THE STRAIGHT CONVERSION, THREE KNOWN BUGS ARE FIXED HERE
// (all three were explicitly called out by the migration team as things
// to fix while we're in this file — this is the highest-risk file in the
// whole migration, real money and real inventory, so each fix has an
// explanation of the reasoning right next to it):
//
// (a) STOCK-READ EFFICIENCY — the original ran
//         db.collection("products").get()
//     on EVERY single order, downloading the entire products catalog just
//     to look up the handful of items actually in this cart. Replaced with
//     getAll(env, refs), fetching ONLY the specific product docs whose IDs
//     appear in this order's cart items. Scales with cart size instead of
//     catalog size.
//
// (b) OVERSELL RACE CONDITION — the original read stock ONCE (in the same
//     bulk read as (a)), checked `qty <= currentStock` in JS, and only
//     decremented stock LATER in a plain (non-transactional) batch write.
//     Between that initial read and the later write, a second, concurrent
//     order for the same product could run through the exact same check
//     against the exact same (stale) stock number. If a product had 1
//     unit left, TWO simultaneous orders could each see "1 in stock, need
//     1" and both succeed — selling the same unit twice. Fixed by moving
//     the authoritative stock check AND the decrement into a single
//     runTransaction(env, ...) call: the transaction re-reads each
//     product's CURRENT stock from inside the transaction, verifies it's
//     still sufficient, and writes the new stock value — all atomically.
//     Firestore transactions guarantee that if two transactions touch the
//     same document, one of them aborts and retries against fresh data
//     rather than both committing against a stale read, which is exactly
//     what closes this race. Full walkthrough in REPORT.md.
//
// (c) NO RATE LIMIT — this endpoint had zero abuse protection (someone
//     could script thousands of fake orders per minute). Added the exact
//     same IP-based, transaction-backed "counter doc keyed by hashed-IP +
//     today's date" pattern already used by
//     lib/submit-review-guard.js's checkAndIncrementRateLimit(), just with
//     its own collection (`order_rate_limits`) and its own cap (10/day
//     instead of reviews' 5/day). Returns 429 with a clear message if
//     exceeded, checked right up front before any real work happens.
//
// Everything else — coupon validation, store-margin pricing, COD charge,
// delivery fee, Telegram notification calls — is unchanged in behavior.

import {
  getDoc,
  getDocs,
  getAll,
  createDoc,
  updateDoc,
  increment,
  runTransaction
} from "../../lib/firestore-rest.js";
import { dispatchTelegramEvent } from "../../lib/telegram.js";
import { applyStoreMargin } from "../../lib/pricing.js";

const LOW_STOCK_THRESHOLD = 3;
const MAX_ORDERS_PER_IP_PER_DAY = 10;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
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

function getClientIp(request) {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// FIX (c) — same pattern/style as lib/submit-review-guard.js's
// checkAndIncrementRateLimit(), just its own collection + cap. Kept local
// to this file (rather than importing the reviews guard) since it isn't
// about reviews and place-order.js is the only caller.
async function checkAndIncrementOrderRateLimit(env, ip) {
  const today = todayString();
  const ipHash = (await sha256Hex(String(ip))).slice(0, 24);
  const docId = `${ipHash}_${today}`;
  const path = `order_rate_limits/${docId}`;

  return runTransaction(env, async (txn) => {
    const snap = await txn.get(path);
    const current = snap ? Number(snap.count || 0) : 0;
    if (current >= MAX_ORDERS_PER_IP_PER_DAY) {
      return { allowed: false, remaining: 0 };
    }
    txn.update(path, { count: current + 1, lastSubmittedAt: new Date().toISOString() });
    return { allowed: true, remaining: MAX_ORDERS_PER_IP_PER_DAY - current - 1 };
  });
}

// Thrown from inside the stock transaction (fix b) when a product is
// missing or genuinely out of stock at commit time. Kept as a distinct
// class so the catch block below can tell "customer needs a clear 400
// message" apart from an unexpected/infra error (500).
class OrderValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderValidationError";
  }
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
    const { orderId, items, deliveryDetails, paymentMethod, couponCode, paymentScreenshotUrl, autoPlaced, deviceId } = body || {};

    if (!orderId || !Array.isArray(items) || items.length === 0 || !deliveryDetails) {
      return json({ error: "Missing required order fields." }, 400);
    }
    if (paymentMethod !== "COD" && paymentMethod !== "UPI") {
      return json({ error: "Invalid payment method." }, 400);
    }
    // The manual UTR/last-6-digit box has been replaced with a mandatory
    // payment screenshot upload — this is the real verification proof now.
    // Exception: `autoPlaced` orders (the 3-minute checkout timer expired
    // with no action from the shopper) are allowed through without one —
    // they land as "Pending" either way and admin verifies/deletes them
    // manually, per the agreed flow.
    if (paymentMethod === "UPI" && !autoPlaced && !paymentScreenshotUrl) {
      return json({ error: "Please upload a screenshot of your payment before placing the order." }, 400);
    }

    // FIX (c) — rate limit, checked up front before any real work happens.
    const ip = getClientIp(request);
    const { allowed } = await checkAndIncrementOrderRateLimit(env, ip);
    if (!allowed) {
      return json({ error: "You've placed the maximum number of orders allowed today from this connection. Please try again tomorrow, or contact us if you need help." }, 429);
    }

    // 1. Re-fetch REAL prices/stock/deliveryFee/sourcePlatformUrl — never
    //    trust what the browser sent for these. Settings fetched here too
    //    (once) — needed for both the Store Margin markup below and the
    //    COD charge further down.
    //
    // FIX (a) — only fetch the specific products in THIS cart (getAll),
    // instead of the original's `db.collection("products").get()` which
    // downloaded the entire catalog on every single order.
    const productIds = [...new Set(items.map((it) => it.productId))];
    const productPaths = productIds.map((id) => `products/${id}`);
    const [productDocs, settingsDoc] = await Promise.all([
      getAll(env, productPaths),
      getDoc(env, "settings/store_config")
    ]);
    const orderSettings = settingsDoc || {};
    const productsById = {};
    productIds.forEach((id, i) => {
      if (productDocs[i]) productsById[id] = productDocs[i];
    });

    let subtotal = 0;
    let deliveryFee = 0;
    const verifiedItems = [];
    for (const reqItem of items) {
      const product = productsById[reqItem.productId];
      if (!product) return json({ error: "A product in your cart is no longer available." }, 400);
      if (product.status && product.status !== "active") {
        return json({ error: `"${product.title}" is no longer available.` }, 400);
      }
      const qty = Math.max(1, Math.floor(Number(reqItem.quantity) || 1));
      const currentStock = product.stock !== undefined && product.stock !== null ? Number(product.stock) : null;
      if (currentStock !== null && qty > currentStock) {
        // Fast-path check against the read we just did — good enough for
        // instant, friendly feedback in the common case. This is NOT the
        // authoritative check (that happens inside the transaction in
        // step 5, right before we actually decrement) — it's just here so
        // a shopper adding more to their cart than exists gets an
        // immediate, specific error instead of waiting for the
        // transaction to run.
        return json({ error: `Only ${currentStock} of "${product.title}" left in stock.` }, 400);
      }
      const price = applyStoreMargin(product.sellingPrice, orderSettings);
      // Snapshotted the same way price is — so profit reports for this
      // order stay accurate even if the admin changes (or hasn't yet set)
      // the product's cost price later. `null` (not 0) when genuinely
      // unset, so reports can tell "no cost recorded" apart from "free".
      const costPrice = (product.costPrice !== undefined && product.costPrice !== null && product.costPrice !== "")
        ? Number(product.costPrice)
        : null;
      subtotal += price * qty;
      deliveryFee += Number(product.deliveryFee) || 0;
      verifiedItems.push({
        productId: reqItem.productId,
        title: product.title,
        price,
        costPrice,
        hsnCode: product.hsnCode || "",
        // A variant is just a normal product doc with size/color set —
        // stock and price verification above already used THIS exact
        // variant's own document (looked up by productId), so no extra
        // variant-aware logic was needed there. This just carries the
        // size/color through onto the order so admin views, emails,
        // Telegram alerts, invoices and CSV exports can show it.
        size: product.size || "",
        color: product.color || "",
        quantity: qty,
        sourcePlatformUrl: product.sourcePlatformUrl || null
      });
    }

    // 1b. WHOLE-STORE geo check — this store only delivers within West
    // Bengal (see config/geo-config.json). This was previously ONLY
    // enforced client-side (checkout.js / js/geo-restriction.js), which
    // means anyone could bypass it entirely by calling this API directly.
    // env.ASSETS.fetch reads the same static config file Cloudflare Pages
    // already serves — no Firestore read, no extra cost.
    try {
      const configRes = await env.ASSETS.fetch(new URL("/config/geo-config.json", request.url));
      const geoConfig = await configRes.json();
      const pinNum = parseInt(String(deliveryDetails.pincode || "").replace(/\D/g, ""), 10);
      const inRange = (geoConfig.pincodeRanges || []).some((r) => pinNum >= r.min && pinNum <= r.max);
      if (!pinNum || !inRange) {
        return json({ error: "Sorry, we don't deliver to this pincode. We currently only ship within West Bengal." }, 400);
      }
    } catch (err) {
      console.error("place-order: geo-config check failed, rejecting order to be safe:", err);
      return json({ error: "Could not verify delivery availability right now. Please try again in a moment." }, 400);
    }

    // 1c. PER-PRODUCT / PER-BRAND availability — a product (or its whole
    // brand) can be restricted to specific cities/pincodes even within
    // West Bengal (set in the admin panel). Reuses the exact product docs
    // already fetched above for price/stock (zero extra reads) and only
    // fetches the DISTINCT brand docs this specific order actually needs
    // (deduped — two items from the same brand = one read, not two), so
    // this stays cheap on the Firestore free tier no matter how big the
    // catalog is.
    {
      const orderPincode = String(deliveryDetails.pincode || "").replace(/\D/g, "");
      const neededBrandIds = [...new Set(
        Object.values(productsById)
          .filter((p) => !p.hasCustomAvailability) // only need the brand if the product itself doesn't override
          .map((p) => p.brandId)
          .filter(Boolean)
      )];
      let brandsById = {};
      if (neededBrandIds.length > 0) {
        const brandDocs = await getAll(env, neededBrandIds.map((id) => `brands/${id}`));
        neededBrandIds.forEach((id, i) => { if (brandDocs[i]) brandsById[id] = brandDocs[i]; });
      }

      function flattenAllowedPincodes(availability) {
        const set = new Set();
        Object.values((availability && availability.pincodesByCity) || {}).forEach((entry) => {
          (entry.codes || []).forEach((c) => set.add(c));
        });
        return set;
      }
      function resolveAvailability(product) {
        if (product.hasCustomAvailability && product.availability) return product.availability;
        const brand = product.brandId ? brandsById[product.brandId] : null;
        if (brand && brand.availability && !brand.availability.allCities) return brand.availability;
        return { allCities: true };
      }

      for (const reqItem of items) {
        const product = productsById[reqItem.productId];
        if (!product) continue; // already rejected above if missing
        const availability = resolveAvailability(product);
        if (availability.allCities) continue;
        if (!flattenAllowedPincodes(availability).has(orderPincode)) {
          return json({ error: `"${product.title}" is not available for delivery to pincode ${orderPincode}. Please remove it from your cart or change your delivery pincode.` }, 400);
        }
      }
    }

    // 2. Re-validate the coupon server-side, same rules coupon.js uses —
    // including the optional brand/product restriction set in Admin ->
    // Add Coupon -> "Applicable Brands" / "Applicable Products". This is
    // the AUTHORITATIVE check: the client (cart.js/checkout.js) already
    // does the same thing for a good UX, but a request straight to this
    // API must never trust a discount amount it sent — it's recomputed
    // here from scratch, restricted to only the items that actually
    // qualify, using the same productsById docs already fetched above
    // (zero extra reads).
    let discount = 0;
    let verifiedCouponCode = null;
    if (couponCode) {
      const coupons = await getDocs(env, "coupons");
      let match = null;
      coupons.forEach((c) => {
        if (String(c.code || "").toUpperCase() === String(couponCode).toUpperCase()) match = c;
      });
      if (match && match.active && (!match.expiryDate || match.expiryDate >= todayString())) {
        const minOrder = Number(match.minOrderValue) || 0;
        if (subtotal >= minOrder) {
          const brandIds = Array.isArray(match.brandIds) ? match.brandIds : [];
          const productScopeIds = Array.isArray(match.productIds) ? match.productIds : [];
          let eligibleSubtotal = subtotal;
          if (brandIds.length > 0 || productScopeIds.length > 0) {
            eligibleSubtotal = 0;
            for (const vItem of verifiedItems) {
              const product = productsById[vItem.productId];
              const brandOk = brandIds.length === 0 || (product && brandIds.includes(product.brandId));
              const productOk = productScopeIds.length === 0
                || productScopeIds.includes(vItem.productId)
                || (product && product.parentId && productScopeIds.includes(product.parentId));
              if (brandOk && productOk) eligibleSubtotal += vItem.price * vItem.quantity;
            }
          }
          if (eligibleSubtotal > 0) {
            discount = computeCouponDiscount(match, eligibleSubtotal);
            verifiedCouponCode = match.code;
          }
          // eligibleSubtotal === 0 -> coupon doesn't apply to anything in
          // this cart; silently dropped, same as any other disqualified
          // coupon (see comment below).
        }
      }
      // If it no longer qualifies, it's silently dropped rather than
      // failing the whole order — same behaviour the client already had.
    }

    // 3. COD charge from real Settings, not the client.
    let codCharge = 0;
    if (paymentMethod === "COD") {
      codCharge = Number(orderSettings.codExtraCharge) || 0;
    }

    const finalTotal = Math.max(0, subtotal - discount + codCharge + deliveryFee);
    const createdAt = new Date().toISOString();
    // -- ESTIMATED DELIVERY WINDOW CALCULATION (7 to 10 Days) --
    const orderDate = new Date();
    const dispatchDays = 1;
    const transitMin = 6;
    const transitMax = 9;
    
    const fmt = (d) => d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
    const estFrom = new Date(orderDate); estFrom.setDate(estFrom.getDate() + dispatchDays + transitMin);
    const estTo = new Date(orderDate); estTo.setDate(estTo.getDate() + dispatchDays + transitMax);
    const estimatedDeliveryString = `${fmt(estFrom)} – ${fmt(estTo)}`;

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
      paymentScreenshotUrl: paymentMethod === "UPI" ? (paymentScreenshotUrl || null) : null,
      autoPlaced: !!autoPlaced,
      deviceId: deviceId || null,
      estimatedDelivery: estimatedDeliveryString, // <--- Yeh naya field add kar diya
      status: "Pending",
      createdAt,
      verifiedServerSide: true
    };

    // 4. Duplicate-submission guard, checked BEFORE we touch any stock.
    // The original relied on `.create()` throwing ALREADY_EXISTS as its
    // only duplicate guard, running AFTER stock was already decremented
    // in the batch below it. We check for an existing order first here so
    // a resubmitted/retried request (same orderId) can bail out early
    // without a second stock decrement — the `createDoc` in step 6 below
    // is still the final, atomic word on this (a literal-same-instant
    // duplicate could theoretically slip past this early check; see
    // REPORT.md for how that narrow edge case is handled).
    const existingOrder = await getDoc(env, `orders/${orderId}`);
    if (existingOrder) {
      return json({ error: "This order was already placed. Please refresh before trying again." }, 409);
    }

    // 5. FIX (b) — THE OVERSELL FIX. Stock check-then-decrement, all
    // inside one transaction, so two simultaneous orders for the same
    // product's last unit can never both succeed. See the file-level
    // comment and REPORT.md for the full reasoning; short version: each
    // call to runTransaction gets a fresh, consistent read of every
    // product touched here, and Firestore guarantees that if two
    // transactions conflict (they touched the same doc), only one of them
    // is allowed to commit — the other is retried by runTransaction
    // against the now-updated data. That's what makes "read stock, check
    // it, write stock" a single atomic unit instead of three separate
    // steps a second order could interleave with.
    let freshStockByProductId;
    try {
      freshStockByProductId = await runTransaction(env, async (txn) => {
        const results = {};
        for (const item of verifiedItems) {
          const product = productsById[item.productId];
          const path = `products/${item.productId}`;
          const tracksStock = product.stock !== undefined && product.stock !== null;

          if (!tracksStock) {
            // Not stock-tracked — just bump the bestseller counter, no
            // stock field to race over.
            txn.update(path, { orderCount: increment(item.quantity) });
            results[item.productId] = { tracksStock: false, newStock: null };
            continue;
          }

          // Authoritative re-read, INSIDE the transaction — this is the
          // number that matters, not the one from step 1's snapshot.
          const fresh = await txn.get(path);
          if (!fresh) {
            throw new OrderValidationError(`"${item.title}" is no longer available.`);
          }
          const freshStock = Number(fresh.stock);
          if (item.quantity > freshStock) {
            throw new OrderValidationError(`Only ${freshStock} of "${item.title}" left in stock.`);
          }
          const newStock = Math.max(0, freshStock - item.quantity);
          // Written as an explicit computed value (not an increment(-n)
          // marker) deliberately: we already hold the authoritative
          // freshStock we just read inside THIS transaction, so writing
          // the exact resulting number keeps this, the highest-risk line
          // in the whole migration, trivially auditable — no reliance on
          // how a decrement marker resolves under the hood.
          txn.update(path, {
            stock: newStock,
            orderCount: increment(item.quantity)
          });
          results[item.productId] = { tracksStock: true, newStock };
        }
        return results;
      });
    } catch (err) {
      if (err instanceof OrderValidationError) {
        // Stock lost the race between step 1's snapshot and now (or a
        // product vanished) — nothing was written (the transaction never
        // committed), so it's safe to just tell the customer and stop.
        return json({ error: err.message }, 400);
      }
      throw err;
    }

    // 6. Write the order — now that stock is safely reserved. `createDoc`
    // fails if the doc already exists, which is our final, atomic
    // duplicate-orderId guard (step 4 above is just an early exit for the
    // common case). If THIS throws ALREADY_EXISTS, it means an
    // extraordinarily narrow race let two identical-orderId requests both
    // past step 4 — in that case we've already reserved stock we no
    // longer need, so we give it back before returning the error, rather
    // than silently leaking inventory.
    try {
      await createDoc(env, "orders", orderId, orderPayload);
    } catch (err) {
      if (err.code === 6 || /already exists/i.test(err.message || "")) {
        await Promise.all(
          verifiedItems.map((item) => {
            const stockInfo = freshStockByProductId[item.productId];
            if (!stockInfo || !stockInfo.tracksStock) return Promise.resolve();
            // Compensating write: give back exactly what we reserved.
            return updateDoc(env, `products/${item.productId}`, {
              stock: increment(item.quantity),
              orderCount: increment(-item.quantity)
            }).catch((e) => console.error("Stock compensation failed (needs manual admin review):", e.message));
          })
        );
        return json({ error: "This order was already placed. Please refresh before trying again." }, 409);
      }
      throw err;
    }

    // 7. Telegram: new_order, then out_of_stock/low_stock for anything
    //    that just crossed a threshold. All of this is fire-and-forget
    //    from the customer's point of view — dispatchTelegramEvent never
    //    throws, so none of this can fail the order that was already saved.
    const host = request.headers.get("host");
    const adminOrderUrl = host ? `https://${host}/admin` : null;

    // dispatchTelegramEvent's first argument used to be the Admin SDK `db`
    // object; Worker 4's converted lib/telegram.js takes `env` in that
    // same position instead (same name/signature shape, db -> env).
    await dispatchTelegramEvent(env, "new_order", {
      ...orderPayload,
      items: verifiedItems, // include sourcePlatformUrl here, unlike what's stored on the order doc
      adminOrderUrl
    });

    for (const item of verifiedItems) {
      const stockInfo = freshStockByProductId[item.productId];
      if (!stockInfo || !stockInfo.tracksStock) continue;
      const product = productsById[item.productId];
      const newStock = stockInfo.newStock;
      const variantSuffix = (product.size || product.color) ? ` [${[product.size, product.color].filter(Boolean).join("/")}]` : "";
      if (newStock === 0) {
        await dispatchTelegramEvent(env, "out_of_stock", {
          title: product.title + variantSuffix,
          sku: product.sku,
          sourcePlatformUrl: product.sourcePlatformUrl || null,
          lastOrderId: orderId,
          adminEditUrl: adminOrderUrl
        });
      } else if (newStock <= LOW_STOCK_THRESHOLD) {
        await dispatchTelegramEvent(env, "low_stock", {
          title: product.title + variantSuffix,
          sku: product.sku,
          sourcePlatformUrl: product.sourcePlatformUrl || null,
          stockLeft: newStock,
          adminEditUrl: adminOrderUrl
        });
      }
    }

    // costPrice lives in the STORED order (orderPayload, for admin profit
    // reports) but must never reach the customer's own browser in this
    // response — it's what the seller pays, not something a shopper
    // should be able to read from their own order-confirmation network
    // request.
    const clientSafeOrder = {
      ...orderPayload,
      items: orderPayload.items.map(({ costPrice, ...rest }) => rest)
    };
    return json({ success: true, order: clientSafeOrder });
  } catch (err) {
    console.error(err);
    if (err.code === 6 || /already exists/i.test(err.message || "")) {
      // Firestore's create() throws ALREADY_EXISTS instead of silently
      // overwriting — surfaces a duplicate orderId instead of masking it.
      return json({ error: "This order was already placed. Please refresh before trying again." }, 409);
    }
    return json({ error: "Something went wrong placing the order. Please try again." }, 500);
  }
}
