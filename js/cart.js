/**
 * cart.js
 * ---------------------------------------------------------------------------
 * Client-side cart state management. No backend — localStorage is the only
 * persistence layer, so it survives page navigation and refresh but not a
 * cleared browser / different device (expected for a static, guest-only site).
 *
 * Exposes a global `Cart` object, same pattern as `Security` / `GeoRestriction`.
 *
 * Cart item shape (the contract Claude 2's "Add to Cart" buttons rely on):
 *   { productId, title, price, quantity, image }
 *
 * Every mutation dispatches `cart:updated` on `window` with
 * `{ detail: { count } }` so the header badge can react without this module
 * touching header markup directly.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'cart_items';

  /** Read cart items from localStorage. Never throws — bad/missing data just
   *  resets to an empty cart rather than breaking the page. */
  function load() {
    let raw;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      // localStorage can throw in private-browsing modes on some browsers.
      console.warn('Cart: localStorage unavailable, using in-memory cart only.', err);
      return [];
    }
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Defensive normalization in case of malformed/legacy entries.
      return parsed
        .filter((item) => item && typeof item.productId !== 'undefined')
        .map((item) => ({
          productId: String(item.productId),
          title: String(item.title || ''),
          price: Number(item.price) || 0,
          quantity: Math.max(0, Math.floor(Number(item.quantity) || 0)),
          image: item.image ? String(item.image) : ''
        }))
        .filter((item) => item.quantity > 0);
    } catch (err) {
      console.warn('Cart: stored cart data was corrupted, resetting cart.', err);
      return [];
    }
  }

  /** Persist the current items array. */
  function save(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.warn('Cart: failed to persist cart to localStorage.', err);
    }
  }

  // In-memory mirror of what's in storage, kept in sync on every operation.
  let items = load();

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function notify() {
    save(items);
    window.dispatchEvent(
      new CustomEvent('cart:updated', { detail: { count: getItemCount() } })
    );
  }

  function findIndex(productId) {
    return items.findIndex((item) => item.productId === String(productId));
  }

  function addItem(product, quantity) {
    if (!product || typeof product.productId === 'undefined') {
      console.warn('Cart.addItem: product must include a productId.');
      return;
    }
    const qtyToAdd = Math.floor(Number(quantity) || 1);
    if (qtyToAdd <= 0) {
      // Adding a non-positive quantity is a no-op, not a removal — removal
      // has its own explicit method.
      return;
    }

    const idx = findIndex(product.productId);
    if (idx > -1) {
      items[idx].quantity += qtyToAdd;
      // Keep title/price/image fresh in case they changed on the product page.
      items[idx].title = product.title != null ? String(product.title) : items[idx].title;
      items[idx].price = product.price != null ? Number(product.price) : items[idx].price;
      items[idx].image = product.image != null ? String(product.image) : items[idx].image;
    } else {
      items.push({
        productId: String(product.productId),
        title: String(product.title || ''),
        price: Number(product.price) || 0,
        quantity: qtyToAdd,
        image: product.image ? String(product.image) : ''
      });
    }
    notify();

    // Tracking (GA4 add_to_cart + Meta AddToCart). Fires even when the
    // item already existed in the cart (quantity was just bumped) — that's
    // still a genuine "added to cart" action from the shopper's point of
    // view. Non-fatal by design: window.Tracking may not have loaded yet
    // on a very fast click, in which case this just silently no-ops.
    if (window.Tracking) {
      const value = (Number(product.price) || 0) * qtyToAdd;
      window.Tracking.trackEvent({
        ga4: {
          name: "add_to_cart",
          params: {
            currency: "INR",
            value,
            items: [{ item_id: String(product.productId), item_name: String(product.title || ""), price: Number(product.price) || 0, quantity: qtyToAdd }]
          }
        },
        meta: {
          name: "AddToCart",
          params: { content_ids: [String(product.productId)], content_name: String(product.title || ""), content_type: "product", currency: "INR", value }
        }
      });
    }
  }

  function removeItem(productId) {
    const idx = findIndex(productId);
    if (idx === -1) return;
    items.splice(idx, 1);
    notify();
  }

  function updateQuantity(productId, quantity) {
    const idx = findIndex(productId);
    if (idx === -1) return;
    const qty = Math.floor(Number(quantity) || 0);
    if (qty <= 0) {
      // Zero or negative quantity means "remove the item entirely".
      items.splice(idx, 1);
    } else {
      items[idx].quantity = qty;
    }
    notify();
  }

  function getItems() {
    // Return a deep copy so callers can't mutate internal state directly.
    return items.map((item) => Object.assign({}, item));
  }

  function getTotal() {
    return round2(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
  }

  function getItemCount() {
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }

  function clear() {
    items = [];
    notify();
  }

  window.Cart = {
    addItem,
    removeItem,
    updateQuantity,
    getItems,
    getTotal,
    getItemCount,
    clear
  };

  // Fire once on load so any header badge already on the page picks up the
  // persisted count immediately, without waiting for the first mutation.
  window.dispatchEvent(new CustomEvent('cart:updated', { detail: { count: getItemCount() } }));

  // ---------------------------------------------------------------------
  // Global click wiring for every "Add to Cart" button on the site.
  // product-loader.js (product cards) and product.html both just mark
  // their buttons with [data-add-to-cart] + data-product-* attributes —
  // this single delegated listener is what actually adds the item,
  // so it works the same way on every page without each page needing
  // its own wiring code.
  // ---------------------------------------------------------------------
  document.addEventListener('click', function (event) {
    const btn = event.target.closest('[data-add-to-cart]');
    if (!btn || btn.disabled) return;

    const productId = btn.getAttribute('data-product-id');
    if (!productId) return;

    // Always adds 1 — further quantity changes happen via the
    // −/qty/+ stepper this button morphs into (see js/cart-button-ui.js),
    // not a separate quantity input (removed).
    addItem(
      {
        productId: productId,
        title: btn.getAttribute('data-product-title') || '',
        price: Number(btn.getAttribute('data-product-price')) || 0,
        image: btn.getAttribute('data-product-image') || ''
      },
      1
    );

    // Quick visual confirmation without needing a toast library.
    const originalText = btn.textContent;
    btn.textContent = 'Added ✓';
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = originalText;
      btn.disabled = false;
    }, 900);
  });

  // ---------------------------------------------------------------------
  // "Buy Now" — same as Add to Cart, but skips straight to checkout
  // with that item in the cart. Any button marked [data-buy-now] gets
  // this behaviour; product.html uses it next to Add to Cart.
  // ---------------------------------------------------------------------
  document.addEventListener('click', function (event) {
    const btn = event.target.closest('[data-buy-now]');
    if (!btn || btn.disabled) return;

    const productId = btn.getAttribute('data-product-id');
    if (!productId) return;

    // The standalone quantity input is gone — quantity now lives entirely
    // in the "Add to Cart" stepper (js/cart-button-ui.js). If this product
    // is already in the cart (shopper bumped it up with the stepper first),
    // keep that quantity as-is; otherwise add 1 before jumping to checkout.
    const existing = items.find((i) => i.productId === String(productId));
    if (!existing) {
      addItem(
        {
          productId: productId,
          title: btn.getAttribute('data-product-title') || '',
          price: Number(btn.getAttribute('data-product-price')) || 0,
          image: btn.getAttribute('data-product-image') || ''
        },
        1
      );
    }

    window.location.href = '/checkout.html';
  });
})();
