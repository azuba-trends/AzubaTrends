(function () {
  'use strict';
  let deliveryDetails = null;
  let selectedPaymentMethod = null;
  let appliedDiscount = 0;
  let currentOrderId = `ORD-${Date.now().toString().slice(-6)}`;

  const wbCities = [
    "Alipurduar", "Asansol", "Baharampur", "Balurghat", "Bankura", "Bardhaman", "Barrackpore",
    "Contai", "Cooch Behar", "Darjeeling", "Diamond Harbour", "Durgapur", "Habra", "Haldia",
    "Howrah", "Jalpaiguri", "Kalyani", "Kharagpur", "Kolkata", "Krishnanagar", "Malda",
    "Midnapore", "Purulia", "Raiganj", "Serampore", "Siliguri", "Suri", "Tamluk"
  ];

  function initUI() {
    try {
      const items = window.Cart ? window.Cart.getItems() : [];
      const emptyMsg = document.getElementById("empty-cart-message");
      const checkoutContent = document.getElementById("checkout-content");

      if (items.length === 0) {
        if(emptyMsg) emptyMsg.hidden = false;
        if(checkoutContent) checkoutContent.hidden = true;
        return;
      } else {
        if(emptyMsg) emptyMsg.hidden = true;
        if(checkoutContent) checkoutContent.hidden = false;
      }

      // Populate Cart Items
      const listEl = document.getElementById('checkout-items-list');
      if (listEl) {
        listEl.innerHTML = "";
        items.forEach(item => {
          listEl.innerHTML += `<div style="display:flex; justify-content:space-between; margin-bottom:5px;"><span>${item.title} <b>x${item.quantity}</b></span><span>₹${item.price * item.quantity}</span></div>`;
        });
      }

      // Populate Cities
      const citySelect = document.getElementById("field-city");
      if (citySelect && citySelect.options.length <= 1) {
        wbCities.forEach(city => {
          const opt = document.createElement("option");
          opt.value = city; opt.textContent = city;
          citySelect.appendChild(opt);
        });
      }

      // Live Pincode Check
      const pinInput = document.getElementById("field-pincode");
      if (pinInput) {
        pinInput.addEventListener("input", (e) => {
          const pin = e.target.value;
          const err = document.getElementById("error-pincode");
          if (pin.length === 6) {
            if (pin.match(/^7[0-4]\d{4}$/) && !pin.startsWith('744')) {
              err.textContent = "✓ Valid West Bengal Pincode"; err.style.color = "green";
            } else {
              err.textContent = "❌ Delivery restricted to West Bengal only."; err.style.color = "red";
            }
          } else { err.textContent = ""; }
        });
      }

      renderSummary();
    } catch(e) {
      console.error("Checkout Init Error:", e);
    }
  }

  function getCartTotal() { return window.Cart ? window.Cart.getTotal() : 0; }
  function getCodCharge() { return selectedPaymentMethod === 'COD' ? (window.SITE_CONFIG.codExtraCharge || 0) : 0; }

  function renderSummary() {
    const savedCoupon = sessionStorage.getItem("applied_coupon");
    if(savedCoupon) appliedDiscount = JSON.parse(savedCoupon).discount;

    const subtotal = getCartTotal();
    document.getElementById("summary-subtotal").textContent = "₹" + subtotal;
    
    if(appliedDiscount > 0) {
      document.getElementById("summary-discount-row").hidden = false;
      document.getElementById("summary-discount-amount").textContent = "-₹" + appliedDiscount;
    } else {
      document.getElementById("summary-discount-row").hidden = true;
    }

    const codCharge = getCodCharge();
    if(codCharge > 0) {
      document.getElementById("summary-cod-row").hidden = false;
      document.getElementById("summary-cod-amount").textContent = "+₹" + codCharge;
    } else {
      document.getElementById("summary-cod-row").hidden = true;
    }
    
    const total = subtotal - appliedDiscount + codCharge;
    document.getElementById("summary-total").textContent = "₹" + (total > 0 ? total : 0);
  }

  // Address Submit
  document.getElementById("delivery-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const city = document.getElementById("field-city").value;
    const pin = document.getElementById("field-pincode").value;
    const phone = document.getElementById("field-phone").value;

    if(!city) return alert("Please select a city.");
    if(!pin.match(/^7[0-4]\d{4}$/) || pin.startsWith('744')) return alert("Delivery is only available in West Bengal. Check pincode.");
    if(phone.length !== 10) return alert("Enter valid 10 digit phone number.");

    deliveryDetails = {
      name: document.getElementById("field-name").value,
      phone: phone,
      email: document.getElementById("field-email").value,
      address: document.getElementById("field-address").value,
      city: city, state: "West Bengal", pincode: pin
    };

    document.getElementById("delivery-section").hidden = true;
    document.getElementById("payment-section").hidden = false;
    document.getElementById("payment-order-id-note").textContent = "Order Reference: " + currentOrderId;
    renderSummary();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Payment Selection
  document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectedPaymentMethod = e.target.value;
      renderSummary();
      if (selectedPaymentMethod === 'COD') {
        document.getElementById('upi-section').hidden = true;
        document.getElementById('cod-section').hidden = false;
      } else {
        document.getElementById('cod-section').hidden = true;
        document.getElementById('upi-section').hidden = false;
        startUPIFlow();
      }
    });
  });

  function startUPIFlow() {
    const amount = getCartTotal() - appliedDiscount + getCodCharge();
    document.getElementById("upi-amount-text").textContent = `Pay Exactly ₹${amount} via UPI`;
    if(window.QRGenerator && window.SITE_CONFIG.upiId) {
      const link = window.QRGenerator.buildUPILink({ upiId: window.SITE_CONFIG.upiId, payeeName: window.SITE_CONFIG.siteName, amount: amount, orderId: currentOrderId });
      window.QRGenerator.renderQR(document.getElementById("upi-qr-canvas"), link, 240);
      document.getElementById("upi-pay-link").href = link;
      document.getElementById("upi-pay-link").hidden = false;
    }
  }

  // Finalize Order
  async function finalizeOrder(method) {
    const btnId = method === 'COD' ? 'place-order-cod-btn' : 'upi-done-btn';
    const btn = document.getElementById(btnId);
    btn.disabled = true; btn.textContent = "Processing...";

    const total = getCartTotal() - appliedDiscount + getCodCharge();
    const orderPayload = {
      orderId: currentOrderId,
      customerName: deliveryDetails.name,
      customerPhone: deliveryDetails.phone,
      customerEmail: deliveryDetails.email,
      customerAddress: deliveryDetails.address,
      customerCity: deliveryDetails.city,
      customerState: deliveryDetails.state,
      customerPincode: deliveryDetails.pincode,
      items: window.Cart.getItems(),
      subtotal: getCartTotal(),
      discount: appliedDiscount,
      codCharge: getCodCharge(),
      finalTotal: total > 0 ? total : 0,
      paymentMethod: method,
      status: "Pending", // For Admin Panel
      createdAt: new Date().toISOString()
    };

    try {
      const { collection, setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
      await setDoc(doc(window.FirebaseApp.db, "orders", currentOrderId), orderPayload);
      window.Cart.clear();
      sessionStorage.removeItem("applied_coupon");

      document.getElementById("payment-section").hidden = true;
      document.getElementById("summary-aside").hidden = true;
      document.getElementById("confirmation-section").hidden = false;
      document.getElementById("confirmation-order-id").textContent = currentOrderId;
      document.getElementById("confirmation-payment-note").textContent = method === 'COD' ? "Payment to be collected on delivery." : "UPI payment is pending manual verification.";
      
      if (window.OrderEmail) window.OrderEmail.send(orderPayload).catch(e => console.log("Email background error", e));
    } catch (err) {
      alert("Error placing order. Please try again.");
      btn.disabled = false; btn.textContent = "Try Again";
    }
  }

  document.getElementById("place-order-cod-btn")?.addEventListener("click", () => finalizeOrder('COD'));
  document.getElementById("upi-done-btn")?.addEventListener("click", () => finalizeOrder('UPI'));

  window.addEventListener("DOMContentLoaded", initUI);
})();