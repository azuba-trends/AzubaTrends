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
 * Every result — success or failure — carries a human-readable `message` so
 * the checkout UI can explain *why* a code was rejected (expired vs. below
 * minimum vs. unknown code), not just show a generic "invalid coupon".
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
   * @param {number} subtotal - current cart subtotal (before discount)
   * @returns {Promise<{valid: boolean, discount: number, message: string, coupon: object|null}>}
   */
  async function validate(code, subtotal) {
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

    const discount = computeDiscount(match, subtotal);
    const savedText = formatRupees(discount);
    return {
      valid: true,
      discount,
      message: `Coupon applied — you saved ${savedText}.`,
      coupon: match
    };
  }

  window.Coupon = { validate };
})();
