/**
 * site-config.js
 * ------------------------------------------------------------------
 * Shared constants read by every other module (product-loader.js,
 * checkout.js, emailjs-integration.js, qr-generator.js, etc). Nothing
 * outside this file should need to change if you edit values here.
 *
 * ACTION NEEDED BEFORE GOING LIVE — fill these in (see README "Setup
 * Instructions"):
 *   1. emailjs.publicKey / serviceId / templateId — from your EmailJS
 *      dashboard, after creating a service + template there.
 *   2. upiId — your real UPI ID (e.g. "yourname@bank"), used to build
 *      the QR code at checkout.
 *   3. logoUrl — a hosted image URL once you have a logo; leave blank
 *      to keep showing the site name as text.
 * Until these are filled in, order emails and the UPI QR code will
 * not work — everything else on the site functions normally.
 * ------------------------------------------------------------------
 */

const SITE_CONFIG = Object.freeze({
  siteName: "AzubaTrends",
  tagline: "Everyday goods for the home, delivered around the courtyard.",
  currencySymbol: "\u20B9", // ₹
  // Intentionally blank — a Google Drive-hosted logo URL gets added later.
  // Every consumer of this value must fall back gracefully (see header
  // markup in each page, which shows the site name as text when this
  // is empty).
  logoUrl: "",
  adminEmail: "azubatrends@gmail.com",
  supportPhone: "+91-62895-30407",
  deliveryRegion: "West Bengal, India",
  copyrightYear: new Date().getFullYear(),

  // --- EmailJS (order notification email) ---
  // TODO: replace with real values from your EmailJS dashboard.
  emailjs: Object.freeze({
    publicKey: "HfbnYA4QBzySCk_3u",
    serviceId: "service_udqkh9u",
    templateId: "template_bhpt2zb"
  }),

  // --- Payments ---
  upiId: "azubatrends@naviaxis",
  // Extra charge added for Cash on Delivery orders (in ₹). Set to 0 to disable.
  codExtraCharge: 30,
  // How long the UPI QR/countdown stays up before auto-marking the
  // order "pending verification" if the customer doesn't click Done.
  upiAutoConfirmSeconds: 60
});

// Expose for non-module <script> usage across pages (checkout.js calls
// window.SITE_CONFIG.* explicitly).
if (typeof window !== "undefined") {
  window.SITE_CONFIG = SITE_CONFIG;
}
