/**
 * coupon.js
 * ---------------------------------------------------------------------------
 * Validates a coupon code against the `coupons` collection in Firestore and
 * computes the discount for a given cart subtotal. Coupons are managed
 * entirely from Admin -> All Coupons / Add Coupon — create, edit, or delete
 * one there and it is live on the storefront immediately, no git push
 * needed (this replaced the old config/coupons.json file, which required a
 * commit + redeploy for every change).
 *
 * A coupon can optionally be restricted to specific brands and/or specific
 * products/variants (set in Admin -> Add Coupon -> "Applicable Brands" /
 * "Applicable Products"). When restricted, the discount is computed only
 * off the subtotal of cart items that actually match — other items in the
 * same cart are left untouched. This is why `validate()` now also accepts
 * the cart's line items, not just a subtotal number.
 *
 * Every result — success or failure — carries a human-readable `message` so
 * the checkout UI can explain *why* a code was rejected (expired vs. below
 * minimum vs. unknown code vs. not applicable to these items), not just
 * show a generic "invalid coupon".
 *
 * Exposes a global `Coupon` object.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';

  // Coupons rarely change and validate() can be called more than once per
  // checkout (live pincode-style re-checks etc.), so cache the list briefly
  // — but keep the window short enough that a coupon created in the admin
  // panel moments ago is picked up without the shopper needing to reload.
  const CACHE_MS = 15000;
  let couponsCache = null;
  let cacheFetchedAt = 0;
  let fetchPromise = null;

  // productId -> { brandId, parentId } | null (null = fetched, doesn't
  // exist / no longer available). Shared across every validate() call this
  // page session, since the same cart items get re-checked repeatedly.
  const productEligibilityCache = new Map();

  async function waitForDb() {
    if (window.SITE_CONFIG_READY) {
      try { await window.SITE_CONFIG_READY; } catch (err) { /* fall through, still try below */ }
    }
    let waited = 0;
    while (!(window.FirebaseApp && window.FirebaseApp.db) && waited < 8000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    if (!(window.FirebaseApp && window.FirebaseApp.db)) {
      throw new Error('Could not connect to the database.');
    }
    return window.FirebaseApp.db;
  }

  async function loadCoupons(forceRefresh) {
    const fresh = couponsCache && (Date.now() - cacheFetchedAt) < CACHE_MS;
    if (fresh && !forceRefresh) return couponsCache;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
      const db = await waitForDb();
      const { collection, getDocs } = await import(FIRESTORE_SDK);
      const snap = await getDocs(collection(db, 'coupons'));
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      couponsCache = list;
      cacheFetchedAt = Date.now();
      return list;
    })();

    try {
      return await fetchPromise;
    } catch (err) {
      couponsCache = null; // allow a retry on the next call
      throw err;
    } finally {
      fetchPromise = null;
    }
  }

  /** Fetches { brandId, parentId } for each given productId (dedup'd,
   *  cached). Used to check a coupon's brand/product restrictions against
   *  actual cart items — a variant's own doc has no brandId of its own
   *  copied at cart-add time, so this always reads the live product doc. */
  async function fetchProductEligibility(productIds) {
    const uniqueIds = Array.from(new Set(productIds)).filter((id) => !productEligibilityCache.has(id));
    if (uniqueIds.length > 0) {
      try {
        const db = await waitForDb();
        const { doc, getDoc } = await import(FIRESTORE_SDK);
        await Promise.all(uniqueIds.map(async (id) => {
          try {
            const snap = await getDoc(doc(db, 'products', id));
            productEligibilityCache.set(id, snap.exists()
              ? { brandId: snap.data().brandId || '', parentId: snap.data().parentId || '' }
              : null);
          } catch (err) {
            console.error(`Coupon: could not fetch product "${id}" for eligibility check:`, err);
            productEligibilityCache.set(id, null);
          }
        }));
      } catch (err) {
        console.error('Coupon: could not connect to database for eligibility check:', err);
      }
    }
    const map = {};
    productIds.forEach((id) => { map[id] = productEligibilityCache.get(id) || null; });
    return map;
  }

  /**
   * Splits cart items into what a (possibly brand/product-restricted)
   * coupon can and can't discount.
   * @param {object} coupon
   * @param {Array<{productId, price, quantity}>} cartItems
   * @returns {Promise<{eligibleSubtotal:number, totalSubtotal:number, allEligible:boolean, anyEligible:boolean}>}
   */
  async function resolveEligibility(coupon, cartItems) {
    const items = Array.isArray(cartItems) ? cartItems : [];
    const totalSubtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);

    const brandIds = Array.isArray(coupon.brandIds) ? coupon.brandIds : [];
    const productIds = Array.isArray(coupon.productIds) ? coupon.productIds : [];

    // No restriction set at all — every item in the cart is eligible,
    // and (importantly) this skips the product-doc fetches entirely.
    if (brandIds.length === 0 && productIds.length === 0) {
      return { eligibleSubtotal: totalSubtotal, totalSubtotal, allEligible: true, anyEligible: totalSubtotal > 0 };
    }

    const eligibilityMap = await fetchProductEligibility(items.map((it) => it.productId));

    let eligibleSubtotal = 0;
    items.forEach((it) => {
      const info = eligibilityMap[it.productId];
      const brandOk = brandIds.length === 0 || (info && brandIds.includes(info.brandId));
      // Product-eligible if: no product restriction set, OR this exact
      // product/variant id was picked, OR its parent product was picked
      // (parent selection covers every one of its variants).
      const productOk = productIds.length === 0
        || productIds.includes(it.productId)
        || (info && info.parentId && productIds.includes(info.parentId));
      if (brandOk && productOk) {
        eligibleSubtotal += (Number(it.price) || 0) * (Number(it.quantity) || 0);
      }
    });
    eligibleSubtotal = Math.round(eligibleSubtotal * 100) / 100;

    return {
      eligibleSubtotal,
      totalSubtotal,
      allEligible: eligibleSubtotal >= totalSubtotal,
      anyEligible: eligibleSubtotal > 0
    };
  }

  /** Local YYYY-MM-DD string (not UTC), so date comparisons match the
   *  shopper's own calendar day rather than shifting a day at UTC midnight. */
  function todayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatRupees(amount) {
    return '₹' + Math.round(amount).toLocaleString('en-IN');
  }

  function formatDateForHumans(isoDate) {
    const d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function computeDiscount(coupon, subtotal) {
    let discount;
    if (coupon.type === 'percentage') {
      discount = subtotal * (Number(coupon.value) / 100);
      if (coupon.maxDiscount !== null && coupon.maxDiscount !== undefined && coupon.maxDiscount !== '') {
        discount = Math.min(discount, Number(coupon.maxDiscount));
      }
    } else {
      // flat
      discount = Number(coupon.value);
    }
    // A discount can never exceed the subtotal itself, regardless of type.
    discount = Math.max(0, Math.min(discount, subtotal));
    return Math.round(discount * 100) / 100;
  }

  /**
   * @param {string} code - the coupon code the shopper entered
   * @param {number} subtotal - current cart subtotal (before discount) —
   *   still required, and still what minimum-order-value is checked
   *   against, so a coupon's ₹ minimum always reflects the whole cart even
   *   when it only discounts part of it.
   * @param {Array<{productId, price, quantity}>} [cartItems] - the cart's
   *   line items, needed to check a brand/product-restricted coupon. Not
   *   required for a coupon with no such restriction, but a restricted
   *   coupon can't be verified without it (rejected safely if omitted).
   * @returns {Promise<{valid: boolean, discount: number, message: string, coupon: object|null, eligibleSubtotal?: number}>}
   */
  async function validate(code, subtotal, cartItems) {
    const cleanCode = String(code || '').trim();
    if (!cleanCode) {
      return { valid: false, discount: 0, message: 'Enter a coupon code.', coupon: null };
    }

    let coupons;
    try {
      coupons = await loadCoupons();
    } catch (err) {
      return {
        valid: false,
        discount: 0,
        message: 'Could not check that coupon right now. Please try again.',
        coupon: null
      };
    }

    let match = coupons.find(
      (c) => String(c.code || '').trim().toUpperCase() === cleanCode.toUpperCase()
    );

    // Not found in the (possibly slightly stale) cache — force one refresh
    // before giving up, so a coupon created seconds ago in the admin panel
    // still works right away.
    if (!match) {
      try {
        coupons = await loadCoupons(true);
        match = coupons.find(
          (c) => String(c.code || '').trim().toUpperCase() === cleanCode.toUpperCase()
        );
      } catch (err) { /* keep match as undefined, handled below */ }
    }

    if (!match) {
      return { valid: false, discount: 0, message: 'That coupon code doesn\u2019t exist.', coupon: null };
    }

    if (!match.active) {
      return { valid: false, discount: 0, message: 'That coupon is no longer active.', coupon: null };
    }

    if (match.expiryDate && match.expiryDate < todayString()) {
      return {
        valid: false,
        discount: 0,
        message: `That coupon expired on ${formatDateForHumans(match.expiryDate)}.`,
        coupon: null
      };
    }

    const minOrder = Number(match.minOrderValue) || 0;
    if (subtotal < minOrder) {
      const shortfall = formatRupees(minOrder - subtotal);
      return {
        valid: false,
        discount: 0,
        message: `Add ${shortfall} more to your cart to use this coupon (minimum order ${formatRupees(minOrder)}).`,
        coupon: null
      };
    }

    const hasScopeRestriction = (Array.isArray(match.brandIds) && match.brandIds.length > 0)
      || (Array.isArray(match.productIds) && match.productIds.length > 0);

    if (!hasScopeRestriction) {
      // Unrestricted coupon — original behaviour, no product lookups needed.
      const discount = computeDiscount(match, subtotal);
      const savedText = formatRupees(discount);
      return {
        valid: true,
        discount,
        message: `Coupon applied — you saved ${savedText}.`,
        coupon: match
      };
    }

    // Restricted coupon — we need the actual cart items to know which part
    // of the subtotal it's even allowed to touch.
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return {
        valid: false,
        discount: 0,
        message: 'That coupon only applies to specific brands/products — could not verify your cart items.',
        coupon: null
      };
    }

    let eligibility;
    try {
      eligibility = await resolveEligibility(match, cartItems);
    } catch (err) {
      return {
        valid: false,
        discount: 0,
        message: 'Could not check that coupon right now. Please try again.',
        coupon: null
      };
    }

    if (!eligibility.anyEligible) {
      return {
        valid: false,
        discount: 0,
        message: 'That coupon isn\u2019t valid for any of the items currently in your cart.',
        coupon: null
      };
    }

    const discount = computeDiscount(match, eligibility.eligibleSubtotal);
    const savedText = formatRupees(discount);
    const message = eligibility.allEligible
      ? `Coupon applied — you saved ${savedText}.`
      : `Coupon applied — you saved ${savedText} (only applies to eligible items in your cart).`;

    return {
      valid: true,
      discount,
      message,
      coupon: match,
      eligibleSubtotal: eligibility.eligibleSubtotal
    };
  }

  window.Coupon = { validate };
})();

