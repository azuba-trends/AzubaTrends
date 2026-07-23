/**
 * page-loader.js
 * ------------------------------------------------------------------
 * Public-facing (non-admin) reader for the "pages" Firestore collection.
 * Used by:
 *   - page.html          (any custom page added from Admin -> Pages)
 *   - about.html / terms.html / 404.html   (default pages — overlays
 *     Firestore content on top of the static placeholder markup already
 *     in the file, ONLY if the admin has actually written something in
 *     Admin -> Pages -> Edit for that page. Empty Firestore content means
 *     "admin hasn't touched this yet" -> static placeholder stays as-is.)
 *   - index.html          (reads the "home" page doc for its optional
 *     after-products content block)
 *
 * Same direct-Firestore-read approach as blog-loader.js's fallback path
 * (no dedicated /api endpoint for pages yet — reads are cheap and public).
 * ------------------------------------------------------------------
 */
const PageLoader = (function () {
  async function getDb() {
    while (!window.FirebaseApp) { await new Promise((r) => setTimeout(r, 100)); }
    return window.FirebaseApp.db;
  }

  // Looks up a single published page by its slug. Returns null if it
  // doesn't exist or isn't published (drafts are admin-preview only).
  async function getPageBySlug(slug) {
    if (!slug) return null;
    try {
      const db = await getDb();
      const { collection, getDocs, query, where } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
      const q = query(collection(db, "pages"), where("slug", "==", slug));
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const docSnap = snap.docs[0];
      const data = { id: docSnap.id, ...docSnap.data() };
      if (data.status !== "published") return null;
      return data;
    } catch (err) {
      console.error("PageLoader.getPageBySlug error", err);
      return null;
    }
  }

  // For default pages (about/terms/404/home): overlays dynamic SEO tags +
  // content onto an already-rendered static page, WITHOUT touching layout
  // if the admin hasn't saved anything for it yet. Call this after
  // layout:ready. `opts.headingEl`, `opts.contentEl` are the elements to
  // update; `opts.baseUrl` is used for canonical/OG tags.
  async function overlayDefaultPage(slug, opts) {
    const page = await getPageBySlug(slug);
    if (!page) return null; // not seeded yet, or admin hasn't published it — keep static content

    const title = page.metaTitle || page.heading;
    if (title) document.title = title + " — AzubaTrends";
    const desc = page.metaDesc;
    const descTag = document.querySelector('meta[name="description"]');
    if (desc && descTag) descTag.setAttribute("content", desc);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (title && ogTitle) ogTitle.setAttribute("content", title);
    if (desc && ogDesc) ogDesc.setAttribute("content", desc);

    if (opts && opts.headingEl && page.heading) {
      (window.Security ? Security.setTextSafely : (el, t) => { el.textContent = t; })(opts.headingEl, page.heading);
    }
    // Only overwrite the static placeholder content if the admin actually
    // wrote something — an empty editor means "hasn't been touched yet".
    if (opts && opts.contentEl && page.content && page.content.trim()) {
      opts.contentEl.innerHTML = page.content;
    }
    return page;
  }

  return { getPageBySlug, overlayDefaultPage };
})();
