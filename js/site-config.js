window.SITE_CONFIG = {
  siteName: "AzubaTrends",
  currencySymbol: "₹",
  deliveryRegion: "West Bengal, India",
  logoUrl: "", 
  codExtraCharge: 30,
  upiAutoConfirmSeconds: 180,
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

  // Fetch Settings from Firebase
  try {
    const docSnap = await getDoc(doc(db, "settings", "store_config"));
    if (docSnap.exists()) {
      const data = docSnap.data();
      window.SITE_CONFIG.siteName = data.storeName || window.SITE_CONFIG.siteName;
      window.SITE_CONFIG.upiId = data.upiId || "";
      window.SITE_CONFIG.adminEmail = data.supportEmail || "azubatrends@gmail.com";
      window.SITE_CONFIG.supportPhone = data.supportPhone || "";
      window.SITE_CONFIG.codExtraCharge = (data.codExtraCharge !== undefined && data.codExtraCharge !== null)
        ? Number(data.codExtraCharge)
        : window.SITE_CONFIG.codExtraCharge;
      window.SITE_CONFIG.emailjs = {
        publicKey: data.emailjs_publicKey || "",
        serviceId: data.emailjs_serviceId || "",
        templateId: data.emailjs_templateId || "",
        customerTemplateId: data.emailjs_customerTemplateId || ""
      };
      // Used by reviews.js so a guest submitting a review photo can upload
      // it the same way the admin panel uploads product images — same
      // ImgBB key, same "not actually secret" exposure model as everything
      // else in this file (see the big comment at the top).
      window.SITE_CONFIG.imgbbKey = data.imgbbKey || "";
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