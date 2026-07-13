window.SITE_CONFIG = {
  siteName: "AzubaTrends",
  currencySymbol: "₹",
  deliveryRegion: "West Bengal, India",
  logoUrl: "", 
  codExtraCharge: 30,
  upiAutoConfirmSeconds: 60
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
  const res = await fetch("config/firebase-config.json");
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
        templateId: data.emailjs_templateId || ""
      };
      
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