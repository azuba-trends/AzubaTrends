/**
 * category-chips.js
 * ------------------------------------------------------------------
 * Fills the horizontal circular category icon row under the header
 * (design system §2.1 / §2.3) on pages that opt in with
 * <body data-show-chips>. Reads real top-level categories from
 * CategoryLoader (same source category.html uses) so the row always
 * matches what's actually in the catalog instead of a hardcoded list.
 *
 * Categories don't carry an icon field in Firestore, so each chip gets
 * a flat inline-SVG icon looked up by name/slug from a small built-in
 * set, falling back to a generic tag icon for anything unmapped.
 * ------------------------------------------------------------------
 */
const CategoryChips = (function () {
  const ICONS = {
    textiles: '<path d="M4 4h16v4l-3 1 3 1v10H4V10l3-1-3-1V4z"/>',
    terracotta: '<path d="M9 3h6v3.2c1.8.9 3 2.8 3 5.3 0 3.6-2.7 6.5-6 6.5s-6-2.9-6-6.5c0-2.5 1.2-4.4 3-5.3V3z"/><path d="M8 21h8"/>',
    jute: '<path d="M4 8h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
    brass: '<path d="M12 3v5"/><path d="M6 12c0-2 2.5-4 6-4s6 2 6 4-2.5 3-6 3-6-1-6-3z"/><path d="M8 15h8l-1.5 6h-5z"/>',
    copper: '<rect x="9" y="3" width="6" height="4" rx="1"/><path d="M8 7h8l1 5-1 9H8L7 12z"/>',
    jewelry: '<circle cx="12" cy="9" r="5"/><path d="M9 4l3-2 3 2"/><path d="M9.5 9a2.5 2.5 0 0 0 5 0"/>',
    "home decor": '<path d="M4 11l8-7 8 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-6h4v6"/>',
    accessories: '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9"/><path d="M17 17l3 3"/>',
    gifts: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 9h16"/><path d="M12 9v11"/><path d="M12 9C9.5 9 8 7.5 8 6a2 2 0 0 1 4 0 2 2 0 0 1 4 0c0 1.5-1.5 3-4 3z"/>',
    default: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>'
  };

  function iconFor(name) {
    const key = (name || "").trim().toLowerCase();
    return ICONS[key] || ICONS.default;
  }

  function chipHTML(label, href, iconPath, isAll) {
    return `<a class="category-chip${isAll ? " category-chip--all" : ""}" href="${href}">
      <span class="category-chip__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
      </span>
      <span class="category-chip__label">${label}</span>
    </a>`;
  }

  async function mount() {
    if (!document.body.hasAttribute("data-show-chips")) return;
    const row = document.getElementById("category-chip-row");
    const list = document.getElementById("category-chip-list");
    if (!row || !list) return;

    let cats = [];
    try {
      const all = await window.CategoryLoader.loadAllCategories();
      const tree = window.CategoryLoader.buildTree(all);
      cats = tree.roots
        .filter((c) => !c.hidden)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || "").localeCompare(b.name || ""));
    } catch (err) {
      console.error("CategoryChips: failed to load categories", err);
    }

    if (!cats.length) { row.hidden = true; return; }

    const MAX_VISIBLE = window.innerWidth < 768 ? 5 : 10;
    const visible = cats.slice(0, MAX_VISIBLE);
    const overflowCount = cats.length - visible.length;

    let html = chipHTML("All Categories", "/category", ICONS.default, true);
    html += visible
      .map((c) => chipHTML(c.name || c.slug, `/category/${c.fullPath || c.slug}`, iconFor(c.name || c.slug)))
      .join("");
    if (overflowCount > 0) {
      html += chipHTML("More", "/category", '<circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/>');
    }

    list.innerHTML = html;
    row.hidden = false;
  }

  window.addEventListener("layout:ready", mount);
  return { mount };
})();
