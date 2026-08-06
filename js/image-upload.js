/**
 * js/image-upload.js
 * -------------------
 * Shared by BOTH the admin panel (product/gallery/delivery-logo images)
 * and reviews.js (guest review photos) — one place that knows how to
 * upload to whichever image host is active, with automatic failover to
 * the other one if it's configured and the active one fails (the exact
 * scenario that prompted this: ImgBB going down for maintenance).
 *
 * Config shape passed to AzubaImageUpload.upload(file, config):
 *   {
 *     activeProvider: "imgbb" | "imagekit",
 *     imgbbKey: "...",
 *     imagekitPublicKey: "...",
 *     imagekitUrlEndpoint: "..."   // e.g. https://ik.imagekit.io/yourid
 *   }
 * Any field can be missing/blank — a provider is only attempted if its
 * required key(s) are present.
 */
window.AzubaImageUpload = (function () {
  async function uploadToImgbb(file, key) {
    if (!key) throw new Error("ImgBB isn't configured (no API key).");
    const formData = new FormData();
    formData.append("image", file);
    let res;
    try {
      res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, { method: "POST", body: formData });
    } catch (err) {
      // See functions/api/delete-review.js's comment style for why this
      // is worth distinguishing — a thrown fetch() here means the request
      // never reached ImgBB at all (blocked, offline, or ImgBB itself is
      // down), not that ImgBB rejected it.
      throw new Error("Couldn't reach ImgBB (it may be down, or something on this network/browser is blocking it).");
    }
    const data = await res.json();
    if (data && data.success && data.data && data.data.url) return data.data.url;
    throw new Error("ImgBB upload failed: " + (data && data.error && data.error.message ? data.error.message : "unknown error"));
  }

  async function uploadToImageKit(file, publicKey, urlEndpoint) {
    if (!publicKey || !urlEndpoint) throw new Error("ImageKit isn't fully configured (need Public Key + URL Endpoint).");

    // Get a freshly-signed, single-use token from our own backend — see
    // functions/api/imagekit-auth.js for why this step exists (ImageKit's
    // private key can never be exposed in browser code).
    const authRes = await fetch("/api/imagekit-auth", { method: "POST" });
    const authData = await authRes.json();
    if (!authRes.ok || !authData.ok) {
      throw new Error(authData.error || "Couldn't prepare the ImageKit upload.");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name || `upload-${Date.now()}.jpg`);
    formData.append("publicKey", publicKey);
    formData.append("token", authData.token);
    formData.append("expire", String(authData.expire));
    formData.append("signature", authData.signature);
    formData.append("useUniqueFileName", "true");

    let res;
    try {
      res = await fetch("https://upload.imagekit.io/api/v1/files/upload", { method: "POST", body: formData });
    } catch (err) {
      throw new Error("Couldn't reach ImageKit (it may be down, or something on this network/browser is blocking it).");
    }
    const data = await res.json();
    if (res.ok && data && data.url) return data.url;
    throw new Error("ImageKit upload failed: " + (data && data.message ? data.message : "unknown error"));
  }

  function isProviderConfigured(provider, config) {
    if (provider === "imgbb") return !!config.imgbbKey;
    if (provider === "imagekit") return !!(config.imagekitPublicKey && config.imagekitUrlEndpoint);
    return false;
  }

  async function uploadWithProvider(provider, file, config) {
    if (provider === "imgbb") return uploadToImgbb(file, config.imgbbKey);
    if (provider === "imagekit") return uploadToImageKit(file, config.imagekitPublicKey, config.imagekitUrlEndpoint);
    throw new Error("Unknown image provider: " + provider);
  }

  /**
   * Uploads `file`, using config.activeProvider first. If that provider
   * throws AND the other provider is configured, automatically retries
   * once on the other provider before giving up — this is what makes an
   * outage on one provider (like ImgBB's maintenance page) transparent
   * instead of blocking every image upload until an admin manually
   * flips the Settings toggle.
   */
  async function upload(file, config) {
    const active = config.activeProvider === "imagekit" ? "imagekit" : "imgbb"; // default to imgbb if unset (backward compatible)
    const fallback = active === "imgbb" ? "imagekit" : "imgbb";

    try {
      return await uploadWithProvider(active, file, config);
    } catch (activeErr) {
      if (!isProviderConfigured(fallback, config)) throw activeErr;
      try {
        return await uploadWithProvider(fallback, file, config);
      } catch (fallbackErr) {
        // Both failed — surface the ACTIVE provider's error as the
        // primary message (that's the one the admin actually chose/
        // expects), but mention the fallback also failed so it's clear
        // this isn't a one-off.
        throw new Error(`${activeErr.message} (backup provider also failed: ${fallbackErr.message})`);
      }
    }
  }

  return { upload, uploadToImgbb, uploadToImageKit };
})();
