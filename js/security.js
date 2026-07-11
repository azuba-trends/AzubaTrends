/**
 * security.js
 * ------------------------------------------------------------------
 * XSS escaping, safe text insertion, and lightweight client-side
 * validation/spam-guard helpers used across the site (mainly by
 * checkout.js, but escapeHTML/setTextSafely are used everywhere
 * user-entered or product text gets rendered).
 *
 * Client-side rate limiting and the honeypot field stop casual bots
 * and accidental double-submits, not a targeted attacker scripting
 * requests directly — see README "Known Limitations".
 * ------------------------------------------------------------------
 */

const Security = Object.freeze({
  /**
   * Escapes HTML special characters so a string can be safely inserted
   * via innerHTML. Prefer textContent/setTextSafely wherever possible;
   * use this only when you genuinely need to mix escaped text with markup.
   */
  escapeHTML(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },

  /** Sets element text via textContent — never parsed as HTML. */
  setTextSafely(el, text) {
    if (!el) return;
    el.textContent = text === null || text === undefined ? "" : String(text);
  },

  /** Basic, permissive email shape check (not exhaustive RFC 5322). */
  isValidEmail(email) {
    if (typeof email !== "string") return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  },

  /**
   * Indian mobile number check: 10 digits, first digit 6-9.
   * Accepts optional +91 / 0 prefix and spaces/dashes, e.g.
   * "+91 98765 43210", "09876543210", "9876543210".
   */
  isValidIndianPhone(phone) {
    if (typeof phone !== "string") return false;
    const digitsOnly = phone.replace(/[\s\-()]/g, "");
    const stripped = digitsOnly.replace(/^(\+91|91|0)/, "");
    return /^[6-9]\d{9}$/.test(stripped);
  },

  /** Indian PIN code: exactly 6 digits, first digit 1-9. */
  isValidPincode(pincode) {
    if (typeof pincode !== "string" && typeof pincode !== "number") return false;
    return /^[1-9]\d{5}$/.test(String(pincode).trim());
  },

  /**
   * Honeypot check: a hidden field real users never fill in.
   * If it has any value, the submission is very likely a bot.
   * `fieldName` is the `name` attribute of the honeypot input.
   */
  isHoneypotTripped(formEl, fieldName) {
    if (!formEl) return false;
    const field = formEl.elements ? formEl.elements[fieldName] : null;
    return !!(field && field.value && field.value.trim().length > 0);
  },

  /**
   * Simple per-key submit throttle: returns false (blocks) if the same
   * `key` was allowed within the last `cooldownMs`. Guards against
   * accidental double-submits (double-click, double-tap) and quick
   * repeat spam — not a substitute for server-side rate limiting.
   */
  canSubmit(key, cooldownMs) {
    const now = Date.now();
    const store = Security._submitTimestamps;
    const last = store[key];
    if (last && now - last < cooldownMs) {
      return false;
    }
    store[key] = now;
    return true;
  },

  // Internal mutable state for canSubmit. Not part of the public API.
  _submitTimestamps: {}
});
