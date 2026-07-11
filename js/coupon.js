/**
 * coupon.js
 * ---------------------------------------------------------------------------
 * Validates a coupon code against config/coupons.json and computes the
 * discount for a given cart subtotal. Every result — success or failure —
 * carries a human-readable `message` so the checkout UI can explain *why*
 * a code was rejected (expired vs. below minimum vs. unknown code), not just
 * show a generic "invalid coupon".
 *
 * Exposes a global `Coupon` object.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const COUPONS_URL = 'config/coupons.json';

  // Cache the parsed coupon list after the first successful fetch so re-applying
  // or re-checking a code doesn't re-fetch the file every time.
  let couponsCache = null;
  let fetchPromise = null;

  async function loadCoupons() {
    if (couponsCache) return couponsCache;
    if (fetchPromise) return fetchPromise;

    fetchPromise = fetch(COUPONS_URL)
      .then((res) => {
        if (!res.ok) throw new Error('Coupon list request failed: ' + res.status);
        return res.json();
      })
      .then((data) => {
        couponsCache = Array.isArray(data) ? data : [];
        return couponsCache;
      })
      .catch((err) => {
        fetchPromise = null; // allow a retry on the next call
        throw err;
      });

    return fetchPromise;
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
      if (coupon.maxDiscount !== null && coupon.maxDiscount !== undefined) {
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

    const match = coupons.find(
      (c) => String(c.code || '').trim().toUpperCase() === cleanCode.toUpperCase()
    );

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
