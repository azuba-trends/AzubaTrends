// js/checkout.js
(function () {
  'use strict';
  let deliveryDetails = null;
  let selectedPaymentMethod = null;
  let currentOrderId = `ORD-${Date.now().toString().slice(-6)}`;

  // West Bengal Cities List
  const wbCities = [
    "Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman", 
    "Malda", "Kharagpur", "Haldia", "Krishnanagar", "Baharampur", "Habra", 
    "Kalyani", "Darjeeling", "Jalpaiguri", "Cooch Behar", "Bankura", "Purulia", 
    "Midnapore", "Raiganj", "Alipurduar", "Balurghat", "Suri", "Tamluk", 
    "Contai", "Diamond Harbour", "Barrackpore", "Serampore"
  ].sort();

  function initUI() {
    // Populate Cities
    const citySelect = document.getElementById("field-city");
    if(citySelect) {
      wbCities.forEach(city => {
        citySelect.innerHTML += `<option value="${city}">${city}</option>`;
      });
    }

    // Live Pincode Check
    const pinInput = document.getElementById("field-pincode");
    if(pinInput) {
      pinInput.addEventListener("input", (e) => {
        const pin = e.target.value;
        const err = document.getElementById("error-pincode");
        if(pin.length === 6) {
          // West Bengal pins start with 70,71,72,73,74 (excluding 744 Andaman)
          if(pin.match(/^7[0-4]\d{4}$/) && !pin.startsWith('744')) {
            err.textContent = "✓ Valid West Bengal Pincode";
            err.style.color = "green";
          } else {
            err.textContent = "❌ We only deliver in West Bengal.";
            err.style.color = "red";
          }
        } else {
          err.textContent = "";
        }
      });
    }
  }

  function getCartTotal() {
    return window.Cart ? window.Cart.getTotal() : 0;
  }
  
  function getCodCharge() {
    return selectedPaymentMethod === 'COD' ? window.SITE_CONFIG.codExtraCharge : 0;
  }

  let appliedDiscount = 0;

  function renderSummary() {
    // Read discount from Cart page
    const savedCoupon = sessionStorage.getItem("applied_coupon");
    if(savedCoupon) {
      appliedDiscount = JSON.parse(savedCoupon).discount;
    }

    const subtotal = getCartTotal();
    document.getElementById("summary-subtotal").textContent = "₹" + subtotal;
    
    // Add discount row dynamically in checkout
    let discountRow = document.getElementById("summary-discount-row");
    if(appliedDiscount > 0) {
      if(!discountRow) {
        discountRow = document.createElement("div");
        discountRow.className = "summary-row";
        discountRow.id = "summary-discount-row";
        discountRow.style.color = "green";
        document.getElementById("summary-subtotal").parentElement.insertBefore(discountRow, document.getElementById("summary-cod-row"));
      }
      discountRow.innerHTML = `<span>Discount</span><span>-₹${appliedDiscount}</span>`;
      discountRow.hidden = false;
    } else if(discountRow) {
      discountRow.hidden = true;
    }

    const codCharge = getCodCharge();
    if(codCharge > 0) {
      document.getElementById("summary-cod-row").hidden = false;
      document.getElementById("summary-cod-amount").textContent = "+₹" + codCharge;
    } else {
      document.getElementById("summary-cod-row").hidden = true;
    }
    
    document.getElementById("summary-total").textContent = "₹" + (subtotal - appliedDiscount + codCharge);
  }

  // Handle Form Submit
  document.getElementById("delivery-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("field-name").value;
    const phone = document.getElementById("field-phone").value;
    const address = document.getElementById("field-address").value;
    const city = document.getElementById("field-city").value;
    const pin = document.getElementById("field-pincode").value;

    if(!city) return alert("Please select a city.");
    if(!pin.match(/^7[0-4]\d{4}$/) || pin.startsWith('744')) {
      return alert("Delivery is only available in West Bengal. Please check your pincode.");
    }
    if(phone.length !== 10) return alert("Enter valid 10 digit phone number.");

    deliveryDetails = {
      name, phone, email: document.getElementById("field-email").value,
      address, city, state: "West Bengal", pincode: pin
    };

    document.getElementById("delivery-section").hidden = true;
    document.getElementById("payment-section").hidden = false;
    document.getElementById("payment-order-id-note").textContent = "Order ID: " + currentOrderId;
    renderSummary();
  });

  // Handle Payment Selection
  document.querySelectorAll('input[name="paymentMethod"]').forEach((radio) => {
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
    const amount = getCartTotal() + getCodCharge();
    document.getElementById("upi-amount-text").textContent = `Pay Exactly ₹${amount} via UPI`;
    
    // Attempt QR Code generation
    if(window.QRGenerator && window.SITE_CONFIG.upiId) {
      const link = window.QRGenerator.buildUPILink({
        upiId: window.SITE_CONFIG.upiId,
        payeeName: window.SITE_CONFIG.siteName,
        amount: amount,
        orderId: currentOrderId
      });
      window.QRGenerator.renderQR(document.getElementById("upi-qr-canvas"), link, 240);
      document.getElementById("upi-pay-link").href = link;
      document.getElementById("upi-pay-link").hidden = false;
    }
  }

  // Finalize Order
  async function finalizeOrder(method) {
    const btnId = method === 'COD' ? 'place-order-cod-btn' : 'upi-done-btn';
    document.getElementById(btnId).disabled = true;
    document.getElementById(btnId).textContent = "Processing...";

    const items = window.Cart.getItems();
    const finalTotal = getCartTotal() + getCodCharge();

    const orderPayload = {
      orderId: currentOrderId,
      customerName: deliveryDetails.name,
      customerPhone: deliveryDetails.phone,
      customerEmail: deliveryDetails.email,
      customerAddress: deliveryDetails.address,
      customerCity: deliveryDetails.city,
      customerState: deliveryDetails.state,
      customerPincode: deliveryDetails.pincode,
      items: items,
      finalTotal: finalTotal,
      paymentMethod: method,
      status: "Pending",
      createdAt: new Date().toISOString()
    };

    try {
      // 1. SAVE TO FIREBASE DATABASE
      const { collection, setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
      const db = window.FirebaseApp.db;
      await setDoc(doc(db, "orders", currentOrderId), orderPayload);

      // 2. Clear Cart
      window.Cart.clear();

      // 3. Show Success Screen
      document.getElementById("payment-section").hidden = true;
      document.getElementById("confirmation-section").hidden = false;
      document.getElementById("confirmation-order-id").textContent = currentOrderId;
      document.getElementById("confirmation-payment-note").textContent = method === 'COD' ? "Payment to be collected on delivery." : "UPI payment is pending manual verification.";
      
      // 4. (Optional) Send EmailJS notification silently in background
      if (window.OrderEmail) {
        window.OrderEmail.send(orderPayload).catch(e => console.log("EmailJS failed, but order saved in DB."));
      }

    } catch (err) {
      console.error(err);
      alert("Something went wrong while placing order. Please try again.");
      document.getElementById(btnId).disabled = false;
      document.getElementById(btnId).textContent = "Try Again";
    }
  }

  document.getElementById("place-order-cod-btn")?.addEventListener("click", () => finalizeOrder('COD'));
  document.getElementById("upi-done-btn")?.addEventListener("click", () => finalizeOrder('UPI'));

  // Boot UI
  window.addEventListener("DOMContentLoaded", () => {
    initUI();
    // Re-render cart whenever it updates
    window.addEventListener('cart:updated', () => {
      const items = window.Cart.getItems();
      const listEl = document.getElementById('cart-items-list');
      if (!listEl) return;
      listEl.innerHTML = items.length === 0 ? "<p>Your cart is empty.</p>" : "";
      items.forEach(item => {
        listEl.innerHTML += `<div class="cart-row"><span>${item.title} (x${item.quantity})</span><b>₹${item.price * item.quantity}</b></div>`;
      });
      renderSummary();
    });
    // Trigger initial render
    if(window.Cart) window.dispatchEvent(new CustomEvent('cart:updated'));
  });

})();