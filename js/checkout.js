// js/checkout.js
//
// Fixes vs the previous version:
// 1. THE PAGE NOW ACTUALLY SHOWS ITSELF. Previously #checkout-content and
//    #empty-cart-message both started as display:none and nothing ever
//    toggled them — that's why checkout looked blank. This file now mirrors
//    cart.html's pattern: show the empty message OR the content, always.
// 2. West Bengal validation now goes through GeoRestriction
//    (config/geo-config.json) instead of a second, hand-rolled regex that
//    silently ignored the admin-editable config file.
// 3. Every field is validated individually with its own error message
//    (Security.isValidIndianPhone / isValidEmail / GeoRestriction), and every
//    field is mandatory, per spec.
// 4. Cart/summary rendering uses Security.escapeHTML — no raw innerHTML of
//    user- or product-supplied text.
// 5. The coupon is re-validated against the current cart total right before
//    placing the order (not just trusted from sessionStorage) so a stale or
//    tampered discount can't sneak through.
// 6. Per-product deliveryFee (set by the admin on each product) is summed
//    into the total as its own line item.
(function () {
  'use strict';

  let deliveryDetails = null;
  let selectedPaymentMethod = null;
  let appliedCoupon = null; // { code, discount } - re-validated, not trusted blindly
  let productsById = {};    // productId -> product doc, loaded once for delivery-fee lookup
  const currentOrderId = `ORD-${Date.now().toString().slice(-6)}`;
  let orderJustPlaced = false; // guards against the empty-cart view flashing over the confirmation screen
  let uploadedScreenshotUrl = null; // set once the mandatory UPI payment screenshot finishes uploading to ImgBB
  let screenshotUploading = false;

  function $(id) { return document.getElementById(id); }

  // .hidden (the IDL property) toggles the `hidden` *attribute*, which loses
  // to any inline `style="display:none"` already on the element — that
  // mismatch is exactly why the COD/UPI panels never appeared before.
  // These two helpers always win by setting style.display directly.
  function show(id) { const el = $(id); if (el) el.style.display = ''; }
  function hide(id) { const el = $(id); if (el) el.style.display = 'none'; }

  function showFieldError(id, message) {
    const el = $(id);
    if (el) el.textContent = message || '';
  }

  function clearAllFieldErrors() {
    ['error-name', 'error-phone', 'error-email', 'error-address', 'error-city', 'error-pincode']
      .forEach((id) => showFieldError(id, ''));
  }

  // ------------------------------------------------------------------
  // Boot: show empty-cart message or the real content, never both/neither.
  // ------------------------------------------------------------------
  function renderPageVisibility() {
    // Once an order is placed, Cart.clear() fires cart:updated with an
    // empty cart — without this guard, that made the page fall through to
    // the "Your cart is empty" view and bury the confirmation section that
    // had literally just been shown a moment earlier.
    if (orderJustPlaced) return;
    const items = window.Cart ? window.Cart.getItems() : [];
    const empty = $('empty-cart-message');
    const content = $('checkout-content');
    if (!empty || !content) return;
    if (items.length === 0) {
      empty.style.display = 'block';
      content.style.display = 'none';
    } else {
      empty.style.display = 'none';
      content.style.display = 'block';
    }
  }

  // ------------------------------------------------------------------
  // City dropdown — populated from config/geo-config.json's allowedCities
  // (the same admin-editable list used for validation), so the dropdown and
  // the validation logic can never drift apart again.
  // ------------------------------------------------------------------
  async function populateCities(geoConfig) {
    const citySelect = $('field-city');
    if (!citySelect) return;
    const cities = (geoConfig.allowedCities || []).slice().sort();
    citySelect.innerHTML = '<option value="">Select City / Town</option>';
    cities.forEach((city) => {
      const opt = document.createElement('option');
      opt.value = city;
      opt.textContent = city;
      citySelect.appendChild(opt);
    });
    // A shopper's real town might not be in the curated list — let them type
    // their own instead of being blocked entirely.
    const otherOpt = document.createElement('option');
    otherOpt.value = '__other__';
    otherOpt.textContent = 'Other (type below)';
    citySelect.appendChild(otherOpt);
  }

  function wireCityOther() {
    const citySelect = $('field-city');
    const otherWrap = $('field-city-other-wrap');
    const otherInput = $('field-city-other');
    if (!citySelect || !otherWrap) return;
    citySelect.addEventListener('change', () => {
      const isOther = citySelect.value === '__other__';
      otherWrap.style.display = isOther ? 'block' : 'none';
      if (!isOther && otherInput) otherInput.value = '';
    });
  }

  function getCityValue() {
    const citySelect = $('field-city');
    const otherInput = $('field-city-other');
    if (!citySelect) return '';
    if (citySelect.value === '__other__') return (otherInput?.value || '').trim();
    return citySelect.value;
  }

  // ------------------------------------------------------------------
  // Live pincode feedback as the user types (uses the real GeoRestriction
  // module + geo-config.json now, not a duplicate regex).
  // ------------------------------------------------------------------
  function wireLivePincode(geoConfig) {
    const pinInput = $('field-pincode');
    if (!pinInput) return;
    pinInput.addEventListener('input', (e) => {
      const pin = e.target.value.replace(/\D/g, '');
      const errEl = $('error-pincode');
      if (!errEl) return;
      if (pin.length !== 6) {
        errEl.textContent = '';
        errEl.style.color = '';
        return;
      }
      const check = window.GeoRestriction.validate(geoConfig, { state: 'West Bengal', pincode: pin, city: '' });
      if (check.details.pincodeAllowed) {
        errEl.textContent = '✓ Deliverable pincode';
        errEl.style.color = 'var(--color-success, green)';
      } else {
        errEl.textContent = '❌ ' + (check.details.pincodeReason || 'Not deliverable here.');
        errEl.style.color = 'var(--color-danger, red)';
      }
    });
  }

  function getCartTotal() {
    return window.Cart ? window.Cart.getTotal() : 0;
  }

  function getCodCharge() {
    return selectedPaymentMethod === 'COD' ? (window.SITE_CONFIG.codExtraCharge || 0) : 0;
  }

  // Sum of each distinct product's deliveryFee (set by admin per product),
  // once per line item — not multiplied by quantity, since it represents a
  // per-shipment handling cost, not a per-unit one.
  function getDeliveryFeeTotal() {
    const items = window.Cart ? window.Cart.getItems() : [];
    return items.reduce((sum, item) => {
      const product = productsById[item.productId];
      const fee = product && product.deliveryFee ? Number(product.deliveryFee) || 0 : 0;
      return sum + fee;
    }, 0);
  }

  async function loadProductsForDeliveryFees() {
    try {
      if (window.ProductLoader) {
        const all = await window.ProductLoader.loadAllProducts();
        productsById = {};
        all.forEach((p) => { productsById[p.id] = p; });
      }
    } catch (err) {
      console.warn('Checkout: could not load products for delivery-fee lookup', err);
    }
  }

  function renderCartList() {
    const listEl = $('checkout-items-list');
    if (!listEl) return;
    const items = window.Cart ? window.Cart.getItems() : [];
    listEl.innerHTML = '';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'cart-row';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.padding = '6px 0';

      const label = document.createElement('span');
      Security.setTextSafely(label, `${item.title} (x${item.quantity})`);

      const amount = document.createElement('b');
      Security.setTextSafely(amount, '₹' + (item.price * item.quantity));

      row.appendChild(label);
      row.appendChild(amount);
      listEl.appendChild(row);
    });
  }

  function ensureRow(id, afterId) {
    let row = $(id);
    if (!row) {
      row = document.createElement('div');
      row.className = 'summary-row';
      row.id = id;
      const after = $(afterId);
      after.parentElement.insertBefore(row, after);
    }
    return row;
  }

  function renderSummary() {
    const subtotal = getCartTotal();
    Security.setTextSafely($('summary-subtotal'), '₹' + subtotal);

    // Discount row
    const discountAmount = appliedCoupon ? appliedCoupon.discount : 0;
    let discountRow = $('summary-discount-row');
    if (discountAmount > 0) {
      if (discountRow) {
        discountRow.style.display = 'flex';
        Security.setTextSafely($('summary-discount-amount'), '-₹' + discountAmount);
      }
    } else if (discountRow) {
      discountRow.style.display = 'none';
    }

    // Delivery fee row (created dynamically — not in the original markup)
    const deliveryFee = getDeliveryFeeTotal();
    const deliveryRow = ensureRow('summary-delivery-row', 'summary-cod-row');
    if (deliveryFee > 0) {
      deliveryRow.innerHTML = '';
      const l = document.createElement('span'); l.textContent = 'Delivery Fee';
      const a = document.createElement('span'); a.textContent = '+₹' + deliveryFee;
      deliveryRow.appendChild(l); deliveryRow.appendChild(a);
      deliveryRow.style.display = 'flex';
    } else {
      deliveryRow.style.display = 'none';
    }

    const codCharge = getCodCharge();
    const codRow = $('summary-cod-row');
    if (codRow) {
      if (codCharge > 0) {
        codRow.style.display = 'flex';
        Security.setTextSafely($('summary-cod-amount'), '+₹' + codCharge);
      } else {
        codRow.style.display = 'none';
      }
    }

    const total = Math.max(0, subtotal - discountAmount + codCharge + deliveryFee);
    Security.setTextSafely($('summary-total'), '₹' + total);
    return total;
  }

  // Re-check the coupon from sessionStorage against the CURRENT cart total —
  // never trust the discount number that was cached on the cart page, since
  // the cart may have changed since then.
  async function reValidateCoupon() {
    const saved = sessionStorage.getItem('applied_coupon');
    if (!saved) { appliedCoupon = null; return; }
    let parsed;
    try { parsed = JSON.parse(saved); } catch (err) { appliedCoupon = null; return; }
    if (!parsed || !parsed.code) { appliedCoupon = null; return; }

    const subtotal = getCartTotal();
    const result = await window.Coupon.validate(parsed.code, subtotal);
    appliedCoupon = result.valid ? { code: parsed.code, discount: result.discount } : null;
    if (!result.valid) sessionStorage.removeItem('applied_coupon');
  }

  function initUI(geoConfig) {
    populateCities(geoConfig);
    wireCityOther();
    wireLivePincode(geoConfig);
  }

  // ------------------------------------------------------------------
  // Delivery form submit — full per-field validation, mandatory fields.
  // ------------------------------------------------------------------
  function wireDeliveryForm(geoConfig) {
    $('delivery-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      clearAllFieldErrors();

      // Honeypot + throttle: same first line of defense used across the site.
      if (Security.isHoneypotTripped(e.target, 'website')) return; // silently drop
      if (!Security.canSubmit('checkout-delivery-form', 2000)) return;

      const name = $('field-name').value.trim();
      const phone = $('field-phone').value.trim();
      const email = $('field-email').value.trim();
      const address = $('field-address').value.trim();
      const city = getCityValue();
      const pin = $('field-pincode').value.replace(/\D/g, '');

      let hasError = false;

      if (!name) { showFieldError('error-name', 'Please enter your full name.'); hasError = true; }
      if (!Security.isValidIndianPhone(phone)) {
        showFieldError('error-phone', 'Enter a valid 10-digit mobile number.');
        hasError = true;
      }
      if (!Security.isValidEmail(email)) {
        showFieldError('error-email', 'Enter a valid email address.');
        hasError = true;
      }
      if (!address) { showFieldError('error-address', 'Please enter your full address.'); hasError = true; }
      if (!city) { showFieldError('error-city', 'Please select or enter your city/town.'); hasError = true; }

      const pinCheck = window.GeoRestriction.validate(geoConfig, { state: 'West Bengal', pincode: pin, city });
      if (!pin || pin.length !== 6) {
        showFieldError('error-pincode', 'PIN code must be exactly 6 digits.');
        hasError = true;
      } else if (!pinCheck.details.pincodeAllowed) {
        showFieldError('error-pincode', pinCheck.details.pincodeReason || 'We do not deliver to this PIN code.');
        hasError = true;
      }

      if (hasError) return;

      deliveryDetails = {
        name: Security.escapeHTML(name),
        phone,
        email,
        address: Security.escapeHTML(address),
        city: Security.escapeHTML(city),
        state: 'West Bengal',
        pincode: pin
      };

      $('delivery-section').hidden = true;
      $('payment-section').hidden = false;
      Security.setTextSafely($('payment-order-id-note'), 'Order ID: ' + currentOrderId);
      renderSummary();
    });
  }

  function wirePaymentSelection() {
    document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        selectedPaymentMethod = e.target.value;
        renderSummary();
        if (selectedPaymentMethod === 'COD') {
          if (upiCountdownTimer) clearInterval(upiCountdownTimer);
          hide('upi-section');
          show('cod-section');
        } else {
          hide('cod-section');
          show('upi-section');
          startUPIFlow();
        }
      });
    });
  }

  let upiCountdownTimer = null;
  let orderAutoPlacing = false; // guards against the auto-place timer and a manual click firing at the same instant

  function startUPIFlow() {
    const total = renderSummary();
    Security.setTextSafely($('upi-amount-text'), `Pay Exactly ₹${total} via UPI`);
    Security.setTextSafely($('upi-order-id-note'), `Order ID: ${currentOrderId}`);

    if (window.QRGenerator && window.SITE_CONFIG.upiId) {
      const link = window.QRGenerator.buildUPILink({
        upiId: window.SITE_CONFIG.upiId,
        payeeName: window.SITE_CONFIG.siteName,
        amount: total,
        orderId: currentOrderId
      });
      window.QRGenerator.renderQR($('upi-qr-canvas'), link, 240);
    }

    // 3-minute countdown. If the shopper neither confirms ("I have paid")
    // nor navigates away before this hits 0, the order is auto-placed as
    // Pending (no screenshot required in that case) so it isn't lost —
    // admin can verify manually or delete it from the Admin Panel.
    if (upiCountdownTimer) clearInterval(upiCountdownTimer);
    let secondsLeft = window.SITE_CONFIG.upiAutoConfirmSeconds || 180;
    const countdownEl = $('upi-countdown-text');
    const tick = () => {
      if (secondsLeft <= 0) {
        clearInterval(upiCountdownTimer);
        Security.setTextSafely(countdownEl, 'Time is up — placing your order as pending...');
        finalizeOrder('UPI', { auto: true });
        return;
      }
      const mins = Math.floor(secondsLeft / 60);
      const secs = String(secondsLeft % 60).padStart(2, '0');
      Security.setTextSafely(countdownEl, `Scan & pay within ${mins}:${secs}, then tap "I have paid" below.`);
      secondsLeft -= 1;
    };
    tick();
    upiCountdownTimer = setInterval(tick, 1000);
  }

  // ------------------------------------------------------------------
  // Mandatory payment-screenshot upload (replaces the old manual
  // last-6-digit UTR box). Uses the same ImgBB upload pattern already
  // used for review photos (js/reviews.js) — same key, same model.
  // ------------------------------------------------------------------
  function wireScreenshotUpload() {
    const input = $('upi-screenshot-input');
    const doneBtn = $('upi-done-btn');
    const statusEl = $('upi-screenshot-status');
    const previewWrap = $('upi-screenshot-preview-wrap');
    const previewImg = $('upi-screenshot-preview');
    if (!input) return;

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      showFieldError('error-upi-screenshot', '');
      uploadedScreenshotUrl = null;
      if (doneBtn) doneBtn.disabled = true;
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        showFieldError('error-upi-screenshot', 'Image is too large — please keep it under 2MB.');
        input.value = '';
        return;
      }

      if (previewWrap && previewImg) {
        previewImg.src = URL.createObjectURL(file);
        previewWrap.style.display = 'block';
      }

      screenshotUploading = true;
      Security.setTextSafely(statusEl, 'Uploading screenshot...');
      try {
        const key = window.SITE_CONFIG && window.SITE_CONFIG.imgbbKey;
        if (!key) throw new Error("Image uploads aren't set up yet — the store hasn't added an ImgBB key.");
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (!data || !data.data || !data.data.url) throw new Error('Upload failed. Please try again.');
        uploadedScreenshotUrl = data.data.url;
        Security.setTextSafely(statusEl, '✓ Screenshot uploaded — you can now place your order.');
        if (statusEl) statusEl.style.color = 'var(--color-success, green)';
        if (doneBtn) doneBtn.disabled = false;
      } catch (err) {
        console.error('Payment screenshot upload failed:', err);
        Security.setTextSafely(statusEl, '');
        showFieldError('error-upi-screenshot', err.message || 'Upload failed. Please try again.');
      } finally {
        screenshotUploading = false;
      }
    });
  }

  async function finalizeOrder(method, opts = {}) {
    const isAuto = !!opts.auto;

    // Guard against the 3-minute auto-place timer and a manual click firing
    // at (or near) the same instant, and against the order already having
    // been placed by whichever path got there first.
    if (orderJustPlaced || orderAutoPlacing) return;
    if (!isAuto && !Security.canSubmit('checkout-place-order', 3000)) return;
    if (isAuto) orderAutoPlacing = true;
    if (upiCountdownTimer) clearInterval(upiCountdownTimer);

    // Payment screenshot replaces the old manual last-6-digit UTR box —
    // it's the real verification proof now. Not required on the 3-minute
    // auto-place path, since the shopper never got a chance to confirm.
    if (method === 'UPI' && !isAuto) {
      showFieldError('error-upi-screenshot', '');
      if (screenshotUploading) {
        showFieldError('error-upi-screenshot', 'Please wait for the screenshot to finish uploading.');
        orderAutoPlacing = false;
        return;
      }
      if (!uploadedScreenshotUrl) {
        showFieldError('error-upi-screenshot', 'Please upload a screenshot of your payment before placing the order.');
        orderAutoPlacing = false;
        return;
      }
    }

    const btnId = method === 'COD' ? 'place-order-cod-btn' : 'upi-done-btn';
    const btn = $(btnId);
    if (btn) {
      btn.disabled = true;
      btn.textContent = isAuto ? 'Placing order...' : 'Processing...';
    }

    await reValidateCoupon();
    const items = window.Cart.getItems();
    const subtotal = getCartTotal();
    const discount = appliedCoupon ? appliedCoupon.discount : 0;
    const codCharge = getCodCharge();
    const deliveryFee = getDeliveryFeeTotal();
    const finalTotal = Math.max(0, subtotal - discount + codCharge + deliveryFee);

    let orderPayload = {
      orderId: currentOrderId,
      customerName: deliveryDetails.name,
      customerPhone: deliveryDetails.phone,
      customerEmail: deliveryDetails.email,
      customerAddress: deliveryDetails.address,
      customerCity: deliveryDetails.city,
      customerState: deliveryDetails.state,
      customerPincode: deliveryDetails.pincode,
      items: items,
      subtotal: subtotal,
      discount: discount,
      couponCode: appliedCoupon ? appliedCoupon.code : null,
      deliveryFee: deliveryFee,
      codCharge: codCharge,
      finalTotal: finalTotal,
      paymentMethod: method,
      paymentScreenshotUrl: method === 'UPI' ? uploadedScreenshotUrl : null,
      autoPlaced: isAuto,
      status: 'Pending',
      createdAt: new Date().toISOString()
    };

    const { doc, setDoc, updateDoc } = await import('https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js');
    while (!window.FirebaseApp) { await new Promise((r) => setTimeout(r, 100)); }
    const db = window.FirebaseApp.db;

    // Try the server-side-verified path first: api/place-order.js
    // re-fetches real prices/coupon rules from Firestore and computes the
    // total itself, ignoring whatever the browser sent — this is what
    // stops DevTools price tampering. If that route 404s (this build is
    // hosted somewhere without serverless functions, e.g. GitHub Pages),
    // fall back to the old direct client write so checkout still works,
    // just without that extra server-side check on this particular host.
    let serverVerified = false;
    try {
      const apiRes = await fetch('/api/place-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: currentOrderId,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          deliveryDetails,
          paymentMethod: method,
          couponCode: appliedCoupon ? appliedCoupon.code : null,
          paymentScreenshotUrl: method === 'UPI' ? uploadedScreenshotUrl : null,
          autoPlaced: isAuto
        })
      });

      if (apiRes.status === 404) {
        throw { isFallback: true }; // route doesn't exist on this host — fall back below
      }
      if (!apiRes.ok) {
        const errBody = await apiRes.json().catch(() => ({}));
        throw new Error(errBody.error || 'We could not verify your order. Please refresh and try again.');
      }
      const result = await apiRes.json();
      orderPayload = result.order; // use the server's verified numbers for the email + confirmation screen
      serverVerified = true;
    } catch (err) {
      if (!(err && err.isFallback)) {
        // A real rejection from the server (out of stock, invalid coupon,
        // bad payment method, etc) — surface it and stop, don't fall back
        // to an unverified write.
        console.error('Server-verified order placement failed:', err);
        alert(err.message || 'Something went wrong while placing your order. Please try again.');
        if (btn) {
          btn.disabled = false;
          btn.textContent = method === 'COD' ? 'Place Order (COD)' : 'I have paid, Place Order';
        }
        orderAutoPlacing = false;
        return;
      }
      console.warn('api/place-order not available on this host — falling back to direct client write (no server-side price re-check).');
    }

    try {
      if (!serverVerified) {
        await setDoc(doc(db, 'orders', currentOrderId), orderPayload);
      }

      orderJustPlaced = true;
      window.Cart.clear();
      sessionStorage.removeItem('applied_coupon');

      if (window.Tracking) {
        window.Tracking.trackEvent({
          ga4: {
            name: "purchase",
            params: {
              transaction_id: orderPayload.orderId,
              currency: "INR",
              value: orderPayload.finalTotal,
              shipping: orderPayload.deliveryFee || 0,
              coupon: orderPayload.couponCode || undefined,
              items: (orderPayload.items || []).map((i) => ({ item_id: i.productId, item_name: i.title, price: i.price, quantity: i.quantity }))
            }
          },
          meta: {
            name: "Purchase",
            params: {
              content_ids: (orderPayload.items || []).map((i) => i.productId),
              content_type: "product",
              currency: "INR",
              value: orderPayload.finalTotal
            }
          }
        });
      }

      $('payment-section').hidden = true;
      $('confirmation-section').hidden = false;
      if ($('summary-aside')) $('summary-aside').style.display = 'none';
      Security.setTextSafely($('confirmation-order-id'), currentOrderId);
      let paymentNote;
      if (method === 'COD') {
        paymentNote = 'Payment to be collected on delivery.';
      } else if (isAuto) {
        paymentNote = `We didn't hear back from you in time, so Order ${currentOrderId} has been placed as Pending. If you already paid, no action needed — we'll verify and confirm it shortly.`;
      } else {
        paymentNote = `UPI payment for Order ${currentOrderId} is pending manual verification. We'll confirm once we receive it.`;
      }
      Security.setTextSafely($('confirmation-payment-note'), paymentNote);

      if (window.OrderEmail) {
        window.OrderEmail.send(orderPayload)
          .then(() => updateDoc(doc(db, 'orders', currentOrderId), { emailStatus: 'sent' }).catch(() => {}))
          .catch((e) => {
            // Don't block the order on email failure, but DO record it —
            // this used to fail completely silently (console.log only),
            // which made "the customer says no email arrived" impossible
            // to diagnose. Now it shows up on the order in Admin > Orders.
            console.warn('EmailJS failed, but order saved in DB.', e);
            updateDoc(doc(db, 'orders', currentOrderId), {
              emailStatus: 'failed',
              emailError: String((e && (e.text || e.message)) || e)
            }).catch(() => {});
          });
      }
    } catch (err) {
      console.error(err);
      alert('Something went wrong while placing your order. Please try again.');
      orderAutoPlacing = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = method === 'COD' ? 'Place Order (COD)' : 'I have paid, Place Order';
      }
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    renderPageVisibility();
    window.addEventListener('cart:updated', () => {
      renderPageVisibility();
      renderCartList();
      // Cart may have just dropped below the applied coupon's minOrderValue
      // (qty reduced, item removed) — re-check it live instead of only at
      // final submit, so the summary the shopper is looking at is never wrong.
      reValidateCoupon().then(renderSummary);
    });

    if (!window.Cart || window.Cart.getItems().length === 0) return; // nothing else to boot on an empty cart

    if (window.SITE_CONFIG_READY) await window.SITE_CONFIG_READY;
    await loadProductsForDeliveryFees();
    await reValidateCoupon();

    let geoConfig;
    try {
      geoConfig = await window.GeoRestriction.loadConfig();
    } catch (err) {
      console.error('Checkout: could not load geo-config.json — blocking checkout to fail safe.', err);
      alert('We could not verify delivery availability right now. Please refresh and try again.');
      return;
    }

    initUI(geoConfig);
    wireDeliveryForm(geoConfig);
    wirePaymentSelection();
    wireScreenshotUpload();
    $('place-order-cod-btn')?.addEventListener('click', () => finalizeOrder('COD'));
    $('upi-done-btn')?.addEventListener('click', () => finalizeOrder('UPI'));

    renderCartList();
    renderSummary();

    if (window.Tracking) {
      const items = window.Cart.getItems();
      const value = getCartTotal();
      window.Tracking.trackEvent({
        ga4: {
          name: "begin_checkout",
          params: {
            currency: "INR",
            value,
            items: items.map((i) => ({ item_id: i.productId, item_name: i.title, price: i.price, quantity: i.quantity }))
          }
        },
        meta: {
          name: "InitiateCheckout",
          params: { content_ids: items.map((i) => i.productId), currency: "INR", value, num_items: items.reduce((s, i) => s + i.quantity, 0) }
        }
      });
    }
  });
})();
