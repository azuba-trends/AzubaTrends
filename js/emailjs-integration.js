/**
 * emailjs-integration.js
 * -----------------------
 * Sends the full order breakdown to the admin's email (SITE_CONFIG.adminEmail)
 * using EmailJS (https://www.emailjs.com), a free client-side email
 * service — no backend server needed.
 *
 * Which EmailJS ACCOUNT actually sends it is decided by js/email-router.js
 * (round-robins across every account configured in Settings > Email for
 * the "newOrderAdmin" / "customerOrderConfirm" purpose) — this file just
 * builds the template params and asks the router to send them.
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
  function formatItemsForEmail(items) {
    return (items || [])
      .map((item, i) => {
        const variant = (item.size || item.color) ? ` [${[item.size, item.color].filter(Boolean).join("/")}]` : "";
        return `${i + 1}. ${item.title}${variant} x${item.quantity} — ${SITE_CONFIG.currencySymbol}${item.price * item.quantity}`;
      })
      .join("\n");
  }

  /**
   * Sends the order notification email. Expects fully-validated,
   * already-sanitized order data (run Security.escapeHTML on any free-
   * text fields like address notes BEFORE calling this).
   */
  async function send(order) {
    // The 422 "recipients address is empty" error means EmailJS received
    // to_email as blank/undefined — fail loudly and early with a clear
    // message instead of letting EmailJS's own cryptic error surface,
    // so this is easy to diagnose the next time it happens.
    const toEmail = SITE_CONFIG.adminEmail;
    if (!toEmail || !toEmail.includes('@')) {
      throw new Error(
        'OrderEmail.send: SITE_CONFIG.adminEmail is missing/invalid — set "Support Email" in Admin > Settings so order emails have somewhere to go.'
      );
    }

    // Every field the order can possibly have — nothing left out, so the
    // EmailJS template can show as much or as little of this as wanted.
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
      coupon_code: order.couponCode || 'None',
      delivery_fee: order.deliveryFee
        ? `${SITE_CONFIG.currencySymbol}${order.deliveryFee}`
        : `${SITE_CONFIG.currencySymbol}0`,
      cod_charge: order.codCharge
        ? `${SITE_CONFIG.currencySymbol}${order.codCharge}`
        : `${SITE_CONFIG.currencySymbol}0`,
      final_total: `${SITE_CONFIG.currencySymbol}${order.finalTotal}`,
      payment_method: order.paymentMethod,
      upi_payment_screenshot: order.paymentScreenshotUrl || 'Not applicable (COD order)',
      order_status: order.status || 'Pending',
      order_date: new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
      }),
      to_email: toEmail,
    };

    const adminResult = await window.AzubaEmailRouter.send('newOrderAdmin', templateParams);

    // Also send a copy to the customer's own email so they have their
    // order details in their inbox. Best-effort: if this fails (bad
    // email typo, quota hit, no account configured, etc.) it should NOT
    // make the whole order placement look like it failed — the admin
    // copy above already succeeded and the order itself is already
    // saved, so we just log and swallow the error here.
    const customerEmail = order.customerEmail;
    if (customerEmail && customerEmail.includes('@')) {
      try {
        await window.AzubaEmailRouter.send('customerOrderConfirm', { ...templateParams, to_email: customerEmail });
      } catch (err) {
        // No account has a dedicated "customerOrderConfirm" template set
        // up — reuse whatever handled the admin copy instead, same
        // fallback the old single-account version had ("reuse the admin
        // template for the customer copy too").
        try {
          await window.AzubaEmailRouter.send('newOrderAdmin', { ...templateParams, to_email: customerEmail });
        } catch (err2) {
          console.warn('OrderEmail.send: customer confirmation copy failed (order itself is unaffected):', err2);
        }
      }
    }
    return adminResult;
  }

  return { send };
})();

if (typeof window !== "undefined") {
  window.OrderEmail = OrderEmail;
}
