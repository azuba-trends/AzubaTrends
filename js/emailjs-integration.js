/**
 * emailjs-integration.js
 * -----------------------
 * Sends the full order breakdown to the admin's email (SITE_CONFIG.adminEmail)
 * using EmailJS (https://www.emailjs.com), a free client-side email
 * service — no backend server needed.
 *
 * SECURITY REALITY CHECK (important — please read before deploying):
 * On a pure static site, there is NO way to hide the EmailJS public key,
 * service ID, or template ID from someone who opens DevTools — they are
 * sent from the browser, so they are visible in the network request no
 * matter how you store them in your source files. This is expected and
 * is how EmailJS's browser SDK is designed to work (same model as a
 * Stripe "publishable key" or a Google Maps browser API key).
 *
 * The REAL protection is configuring this in your EmailJS dashboard:
 *   1. Account -> Security -> "Allowed origins" -> add ONLY your live
 *      domain(s) (e.g. https://yourstore.vercel.app, https://yourstore.com).
 *      This makes the key useless if copied to any other website.
 *   2. Set a reasonable monthly send quota / rate limit in EmailJS
 *      settings so a script-kiddie spamming your endpoint can't run up
 *      usage or flood your inbox indefinitely.
 *   3. Keep the additional client-side throttling below (canSubmit +
 *      honeypot from security.js) wired into checkout.js as a first
 *      line of defense against accidental double-sends and simple bots.
 *
 * Usage (from checkout.js, written by Claude 3):
 *
 *   await OrderEmail.send({
 *     orderId, customerName, customerPhone, customerAddress,
 *     customerCity, customerPincode, items, subtotal, discount,
 *     codCharge, finalTotal, paymentMethod
 *   });
 */

const OrderEmail = (function () {
  let sdkReady = false;

  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (sdkReady && window.emailjs) return resolve();
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      script.onload = () => {
        try {
          window.emailjs.init({ publicKey: SITE_CONFIG.emailjs.publicKey });
          sdkReady = true;
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      script.onerror = () =>
        reject(new Error("Failed to load EmailJS SDK — check network."));
      document.head.appendChild(script);
    });
  }

  function formatItemsForEmail(items) {
    return (items || [])
      .map(
        (item, i) =>
          `${i + 1}. ${item.title} x${item.quantity} — ${SITE_CONFIG.currencySymbol}${item.price * item.quantity}`
      )
      .join("\n");
  }

  /**
   * Sends the order notification email. Expects fully-validated,
   * already-sanitized order data (run Security.escapeHTML on any free-
   * text fields like address notes BEFORE calling this).
   */
  async function send(order) {
    await loadSdk();

    const templateParams = {
      order_id: order.orderId,
      customer_name: order.customerName,
      customer_phone: order.customerPhone,
      customer_email: order.customerEmail || 'Not provided',
      customer_address: order.customerAddress,
      customer_city: order.customerCity,
      customer_state: order.customerState || 'West Bengal',
      customer_pincode: order.customerPincode,
      order_items: formatItemsForEmail(order.items),
      subtotal: `${SITE_CONFIG.currencySymbol}${order.subtotal}`,
      discount: order.discount
        ? `-${SITE_CONFIG.currencySymbol}${order.discount}`
        : `${SITE_CONFIG.currencySymbol}0`,
      cod_charge: order.codCharge
        ? `${SITE_CONFIG.currencySymbol}${order.codCharge}`
        : `${SITE_CONFIG.currencySymbol}0`,
      final_total: `${SITE_CONFIG.currencySymbol}${order.finalTotal}`,
      payment_method: order.paymentMethod,
      order_date: new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      }),
      to_email: SITE_CONFIG.adminEmail,
    };

    return window.emailjs.send(
      SITE_CONFIG.emailjs.serviceId,
      SITE_CONFIG.emailjs.templateId,
      templateParams
    );
  }

  return { send };
})();

if (typeof window !== "undefined") {
  window.OrderEmail = OrderEmail;
}
