// js/site-config.js
window.SITE_CONFIG = {
  siteName: "AzubaTrends",
  currencySymbol: "₹",
  deliveryRegion: "West Bengal, India",
  logoUrl: "", 
  codExtraCharge: 30,
  upiAutoConfirmSeconds: 60
};

// Initialize Firebase for the Frontend
(async function() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js");
  const { getFirestore, doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");

  const firebaseConfig = {
    apiKey: "AIzaSyBimjySQnhOfYCnQV0Drdx3wRb0x173bbs", // <-- APNI FIREBASE API KEY YAHAN DALEIN
    authDomain: "azubatrends-32349.firebaseapp.com",
    projectId: "azubatrends-32349",
    storageBucket: "azubatrends-32349.firebasestorage.app",
    messagingSenderId: "767815210504",
    appId: "1:767815210504:web:39a81e27237fc66e29a3bd"
  };

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
      window.SITE_CONFIG.emailjs = {
        publicKey: data.emailjs_publicKey || "",
        serviceId: data.emailjs_serviceId || "",
        templateId: data.emailjs_templateId || ""
      };
    }
  } catch(e) {
    console.error("Could not load settings from DB", e);
  }
})();