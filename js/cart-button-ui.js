/**
 * cart-button-ui.js
 * ---------------------------------------------------------------------------
 * "Add to Cart" morphs in place into a −/qty/+ stepper the moment that
 * product is in the cart (whether it got there just now, or was already
 * there from a previous visit — this checks Cart.getItems() on mount, so a
 * page reload shows the stepper immediately, not a flash of "Add to Cart"
 * first). Same component, same markup, used by both the product card grid
 * (js/product-loader.js) and the product detail page (product.html) so the
 * behaviour is identical everywhere.
 *
 * The "Add to Cart" button itself still just carries the existing
 * [data-add-to-cart] contract — cart.js's global delegated click listener
 * is what actually adds it. This module only decides *which* markup
 * (button vs stepper) is showing, and owns the +/- clicks once the
 * stepper is showing.
 * ---------------------------------------------------------------------------
 */
const CartButtonUI = (function () {
  function currentQty(productId) {
    if (!window.Cart) return 0;
    const item = window.Cart.getItems().find((i) => i.productId === String(productId));
    return item ? item.quantity : 0;
  }

  function render(container, product) {
    if (!container) return;
    const qty = currentQty(product.productId);

    if (product.stock === 0) {
      container.innerHTML = `<button class="btn btn-outline btn-block" disabled>Out of Stock</button>`;
      return;
    }

    if (qty > 0) {
      container.innerHTML = `
        <div class="qty-stepper" data-product-id="${product.productId}">
          <button type="button" class="qty-stepper__btn" data-qty-dec aria-label="Decrease quantity">−</button>
          <span class="qty-stepper__value">${qty}</span>
          <button type="button" class="qty-stepper__btn" data-qty-inc aria-label="Increase quantity">+</button>
        </div>`;
    } else {
      container.innerHTML = `
        <button class="btn btn-outline btn-block"
          data-add-to-cart
          data-product-id="${product.productId}"
          data-product-title="${product.title}"
          data-product-price="${product.price}"
          data-product-image="${product.image}">
          Add to Cart
        </button>`;
    }
  }

  /** Mounts the stepper/button into `container` for one product, and keeps
   *  it live-synced with the cart from then on (any tab, any button). */
  function mount(container, product) {
    if (!container || !product || typeof product.productId === "undefined") return;
    render(container, product);

    // Re-render on every cart change so this button, the header badge, the
    // bottom-nav badge, and every other instance of this same product's
    // button on the page (e.g. it could appear in "related products" too)
    // all stay in sync instantly, without a page reload.
    window.addEventListener("cart:updated", () => render(container, product));

    container.addEventListener("click", (e) => {
      const dec = e.target.closest("[data-qty-dec]");
      const inc = e.target.closest("[data-qty-inc]");
      if (!dec && !inc) return; // "Add to Cart" clicks are handled by cart.js's own delegated listener
      e.preventDefault();
      const qty = currentQty(product.productId);
      if (qty <= 0) return;
      window.Cart.updateQuantity(product.productId, dec ? qty - 1 : qty + 1);
    });
  }

  return { mount, render };
})();

if (typeof window !== "undefined") {
  window.CartButtonUI = CartButtonUI;
}
