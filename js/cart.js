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

    // On the product detail page there's a quantity input next to the
    // button; product-card buttons in listings don't have one, so we
    // default to 1.
    let quantity = 1;
    const qtyInput = document.querySelector('[data-qty-input]');
    if (qtyInput && document.getElementById('add-to-cart-btn') === btn) {
      quantity = Math.max(1, Math.floor(Number(qtyInput.value) || 1));
    }

    addItem(
      {
        productId: productId,
        title: btn.getAttribute('data-product-title') || '',
        price: Number(btn.getAttribute('data-product-price')) || 0,
        image: btn.getAttribute('data-product-image') || ''
      },
      quantity
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

    let quantity = 1;
    const qtyInput = document.querySelector('[data-qty-input]');
    if (qtyInput) {
      quantity = Math.max(1, Math.floor(Number(qtyInput.value) || 1));
    }

    addItem(
      {
        productId: productId,
        title: btn.getAttribute('data-product-title') || '',
        price: Number(btn.getAttribute('data-product-price')) || 0,
        image: btn.getAttribute('data-product-image') || ''
      },
      quantity
    );

    window.location.href = 'checkout.html';
  });
})();
