/**
 * geo-restriction.js
 * -------------------
 * Validates that a customer's delivery address falls within the allowed
 * delivery zone (West Bengal only), using rules defined in
 * /config/geo-config.json.
 *
 * IMPORTANT (read this before wiring into checkout.js):
 * This is a FRONTEND-ONLY static site with no server. This validation
 * checks what the user TYPES into the address form — it cannot verify
 * their actual GPS location. A determined user could type a fake West
 * Bengal address. This is normal and expected for a no-backend store;
 * it stops honest mistakes and casual out-of-state orders, not fraud.
 * If you later need to verify real location, you'd need a backend or
 * a browser Geolocation API prompt (optional, not implemented here).
 *
 * Usage (from checkout.js, written by Claude 3):
 *
 *   const geoConfig = await GeoRestriction.loadConfig();
 *   const result = GeoRestriction.validate(geoConfig, {
 *     state: formState, city: formCity, pincode: formPincode
 *   });
 *   if (!result.valid) {
 *     showError(result.message);
 *     disableCheckoutButton();
 *   }
 */

const GeoRestriction = (function () {
  const CONFIG_PATH = "config/geo-config.json";
  let cachedConfig = null;

  /**
   * Fetches and caches geo-config.json.
   * Throws if the file is missing or malformed — checkout.js should
   * fail SAFE (block the order) if this rejects, not allow it through.
   */
  async function loadConfig() {
    if (cachedConfig) return cachedConfig;

    const response = await fetch(CONFIG_PATH, { cache: "no-cache" });
    if (!response.ok) {
      throw new Error(
        `geo-config.json could not be loaded (HTTP ${response.status})`
      );
    }
    cachedConfig = await response.json();
    return cachedConfig;
  }

  function normalize(str) {
    return String(str || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function isStateAllowed(config, stateInput) {
    const normalizedInput = normalize(stateInput);
    const normalizedAliases = (config.stateAliases || []).map(normalize);
    return (
      normalizedInput === normalize(config.allowedState) ||
      normalizedAliases.includes(normalizedInput)
    );
  }

  function isCityAllowed(config, cityInput) {
    // City list is advisory / used for autosuggest dropdowns.
    // We do NOT hard-block on city — many valid WB towns/villages
    // won't be in a short curated list. Pincode + state are the
    // authoritative checks. City match only helps show a friendly
    // "did you mean...?" suggestion in the UI (Claude 2/3's call).
    const normalizedInput = normalize(cityInput);
    return (config.allowedCities || []).some(
      (c) => normalize(c) === normalizedInput
    );
  }

  function isPincodeAllowed(config, pincodeInput) {
    const digitsOnly = String(pincodeInput || "").replace(/\D/g, "");

    if (digitsOnly.length !== 6) {
      return { allowed: false, reason: "PIN code must be exactly 6 digits." };
    }

    const pin = parseInt(digitsOnly, 10);

    if ((config.explicitBlockedPincodes || []).includes(digitsOnly)) {
      return { allowed: false, reason: "This PIN code is not serviceable." };
    }

    if ((config.explicitAllowedPincodes || []).includes(digitsOnly)) {
      return { allowed: true, reason: "Explicit allow override." };
    }

    const inRange = (config.pincodeRanges || []).some(
      (range) => pin >= range.min && pin <= range.max
    );

    return {
      allowed: inRange,
      reason: inRange
        ? "Within West Bengal PIN range."
        : "PIN code is outside the West Bengal delivery zone.",
    };
  }

  /**
   * Main validation entry point.
   * @param {object} config - result of loadConfig()
   * @param {{state: string, city: string, pincode: string}} address
   * @returns {{valid: boolean, message: string, details: object}}
   */
  function validate(config, address) {
    const { state, city, pincode } = address || {};

    if (!state || !pincode) {
      return {
        valid: false,
        message: "Please enter your State and PIN code to continue.",
        details: {},
      };
    }

    const stateOk = isStateAllowed(config, state);
    const pincodeCheck = isPincodeAllowed(config, pincode);
    const cityKnown = isCityAllowed(config, city);

    const valid = stateOk && pincodeCheck.allowed;

    return {
      valid,
      message: valid
        ? "Delivery available at this address."
        : config.restrictionMessage ||
          "Sorry, we don't deliver to this location yet.",
      details: {
        stateOk,
        pincodeAllowed: pincodeCheck.allowed,
        pincodeReason: pincodeCheck.reason,
        cityRecognized: cityKnown,
      },
    };
  }

  // ------------------------------------------------------------------
  // REAL-TIME VERIFICATION (added later, per owner request)
  // ------------------------------------------------------------------
  // Uses India Post's free, public Pincode API — no signup, no API key:
  //   https://api.postalpincode.in/pincode/{pincode}
  // This returns the REAL district/state/post-office names registered
  // for that PIN code, so a fake-but-in-range PIN (e.g. typing a random
  // 700xxx number that isn't actually assigned) gets caught. It is still
  // not GPS/location-based — it verifies the PIN CODE is real and in
  // West Bengal, not that the shopper is physically there. That level of
  // certainty would need the browser Geolocation API (user permission
  // prompt) or a courier-side address-verification service, neither of
  // which this free API provides.
  //
  // This call can fail (offline, India Post API down, CORS hiccup) —
  // in that case we fail back to the static config check rather than
  // blocking checkout, since a third-party API with no SLA shouldn't be
  // able to take the whole store down.
  const PINCODE_API = "https://api.postalpincode.in/pincode/";

  async function verifyPincodeRealtime(pincodeInput) {
    const digitsOnly = String(pincodeInput || "").replace(/\D/g, "");
    if (digitsOnly.length !== 6) {
      return { checked: false, valid: false, reason: "PIN code must be exactly 6 digits." };
    }

    let data;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(PINCODE_API + digitsOnly, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      data = Array.isArray(json) ? json[0] : json;
    } catch (err) {
      // API unreachable/timed out — let the caller fall back to the
      // static pincodeRanges check instead of hard-failing.
      return { checked: false, valid: null, reason: "Could not reach verification service.", error: String(err) };
    }

    if (!data || data.Status !== "Success" || !Array.isArray(data.PostOffice) || data.PostOffice.length === 0) {
      return { checked: true, valid: false, reason: "This PIN code does not exist in India Post's records." };
    }

    const offices = data.PostOffice;
    const isWestBengal = offices.some((po) => normalize(po.State) === "west bengal");
    const district = offices[0].District || null;
    const officeNames = offices.map((po) => po.Name);

    return {
      checked: true,
      valid: isWestBengal,
      reason: isWestBengal
        ? "Verified: real PIN code in West Bengal."
        : `This PIN code is actually registered in ${offices[0].State}, not West Bengal.`,
      district,
      officeNames
    };
  }

  return { loadConfig, validate, isCityAllowed, verifyPincodeRealtime };
})();

// Expose for non-module <script> usage across pages
if (typeof window !== "undefined") {
  window.GeoRestriction = GeoRestriction;
}
