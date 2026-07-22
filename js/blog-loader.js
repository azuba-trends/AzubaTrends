/**
 * blog-loader.js
 * ------------------------------------------------------------------
 * Public-facing (non-admin) blog data loading + block rendering.
 * Mirrors product-loader.js's pattern: try a cached API endpoint
 * first, fall back to a direct Firestore read so the site keeps
 * working even before/without that endpoint. Only PUBLISHED posts
 * are ever shown here — drafts stay admin-only via Firestore rules
 * plus this status filter.
 * ------------------------------------------------------------------
 */
const BlogLoader = (function () {
  let cachedPosts = null;
  let inFlightRequest = null;

  async function loadPublishedPosts() {
    if (cachedPosts) return cachedPosts;
    if (inFlightRequest) return inFlightRequest;

    inFlightRequest = (async () => {
      try {
        const res = await fetch("/api/blog-posts");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.posts)) {
            cachedPosts = data.posts;
            return cachedPosts;
          }
        }
        console.warn("BlogLoader: /api/blog-posts unavailable (status " + res.status + "), falling back to direct Firestore read.");
      } catch (err) {
        console.warn("BlogLoader: /api/blog-posts fetch failed, falling back to direct Firestore read.", err);
      }

      try {
        while (!window.FirebaseApp) { await new Promise((r) => setTimeout(r, 100)); }
        const { collection, getDocs, query, where } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        const db = window.FirebaseApp.db;
        const q = query(collection(db, "blogPosts"), where("status", "==", "published"));
        const snapshot = await getDocs(q);
        cachedPosts = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        return cachedPosts;
      } catch (err) {
        console.error("BlogLoader Error:", err);
        return [];
      }
    })();
    return inFlightRequest;
  }

  async function getPostBySlug(slug) {
    const posts = await loadPublishedPosts();
    return posts.find((p) => p.slug === slug) || null;
  }

  function sortByNewest(posts) {
    return [...posts].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  }

  // Plain-text excerpt for cards/meta descriptions. Posts don't have a
  // separate "excerpt" field, so this pulls text out of whichever content
  // representation the post has: the rich-text `content` HTML field
  // (current posts), or the older `blocks` array (posts saved before the
  // rich text editor existed).
  function getExcerpt(post, maxLen) {
    maxLen = maxLen || 140;
    let raw = "";
    if (post.content) {
      const tmp = document.createElement("div");
      tmp.innerHTML = post.content;
      raw = (tmp.textContent || "").replace(/\s+/g, " ").trim();
    } else {
      const textBlock = (post.blocks || []).find((b) => (b.type === "paragraph" || b.type === "heading") && b.text && b.text.trim());
      raw = textBlock ? textBlock.text.trim() : "";
    }
    return raw.length > maxLen ? raw.slice(0, maxLen).trim() + "…" : raw;
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    } catch (err) {
      return "";
    }
  }

  // Categories/tags -> safe pill HTML. Categories are highlighted (accent
  // pill), tags render as plain "#tag" pills — same visual language on the
  // single post page and (for the primary category) the blog listing cards.
  function renderTaxonomyHTML(post) {
    const esc = (s) => (window.Security ? window.Security.escapeHTML(s) : String(s ?? ""));
    const categories = post.categories || [];
    const tags = post.tags || [];
    if (!categories.length && !tags.length) return "";
    const catHTML = categories.map((c) => `<span class="taxonomy-pill taxonomy-pill--category">${esc(c)}</span>`).join("");
    const tagHTML = tags.map((t) => `<span class="taxonomy-pill">#${esc(t)}</span>`).join("");
    return `<div class="taxonomy-pills">${catHTML}${tagHTML}</div>`;
  }

  // Turns one content block into safe HTML. Every piece of user-entered
  // text goes through Security.escapeHTML — same helper used everywhere
  // else on the site for user/admin-entered text (reviews, products, etc.).
  function renderBlockHTML(block) {
    const esc = (s) => (window.Security ? window.Security.escapeHTML(s) : String(s ?? ""));
    if (block.type === "heading") {
      return `<h2>${esc(block.text || "")}</h2>`;
    }
    if (block.type === "paragraph") {
      return `<p>${esc(block.text || "")}</p>`;
    }
    if (block.type === "image" && block.imageUrl) {
      const caption = block.caption ? `<figcaption>${esc(block.caption)}</figcaption>` : "";
      return `<figure class="blog-post__figure"><img src="${esc(block.imageUrl)}" alt="${esc(block.caption || "")}" loading="lazy">${caption}</figure>`;
    }
    return "";
  }

  // The `content` field is HTML authored in the admin's rich text editor.
  // Only the site owner can write it (Firestore rules restrict writes to
  // authenticated admins), but it's still stripped of anything that could
  // execute script before ever touching the live page, as a safety net.
  function sanitizeContentHTML(html) {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    tmp.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((el) => el.remove());
    tmp.querySelectorAll("*").forEach((el) => {
      [...el.attributes].forEach((attr) => {
        const name = attr.name.toLowerCase();
        if (name.startsWith("on") || (name === "href" && /^\s*javascript:/i.test(attr.value)) || (name === "src" && /^\s*javascript:/i.test(attr.value))) {
          el.removeAttribute(attr.name);
        }
      });
    });
    return tmp.innerHTML;
  }

  function renderPostHTML(post) {
    if (post.content) return sanitizeContentHTML(post.content);
    return (post.blocks || []).map(renderBlockHTML).join("\n");
  }

  function renderBlogCard(post) {
    const cover = post.coverImage || "images/logo-placeholder.svg";
    const esc = (s) => (window.Security ? window.Security.escapeHTML(s) : String(s ?? ""));
    const primaryCategory = (post.categories && post.categories[0])
      ? `<span class="taxonomy-pill taxonomy-pill--category">${esc(post.categories[0])}</span>`
      : "";
    return `
      <a href="/blog/${encodeURIComponent(post.slug)}" class="blog-card">
        <img src="${esc(cover)}" alt="" class="blog-card__img" loading="lazy">
        <div class="blog-card__body">
          ${primaryCategory}
          <h3 class="blog-card__title">${esc(post.title)}</h3>
          <p class="blog-card__excerpt">${esc(getExcerpt(post))}</p>
          <span class="blog-card__date">${esc(formatDate(post.createdAt))}</span>
        </div>
      </a>`;
  }

  function renderGrid(container, posts, emptyMessage) {
    if (!posts || posts.length === 0) {
      container.innerHTML = `<p class="blog-empty">${emptyMessage || "No posts yet — check back soon."}</p>`;
      return;
    }
    container.innerHTML = sortByNewest(posts).map(renderBlogCard).join("");
  }

  const API = { loadPublishedPosts, getPostBySlug, sortByNewest, getExcerpt, formatDate, renderPostHTML, renderBlockHTML, renderBlogCard, renderGrid, renderTaxonomyHTML };
  window.BlogLoader = API;
  return API;
})();
