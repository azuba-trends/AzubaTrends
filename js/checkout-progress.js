/**
 * checkout-progress.js
 * ------------------------------------------------------------------
 * Renders the shared 3-step "Cart -> Checkout -> Payment" progress bar
 * into a mount element, and lets the host page tell it which step is
 * current. Steps before the current one are marked done, steps after
 * stay dim — exactly one step is ever "current" at a time.
 * ------------------------------------------------------------------
 */
const CheckoutProgress = (function () {
  const STEPS = ["Cart", "Checkout", "Payment"];

  function render(mountEl, currentStepIndex) {
    if (!mountEl) return;
    mountEl.innerHTML = `
      <div class="checkout-progress">
        ${STEPS.map((label, i) => {
          const state = i < currentStepIndex ? "is-done" : i === currentStepIndex ? "is-current" : "";
          const lineAfter = i < STEPS.length - 1
            ? `<div class="checkout-progress__line ${i < currentStepIndex ? "is-done" : ""}"></div>`
            : "";
          return `
            <div class="checkout-progress__step ${state}">
              <span class="checkout-progress__circle">${i < currentStepIndex ? "✓" : i + 1}</span>
              <span class="checkout-progress__label">${label}</span>
            </div>
            ${lineAfter}`;
        }).join("")}
      </div>`;
  }

  window.CheckoutProgress = { render };
  return { render };
})();
