/**
 * js/email-router.js
 * -------------------
 * Shared by every page that sends an email via EmailJS: checkout.html
 * (New Order + Customer Confirmation), contact.html (Contact Form), and
 * admin.html (Order Status Update, Support Reply).
 *
 * Loads the EmailJS SDK once, asks the server which configured account
 * (see Settings > Email) to use for a given "purpose" — round-robined
 * across every enabled account that has a template for it, so load
 * spreads across multiple free EmailJS accounts (200 emails/month each)
 * instead of one hitting its cap — then sends through that account.
 *
 * If the send itself fails (most commonly: that account's monthly quota
 * is used up), automatically retries ONCE more on a different account
 * before giving up, so a single maxed-out account doesn't block emails
 * that other configured accounts could still send.
 */
window.AzubaEmailRouter = (function () {
  let sdkReady = false;

  function loadSdk() {
    return new Promise((resolve, reject) => {
      if (sdkReady && window.emailjs) return resolve();
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      script.onload = () => { sdkReady = true; resolve(); };
      script.onerror = () => reject(new Error("Failed to load EmailJS SDK — check network."));
      document.head.appendChild(script);
    });
  }

  async function pickAccount(purpose, excludeIds) {
    const res = await fetch("/api/next-email-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, excludeIds })
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `No email account configured for "${purpose}".`);
    return data;
  }

  /**
   * @param {string} purpose - one of: newOrderAdmin, customerOrderConfirm, orderStatusUpdate, contactForm, supportReply
   * @param {object} templateParams - EmailJS template variables (must include to_email)
   */
  async function send(purpose, templateParams) {
    await loadSdk();
    const tried = [];
    let lastErr;
    // Two attempts max: the first pick, and (only if that SEND fails) one
    // retry on a different account. Not sending at all when nothing's
    // configured throws immediately on the first pickAccount() call.
    for (let attempt = 0; attempt < 2; attempt++) {
      const account = await pickAccount(purpose, tried); // let this throw on attempt 0 (nothing configured at all)
      tried.push(account.accountId);
      try {
        return await window.emailjs.send(account.serviceId, account.templateId, templateParams, { publicKey: account.publicKey });
      } catch (err) {
        lastErr = err;
        // Loop again — pickAccount(purpose, tried) will exclude this
        // account and (if a second one is configured) return a different
        // one; if none is left it'll throw there instead, which is fine.
      }
    }
    throw lastErr || new Error("Couldn't send email.");
  }

  return { send };
})();
