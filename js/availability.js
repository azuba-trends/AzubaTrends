/**
 * availability.js
 * ------------------------------------------------------------------
 * Product/brand-level "sellable only in these cities/pincodes" check,
 * used by product.html, cart.html, and checkout.js. Mirrors the data
 * shape admin.js writes (see js/admin.js's createAvailabilityPicker):
 *
 *   { allCities: boolean, cities: string[], pincodesByCity: { [city]: { all, codes: string[] } } }
 *
 * Priority: product.hasCustomAvailability (+ product.availability)
 *           > brand.availability (if it restricts)
 *           > everywhere (no restriction)
 * ------------------------------------------------------------------
 */
const Availability = (function () {
  const brandCache = new Map(); // brandId -> brand doc data (or null), shared across the whole page session

  async function fetchBrand(brandId) {
    if (!brandId) return null;
    if (brandCache.has(brandId)) return brandCache.get(brandId);
    try {
      while (!window.FirebaseApp) { await new Promise((r) => setTimeout(r, 100)); }
      const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
      const snap = await getDoc(doc(window.FirebaseApp.db, "brands", brandId));
      const data = snap.exists() ? snap.data() : null;
      brandCache.set(brandId, data);
      return data;
    } catch (err) {
      console.error("Availability: could not fetch brand doc:", err);
      brandCache.set(brandId, null);
      return null;
    }
  }

  function flattenAllowedPincodes(availability) {
    const set = new Set();
    Object.values((availability && availability.pincodesByCity) || {}).forEach((entry) => {
      (entry.codes || []).forEach((c) => set.add(c));
    });
    return set;
  }

  /** Effective availability for a product — resolves product override,
   *  then brand, then falls back to unrestricted. Fetches the brand doc
   *  only when actually needed (and caches it). */
  async function resolveForProduct(product) {
    if (product && product.hasCustomAvailability && product.availability) {
      return product.availability;
    }
    if (product && product.brandId) {
      const brand = await fetchBrand(product.brandId);
      if (brand && brand.availability && !brand.availability.allCities) return brand.availability;
    }
    return { allCities: true, cities: [], pincodesByCity: {} };
  }

  function isPincodeAllowed(availability, pincode) {
    if (!availability || availability.allCities) return true;
    return flattenAllowedPincodes(availability).has(String(pincode || "").trim());
  }

  /** Convenience: resolve + check in one call. */
  async function isProductAvailableAt(product, pincode) {
    const availability = await resolveForProduct(product);
    return isPincodeAllowed(availability, pincode);
  }

  // ---- Auto-detect pincode from browser location (free, no API key) ----
  // Browser Geolocation API always shows a one-time permission prompt —
  // no way around that, it's a browser security requirement, not
  // something this site controls. Reverse-geocoding (lat/long -> pincode)
  // uses OpenStreetMap's free public Nominatim endpoint.
  async function detectPincodeFromLocation() {
    if (!navigator.geolocation) return null;
    const position = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => resolve(null),
        { timeout: 8000, maximumAge: 300000 }
      );
    });
    if (!position) return null;
    try {
      const { latitude, longitude } = position.coords;
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`);
      const data = await res.json();
      return (data && data.address && data.address.postcode) || null;
    } catch (err) {
      console.error("Availability: reverse-geocode lookup failed:", err);
      return null;
    }
  }

  const API = { resolveForProduct, isPincodeAllowed, isProductAvailableAt, flattenAllowedPincodes, detectPincodeFromLocation, fetchBrand };
  window.Availability = API;
  return API;
})();
