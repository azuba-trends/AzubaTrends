/**
 * category-loader.js
 * ------------------------------------------------------------------
 * Storefront-side reader for the `categories` Firestore collection
 * (public read — see firestore.rules). Mirrors the fullPath/parentId
 * tree logic admin.js uses to write these docs, so a fullPath like
 * "men/clothing/shirts" resolves the same way on both sides.
 *
 * Tolerant of categories that haven't gone through the admin-panel
 * migration yet (no `parentId` key) — falls back to treating them as
 * top-level with their stored `slug` as-is, so this never hard-fails
 * even before an admin has opened the panel once.
 * ------------------------------------------------------------------
 */
const CategoryLoader = (function () {
  let cached = null;
  let cachedSavedAt = 0;
  let inFlight = null;

  // Short-lived sessionStorage cache — the real fix for the visible
  // breadcrumb/category loading delay, which was every single page load
  // re-fetching the whole `categories` collection from Firestore from
  // scratch. Within this TTL, navigating between category pages (or back
  // to one already visited) reads from sessionStorage instead and renders
  // instantly; the very first category page visited in a session still
  // does one real fetch. Cleared automatically when the tab closes.
  const SESSION_CACHE_KEY = "azuba_categories_cache_v1";
  const SESSION_CACHE_TTL_MS = 90 * 1000;

  // Cross-tab invalidation: js/admin.js writes this same key (in
  // localStorage, which — unlike sessionStorage — IS shared across every
  // tab of this origin) to a fresh timestamp the instant a category is
  // saved or deleted. Any cache here saved BEFORE that timestamp is
  // treated as stale immediately, rather than waiting out its TTL. This
  // is what makes "I just removed a category's icon in the admin panel"
  // show up on the storefront right away instead of up to
  // SESSION_CACHE_TTL_MS later.
  const DIRTY_FLAG_KEY = "azuba_categories_dirty_at";

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

  function writeSessionCache(categories, savedAt) {
    try {
      sessionStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ savedAt, categories }));
    } catch (err) {
      // Storage full/unavailable — fine, this cache is purely an
      // optimization, everything still works without it.
    }
  }

  async function loadAllCategories() {
    if (cached && !isStaleByDirtyFlag(cachedSavedAt)) return cached;
    const fromSession = readSessionCache();
    if (fromSession) { cached = fromSession.categories; cachedSavedAt = fromSession.savedAt; return cached; }
    if (inFlight) return inFlight;
    inFlight = (async () => {
      // Fast path first: /api/categories is the same edge-cached endpoint
      // functions/api/list.js already serves for the rest of the site, so
      // this is a plain fetch — no waiting on the Firebase SDK to
      // initialize, no separate Firestore round trip from the browser,
      // which is what caused the visible breadcrumb/category loading
      // delay. Falls back to the old direct-Firestore read only if the API
      // is unavailable (e.g. hosted somewhere without Pages Functions).
      try {
        const res = await fetch("/api/categories");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.categories)) {
            cached = data.categories;
            cachedSavedAt = Date.now();
            writeSessionCache(cached, cachedSavedAt);
            return cached;
          }
        }
        console.warn("CategoryLoader: /api/categories unavailable (status " + res.status + "), falling back to direct Firestore read.");
      } catch (err) {
        console.warn("CategoryLoader: /api/categories fetch failed, falling back to direct Firestore read.", err);
      }

      try {
        while (!window.FirebaseApp) { await new Promise((r) => setTimeout(r, 100)); }
        const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        const db = window.FirebaseApp.db;
        const snap = await getDocs(collection(db, "categories"));
        cached = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        cachedSavedAt = Date.now();
        writeSessionCache(cached, cachedSavedAt);
        return cached;
      } catch (err) {
        console.error("CategoryLoader Error:", err);
        cached = [];
        return cached;
      }
    })();
    return inFlight;
  }

  /** Call after an admin edit so the next page load doesn't serve a stale
   *  cached tree — not wired up to anything yet (admin panel is next
   *  update's work), just exposed for that to call later. */
  function invalidateCache() {
    cached = null;
    cachedSavedAt = 0;
    try { sessionStorage.removeItem(SESSION_CACHE_KEY); } catch (err) {}
  }

  function computeFullPath(catId, byId) {
    const seen = new Set();
    const parts = [];
    let cur = byId.get(catId);
    while (cur) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      parts.unshift(cur.slug || cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : null;
    }
    return parts.join("/");
  }

  /** Builds { byId, roots } where every node carries .children, .depth
   *  and a resolved .fullPath (using the cached field if the admin panel
   *  has already migrated + saved it, otherwise computed on the fly). */
  function buildTree(categories) {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const nodes = new Map();
    categories.forEach((c) => {
      nodes.set(c.id, {
        ...c,
        fullPath: c.fullPath || computeFullPath(c.id, byId),
        children: []
      });
    });
    const roots = [];
    nodes.forEach((n) => {
      if (n.parentId && nodes.has(n.parentId)) nodes.get(n.parentId).children.push(n);
      else roots.push(n);
    });
    return { byId: nodes, roots };
  }

  function findByFullPath(tree, fullPath) {
    if (!fullPath) return null;
    for (const node of tree.byId.values()) {
      if (node.fullPath === fullPath) return node;
    }
    return null;
  }

  function getDescendantIds(node) {
    const result = [];
    const stack = [...node.children];
    while (stack.length) {
      const n = stack.pop();
      result.push(n.id);
      stack.push(...n.children);
    }
    return result;
  }

  /** Root -> ... -> node, for breadcrumb rendering. */
  function breadcrumbChain(tree, node) {
    const chain = [];
    let cur = node;
    const seen = new Set();
    while (cur) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.parentId ? tree.byId.get(cur.parentId) : null;
    }
    return chain;
  }

  const API = { loadAllCategories, buildTree, findByFullPath, getDescendantIds, breadcrumbChain, invalidateCache };
  window.CategoryLoader = API;
  return API;
})();
