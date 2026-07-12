/**
 * checkout.js
 * ---------------------------------------------------------------------------
 * Orchestrates the whole checkout flow. Loads LAST, after cart.js and
 * coupon.js, and depends on globals already provided elsewhere in the
 * project: SITE_CONFIG, Security, GeoRestriction, OrderEmail (Claude 1),
 * and Cart / Coupon / QRGenerator (this workstream).
 *
 * Flow:
 *   1. Cart + coupon review (always visible).
 *   2. Guest delivery-details form → validated → geo-restriction gate.
 *      Only on a pass does payment selection appear.
 *   3. Payment: COD finalizes immediately. UPI shows a QR + countdown;
 *      either the "Done" click or the countdown running out finalizes the
 *      order, both marked identically as "pending manual verification" —
 *      neither path is a verified payment, only a user claim.
 *   4. Confirmation screen with the Order ID.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // ---- Local state -----------------------------------------------------
  let appliedCoupon = null; // { code, discount, message } | null
  let selectedPaymentMethod = null; // 'COD' | 'UPI' | null
  let deliveryDetails = null; // sanitized values captured after Step 1 passes
  let currentOrderId = null;
  let orderFinalized = false;
  let upiTimerHandle = null;
  let upiSecondsLeft = 0;

  // ---- Small helpers -----------------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function formatRupees(amount) {
    const symbol = (window.SITE_CONFIG && window.SITE_CONFIG.currencySymbol) || '₹';
    return symbol + round2(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function scrollToEl(el) {
    if (!el) return;
    window.scrollTo({ top: el.offsetTop - 16, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  function show(id) {
    const el = $(id);
    if (el) el.hidden = false;
  }

  function hide(id) {
    const el = $(id);
    if (el) el.hidden = true;
  }

  function generateOrderId() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return `ORD-${y}${m}${d}-${suffix}`;
  }

  // ---- Cart + summary rendering ------------------------------------------

  function currentSubtotal() {
    return window.Cart.getTotal();
  }

  function currentDiscount() {
    return appliedCoupon ? appliedCoupon.discount : 0;
  }

  function currentCodCharge() {
    if (selectedPaymentMethod !== 'COD') return 0;
    return Number((window.SITE_CONFIG && window.SITE_CONFIG.codExtraCharge) || 0);
  }

  function currentFinalTotal() {
    return round2(currentSubtotal() - currentDiscount() + currentCodCharge());
  }

  function renderCartItems() {
    const items = window.Cart.getItems();
    const listEl = $('cart-items-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (items.length === 0) {
      show('empty-cart-message');
      hide('checkout-content');
      return;
    }
    hide('empty-cart-message');
    show('checkout-content');

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cart-row';
      const safeTitle = window.Security.escapeHTML(item.title);
      row.innerHTML = `
        <div class="cart-row__info">
          <span class="cart-row__title">${safeTitle}</span>
          <span class="cart-row__qty">Qty: ${item.quantity}</span>
        </div>
        <div class="cart-row__price">${formatRupees(item.price * item.quantity)}</div>
      `;
      listEl.appendChild(row);
    });
  }

  function renderSummary() {
    setText('summary-subtotal', formatRupees(currentSubtotal()));

    if (appliedCoupon) {
      show('summary-discount-row');
      setText('summary-discount-amount', '−' + formatRupees(appliedCoupon.discount));
    } else {
      hide('summary-discount-row');
    }

    if (selectedPaymentMethod === 'COD') {
      show('summary-cod-row');
      setText('summary-cod-amount', '+' + formatRupees(currentCodCharge()));
    } else {
      hide('summary-cod-row');
    }

    setText('summary-total', formatRupees(currentFinalTotal()));
  }

  function refreshCartAndSummary() {
    renderCartItems();
    renderSummary();
  }

  // ---- Coupon handling ----------------------------------------------------

  async function handleApplyCoupon() {
    const input = $('coupon-code-input');
    const msgEl = $('coupon-message');
    if (!input) return;

    const code = input.value.trim();
    const applyBtn = $('coupon-apply-btn');
    if (applyBtn) applyBtn.disabled = true;

    try {
      const result = await window.Coupon.validate(code, currentSubtotal());
      if (msgEl) {
        msgEl.textContent = result.message;
        msgEl.className = 'coupon-message ' + (result.valid ? 'coupon-message--success' : 'coupon-message--error');
      }
      if (result.valid) {
        appliedCoupon = { code: window.Security.escapeHTML(code), discount: result.discount, message: result.message };
        show('coupon-remove-btn');
        input.disabled = true;
        if (applyBtn) applyBtn.hidden = true;
      } else {
        appliedCoupon = null;
      }
      renderSummary();
    } finally {
      if (applyBtn) applyBtn.disabled = false;
    }
  }

  function handleRemoveCoupon() {
    appliedCoupon = null;
    const input = $('coupon-code-input');
    const msgEl = $('coupon-message');
    const applyBtn = $('coupon-apply-btn');
    if (input) {
      input.value = '';
      input.disabled = false;
    }
    if (msgEl) {
      msgEl.textContent = '';
      msgEl.className = 'coupon-message';
    }
    if (applyBtn) applyBtn.hidden = false;
    hide('coupon-remove-btn');
    renderSummary();
  }

  // ---- Step 1: delivery details form --------------------------------------

  function clearFieldErrors() {
    ['name', 'phone', 'address', 'city', 'state', 'pincode'].forEach((field) => {
      const el = $(`error-${field}`);
      if (el) el.textContent = '';
    });
  }

  function setFieldError(field, message) {
    const el = $(`error-${field}`);
    if (el) el.textContent = message;
  }

  /** Validates the raw form fields. Returns sanitized values on success. */
  function validateDeliveryFields() {
    clearFieldErrors();
    let valid = true;

    const raw = {
      name: $('field-name').value.trim(),
      phone: $('field-phone').value.trim(),
      email: $('field-email').value.trim(),
      address: $('field-address').value.trim(),
      city: $('field-city').value.trim(),
      state: $('field-state').value.trim(),
      pincode: $('field-pincode').value.trim()
    };

    if (!raw.name) {
      setFieldError('name', 'Enter your full name.');
      valid = false;
    }
    if (!window.Security.isValidIndianPhone(raw.phone)) {
      setFieldError('phone', 'Enter a valid 10-digit Indian mobile number.');
      valid = false;
    }
    // Email is optional — only validated if the customer chose to fill it in.
    if (raw.email && !window.Security.isValidEmail(raw.email)) {
      setFieldError('email', 'Enter a valid email address, or leave this blank.');
      valid = false;
    }
    if (!raw.address) {
      setFieldError('address', 'Enter your delivery address.');
      valid = false;
    }
    if (!raw.city) {
      setFieldError('city', 'Enter your city.');
      valid = false;
    }
    if (!raw.state) {
      setFieldError('state', 'Enter your state.');
      valid = false;
    }
    if (!window.Security.isValidPincode(raw.pincode)) {
      setFieldError('pincode', 'Enter a valid 6-digit pincode.');
      valid = false;
    }

    if (!valid) return { valid: false, values: null };

    // Sanitize every free-text field before it's used anywhere else
    // (on-screen summary, the order email, etc).
    const sanitized = {
      name: window.Security.escapeHTML(raw.name),
      phone: window.Security.escapeHTML(raw.phone),
      email: raw.email ? window.Security.escapeHTML(raw.email) : '',
      address: window.Security.escapeHTML(raw.address),
      city: window.Security.escapeHTML(raw.city),
      state: window.Security.escapeHTML(raw.state),
      pincode: window.Security.escapeHTML(raw.pincode)
    };
    return { valid: true, values: sanitized };
  }

  async function handleDeliveryFormSubmit(event) {
    event.preventDefault();
    const formEl = $('delivery-form');
    const formMsgEl = $('delivery-form-message');
    if (formMsgEl) formMsgEl.textContent = '';
    hide('geo-error-message');

    // Honeypot: bots that fill every field trip this. Reject silently —
    // no error message, so the bot gets no signal about what happened.
    if (window.Security.isHoneypotTripped(formEl, 'website')) {
      return;
    }

    // Basic double-submit / accidental resubmission guard.
    if (!window.Security.canSubmit('checkout', 5000)) {
      if (formMsgEl) formMsgEl.textContent = 'Please wait a moment before trying again.';
      return;
    }

    const { valid, values } = validateDeliveryFields();
    if (!valid) return;

    // Geo-restriction gate. Fail safe: if the config can't be loaded at all,
    // we cannot confirm the address is deliverable, so we block rather than
    // let the order through.
    const submitBtn = $('continue-to-payment-btn');
    if (submitBtn) submitBtn.disabled = true;

    let geoConfig;
    try {
      geoConfig = await window.GeoRestriction.loadConfig();
    } catch (err) {
      console.error('GeoRestriction config failed to load — blocking order.', err);
      const el = $('geo-error-message');
      if (el) {
        el.textContent = "We couldn't verify your delivery area right now. Please try again in a moment.";
        el.hidden = false;
      }
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const result = window.GeoRestriction.validate(geoConfig, {
      state: values.state,
      city: values.city,
      pincode: values.pincode
    });

    if (!result.valid) {
      const el = $('geo-error-message');
      if (el) {
        el.textContent = result.message;
        el.hidden = false;
      }
      if (submitBtn) submitBtn.disabled = false;
      return; // Do not proceed to payment selection at all.
    }

    // Passed every gate — lock in the details and move to payment.
    deliveryDetails = values;
    if (submitBtn) submitBtn.disabled = false;
    revealPaymentSection();
  }

  function revealPaymentSection() {
    hide('delivery-section');
    show('payment-section');
    show('edit-details-btn');
    if (!currentOrderId) {
      currentOrderId = generateOrderId();
    }
    setText('payment-order-id-note', `Order reference: ${currentOrderId}`);
    scrollToEl($('payment-section'));
  }

  function handleEditDetails() {
    stopUpiTimer();
    hide('payment-section');
    hide('upi-section');
    hide('cod-section');
    show('delivery-section');
    hide('edit-details-btn');
    selectedPaymentMethod = null;
    // Uncheck both payment radios so the visible UI matches the reset state —
    // otherwise a previously-checked radio would stay checked on screen while
    // `selectedPaymentMethod` silently says "none".
    document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
      radio.checked = false;
    });
    renderSummary();
  }

  // ---- Step 2: payment method ---------------------------------------------

  function handlePaymentMethodChange(event) {
    selectedPaymentMethod = event.target.value; // 'COD' | 'UPI'
    renderSummary();

    if (selectedPaymentMethod === 'COD') {
      stopUpiTimer();
      hide('upi-section');
      show('cod-section');
    } else if (selectedPaymentMethod === 'UPI') {
      hide('cod-section');
      show('upi-section');
      startUpiFlow();
    }
  }

  async function handlePlaceOrderCOD() {
    if (orderFinalized) return;
    const btn = $('place-order-cod-btn');
    if (btn) btn.disabled = true;
    await finalizeOrder('COD', 'Payment: Cash on Delivery.');
  }

  // ---- Step 3: UPI QR + countdown -----------------------------------------

  async function startUpiFlow() {
    const canvas = $('upi-qr-canvas');
    const linkEl = $('upi-pay-link');
    const amount = currentFinalTotal();

    setText('upi-amount-text', `Pay exactly ${formatRupees(amount)} via UPI`);

    const siteName = (window.SITE_CONFIG && window.SITE_CONFIG.siteName) || 'Store';
    const upiId = window.SITE_CONFIG.upiId;
    const upiLink = window.QRGenerator.buildUPILink({
      upiId,
      payeeName: siteName,
      amount,
      orderId: currentOrderId
    });

    if (linkEl) {
      linkEl.href = upiLink;
      linkEl.hidden = false;
    }

    try {
      await window.QRGenerator.renderQR(canvas, upiLink, 240);
    } catch (err) {
      console.error('QR rendering failed — falling back to the tappable UPI link only.', err);
      const fallbackMsg = $('upi-qr-fallback-message');
      if (fallbackMsg) fallbackMsg.hidden = false;
    }

    startUpiTimer();
  }

  function startUpiTimer() {
    stopUpiTimer();
    upiSecondsLeft = Number((window.SITE_CONFIG && window.SITE_CONFIG.upiAutoConfirmSeconds) || 60);
    renderUpiCountdown();
    upiTimerHandle = window.setInterval(() => {
      upiSecondsLeft -= 1;
      renderUpiCountdown();
      if (upiSecondsLeft <= 0) {
        stopUpiTimer();
        // Timer ran out with no click — finalize anyway. Don't make the
        // shopper's order hostage to a missed button press.
        finalizeOrder('UPI', 'Payment: UPI — pending manual verification (auto-confirmed after timer).');
      }
    }, 1000);
  }

  function stopUpiTimer() {
    if (upiTimerHandle) {
      window.clearInterval(upiTimerHandle);
      upiTimerHandle = null;
    }
  }

  function renderUpiCountdown() {
    setText('upi-countdown', `Auto-confirming in ${Math.max(0, upiSecondsLeft)}s if you don't click "Done"`);
  }

  async function handleUpiDone() {
    if (orderFinalized) return;
    stopUpiTimer();
    const btn = $('upi-done-btn');
    if (btn) btn.disabled = true;
    await finalizeOrder('UPI', 'Payment: UPI — pending manual verification (confirmed by customer).');
  }

  // ---- Finalization ---------------------------------------------------

  async function finalizeOrder(paymentMethod, statusNote) {
    if (orderFinalized) return;
    orderFinalized = true;
    stopUpiTimer();

    const items = window.Cart.getItems().map((item) => ({
      title: window.Security.escapeHTML(item.title),
      price: item.price,
      quantity: item.quantity
    }));

    const orderPayload = {
      orderId: currentOrderId,
      customerName: deliveryDetails.name,
      customerPhone: deliveryDetails.phone,
      customerEmail: deliveryDetails.email || 'Not provided',
      customerAddress: deliveryDetails.address,
      customerCity: deliveryDetails.city,
      customerState: deliveryDetails.state,
      customerPincode: deliveryDetails.pincode,
      items,
      subtotal: currentSubtotal(),
      discount: currentDiscount(),
      codCharge: currentCodCharge(),
      finalTotal: currentFinalTotal(),
      paymentMethod // exactly "COD" or "UPI"
    };

    try {
      await window.OrderEmail.send(orderPayload);
    } catch (err) {
      // The order still stands from the shopper's point of view — email
      // delivery is a notification concern, not a gate on the order itself.
      console.error('Order email failed to send.', err);
    }

    window.Cart.clear();
    showConfirmation(statusNote);
  }

  function showConfirmation(statusNote) {
    hide('payment-section');
    hide('delivery-section');
    hide('edit-details-btn');
    setText('confirmation-order-id', currentOrderId);
    setText('confirmation-payment-note', statusNote);
    show('confirmation-section');
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  // ---- Wiring --------------------------------------------------------

  function init() {
    refreshCartAndSummary();
    window.addEventListener('cart:updated', refreshCartAndSummary);

    const applyBtn = $('coupon-apply-btn');
    if (applyBtn) applyBtn.addEventListener('click', handleApplyCoupon);

    const removeBtn = $('coupon-remove-btn');
    if (removeBtn) removeBtn.addEventListener('click', handleRemoveCoupon);

    const deliveryForm = $('delivery-form');
    if (deliveryForm) deliveryForm.addEventListener('submit', handleDeliveryFormSubmit);

    const editBtn = $('edit-details-btn');
    if (editBtn) editBtn.addEventListener('click', handleEditDetails);

    document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
      radio.addEventListener('change', handlePaymentMethodChange);
    });

    const codBtn = $('place-order-cod-btn');
    if (codBtn) codBtn.addEventListener('click', handlePlaceOrderCOD);

    const upiDoneBtn = $('upi-done-btn');
    if (upiDoneBtn) upiDoneBtn.addEventListener('click', handleUpiDone);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
