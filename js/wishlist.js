/**
 * wishlist.js
 * ------------------------------------------------------------------
 * Browser-local wishlist (localStorage, per-device — no backend/account
 * needed). Saving/removing a product from any product card's heart
 * button updates the same store the /wishlist page reads from, so it
 * survives a refresh and stays in sync everywhere on the site.
 *
 * Storage shape: { [productId]: { id, title, category, brand, image,
 * sellingPrice, mrp, rating, reviewCount, slug, stock, savedAt } }
 * A snapshot of the product is kept (not just the id) so the wishlist
 * page can render instantly without waiting on a fresh product fetch —
 * ProductLoader.loadAllProducts() is still used to refresh price/stock
 * when available, snapshot is just the instant-render fallback.
 * ------------------------------------------------------------------
 */
const Wishlist = (function () {
  const KEY = "azuba_wishlist_v1";

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      console.error("Wishlist: failed to read", err);
      return {};
    }
  }

  function writeAll(map) {
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
    } catch (err) {
      console.error("Wishlist: failed to save", err);
    }
    window.dispatchEvent(new CustomEvent("wishlist:changed", { detail: { map } }));
  }

  function has(id) {
    if (id === undefined || id === null) return false;
    return Object.prototype.hasOwnProperty.call(readAll(), String(id));
  }

  /** Adds if not saved, removes if already saved. Returns the new saved state (true/false). */
  function toggle(id, snapshot) {
    if (id === undefined || id === null) return false;
    const key = String(id);
    const map = readAll();
    if (map[key]) {
      delete map[key];
      writeAll(map);
      return false;
    }
    map[key] = { ...(snapshot || {}), id, savedAt: Date.now() };
    writeAll(map);
    return true;
  }

  function remove(id) {
    const key = String(id);
    const map = readAll();
    if (map[key]) {
      delete map[key];
      writeAll(map);
    }
  }

  function getAll() {
    const map = readAll();
    // Most-recently-saved first.
    return Object.values(map).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  function count() {
    return Object.keys(readAll()).length;
  }

  function updateBadges() {
    const n = count();
    document.querySelectorAll("[data-wishlist-count]").forEach((el) => {
      el.textContent = String(n);
      el.hidden = n === 0;
    });
  }

  window.addEventListener("wishlist:changed", updateBadges);
  window.addEventListener("layout:ready", updateBadges);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateBadges);
  } else {
    updateBadges();
  }

  const API = { has, toggle, remove, getAll, count };
  window.Wishlist = API;
  return API;
})();
