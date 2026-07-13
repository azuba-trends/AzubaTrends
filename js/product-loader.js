const ProductLoader = (function () {
  let cachedProducts = null;
  let inFlightRequest = null;
  const currency = "₹";

  async function loadAllProducts() {
    if (cachedProducts) return cachedProducts;
    if (inFlightRequest) return inFlightRequest;

    inFlightRequest = (async () => {
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
        <div class="product-card__cta">
          <button class="btn btn-outline btn-block" ${product.stock === 0 ? 'disabled' : ''} 
            data-add-to-cart 
            data-product-id="${product.id}" 
            data-product-title="${safeTitle}" 
            data-product-price="${product.sellingPrice}" 
            data-product-image="${safeImage}">
            ${product.stock === 0 ? 'Out of Stock' : 'Add to Cart'}
          </button>
        </div>
      </div>
    `;
    return card;
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

  const API = { loadAllProducts, getProductById, calcDiscount, formatPrice, sortByStock, getCategories, renderProductCard, renderGrid, renderCategoryChips, initHeader };
  window.ProductLoader = API;
  return API;
})();