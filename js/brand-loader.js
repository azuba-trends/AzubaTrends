/**
 * brand-loader.js
 * ------------------------------------------------------------------
 * Storefront-side reader for the `brands` Firestore collection (public
 * read — see firestore.rules). Mirrors js/category-loader.js's caching
 * strategy exactly (same session-cache TTL + cross-tab dirty flag), just
 * for a flat list instead of a parent/child tree — brands have no
 * nesting, so there's no buildTree()/breadcrumbChain() equivalent here.
 * ------------------------------------------------------------------
 */
const BrandLoader = (function () {
  let cached = null;
  let cachedSavedAt = 0;
  let inFlight = null;

  // Short-lived sessionStorage cache, same reasoning as CategoryLoader's:
  // avoids re-fetching the whole `brands` collection on every /brand and
  // /brand/:slug navigation within one browsing session.
  const SESSION_CACHE_KEY = "azuba_brands_cache_v1";
  const SESSION_CACHE_TTL_MS = 90 * 1000;

  // Cross-tab invalidation: js/admin.js writes this same key (in
  // localStorage) to a fresh timestamp the instant a brand is saved or
  // deleted, so an admin edit shows up on the storefront right away
  // instead of waiting out the TTL. See CategoryLoader's identical
  // DIRTY_FLAG_KEY comment for the full explanation.
  const DIRTY_FLAG_KEY = "azuba_brands_dirty_at";

  function isStaleByDirtyFlag(savedAt) {
    try {
      const dirtyAt = Number(localStorage.getItem(DIRTY_FLAG_KEY)) || 0;
      return dirtyAt > savedAt;
    } catch (err) {
      return false; // localStorage unavailable — can't check, assume fresh
    }
  }

  function readSessionCache() {
    try {
      const raw = sessionStorage.getItem(SESSION_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || (Date.now() - parsed.savedAt) > SESSION_CACHE_TTL_MS) return null;
      if (isStaleByDirtyFlag(parsed.savedAt)) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function writeSessionCache(brands, savedAt) {
    try {
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ savedAt, brands }));
    } catch (err) {
      // Storage full/unavailable — fine, this cache is purely an
      // optimization, everything still works without it.
    }
  }

  async function loadAllBrands() {
    if (cached && !isStaleByDirtyFlag(cachedSavedAt)) return cached;
    const fromSession = readSessionCache();
    if (fromSession) { cached = fromSession.brands; cachedSavedAt = fromSession.savedAt; return cached; }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      // Fast path first: /api/brands (functions/api/brands.js ->
      // list.js's handleBrands) is edge-cached the same way
      // /api/categories is. Falls back to a direct Firestore read only if
      // that endpoint is unavailable.
      try {
        const res = await fetch("/api/brands");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.brands)) {
            cached = data.brands;
            cachedSavedAt = Date.now();
            writeSessionCache(cached, cachedSavedAt);
            return cached;
          }
        }
        console.warn("BrandLoader: /api/brands unavailable (status " + res.status + "), falling back to direct Firestore read.");
      } catch (err) {
        console.warn("BrandLoader: /api/brands fetch failed, falling back to direct Firestore read.", err);
      }

      try {
        while (!window.FirebaseApp) { await new Promise((r) => setTimeout(r, 100)); }
        const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        const db = window.FirebaseApp.db;
        const snap = await getDocs(collection(db, "brands"));
        cached = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        cachedSavedAt = Date.now();
        writeSessionCache(cached, cachedSavedAt);
        return cached;
      } catch (err) {
        console.error("BrandLoader Error:", err);
        cached = [];
        return cached;
      }
    })();
    return inFlight;
  }

  function findBySlug(brands, slug) {
    if (!slug) return null;
    return brands.find((b) => b.slug === slug) || null;
  }

  /** Call after an admin edit so the next page load doesn't serve a stale
   *  cached list — mirrors CategoryLoader.invalidateCache(). */
  function invalidateCache() {
    cached = null;
    cachedSavedAt = 0;
    try { sessionStorage.removeItem(SESSION_CACHE_KEY); } catch (err) {}
  }

  const API = { loadAllBrands, findBySlug, invalidateCache };
  window.BrandLoader = API;
  return API;
})();
