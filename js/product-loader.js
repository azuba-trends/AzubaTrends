const ProductLoader = (function () {
  let cachedProducts = null;
  let inFlightRequest = null;
  const currency = "₹";

  async function loadAllProducts() {
    if (cachedProducts) return cachedProducts;
    if (inFlightRequest) return inFlightRequest;

    inFlightRequest = (async () => {
      // Try the server-cached endpoint first — this is what makes product
      // loading fast and stops every page load from hitting Firestore
      // directly from the browser. See api/products.js for the full
      // caching explanation.
      try {
        const res = await fetch("/api/products");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.products)) {
            cachedProducts = data.products;
            return cachedProducts;
          }
        }
        console.warn("ProductLoader: /api/products unavailable (status " + res.status + "), falling back to direct Firestore read.");
      } catch (err) {
        console.warn("ProductLoader: /api/products fetch failed, falling back to direct Firestore read.", err);
      }

      // Fallback: the original direct-from-browser Firestore read. Keeps
      // the site working even when hosted somewhere without serverless
      // functions, or before the service account is configured.
      try {
        while(!window.FirebaseApp) { await new Promise(r => setTimeout(r, 100)); }
        
        const { collection, getDocs, query, where } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        const db = window.FirebaseApp.db;
        
        const q = query(collection(db, "products"), where("status", "==", "active"));
        const snapshot = await getDocs(q);
        
        cachedProducts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return cachedProducts;
      } catch (err) {
        console.error("ProductLoader Error:", err);
        return [];
      }
    })();
    return inFlightRequest;
  }

  async function getProductById(id) {
    const products = await loadAllProducts();
    return products.find((p) => p.id === id) || null;
  }

  function calcDiscount(product) {
    if (!product || !product.mrp || product.sellingPrice >= product.mrp) return 0;
    return Math.round(((product.mrp - product.sellingPrice) / product.mrp) * 100);
  }

  function formatPrice(amount) {
    return currency + Number(amount || 0).toLocaleString("en-IN");
  }

  function sortByStock(products) {
    return products.sort((a, b) => {
      if(a.stock === 0 && b.stock > 0) return 1;
      if(b.stock === 0 && a.stock > 0) return -1;
      return 0;
    });
  }

  function getCategories(products) {
    return [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  }

  function renderProductCard(product) {
    const card = document.createElement("article");
    card.className = "product-card" + (product.stock === 0 ? " is-out-of-stock" : "");

    const discount = calcDiscount(product);
    const image = (product.images && product.images[0]) ? product.images[0] : "images/logo-placeholder.svg";
    // All product-supplied text is escaped before going into innerHTML —
    // product data comes from the admin panel, which is itself reachable by
    // anyone who can get a malicious string into a field, so it's treated as
    // untrusted the same way user-typed text would be.
    const safeTitle = window.Security ? window.Security.escapeHTML(product.title) : String(product.title || "");
    const safeCategory = window.Security ? window.Security.escapeHTML(product.category) : String(product.category || "");
    const safeImage = window.Security ? window.Security.escapeHTML(image) : image;

    card.innerHTML = `
      <a href="product.html?id=${encodeURIComponent(product.id)}" class="product-card__link">
        <div class="product-card__media">
          ${discount > 0 && product.stock > 0 ? `<span class="price-tag">${discount}% OFF</span>` : ''}
          ${product.stock === 0 ? `<span class="price-tag price-tag--stock">Out of Stock</span>` : ''}
          <img src="${safeImage}" alt="${safeTitle}" loading="lazy">
        </div>
      </a>
      <div class="product-card__body">
        <span class="product-card__category">${safeCategory}</span>
        <h3 class="product-card__title">${safeTitle}</h3>
        <div class="product-card__price-row">
          <span class="price-current">${formatPrice(product.sellingPrice)}</span>
          ${discount > 0 ? `<span class="price-mrp">${formatPrice(product.mrp)}</span>` : ''}
        </div>
        <div class="product-card__cta" data-cta-mount></div>
      </div>
    `;

    if (product.stock !== 0) {
      const ctaMount = card.querySelector("[data-cta-mount]");
      window.CartButtonUI && window.CartButtonUI.mount(ctaMount, {
        productId: product.id,
        title: safeTitle,
        price: product.sellingPrice,
        image: safeImage,
        stock: product.stock
      });
    } else {
      card.querySelector("[data-cta-mount]").innerHTML = `<button class="btn btn-outline btn-block" disabled>Out of Stock</button>`;
    }
    return card;
  }

  function renderSkeletonGrid(container, count = 6) {
    if (!container) return;
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const card = document.createElement("div");
      card.className = "product-card product-card--skeleton";
      card.innerHTML = `
        <div class="skeleton skeleton--media"></div>
        <div class="product-card__body">
          <div class="skeleton skeleton--line" style="width:40%;"></div>
          <div class="skeleton skeleton--line" style="width:80%; height:1.1em;"></div>
          <div class="skeleton skeleton--line" style="width:55%;"></div>
          <div class="skeleton skeleton--line skeleton--btn"></div>
        </div>`;
      container.appendChild(card);
    }
  }

  function renderGrid(container, products, emptyMessage) {
    if (!container) return;
    container.innerHTML = "";
    if (!products || products.length === 0) {
      container.innerHTML = `<div class="empty-state"><h2>No products found</h2><p>${emptyMessage || "Try another category."}</p></div>`;
      return;
    }
    sortByStock(products).forEach((product) => {
      container.appendChild(renderProductCard(product));
    });
  }

  function renderCategoryChips(container, products, onSelect, activeCategory) {
    if (!container) return;
    container.innerHTML = "";
    ["All", ...getCategories(products)].forEach((cat) => {
      const chip = document.createElement("button");
      chip.className = "chip" + ((cat === activeCategory) ? " is-active" : "");
      chip.textContent = cat;
      chip.addEventListener("click", () => onSelect(cat));
      container.appendChild(chip);
    });
  }

  // ------------------------------------------------------------------
  // Lightweight interest tracking (cookie-based) + related/recommended
  // products. No third-party analytics involved — just a small cookie
  // (`interest_categories`) counting how many times each category has been
  // viewed on this browser, read back to rank "Recommended for you".
  // ------------------------------------------------------------------
  function trackCategoryInterest(category) {
    if (!category) return;
    try {
      const raw = document.cookie.split("; ").find((c) => c.startsWith("interest_categories="));
      const data = raw ? JSON.parse(decodeURIComponent(raw.split("=")[1])) : {};
      data[category] = (data[category] || 0) + 1;
      document.cookie = `interest_categories=${encodeURIComponent(JSON.stringify(data))}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
    } catch (err) { /* cookies disabled or blocked — recommendations just fall back to "no preference" */ }
  }

  function getTopInterestCategories() {
    try {
      const raw = document.cookie.split("; ").find((c) => c.startsWith("interest_categories="));
      if (!raw) return [];
      const data = JSON.parse(decodeURIComponent(raw.split("=")[1]));
      return Object.entries(data).sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
    } catch (err) {
      return [];
    }
  }

  /** Picks related/recommended products: same category as `excludeId`'s
   *  product first (if given), then the shopper's most-viewed categories
   *  from the interest cookie, then just newest-in-stock as a last resort —
   *  so this never comes up empty as long as *some* other product exists. */
  function pickRelatedProducts(allProducts, { excludeId, category, limit = 8 } = {}) {
    const pool = allProducts.filter((p) => String(p.id) !== String(excludeId));
    const buckets = [];
    if (category) buckets.push(pool.filter((p) => p.category === category));
    getTopInterestCategories().forEach((cat) => buckets.push(pool.filter((p) => p.category === cat)));
    buckets.push(pool); // fallback: anything else

    const seen = new Set();
    const result = [];
    for (const bucket of buckets) {
      for (const p of bucket) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        result.push(p);
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  /** Lazy-loads a related-products row into `container` only once it
   *  scrolls into view (shopper isn't looking at it yet, so there's no
   *  reason to render/fetch before that) — shows the same skeleton
   *  shimmer while it "arrives", and a clean empty-state if there's
   *  genuinely nothing else to show. */
  function mountRelatedProducts(container, opts) {
    if (!container || !("IntersectionObserver" in window)) {
      renderRelatedProductsNow(container, opts);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        renderRelatedProductsNow(container, opts);
      }
    }, { rootMargin: "200px" });
    observer.observe(container);
  }

  async function renderRelatedProductsNow(container, opts) {
    renderSkeletonGrid(container, 4);
    const all = await loadAllProducts();
    const related = pickRelatedProducts(all, opts);
    if (related.length === 0) {
      container.innerHTML = `<div class="empty-state"><h2>No related products yet</h2><p>Check back soon as more products are added.</p></div>`;
      return;
    }
    container.innerHTML = "";
    related.forEach((p) => container.appendChild(renderProductCard(p)));
  }

  function initHeader() {
    const siteName = window.SITE_CONFIG.siteName || "AzubaTrends";
    
    // Update all places where Site Name should appear
    document.querySelectorAll("[data-site-name]").forEach(el => el.textContent = siteName);
    
    // Update Page Title if it contains old name
    if(document.title.includes("AzubaTrends") && siteName !== "AzubaTrends") {
      document.title = document.title.replace("AzubaTrends", siteName);
    }

    const setBadge = (count) => {
      document.querySelectorAll("[data-cart-count]").forEach(b => b.textContent = count);
    };
    if (window.Cart) setBadge(window.Cart.getItemCount());
    window.addEventListener("cart:updated", (e) => setBadge(e.detail.count));
  }

  const API = { loadAllProducts, getProductById, calcDiscount, formatPrice, sortByStock, getCategories, renderProductCard, renderGrid, renderSkeletonGrid, renderCategoryChips, initHeader, trackCategoryInterest, mountRelatedProducts };
  window.ProductLoader = API;
  return API;
})();