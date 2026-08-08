window.SITE_CONFIG = {
  siteName: "AzubaTrends",
  currencySymbol: "₹",
  deliveryRegion: "West Bengal, India",
  logoUrl: "", 
  codExtraCharge: 30,
  upiAutoConfirmSeconds: 180,
  // Single switch for the "offers" strip (FREE Delivery / Extra 10% OFF /
  // Sustainable Picks cards). Hidden, not deleted — the markup + CSS stay
  // in place on every page (mobile and desktop both), so flipping this
  // one flag back to `true` brings it back everywhere with no other
  // changes needed. See js/site-flags.js, which reads this on every page.
  showOffers: false,
  // IMPORTANT: this MUST always have a value, even before the Firestore
  // settings doc has loaded (or if it fails to load). Previously there was
  // no default here at all — if settings/store_config didn't exist yet or
  // the fetch failed, window.SITE_CONFIG.adminEmail stayed `undefined`,
  // EmailJS was sent `to_email: undefined`, and EmailJS's API rejected it
  // with "The recipients address is empty" (422). This fallback is
  // overwritten below by the real supportEmail from Firestore once it
  // loads, so it only ever matters as a safety net.
  adminEmail: "admin@example.com"
};

// Other scripts (checkout.js, product-loader.js, etc.) can
// `await window.SITE_CONFIG_READY` to be sure upiId/codExtraCharge/emailjs
// have actually come back from Firestore before using them, instead of
// racing this async IIFE.
window.SITE_CONFIG_READY = (async function() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js");
  const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");

  // Firebase project config lives in config/firebase-config.json now, not
  // hardcoded here — edit that one JSON file if you ever need to point
  // this site at a different Firebase project.
  const res = await fetch("/config/firebase-config.json");
  const firebaseConfig = await res.json();
  delete firebaseConfig._comment;

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  window.FirebaseApp = { app, db };

  // Storefront-wide admin detection — reviews.js uses this to show the
  // Delete button on EVERY review (not just "my own") when the admin is
  // browsing the live site. There's no separate customer-account system
  // here (see firestore.rules' isAdmin(): any signed-in Firebase Auth
  // user IS the admin), and Firebase Auth's session persistence is keyed
  // per-origin, not per-page — so if the admin is already logged in via
  // admin.html in this same browser, onAuthStateChanged below picks up
  // that same session immediately, with no separate login step needed on
  // the storefront pages themselves.
  //
  // PERF FIX (Lighthouse "Network dependency tree" / "Use efficient cache
  // lifetimes" — the ~3.6s critical-path chain through
  // <project>.firebaseapp.com's auth iframe): calling getAuth() is what
  // makes the Firebase Auth SDK inject that hidden iframe, and it used to
  // happen synchronously as part of this same startup chain, competing
  // for bandwidth/priority with the hero image, fonts, and product data
  // on every single storefront pageview — even though 99%+ of visitors
  // are not the admin and get zero benefit from it. Deferring it to
  // requestIdleCallback (i.e. "once the browser has spare time after the
  // real page content is handled") means the iframe still loads and
  // AzubaAdminReady still resolves — the admin's Delete buttons still
  // appear, just a beat later — but it no longer sits on the page's
  // critical path. setTimeout is the fallback for Safari, which has no
  // requestIdleCallback.
  window.AzubaAdmin = { isAdmin: false };
  let resolveAdminReady;
  // Other scripts can `await window.AzubaAdminReady` to be sure the
  // (persisted, so effectively instant once it runs) initial auth check
  // has actually completed before reading window.AzubaAdmin.isAdmin.
  window.AzubaAdminReady = new Promise((resolve) => { resolveAdminReady = resolve; });

  const initAdminAuth = async () => {
    const { getAuth, onAuthStateChanged } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js");
    const auth = getAuth(app);
    window.FirebaseApp.auth = auth;
    onAuthStateChanged(auth, (user) => {
      window.AzubaAdmin.isAdmin = !!user;
      window.dispatchEvent(new CustomEvent("azubaadmin:change", { detail: { isAdmin: !!user } }));
      if (resolveAdminReady) { resolveAdminReady(); resolveAdminReady = null; }
    });
  };
  if ("requestIdleCallback" in window) {
    requestIdleCallback(initAdminAuth, { timeout: 3000 });
  } else {
    setTimeout(initAdminAuth, 1500);
  }

  // Fetch Settings from Firebase
  try {
    const docSnap = await getDoc(doc(db, "settings", "store_config"));
    if (docSnap.exists()) {
      const data = docSnap.data();
      window.SITE_CONFIG.siteName = data.storeName || window.SITE_CONFIG.siteName;
      window.SITE_CONFIG.upiId = data.upiId || "";
      // If Settings > Account > Support Email hasn't been saved yet, keep
      // whatever adminEmail is already set (the "admin@example.com"
      // placeholder above) rather than falling back to any specific
      // person's real inbox — this file gets reused across different
      // stores/clients, so it must never silently route another
      // deployment's emails to someone else's address.
      window.SITE_CONFIG.adminEmail = data.supportEmail || window.SITE_CONFIG.adminEmail;
      window.SITE_CONFIG.supportPhone = data.supportPhone || "";
      window.SITE_CONFIG.codExtraCharge = (data.codExtraCharge !== undefined && data.codExtraCharge !== null)
        ? Number(data.codExtraCharge)
        : window.SITE_CONFIG.codExtraCharge;
      // Store Margin — admin's own markup layered on top of every
      // product's Sale Price. Used by product-loader.js's direct-Firestore
      // fallback path (the normal path is api/list.js, which applies this
      // same markup server-side — see lib/pricing.js).
      window.SITE_CONFIG.storeMargin = data.storeMargin || null;
      window.SITE_CONFIG.emailjs = {
        publicKey: data.emailjs_publicKey || "",
        serviceId: data.emailjs_serviceId || "",
        templateId: data.emailjs_templateId || "",
        customerTemplateId: data.emailjs_customerTemplateId || "",
        // Contact Us form (contact.html) — emails the admin inbox with
        // whatever the customer typed. Separate from the order templates
        // above since the fields (subject/message vs order items) differ.
        contactTemplateId: data.emailjs_contactTemplateId || "",
        // Support Tickets reply (Admin Panel) — emails the CUSTOMER back
        // when the admin replies to their ticket.
        contactReplyTemplateId: data.emailjs_contactReplyTemplateId || ""
      };
      // Used by reviews.js so a guest submitting a review photo can upload
      // it the same way the admin panel uploads product images — same
      // ImgBB key, same "not actually secret" exposure model as everything
      // else in this file (see the big comment at the top).
      window.SITE_CONFIG.imgbbKey = data.imgbbKey || "";
      // Image Hosting — see Settings > Image Hosting. Both ImgBB and
      // ImageKit's Public Key are meant to be exposed client-side (same
      // model as everything above); ImageKit's PRIVATE key never comes
      // anywhere near this file — see functions/api/imagekit-auth.js.
      window.SITE_CONFIG.activeImageProvider = data.activeImageProvider || "imgbb";
      window.SITE_CONFIG.imagekitPublicKey = data.imagekitPublicKey || "";
      window.SITE_CONFIG.imagekitUrlEndpoint = data.imagekitUrlEndpoint || "";
      // This is the lightweight abuse-throttle key for api/telegram.js
      // (set as the TELEGRAM_NOTIFY_API_KEY env var in Vercel) — NOT a bot
      // token, safe to expose the same way the keys above are.
      window.SITE_CONFIG.telegramApiKey = data.telegramApiKey || "";
      // Public-safe analytics identifiers — see js/tracking.js for why
      // these are fine to expose the same way every other key here is.
      window.SITE_CONFIG.ga4MeasurementId = data.ga4MeasurementId || "";
      window.SITE_CONFIG.metaPixelId = data.metaPixelId || "";
      
      // Update UI with new settings dynamically
      if(window.ProductLoader && window.ProductLoader.initHeader) {
        window.ProductLoader.initHeader();
      }
    }
  } catch(e) {
    console.error("Could not load settings from DB", e);
  }
  window.dispatchEvent(new Event("siteconfig:ready"));
})();