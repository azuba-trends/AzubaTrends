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
  let inFlight = null;

  async function loadAllCategories() {
    if (cached) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        while (!window.FirebaseApp) { await new Promise((r) => setTimeout(r, 100)); }
        const { collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        const db = window.FirebaseApp.db;
        const snap = await getDocs(collection(db, "categories"));
        cached = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        return cached;
      } catch (err) {
        console.error("CategoryLoader Error:", err);
        cached = [];
        return cached;
      }
    })();
    return inFlight;
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

  const API = { loadAllCategories, buildTree, findByFullPath, getDescendantIds, breadcrumbChain };
  window.CategoryLoader = API;
  return API;
})();
