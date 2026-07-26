import {
  collection, addDoc, doc, deleteDoc, updateDoc, setDoc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const esc = (s) => (window.Security ? window.Security.escapeHTML(s) : String(s ?? ""));

setTimeout(() => {
  const { auth, db, signInWithEmailAndPassword, onAuthStateChanged, signOut } = window.FirebaseApp;

  // Loaded from Firestore settings on login — nothing API-related is
  // hardcoded in source anymore (see Settings > Account in the UI).
  let SETTINGS = {};

  // --- 1. AUTHENTICATION & UI ROUTING ---
  const loginScreen = document.getElementById("login-screen");
  const adminLayout = document.getElementById("admin-layout");

  onAuthStateChanged(auth, (user) => {
    if (user) {
      loginScreen.style.display = "none";
      adminLayout.style.display = "flex";
      document.getElementById("account-login-email").textContent = user.email || "—";
      startRealtimeSync();
    } else {
      loginScreen.style.display = "block";
      adminLayout.style.display = "none";
      stopRealtimeSync();
    }
  });

  document.getElementById("admin-login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = document.getElementById("admin-email").value;
    const pass = document.getElementById("admin-password").value;
    signInWithEmailAndPassword(auth, email, pass).catch(() => {
      document.getElementById("login-error").style.display = "block";
    });
  });

  document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

  // --- Sidebar / in-page navigation ---
  // Any button with class="nav-btn" + data-target switches sections, whether
  // it lives in the sidebar or as a "+ Add Product" / "Cancel" button inside
  // a section. data-fresh-form resets that form into "Add new" mode so
  // clicking "+ Add Product" after editing something doesn't leave stale data.
  // Pure section switch — NO form reset. Used both by real nav clicks and by
  // editProduct/editCategory/editBrand after they've populated a form (those
  // must NOT trigger the fresh-form reset, or the data they just filled in
  // gets wiped immediately — that was the "Edit always opens a blank Add
  // form" bug).
  const LAST_SECTION_KEY = "azuba_admin_last_section";
  // Sections that only make sense freshly opened (an empty "Add new" form,
  // for instance) are never restored on reload — that would resurrect a
  // half-filled form as if it still applied, which is more confusing than
  // just landing on Overview.
  const NON_RESTORABLE_SECTIONS = new Set(["store-add-product", "store-add-category", "store-add-brand", "store-add-coupon", "blog-add-post", "blog-add-category", "add-page"]);

  // --- Collapsible "All X" -> "Add X" sidebar groups (accordion) ---
  // Opening one group's submenu closes every other one; `except` (a
  // .nav-item element) is left untouched.
  function closeAllSubmenus(except) {
    document.querySelectorAll(".sidebar .nav-item").forEach((item) => {
      if (item === except) return;
      const submenu = item.querySelector(".nav-submenu");
      const arrow = item.querySelector(".nav-arrow");
      if (submenu) submenu.classList.remove("open");
      if (arrow) arrow.classList.remove("open");
    });
  }
  function openSubmenu(item) {
    if (!item) return;
    const submenu = item.querySelector(".nav-submenu");
    const arrow = item.querySelector(".nav-arrow");
    if (submenu) submenu.classList.add("open");
    if (arrow) arrow.classList.add("open");
  }

  function goToSection(target, opts) {
    document.querySelectorAll(".sidebar .nav-btn").forEach((b) => b.classList.remove("active"));
    const sidebarMatch = document.querySelector(`.sidebar .nav-btn[data-target="${target}"]`);
    if (sidebarMatch) sidebarMatch.classList.add("active");
    // Landing on a nested "Add X" page (or its parent "All X" page) expands
    // that group and collapses every other one, so the sidebar always shows
    // at most one open group — matching whatever's currently active.
    if (sidebarMatch) {
      const parentItem = sidebarMatch.closest(".nav-item");
      closeAllSubmenus(parentItem || undefined);
      if (parentItem) openSubmenu(parentItem);
    }
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    const el = document.getElementById(target);
    if (!el) return;
    el.classList.add("active");
    // WordPress-style full-screen editor: hide the sidebar/topbar while the
    // Add/Edit Post screen is open, same as post-new.php / post.php.
    document.getElementById("admin-layout").classList.toggle("editor-mode", target === "blog-add-post" || target === "add-page");
    if (!NON_RESTORABLE_SECTIONS.has(target)) {
      try { localStorage.setItem(LAST_SECTION_KEY, target); } catch (err) { /* storage unavailable, ignore */ }
    }
    if (!(opts && opts.silent)) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // --- Mobile sidebar drawer (hamburger menu) ---
  // On screens under 860px the sidebar is fixed/off-canvas (see admin.html
  // CSS); this just toggles the classes that slide it in/out and dims the
  // rest of the screen behind it.
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  const sidebarEl = document.querySelector(".sidebar");
  const sidebarBackdrop = document.getElementById("sidebar-backdrop");

  function openMobileSidebar() {
    sidebarEl.classList.add("open");
    sidebarBackdrop.classList.add("open");
    mobileMenuBtn.setAttribute("aria-expanded", "true");
  }
  function closeMobileSidebar() {
    sidebarEl.classList.remove("open");
    sidebarBackdrop.classList.remove("open");
    mobileMenuBtn.setAttribute("aria-expanded", "false");
  }
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => {
      sidebarEl.classList.contains("open") ? closeMobileSidebar() : openMobileSidebar();
    });
    sidebarBackdrop.addEventListener("click", closeMobileSidebar);
  }

  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget.dataset.target;
      goToSection(target);
      closeMobileSidebar();

      const fresh = e.currentTarget.dataset.freshForm;
      if (fresh === "product") resetProductForm();
      if (fresh === "category") resetCategoryForm();
      if (fresh === "brand") resetBrandForm();
      if (fresh === "coupon") resetCouponForm();
      if (fresh === "blogpost") resetBlogPostForm();
      if (fresh === "blogcategory") resetBlogCategoryForm();
      if (fresh === "page") resetPageForm();
    });
  });

  // Generic tab-strip wiring (used for Orders status tabs + Settings tabs)
  function wireTabStrip(stripSelector, attr, onSelect) {
    document.querySelectorAll(`${stripSelector} .tab-btn`).forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(`${stripSelector} .tab-btn`).forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        onSelect(btn.dataset[attr]);
      });
    });
  }

  // Helper: Generate Slug
  function generateSlug(text) {
    return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  }

  function fmtRupee(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }

  // ================================================================
  // CSV EXPORT ENGINE (shared by Overview / Products / Brands /
  // Coupons / Orders "Export CSV" buttons). Runs entirely client-side
  // against the data the admin already has loaded live via onSnapshot
  // (productsList / brandsList / couponsList / ordersList) — no server
  // round-trip needed, so this adds zero new /api functions.
  // ================================================================

  // Wraps a value in quotes and escapes internal quotes only when needed
  // (commas, quotes, or newlines present) — keeps plain numbers/short text
  // unquoted for a cleaner-looking file, same as Excel/Sheets' own export.
  function csvCell(value) {
    const s = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function rowsToCSV(rows) {
    return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  }

  function downloadCSV(filename, rows) {
    const csv = "\uFEFF" + rowsToCSV(rows); // BOM so Excel opens ₹/UTF-8 correctly
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Resolves a range key (from the Overview export picker) to concrete
  // [start, end] Date bounds, in local time — consistent with
  // localDateKey()'s local-day bucketing used elsewhere in Analytics.
  function resolveDateRange(rangeKey, customFrom, customTo) {
    const now = new Date();
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    switch (rangeKey) {
      case "7d": {
        const start = new Date(now); start.setDate(start.getDate() - 6);
        return { start: startOfDay(start), end: endOfDay(now), label: "Last 7 days" };
      }
      case "28d": {
        const start = new Date(now); start.setDate(start.getDate() - 27);
        return { start: startOfDay(start), end: endOfDay(now), label: "Last 28 days" };
      }
      case "this_month": {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: startOfDay(start), end: endOfDay(now), label: "This Month" };
      }
      case "prev_month": {
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return { start: startOfDay(start), end: endOfDay(end), label: "Previous Month" };
      }
      case "this_year": {
        const start = new Date(now.getFullYear(), 0, 1);
        return { start: startOfDay(start), end: endOfDay(now), label: "This Year" };
      }
      case "custom": {
        const start = customFrom ? startOfDay(new Date(customFrom)) : startOfDay(new Date(2000, 0, 1));
        const end = customTo ? endOfDay(new Date(customTo)) : endOfDay(now);
        return { start, end, label: `${customFrom || "…"} to ${customTo || "…"}` };
      }
      case "all":
      default:
        return { start: startOfDay(new Date(2000, 0, 1)), end: endOfDay(now), label: "All Time" };
    }
  }

  function ordersInRange(start, end) {
    return ordersList.filter((o) => {
      if (!o.createdAt) return false;
      const t = new Date(o.createdAt);
      return t >= start && t <= end;
    });
  }

  // Per-line profit: (sale price − cost price at time of order) × qty.
  // costPrice is snapshotted on the order item at checkout (api/place-order.js);
  // null means "not recorded" (product had no Cost Price set at order time),
  // which the caller reports separately rather than silently treating as 0.
  function orderProfitBreakdown(order) {
    let profit = 0;
    let hasUnknownCost = false;
    (order.items || []).forEach((it) => {
      if (it.costPrice === null || it.costPrice === undefined) { hasUnknownCost = true; return; }
      profit += (Number(it.price || 0) - Number(it.costPrice || 0)) * Number(it.quantity || 0);
    });
    return { profit, hasUnknownCost };
  }

  function buildOverviewReportCSV(rangeKey, customFrom, customTo) {
    const { start, end, label } = resolveDateRange(rangeKey, customFrom, customTo);
    const orders = ordersInRange(start, end);
    const nonCancelled = orders.filter((o) => o.status !== "Cancelled");

    const revenue = nonCancelled.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
    const discountTotal = nonCancelled.reduce((s, o) => s + (Number(o.discount) || 0), 0);
    const deliveryFeeTotal = nonCancelled.reduce((s, o) => s + (Number(o.deliveryFee) || 0), 0);
    const codChargeTotal = nonCancelled.reduce((s, o) => s + (Number(o.codCharge) || 0), 0);
    let profitTotal = 0, ordersWithUnknownCost = 0;
    nonCancelled.forEach((o) => {
      const { profit, hasUnknownCost } = orderProfitBreakdown(o);
      profitTotal += profit;
      if (hasUnknownCost) ordersWithUnknownCost++;
    });

    const statusCounts = {};
    orders.forEach((o) => { statusCounts[o.status || "Unknown"] = (statusCounts[o.status || "Unknown"] || 0) + 1; });

    const productSales = {}; // productId -> { title, qty, revenue }
    nonCancelled.forEach((o) => {
      (o.items || []).forEach((it) => {
        const key = it.productId || it.title;
        if (!productSales[key]) productSales[key] = { title: it.title, qty: 0, revenue: 0 };
        productSales[key].qty += Number(it.quantity || 0);
        productSales[key].revenue += Number(it.price || 0) * Number(it.quantity || 0);
      });
    });
    const topProducts = Object.values(productSales).sort((a, b) => b.qty - a.qty).slice(0, 20);

    const couponUsage = {}; // code -> { count, discount, revenue }
    nonCancelled.forEach((o) => {
      if (!o.couponCode) return;
      if (!couponUsage[o.couponCode]) couponUsage[o.couponCode] = { count: 0, discount: 0, revenue: 0 };
      couponUsage[o.couponCode].count += 1;
      couponUsage[o.couponCode].discount += Number(o.discount) || 0;
      couponUsage[o.couponCode].revenue += Number(o.finalTotal) || 0;
    });

    const rows = [];
    rows.push(["AzubaTrends — Overview Report"]);
    rows.push(["Range", label]);
    rows.push(["Generated At", new Date().toLocaleString("en-IN")]);
    rows.push([]);
    rows.push(["Summary"]);
    rows.push(["Total Orders (all statuses)", orders.length]);
    rows.push(["Orders Counted for Revenue (excl. Cancelled)", nonCancelled.length]);
    rows.push(["Total Revenue", revenue]);
    rows.push(["Total Discount Given", discountTotal]);
    rows.push(["Total Delivery Fee Collected", deliveryFeeTotal]);
    rows.push(["Total COD Charge Collected", codChargeTotal]);
    rows.push(["Total Profit", profitTotal + (ordersWithUnknownCost ? " (partial — see note)" : "")]);
    if (ordersWithUnknownCost) {
      rows.push(["Note", `${ordersWithUnknownCost} order(s) include a product with no Cost Price recorded — their profit is under-counted above. Set Cost Price on those products (see Products export for which ones).`]);
    }
    rows.push([]);
    rows.push(["Orders by Status"]);
    rows.push(["Status", "Count"]);
    Object.entries(statusCounts).forEach(([status, count]) => rows.push([status, count]));
    rows.push([]);
    rows.push(["Top Products (by units sold, in this range)"]);
    rows.push(["Product", "Units Sold", "Revenue"]);
    topProducts.forEach((p) => rows.push([p.title, p.qty, p.revenue]));
    rows.push([]);
    rows.push(["Coupon Usage (in this range)"]);
    rows.push(["Coupon Code", "Times Used", "Total Discount Given", "Revenue From Those Orders"]);
    Object.entries(couponUsage).forEach(([code, u]) => rows.push([code, u.count, u.discount, u.revenue]));
    return rows;
  }

  function buildProductsReportCSV() {
    const salesByProduct = {};
    ordersList.forEach((o) => {
      if (o.status === "Cancelled") return;
      (o.items || []).forEach((it) => {
        const key = it.productId;
        if (!key) return;
        if (!salesByProduct[key]) salesByProduct[key] = { qty: 0, revenue: 0 };
        salesByProduct[key].qty += Number(it.quantity || 0);
        salesByProduct[key].revenue += Number(it.price || 0) * Number(it.quantity || 0);
      });
    });

    const rows = [[
      "Title", "Size", "Color", "SKU", "Brand", "Category", "Status", "MRP", "Selling Price", "Cost Price",
      "Stock", "Units Sold (all time)", "Revenue Generated (all time)", "Created At"
    ]];
    productsList.forEach((p) => {
      // Parent "template" records (hasVariants:true) aren't sellable
      // themselves — only their variants are actual orderable products —
      // so they're left out of this export to avoid double-counting or
      // a confusing all-zero row. Every variant IS included, listed
      // right alongside normal (non-variant) products.
      if (p.hasVariants) return;
      const sales = salesByProduct[p.id] || { qty: 0, revenue: 0 };
      rows.push([
        p.title || "", p.size || "", p.color || "", p.sku || "", p.brand || "", p.category || "", p.status || "",
        Number(p.mrp || 0), Number(p.sellingPrice || 0),
        (p.costPrice === undefined || p.costPrice === null || p.costPrice === "") ? "NOT SET" : Number(p.costPrice),
        Number(p.stock || 0), sales.qty, sales.revenue,
        p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : ""
      ]);
    });
    return rows;
  }

  function buildBrandsReportCSV() {
    const rows = [["Brand Name", "Slug", "Total Products", "Total Stock", "Units Sold (all time)", "Revenue Generated (all time)"]];
    const salesByProduct = {};
    ordersList.forEach((o) => {
      if (o.status === "Cancelled") return;
      (o.items || []).forEach((it) => {
        if (!it.productId) return;
        if (!salesByProduct[it.productId]) salesByProduct[it.productId] = { qty: 0, revenue: 0 };
        salesByProduct[it.productId].qty += Number(it.quantity || 0);
        salesByProduct[it.productId].revenue += Number(it.price || 0) * Number(it.quantity || 0);
      });
    });
    brandsList.forEach((b) => {
      const brandProducts = productsList.filter((p) => p.brand === b.name);
      let qty = 0, revenue = 0, stock = 0;
      brandProducts.forEach((p) => {
        stock += Number(p.stock || 0);
        const s = salesByProduct[p.id];
        if (s) { qty += s.qty; revenue += s.revenue; }
      });
      rows.push([b.name || "", b.slug || "", brandProducts.length, stock, qty, revenue]);
    });
    return rows;
  }

  function buildCouponsReportCSV() {
    const rows = [["Code", "Type", "Value", "Min Order Value", "Max Discount", "Expiry Date", "Active", "Times Used", "Total Discount Given", "Revenue From Those Orders"]];
    couponsList.forEach((c) => {
      const usedOrders = ordersList.filter((o) => o.status !== "Cancelled" && o.couponCode === c.code);
      const discountGiven = usedOrders.reduce((s, o) => s + (Number(o.discount) || 0), 0);
      const revenue = usedOrders.reduce((s, o) => s + (Number(o.finalTotal) || 0), 0);
      rows.push([
        c.code || "", c.type || "", c.value ?? "", c.minOrderValue ?? 0, c.maxDiscount ?? "",
        c.expiryDate || "", c.active ? "Yes" : "No", usedOrders.length, discountGiven, revenue
      ]);
    });
    return rows;
  }

  function buildOrdersReportCSV() {
    const rows = [[
      "Order ID", "Date", "Customer Name", "Phone", "Address", "City", "Pincode",
      "Items (title x qty @ price)", "Subtotal", "Discount", "Coupon Code",
      "Delivery Fee", "COD Charge", "Final Total", "Cost Total", "Profit",
      "Payment Method", "Status"
    ]];
    ordersList.forEach((o) => {
      const itemsStr = (o.items || []).map((it) => {
        const variant = (it.size || it.color) ? ` [${[it.size, it.color].filter(Boolean).join("/")}]` : "";
        return `${it.title}${variant} x${it.quantity} @${it.price}`;
      }).join(" | ");
      const { profit, hasUnknownCost } = orderProfitBreakdown(o);
      const costTotal = (o.items || []).reduce((s, it) => s + ((it.costPrice === null || it.costPrice === undefined) ? 0 : Number(it.costPrice) * Number(it.quantity || 0)), 0);
      rows.push([
        o.orderId || o.id || "", o.createdAt ? new Date(o.createdAt).toLocaleString("en-IN") : "",
        o.customerName || "", o.customerPhone || "", o.customerAddress || "", o.customerCity || "", o.customerPincode || "",
        itemsStr, Number(o.subtotal || 0), Number(o.discount || 0), o.couponCode || "",
        Number(o.deliveryFee || 0), Number(o.codCharge || 0), Number(o.finalTotal || 0),
        costTotal, hasUnknownCost ? `${profit} (partial — cost missing on 1+ items)` : profit,
        o.paymentMethod || "", o.status || ""
      ]);
    });
    return rows;
  }

  function todayFileStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Resizes/compresses an image file in the browser before upload — phone
  // camera photos are often 3-10 MB at 4000px+ wide, which is massive
  // overkill for a product card/gallery and makes the storefront feel slow
  // on customers' mobile data. This scales the longest edge down to a
  // sensible max and re-encodes as JPEG at a quality that keeps the file
  // small while still looking sharp when zoomed in the lightbox.
  const MAX_IMAGE_DIMENSION = 1600; // px, longest edge
  const IMAGE_QUALITY = 0.82;

  function compressImage(file) {
    return new Promise((resolve) => {
      // Only compress actual raster images ImgBB/browsers can re-encode;
      // pass anything else (e.g. an already-tiny file, or a format canvas
      // can't touch) straight through rather than risk breaking it.
      if (!file.type || !file.type.startsWith("image/") || file.type === "image/gif") {
        return resolve(file);
      }

      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        let { width, height } = img;
        if (width <= MAX_IMAGE_DIMENSION && height <= MAX_IMAGE_DIMENSION && file.size < 700 * 1024) {
          // Already small enough — skip re-encoding to avoid needless
          // quality loss on images that don't need it.
          return resolve(file);
        }

        const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) return resolve(file); // fallback: upload original if canvas export fails
            resolve(new File([blob], (file.name || "image").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }));
          },
          "image/jpeg",
          IMAGE_QUALITY
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file); // fallback: upload original rather than blocking the whole save
      };

      img.src = objectUrl;
    });
  }

  // Helper: Upload image via ImgBB, using the key from Settings (never hardcoded)
  async function uploadToImgBB(file) {
    if (!SETTINGS.imgbbKey) {
      throw new Error("No ImgBB API key set. Add one in Settings > Account before uploading images.");
    }
    const uploadFile = await compressImage(file);
    const formData = new FormData();
    formData.append("image", uploadFile);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(SETTINGS.imgbbKey)}`, { method: "POST", body: formData });
    const data = await res.json();
    if (data.success) return data.data.url;
    throw new Error("Image upload failed: " + (data.error?.message || "unknown error"));
  }

  // Reused for feature/gallery/delivery-partner image previews and the
  // payment screenshot in the order modal — click any preview thumbnail
  // to view it full-size, click the cross or outside to close.
  const adminLightbox = document.getElementById("admin-lightbox");
  const adminLightboxImg = document.getElementById("admin-lightbox-img");
  function openAdminLightbox(url) {
    if (!adminLightbox || !adminLightboxImg || !url) return;
    adminLightboxImg.src = url;
    adminLightbox.hidden = false;
  }
  if (adminLightbox) {
    document.getElementById("admin-lightbox-close").addEventListener("click", () => { adminLightbox.hidden = true; });
    adminLightbox.addEventListener("click", (e) => { if (e.target === adminLightbox) adminLightbox.hidden = true; });
  }

  function previewFileList(input, container, max) {
    container.innerHTML = "";
    const files = Array.from(input.files || []).slice(0, max);
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative; display:inline-block;";
      const img = document.createElement("img");
      img.src = url;
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => openAdminLightbox(url));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove this image";
      removeBtn.style.cssText = "position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:50%; border:none; background:var(--color-danger,#c0392b); color:#fff; cursor:pointer; line-height:1; font-size:14px;";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        input.value = "";
        container.innerHTML = "";
      });
      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      container.appendChild(wrap);
    });
  }

  // A native <input type="file" multiple> REPLACES its whole FileList every
  // time the picker is opened — so picking 1 image, then picking 1 more,
  // silently drops the first. Gallery images aren't uploaded until Save,
  // so we keep our own running list here and merge new picks into it
  // instead of ever trusting input.files directly.
  let pendingGalleryFiles = [];
  function renderGalleryPreview() {
    const container = document.getElementById("prod-gallery-preview");
    container.innerHTML = "";
    pendingGalleryFiles.forEach((file, i) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative; display:inline-block;";
      const img = document.createElement("img");
      const url = URL.createObjectURL(file);
      img.src = url;
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => openAdminLightbox(url));
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.title = "Remove this image";
      removeBtn.style.cssText = "position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:50%; border:none; background:var(--color-danger,#c0392b); color:#fff; cursor:pointer; line-height:1; font-size:14px;";
      removeBtn.addEventListener("click", () => {
        pendingGalleryFiles.splice(i, 1);
        renderGalleryPreview();
      });
      wrap.appendChild(img);
      wrap.appendChild(removeBtn);
      container.appendChild(wrap);
    });
  }

  function previewExistingImages(container, urls, onRemove) {
    container.innerHTML = "";
    (urls || []).forEach((url, idx) => {
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:relative; display:inline-block;";
      const img = document.createElement("img");
      img.src = url;
      img.style.cursor = "zoom-in";
      img.addEventListener("click", () => openAdminLightbox(url));
      wrap.appendChild(img);
      if (onRemove) {
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "×";
        removeBtn.title = "Remove this image";
        removeBtn.style.cssText = "position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:50%; border:none; background:var(--color-danger,#c0392b); color:#fff; cursor:pointer; line-height:1; font-size:14px;";
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          onRemove(idx);
        });
        wrap.appendChild(removeBtn);
      }
      container.appendChild(wrap);
    });
  }

  // Generic bulk-select helper for a table: wires the header checkbox +
  // shows/hides a bulk-delete button when at least one row is checked.
  function wireBulkSelect(tableBodyId, selectAllId, bulkBtnId, onBulkDelete) {
    const selectAll = document.getElementById(selectAllId);
    const bulkBtn = document.getElementById(bulkBtnId);
    if (!selectAll) return;
    function rowChecks() { return Array.from(document.querySelectorAll(`#${tableBodyId} .row-select`)); }
    function refreshBulkBtn() {
      if (!bulkBtn) return;
      bulkBtn.style.display = rowChecks().some((c) => c.checked) ? "inline-block" : "none";
    }
    selectAll.addEventListener("change", () => {
      rowChecks().forEach((c) => { c.checked = selectAll.checked; });
      refreshBulkBtn();
    });
    document.getElementById(tableBodyId).addEventListener("change", (e) => {
      if (e.target.classList.contains("row-select")) refreshBulkBtn();
    });
    if (bulkBtn) {
      bulkBtn.addEventListener("click", async () => {
        const ids = rowChecks().filter((c) => c.checked).map((c) => c.dataset.id);
        if (ids.length === 0) return;
        if (!confirm(`Delete ${ids.length} selected item(s)? This cannot be undone.`)) return;
        await onBulkDelete(ids);
        selectAll.checked = false;
        refreshBulkBtn();
      });
    }
  }

  // ================================================================
  // CATEGORIES
  // ================================================================
  let categoriesList = [];

  document.getElementById("cat-name").addEventListener("input", (e) => {
    document.getElementById("cat-slug").value = generateSlug(e.target.value);
  });
  document.getElementById("cat-type").addEventListener("change", (e) => {
    document.getElementById("parent-cat-dropdown-container").style.display = e.target.value === "child" ? "block" : "none";
  });
  document.getElementById("cat-image").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("cat-image-preview"), 1));

  function resetCategoryForm() {
    document.getElementById("category-form").reset();
    document.getElementById("cat-id").value = "";
    document.getElementById("cat-image-preview").innerHTML = "";
    document.getElementById("parent-cat-dropdown-container").style.display = "none";
    document.getElementById("category-form-title").textContent = "Add New Category";
  }

  let unsubCategories = null;
  function listenCategories() {
    if (unsubCategories) return;
    unsubCategories = onSnapshot(collection(db, "categories"), (snap) => {
      categoriesList = [];
      snap.forEach((d) => categoriesList.push({ id: d.id, ...d.data() }));
      renderCategoriesTable();
      renderDashboard();
    }, (err) => console.error("categories listener error", err));
  }

  function renderCategoriesTable() {
    const tbody = document.getElementById("categories-table-body");
    const parentSelect = document.getElementById("parent-cat-select");
    tbody.innerHTML = "";
    parentSelect.innerHTML = "";

    categoriesList.forEach((cat) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="row-select" data-id="${cat.id}"></td>
        <td>${esc(cat.name)}</td>
        <td>${esc((cat.type || "").toUpperCase())}</td>
        <td>/${esc(cat.slug)}</td>
        <td>
          <button class="btn btn-outline edit-cat-btn" data-id="${cat.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline del-cat-btn" data-id="${cat.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
      if (cat.type === "parent") {
        const opt = document.createElement("option");
        opt.value = cat.slug; opt.textContent = cat.name;
        parentSelect.appendChild(opt);
      }
    });

    tbody.querySelectorAll(".edit-cat-btn").forEach((b) => b.addEventListener("click", () => editCategory(b.dataset.id)));
    tbody.querySelectorAll(".del-cat-btn").forEach((b) => b.addEventListener("click", () => deleteCategory(b.dataset.id)));

    populateCategoryDropdown();
  }

  function editCategory(id) {
    const cat = categoriesList.find((c) => c.id === id);
    if (!cat) return;
    document.getElementById("cat-id").value = cat.id;
    document.getElementById("cat-name").value = cat.name || "";
    document.getElementById("cat-slug").value = cat.slug || "";
    document.getElementById("cat-type").value = cat.type || "parent";
    document.getElementById("parent-cat-dropdown-container").style.display = cat.type === "child" ? "block" : "none";
    document.getElementById("cat-desc").value = cat.description || "";
    document.getElementById("cat-meta-title").value = cat.metaTitle || "";
    document.getElementById("cat-meta-desc").value = cat.metaDesc || "";
    previewExistingImages(document.getElementById("cat-image-preview"), cat.image ? [cat.image] : []);
    if (cat.type === "child" && cat.parentSlug) {
      setTimeout(() => { document.getElementById("parent-cat-select").value = cat.parentSlug; }, 50);
    }
    document.getElementById("category-form-title").textContent = "Edit Category";
    goToSection("store-add-category");
  }

  async function deleteCategory(id) {
    if (!confirm("Delete this category?")) return;
    await deleteDoc(doc(db, "categories", id));
  }

  document.getElementById("category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-cat-btn");
    btn.textContent = "Saving..."; btn.disabled = true;
    try {
      let image = categoriesList.find((c) => c.id === document.getElementById("cat-id").value)?.image || "";
      const file = document.getElementById("cat-image").files[0];
      if (file) image = await uploadToImgBB(file);

      const isChild = document.getElementById("cat-type").value === "child";
      const parentSlug = isChild ? document.getElementById("parent-cat-select").value : "";
      const finalSlug = isChild ? `${parentSlug}/${document.getElementById("cat-slug").value}` : document.getElementById("cat-slug").value;

      const data = {
        name: document.getElementById("cat-name").value,
        slug: finalSlug,
        parentSlug: parentSlug,
        type: document.getElementById("cat-type").value,
        description: document.getElementById("cat-desc").value,
        metaTitle: document.getElementById("cat-meta-title").value,
        metaDesc: document.getElementById("cat-meta-desc").value,
        image: image,
        updatedAt: new Date().toISOString()
      };

      const id = document.getElementById("cat-id").value;
      if (id) {
        await updateDoc(doc(db, "categories", id), data);
      } else {
        data.createdAt = new Date().toISOString();
        await addDoc(collection(db, "categories"), data);
      }
      resetCategoryForm();
      goToSection("store-categories");
    } catch (err) {
      alert("Error saving category: " + err.message);
    } finally {
      btn.textContent = "Save Category"; btn.disabled = false;
    }
  });

  wireBulkSelect("categories-table-body", "select-all-categories", "bulk-delete-categories-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "categories", id));
  });

  // ================================================================
  // BLOG CATEGORIES (flat — no parent/child, unlike store categories)
  // ================================================================
  let blogCategoriesList = [];

  document.getElementById("bcat-name").addEventListener("input", (e) => {
    document.getElementById("bcat-slug").value = generateSlug(e.target.value);
  });
  document.getElementById("bcat-image").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("bcat-image-preview"), 1));

  function resetBlogCategoryForm() {
    document.getElementById("blogcategory-form").reset();
    document.getElementById("bcat-id").value = "";
    document.getElementById("bcat-image-preview").innerHTML = "";
    document.getElementById("blogcategory-form-title").textContent = "Add New Blog Category";
  }

  let unsubBlogCategories = null;
  function listenBlogCategories() {
    if (unsubBlogCategories) return;
    unsubBlogCategories = onSnapshot(collection(db, "blogCategories"), (snap) => {
      blogCategoriesList = [];
      snap.forEach((d) => blogCategoriesList.push({ id: d.id, ...d.data() }));
      renderBlogCategoriesTable();
      renderBlogCategoriesChecklist();
    }, (err) => console.error("blogCategories listener error", err));
  }

  function renderBlogCategoriesTable() {
    const tbody = document.getElementById("blogcategories-table-body");
    tbody.innerHTML = "";

    blogCategoriesList.forEach((cat) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="row-select" data-id="${cat.id}"></td>
        <td>${esc(cat.name)}</td>
        <td>/${esc(cat.slug)}</td>
        <td>
          <button class="btn btn-outline edit-blogcat-btn" data-id="${cat.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline del-blogcat-btn" data-id="${cat.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".edit-blogcat-btn").forEach((b) => b.addEventListener("click", () => editBlogCategory(b.dataset.id)));
    tbody.querySelectorAll(".del-blogcat-btn").forEach((b) => b.addEventListener("click", () => deleteBlogCategory(b.dataset.id)));
  }

  function editBlogCategory(id) {
    const cat = blogCategoriesList.find((c) => c.id === id);
    if (!cat) return;
    document.getElementById("bcat-id").value = cat.id;
    document.getElementById("bcat-name").value = cat.name || "";
    document.getElementById("bcat-slug").value = cat.slug || "";
    document.getElementById("bcat-desc").value = cat.description || "";
    document.getElementById("bcat-meta-title").value = cat.metaTitle || "";
    document.getElementById("bcat-meta-desc").value = cat.metaDesc || "";
    previewExistingImages(document.getElementById("bcat-image-preview"), cat.image ? [cat.image] : []);
    document.getElementById("blogcategory-form-title").textContent = "Edit Blog Category";
    goToSection("blog-add-category");
  }

  async function deleteBlogCategory(id) {
    if (!confirm("Delete this blog category?")) return;
    await deleteDoc(doc(db, "blogCategories", id));
  }

  document.getElementById("blogcategory-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-blogcat-btn");
    btn.textContent = "Saving..."; btn.disabled = true;
    try {
      let image = blogCategoriesList.find((c) => c.id === document.getElementById("bcat-id").value)?.image || "";
      const file = document.getElementById("bcat-image").files[0];
      if (file) image = await uploadToImgBB(file);

      const data = {
        name: document.getElementById("bcat-name").value,
        slug: document.getElementById("bcat-slug").value,
        description: document.getElementById("bcat-desc").value,
        metaTitle: document.getElementById("bcat-meta-title").value,
        metaDesc: document.getElementById("bcat-meta-desc").value,
        image: image,
        updatedAt: new Date().toISOString()
      };

      const id = document.getElementById("bcat-id").value;
      if (id) {
        await updateDoc(doc(db, "blogCategories", id), data);
      } else {
        data.createdAt = new Date().toISOString();
        await addDoc(collection(db, "blogCategories"), data);
      }
      resetBlogCategoryForm();
      goToSection("blog-categories");
    } catch (err) {
      alert("Error saving blog category: " + err.message);
    } finally {
      btn.textContent = "Save Category"; btn.disabled = false;
    }
  });

  wireBulkSelect("blogcategories-table-body", "select-all-blogcategories", "bulk-delete-blogcategories-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "blogCategories", id));
  });

  // --- Live checkbox list used by the Add/Edit Post "Categories" field ---
  // Keeps a hidden #bp-categories input (comma-joined names) in sync so the
  // existing Preview + Save logic — which reads #bp-categories.value.split(",")
  // — keeps working untouched, while the visible UI is a checkbox list
  // instead of free text. `post.categories` is still saved as an array of
  // category NAMES, exactly as before.
  let selectedBlogCatNames = new Set();

  function syncBlogCategoriesHiddenField() {
    document.getElementById("bp-categories").value = Array.from(selectedBlogCatNames).join(", ");
  }

  function renderBlogCategoriesChecklist() {
    const box = document.getElementById("bp-categories-checklist");
    if (!box) return;
    if (blogCategoriesList.length === 0) {
      box.innerHTML = '<span class="field-hint">No blog categories yet — add one under Blog &gt; Add Blog Category.</span>';
      return;
    }
    box.innerHTML = blogCategoriesList.map((cat) => `
      <label style="display:flex; align-items:center; gap:8px; font-weight:normal;">
        <input type="checkbox" class="bp-cat-checkbox" value="${esc(cat.name)}" ${selectedBlogCatNames.has(cat.name) ? "checked" : ""}>
        ${esc(cat.name)}
      </label>`).join("");
    box.querySelectorAll(".bp-cat-checkbox").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        if (e.target.checked) selectedBlogCatNames.add(e.target.value);
        else selectedBlogCatNames.delete(e.target.value);
        syncBlogCategoriesHiddenField();
      });
    });
  }

  // ================================================================
  // BRANDS
  // ================================================================
  let brandsList = [];

  document.getElementById("brand-name").addEventListener("input", (e) => {
    document.getElementById("brand-slug").value = generateSlug(e.target.value);
  });
  document.getElementById("brand-image").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("brand-image-preview"), 1));

  function resetBrandForm() {
    document.getElementById("brand-form").reset();
    document.getElementById("brand-id").value = "";
    document.getElementById("brand-image-preview").innerHTML = "";
    document.getElementById("brand-form-title").textContent = "Add New Brand";
  }

  let unsubBrands = null;
  function listenBrands() {
    if (unsubBrands) return;
    unsubBrands = onSnapshot(collection(db, "brands"), (snap) => {
      brandsList = [];
      snap.forEach((d) => brandsList.push({ id: d.id, ...d.data() }));
      renderBrandsTable();
      renderDashboard();
    }, (err) => console.error("brands listener error", err));
  }

  function renderBrandsTable() {
    const tbody = document.getElementById("brands-table-body");
    tbody.innerHTML = "";
    brandsList.forEach((b) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="row-select" data-id="${b.id}"></td>
        <td>${esc(b.name)}</td>
        <td>/${esc(b.slug)}</td>
        <td>
          <button class="btn btn-outline edit-brand-btn" data-id="${b.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline del-brand-btn" data-id="${b.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".edit-brand-btn").forEach((b) => b.addEventListener("click", () => editBrand(b.dataset.id)));
    tbody.querySelectorAll(".del-brand-btn").forEach((b) => b.addEventListener("click", () => deleteBrand(b.dataset.id)));

    populateBrandDropdown();
  }

  function editBrand(id) {
    const b = brandsList.find((x) => x.id === id);
    if (!b) return;
    document.getElementById("brand-id").value = b.id;
    document.getElementById("brand-name").value = b.name || "";
    document.getElementById("brand-slug").value = b.slug || "";
    document.getElementById("brand-desc").value = b.description || "";
    document.getElementById("brand-meta-title").value = b.metaTitle || "";
    document.getElementById("brand-meta-desc").value = b.metaDesc || "";
    previewExistingImages(document.getElementById("brand-image-preview"), b.image ? [b.image] : []);
    document.getElementById("brand-form-title").textContent = "Edit Brand";
    goToSection("store-add-brand");
  }

  async function deleteBrand(id) {
    if (!confirm("Delete this brand?")) return;
    await deleteDoc(doc(db, "brands", id));
  }

  document.getElementById("brand-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-brand-btn");
    btn.textContent = "Saving..."; btn.disabled = true;
    try {
      let image = brandsList.find((b) => b.id === document.getElementById("brand-id").value)?.image || "";
      const file = document.getElementById("brand-image").files[0];
      if (file) image = await uploadToImgBB(file);

      const data = {
        name: document.getElementById("brand-name").value,
        slug: document.getElementById("brand-slug").value,
        description: document.getElementById("brand-desc").value,
        metaTitle: document.getElementById("brand-meta-title").value,
        metaDesc: document.getElementById("brand-meta-desc").value,
        image: image,
        updatedAt: new Date().toISOString()
      };

      const id = document.getElementById("brand-id").value;
      if (id) {
        await updateDoc(doc(db, "brands", id), data);
      } else {
        data.createdAt = new Date().toISOString();
        await addDoc(collection(db, "brands"), data);
      }
      resetBrandForm();
      goToSection("store-brands");
    } catch (err) {
      alert("Error saving brand: " + err.message);
    } finally {
      btn.textContent = "Save Brand"; btn.disabled = false;
    }
  });

  wireBulkSelect("brands-table-body", "select-all-brands", "bulk-delete-brands-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "brands", id));
  });

  function populateCategoryDropdown() {
    const sel = document.getElementById("prod-category");
    const current = sel.value;
    sel.innerHTML = "<option value=''>Select Category</option>";
    categoriesList.forEach((cat) => sel.innerHTML += `<option value="${esc(cat.name)}">${esc(cat.name)}</option>`);
    sel.value = current;
  }

  function populateBrandDropdown() {
    const sel = document.getElementById("prod-brand");
    const current = sel.value;
    sel.innerHTML = "<option value=''>Select Brand</option>";
    brandsList.forEach((b) => sel.innerHTML += `<option value="${esc(b.name)}">${esc(b.name)}</option>`);
    sel.value = current;
  }

  // ================================================================
  // COUPONS
  // ================================================================
  let couponsList = [];

  document.getElementById("coupon-code").addEventListener("input", (e) => {
    // Force uppercase as the shopper types, since codes are matched
    // case-insensitively but should always be *stored* consistently.
    const pos = e.target.selectionStart;
    e.target.value = e.target.value.toUpperCase();
    e.target.setSelectionRange(pos, pos);
  });

  function refreshCouponValueLabels() {
    const isPct = document.getElementById("coupon-type").value === "percentage";
    document.getElementById("coupon-value-label").textContent = isPct ? "Value (%) *" : "Value (₹) *";
    document.getElementById("coupon-maxdiscount-field").style.display = isPct ? "" : "none";
  }
  document.getElementById("coupon-type").addEventListener("change", refreshCouponValueLabels);

  function resetCouponForm() {
    document.getElementById("coupon-form").reset();
    document.getElementById("coupon-id").value = "";
    document.getElementById("coupon-active").checked = true;
    document.getElementById("coupon-minorder").value = 0;
    document.getElementById("coupon-form-title").textContent = "Add New Coupon";
    document.getElementById("coupon-save-status").textContent = "";
    refreshCouponValueLabels();
  }

  let unsubCoupons = null;
  function listenCoupons() {
    if (unsubCoupons) return;
    unsubCoupons = onSnapshot(collection(db, "coupons"), (snap) => {
      couponsList = [];
      snap.forEach((d) => couponsList.push({ id: d.id, ...d.data() }));
      renderCouponsTable();
    }, (err) => console.error("coupons listener error", err));
  }

  function couponIsExpired(c) {
    if (!c.expiryDate) return false;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    return c.expiryDate < todayStr;
  }

  function renderCouponsTable() {
    const tbody = document.getElementById("coupons-table-body");
    tbody.innerHTML = "";
    if (couponsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--color-muted);">No coupons yet — click "+ Add Coupon" to create one.</td></tr>`;
      return;
    }
    couponsList.forEach((c) => {
      const expired = couponIsExpired(c);
      const isActive = c.active && !expired;
      const statusLabel = expired ? "EXPIRED" : (c.active ? "ACTIVE" : "INACTIVE");
      const statusColor = expired ? "var(--color-danger)" : (c.active ? "var(--color-success)" : "var(--color-muted)");
      const valueDisplay = c.type === "percentage" ? `${c.value}%` : fmtRupee(c.value);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="row-select" data-id="${c.id}"></td>
        <td><strong>${esc(c.code)}</strong></td>
        <td>${c.type === "percentage" ? "Percentage" : "Flat"}</td>
        <td>${esc(valueDisplay)}</td>
        <td>${fmtRupee(c.minOrderValue || 0)}</td>
        <td>${c.type === "percentage" && c.maxDiscount ? fmtRupee(c.maxDiscount) : "—"}</td>
        <td>${c.expiryDate ? esc(c.expiryDate) : "No expiry"}</td>
        <td style="color:${statusColor}; font-weight:bold;">${statusLabel}</td>
        <td>
          <button class="btn btn-outline toggle-coupon-btn" data-id="${c.id}" data-active="${c.active ? "1" : "0"}" style="padding:4px 8px; font-size:0.8rem;">${c.active ? "Deactivate" : "Activate"}</button>
          <button class="btn btn-outline edit-coupon-btn" data-id="${c.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline del-coupon-btn" data-id="${c.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".edit-coupon-btn").forEach((b) => b.addEventListener("click", () => editCoupon(b.dataset.id)));
    tbody.querySelectorAll(".del-coupon-btn").forEach((b) => b.addEventListener("click", () => deleteCoupon(b.dataset.id)));
    tbody.querySelectorAll(".toggle-coupon-btn").forEach((b) => b.addEventListener("click", () => toggleCouponActive(b.dataset.id, b.dataset.active === "1")));
  }

  function editCoupon(id) {
    const c = couponsList.find((x) => x.id === id);
    if (!c) return;
    document.getElementById("coupon-id").value = c.id;
    document.getElementById("coupon-code").value = c.code || "";
    document.getElementById("coupon-type").value = c.type || "percentage";
    document.getElementById("coupon-value").value = c.value ?? "";
    document.getElementById("coupon-maxdiscount").value = c.maxDiscount ?? "";
    document.getElementById("coupon-minorder").value = c.minOrderValue ?? 0;
    document.getElementById("coupon-expiry").value = c.expiryDate || "";
    document.getElementById("coupon-active").checked = c.active !== false;
    refreshCouponValueLabels();
    document.getElementById("coupon-form-title").textContent = "Edit Coupon";
    goToSection("store-add-coupon");
  }

  async function deleteCoupon(id) {
    if (!confirm("Delete this coupon? Shoppers won't be able to apply it anymore.")) return;
    await deleteDoc(doc(db, "coupons", id));
  }

  async function toggleCouponActive(id, currentlyActive) {
    await updateDoc(doc(db, "coupons", id), { active: !currentlyActive });
  }

  document.getElementById("coupon-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-coupon-btn");
    const statusEl = document.getElementById("coupon-save-status");
    const code = document.getElementById("coupon-code").value.trim().toUpperCase();
    const id = document.getElementById("coupon-id").value;

    if (!code) { statusEl.textContent = "Coupon code is required."; statusEl.style.color = "var(--color-danger)"; return; }

    // Prevent duplicate codes (case-insensitive), except when editing that same coupon.
    const duplicate = couponsList.find((c) => c.id !== id && String(c.code || "").toUpperCase() === code);
    if (duplicate) {
      statusEl.textContent = `A coupon with code "${code}" already exists.`;
      statusEl.style.color = "var(--color-danger)";
      return;
    }

    btn.textContent = "Saving..."; btn.disabled = true;
    statusEl.textContent = "";
    try {
      const data = {
        code,
        type: document.getElementById("coupon-type").value,
        value: Number(document.getElementById("coupon-value").value) || 0,
        maxDiscount: document.getElementById("coupon-maxdiscount").value === "" ? null : Number(document.getElementById("coupon-maxdiscount").value),
        minOrderValue: Number(document.getElementById("coupon-minorder").value) || 0,
        expiryDate: document.getElementById("coupon-expiry").value || "",
        active: document.getElementById("coupon-active").checked,
        updatedAt: new Date().toISOString()
      };

      if (id) {
        await updateDoc(doc(db, "coupons", id), data);
      } else {
        data.createdAt = new Date().toISOString();
        await addDoc(collection(db, "coupons"), data);
      }
      resetCouponForm();
      goToSection("store-coupons");
    } catch (err) {
      statusEl.textContent = "Error: " + err.message;
      statusEl.style.color = "var(--color-danger)";
    } finally {
      btn.textContent = "Save Coupon"; btn.disabled = false;
    }
  });

  wireBulkSelect("coupons-table-body", "select-all-coupons", "bulk-delete-coupons-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "coupons", id));
  });

  // ================================================================
  // PRODUCTS
  // ================================================================
  let productsList = [];

  document.getElementById("prod-name").addEventListener("input", (e) => {
    document.getElementById("prod-slug").value = generateSlug(e.target.value);
    renderSeoChecklist();
  });

  // Lightweight Yoast-style checklist: purely a writing aid for the admin —
  // none of this is sent to Google. It just checks whether the focus
  // keyphrase actually shows up where it matters (title/description/slug/short desc).
  function renderSeoChecklist() {
    const list = document.getElementById("prod-seo-checklist");
    if (!list) return;
    const kp = (document.getElementById("prod-keyphrase").value || "").trim().toLowerCase();
    const seoTitle = (document.getElementById("prod-seo-title").value || document.getElementById("prod-name").value || "").toLowerCase();
    const seoDesc = (document.getElementById("prod-seo-desc").value || (typeof sdRTE !== "undefined" ? sdRTE.getText() : "") || "").toLowerCase();
    const slug = (document.getElementById("prod-slug").value || "").toLowerCase();

    if (!kp) { list.innerHTML = '<li style="color:#888;">Add a focus keyphrase to see SEO checks.</li>'; return; }

    const checks = [
      { label: "In SEO Title", ok: seoTitle.includes(kp) },
      { label: "In SEO Description", ok: seoDesc.includes(kp) },
      { label: "In URL slug", ok: slug.includes(generateSlug(kp)) },
      { label: `Title length ok (${seoTitle.length}/70)`, ok: seoTitle.length > 0 && seoTitle.length <= 70 },
      { label: `Description length ok (${seoDesc.length}/165)`, ok: seoDesc.length >= 50 && seoDesc.length <= 165 },
    ];
    list.innerHTML = checks.map(c =>
      `<li style="color:${c.ok ? 'var(--color-success, #1a7f37)' : 'var(--color-danger, #c0392b)'};">${c.ok ? '✓' : '✗'} ${c.label}</li>`
    ).join("");
  }
  ["prod-keyphrase", "prod-seo-title", "prod-seo-desc", "prod-slug"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderSeoChecklist);
  });
  document.getElementById("sd-content-visual").addEventListener("input", renderSeoChecklist);
  document.getElementById("prod-feature-img").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("prod-feature-preview"), 1));
  document.getElementById("prod-gallery-imgs").addEventListener("change", (e) => {
    const newFiles = Array.from(e.target.files || []);
    pendingGalleryFiles = pendingGalleryFiles.concat(newFiles).slice(0, 5);
    renderGalleryPreview();
    e.target.value = ""; // reset so picking the very same file again still fires "change"
  });
  document.getElementById("prod-delivery-img").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("prod-delivery-preview"), 1));

  // ----------------------------------------------------------------
  // Generic rich-text editor factory — same Visual/Code, execCommand-
  // driven approach as the Blog/Page editors elsewhere in this file,
  // but built as a reusable function instead of hand-wired a third time.
  // Everything is scoped to the passed-in elements (querySelector calls
  // run WITHIN toolbarEl, not document-wide), so this can safely coexist
  // with the blog/page editors even though they share the same
  // `.rte-btn` class names.
  // ----------------------------------------------------------------
  function createRTE({ cmdAttr, toolbarEl, visualEl, codeEl, tabButtons, linkBtnId,
    blockSelectId, fontSizeSelectId, imageBtnId, imageFileId, imgToolbarEl, imgSizeAttr, imgAlignAttr, imgCaptionId, imgRemoveId }) {
    let activeTab = "visual";
    let syncTimer = null;
    let selectedImage = null;

    function syncCodeFromVisual() { codeEl.value = visualEl.innerHTML; }
    function syncVisualFromCode() { visualEl.innerHTML = codeEl.value; }
    function scheduleSync(from) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => { from === "visual" ? syncCodeFromVisual() : syncVisualFromCode(); }, 400);
    }
    visualEl.addEventListener("input", () => scheduleSync("visual"));
    codeEl.addEventListener("input", () => scheduleSync("code"));

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.sdrteTab || btn.dataset.ldrteTab;
        if (tab === activeTab) return;
        clearTimeout(syncTimer);
        activeTab === "visual" ? syncCodeFromVisual() : syncVisualFromCode();
        activeTab = tab;
        tabButtons.forEach((b) => b.classList.toggle("active", b === btn));
        visualEl.hidden = tab !== "visual";
        codeEl.hidden = tab !== "code";
        if (tab === "visual") { hideImageToolbar(); visualEl.focus(); } else { codeEl.focus(); }
      });
    });

    toolbarEl.querySelectorAll(`.rte-btn[${cmdAttr}]`).forEach((btn) => {
      btn.addEventListener("click", () => {
        visualEl.focus();
        document.execCommand(btn.getAttribute(cmdAttr), false, null);
        syncCodeFromVisual();
      });
    });

    if (blockSelectId) {
      const sel = document.getElementById(blockSelectId);
      sel.addEventListener("change", (e) => {
        const val = e.target.value;
        e.target.selectedIndex = 0;
        if (!val) return;
        visualEl.focus();
        document.execCommand("formatBlock", false, val);
        syncCodeFromVisual();
      });
    }

    const FONT_SIZE_MAP = { "rte-fs-sm": "2", "rte-fs-normal": "3", "rte-fs-lg": "5", "rte-fs-xl": "7" };
    if (fontSizeSelectId) {
      const sel = document.getElementById(fontSizeSelectId);
      sel.addEventListener("change", (e) => {
        const cls = e.target.value;
        e.target.selectedIndex = 0;
        if (!cls) return;
        visualEl.focus();
        document.execCommand("fontSize", false, FONT_SIZE_MAP[cls] || "3");
        visualEl.querySelectorAll("font[size]").forEach((f) => {
          const span = document.createElement("span");
          span.className = cls;
          while (f.firstChild) span.appendChild(f.firstChild);
          f.replaceWith(span);
        });
        syncCodeFromVisual();
      });
    }

    if (linkBtnId) {
      document.getElementById(linkBtnId).addEventListener("click", () => {
        const url = prompt("Link URL:", "https://");
        if (!url) return;
        visualEl.focus();
        document.execCommand("createLink", false, url);
        syncCodeFromVisual();
      });
    }

    function hideImageToolbar() {
      if (selectedImage) selectedImage.classList.remove("rte-img--selected");
      selectedImage = null;
      if (imgToolbarEl) imgToolbarEl.hidden = true;
    }

    if (imageBtnId) {
      const fileInput = document.getElementById(imageFileId);
      document.getElementById(imageBtnId).addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        e.target.value = "";
        if (!file) return;
        try {
          const url = await uploadToImgBB(file);
          visualEl.focus();
          const html = `<img src="${esc(url)}" class="rte-img--medium rte-img--center" alt="">`;
          if (!document.execCommand("insertHTML", false, html)) visualEl.insertAdjacentHTML("beforeend", html);
          syncCodeFromVisual();
        } catch (err) {
          alert("Image upload failed: " + err.message);
        }
      });

      function showImageToolbar(img) {
        selectedImage = img;
        visualEl.querySelectorAll("img").forEach((el) => el.classList.remove("rte-img--selected"));
        img.classList.add("rte-img--selected");
        imgToolbarEl.hidden = false;
        document.getElementById(imgCaptionId).value = img.closest("figure")?.querySelector("figcaption")?.textContent || "";
      }
      visualEl.addEventListener("click", (e) => { e.target.tagName === "IMG" ? showImageToolbar(e.target) : hideImageToolbar(); });

      imgToolbarEl.querySelectorAll(`[${imgSizeAttr}]`).forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!selectedImage) return;
          selectedImage.classList.remove("rte-img--small", "rte-img--medium", "rte-img--large", "rte-img--full");
          selectedImage.classList.add(`rte-img--${btn.getAttribute(imgSizeAttr)}`);
          syncCodeFromVisual();
        });
      });
      imgToolbarEl.querySelectorAll(`[${imgAlignAttr}]`).forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!selectedImage) return;
          selectedImage.classList.remove("rte-img--left", "rte-img--center", "rte-img--right");
          selectedImage.classList.add(`rte-img--${btn.getAttribute(imgAlignAttr)}`);
          syncCodeFromVisual();
        });
      });
      document.getElementById(imgCaptionId).addEventListener("change", (e) => {
        if (!selectedImage) return;
        let figure = selectedImage.closest("figure");
        if (!e.target.value) {
          if (figure) { figure.replaceWith(selectedImage); }
        } else {
          if (!figure) {
            figure = document.createElement("figure");
            selectedImage.replaceWith(figure);
            figure.appendChild(selectedImage);
          }
          let cap = figure.querySelector("figcaption");
          if (!cap) { cap = document.createElement("figcaption"); figure.appendChild(cap); }
          cap.textContent = e.target.value;
        }
        syncCodeFromVisual();
      });
      document.getElementById(imgRemoveId).addEventListener("click", () => {
        if (!selectedImage) return;
        (selectedImage.closest("figure") || selectedImage).remove();
        hideImageToolbar();
        syncCodeFromVisual();
      });
    }

    return {
      getHTML() { return activeTab === "visual" ? visualEl.innerHTML : codeEl.value; },
      setHTML(html) { visualEl.innerHTML = html || ""; codeEl.value = html || ""; },
      getText() { return visualEl.textContent || ""; }
    };
  }

  const sdRTE = createRTE({
    cmdAttr: "data-sdcmd",
    toolbarEl: document.getElementById("sd-rte-toolbar"),
    visualEl: document.getElementById("sd-content-visual"),
    codeEl: document.getElementById("sd-content-code"),
    tabButtons: Array.from(document.querySelectorAll('[data-sdrte-tab]')),
    linkBtnId: "sd-rte-link-btn"
  });

  const ldRTE = createRTE({
    cmdAttr: "data-ldcmd",
    toolbarEl: document.getElementById("ld-rte-toolbar"),
    visualEl: document.getElementById("ld-content-visual"),
    codeEl: document.getElementById("ld-content-code"),
    tabButtons: Array.from(document.querySelectorAll('[data-ldrte-tab]')),
    linkBtnId: "ld-rte-link-btn",
    blockSelectId: "ld-rte-block-select",
    fontSizeSelectId: "ld-rte-fontsize-select",
    imageBtnId: "ld-rte-image-btn",
    imageFileId: "ld-rte-image-file",
    imgToolbarEl: document.getElementById("ld-rte-img-toolbar"),
    imgSizeAttr: "data-ldimgsize",
    imgAlignAttr: "data-ldimgalign",
    imgCaptionId: "ld-rte-img-caption",
    imgRemoveId: "ld-rte-img-remove"
  });

  sdRTE.setHTML("");
  ldRTE.setHTML("");

  // ----------------------------------------------------------------
  // Auto Fetch — pulls title/description/main image from the pasted
  // Source Platform URL via api/import-product.js (og:title/og:description/
  // og:image, the same way a WhatsApp link preview is built). One-time
  // prefill, not a live sync — price/stock are never touched, the admin
  // always sets those. Was previously only reachable via the separate
  // product-import-tester.html; now available directly on the form.
  // ----------------------------------------------------------------
  function dataURLtoFile(dataUrl, filename) {
    const [header, base64] = dataUrl.split(",");
    const mime = /data:(.*?);base64/.exec(header)?.[1] || "image/jpeg";
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  }

  document.getElementById("auto-fetch-btn").addEventListener("click", async () => {
    const url = document.getElementById("prod-source-url").value.trim();
    const status = document.getElementById("auto-fetch-status");
    const btn = document.getElementById("auto-fetch-btn");
    if (!url) { alert("Paste a Source Platform URL first."); return; }

    const titleFilled = document.getElementById("prod-name").value.trim();
    const descFilled = sdRTE.getText().trim();
    if ((titleFilled || descFilled) && !confirm("This will overwrite the Name/Short Description/Feature Image already in this form with what's fetched from that URL. Continue?")) return;

    const originalText = btn.textContent;
    btn.disabled = true; btn.textContent = "Fetching...";
    status.textContent = "Fetching that page and reading its tags...";
    status.style.color = "var(--color-ink-soft)";
    if (window.LoadingOverlay) window.LoadingOverlay.show();

    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(`/api/import-product?url=${encodeURIComponent(url)}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

      if (data.title) {
        document.getElementById("prod-name").value = data.title;
        document.getElementById("prod-slug").value = generateSlug(data.title);
      }
      if (data.description) sdRTE.setHTML(data.description);

      if (data.imageDataUrl) {
        const file = dataURLtoFile(data.imageDataUrl, "auto-fetch-image.jpg");
        status.textContent = "Uploading fetched image...";
        const hostedUrl = await uploadToImgBB(file);
        const existing = JSON.parse(document.getElementById("prod-existing-images").value || "[]");
        existing[0] = hostedUrl; // replace feature image, keep any gallery images already there
        document.getElementById("prod-existing-images").value = JSON.stringify(existing);
        previewExistingImages(document.getElementById("prod-feature-preview"), [hostedUrl]);
      }

      renderSeoChecklist();
      status.textContent = "✓ Fetched — review the Name/Short Description/Image above, then set your own price, stock and category.";
      status.style.color = "var(--color-success, #1a7f37)";
    } catch (err) {
      status.textContent = "Couldn't auto-fetch: " + err.message;
      status.style.color = "var(--color-danger)";
    } finally {
      btn.disabled = false; btn.textContent = originalText;
      if (window.LoadingOverlay) window.LoadingOverlay.hide();
    }
  });

  function resetProductForm() {
    document.getElementById("product-form").reset();
    document.getElementById("prod-id").value = "";
    document.getElementById("prod-existing-images").value = "";
    document.getElementById("prod-existing-delivery-img").value = "";
    document.getElementById("prod-feature-preview").innerHTML = "";
    pendingGalleryFiles = [];
    document.getElementById("prod-gallery-preview").innerHTML = "";
    document.getElementById("prod-delivery-preview").innerHTML = "";
    document.getElementById("product-form-title").textContent = "Add New Product";
    sdRTE.setHTML("");
    ldRTE.setHTML("");
    // Variant state
    document.getElementById("prod-is-variant").value = "";
    document.getElementById("prod-parent-id").value = "";
    document.getElementById("prod-variant-color").value = "";
    document.getElementById("variant-top-pricing-wrap").style.display = "";
    document.getElementById("prod-mrp").required = false;
    document.getElementById("prod-price").required = true;
    document.getElementById("prod-stock").required = true;
    document.getElementById("variants-toggle-wrap").style.display = "";
    document.getElementById("prod-has-variants").checked = false;
    document.getElementById("variants-section").style.display = "none";
    document.getElementById("variant-add-color-wrap").style.display = "";
    document.getElementById("variant-boxes-container").innerHTML = "";
    document.getElementById("variant-sizes-input").value = "";
    document.getElementById("variant-colors-input").value = "";
    document.getElementById("variant-sync-wrap").style.display = "none";
    renderSeoChecklist();
    updateProductPricePreview();
  }

  let unsubProducts = null;
  function listenProducts() {
    if (unsubProducts) return;
    unsubProducts = onSnapshot(collection(db, "products"), (snap) => {
      productsList = [];
      snap.forEach((d) => productsList.push({ id: d.id, ...d.data() }));
      renderProductsTable();
      renderDashboard();
      renderAnalytics();
    }, (err) => console.error("products listener error", err));
  }

  // Which parent products currently have their variant rows expanded —
  // module-level so it survives a re-render (e.g. after a Firestore
  // update) instead of collapsing everything the admin had open.
  const expandedProductParents = new Set();

  function buildProductRow(p, opts) {
    const sColor = p.status === "active" ? "var(--color-success)" : "var(--color-accent-dark)";
    const img = (p.images && p.images[0]) ? p.images[0] : "images/logo-placeholder.svg";
    const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "—";
    const missingCostPrice = p.costPrice === undefined || p.costPrice === null || p.costPrice === 0;
    const isExpanded = expandedProductParents.has(p.id);

    const nameCell = opts.isChild
      ? `<span style="padding-left:24px; color:var(--color-ink-soft);">↳ ${esc(p.size || "")} / ${esc(p.color || "")} — </span>${esc(p.title)}`
      : `${opts.hasChildren ? `<button type="button" class="product-expand-btn" data-id="${p.id}" style="background:none; border:none; cursor:pointer; font-size:0.85rem; margin-right:6px; transform:rotate(${isExpanded ? "90deg" : "0deg"}); transition:transform .15s;">▸</button>` : `<span style="display:inline-block; width:18px;"></span>`}${esc(p.title)}`;

    const tr = document.createElement("tr");
    if (opts.isChild) tr.style.background = "#fafaf7";
    tr.innerHTML = `
      <td><input type="checkbox" class="row-select" data-id="${p.id}"></td>
      <td><img src="${esc(img)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" alt=""></td>
      <td>${nameCell}${missingCostPrice ? ` <span title="Cost Price not set — profit reports will show N/A for this product until you add it in Edit" style="color:var(--color-accent-dark); font-size:0.8rem; white-space:nowrap;">⚠ Cost price missing</span>` : ""}${(!opts.isChild && p.hasVariants) ? ` <span style="color:var(--color-ink-soft); font-size:0.78rem;">(${opts.childCount} color${opts.childCount === 1 ? "" : "s"})</span>` : ""}</td>
      <td>${esc(p.brand || "—")}</td>
      <td>${esc((p.tags || []).join(", "))}</td>
      <td>${esc(p.category)}</td>
      <td>${dateStr}</td>
      <td style="color:${p.stock > 0 ? 'inherit' : 'var(--color-danger)'}; font-weight:bold;">${(!opts.isChild && p.hasVariants) ? "—" : p.stock}</td>
      <td style="color:${sColor}; font-weight:bold;">${esc((p.status || "").toUpperCase())}</td>
      <td>${p.sourcePlatformUrl ? `<button class="btn btn-outline source-platform-btn" data-url="${esc(p.sourcePlatformUrl)}" style="padding:4px 8px; font-size:0.8rem;">Source Platform</button>` : '<span style="color:var(--color-ink-soft); font-size:0.8rem;">—</span>'}</td>
      <td>${
        opts.isChild
          ? `<button class="btn btn-outline sync-variant-btn" data-id="${p.id}" title="Pull Name, Description, Category, Brand, Tags, Delivery info and Images from the parent, then publish" style="padding:4px 8px; font-size:0.8rem;">🔄 Auto Sync</button>`
          : (opts.hasChildren
              ? `<button class="btn btn-outline sync-all-btn" data-id="${p.id}" title="Auto Sync every variant of this product from the parent, then publish them all" style="padding:4px 8px; font-size:0.8rem;">🔄 Sync All</button>`
              : '<span style="color:var(--color-ink-soft); font-size:0.8rem;">—</span>')
      }</td>
      <td>
        <button class="btn btn-outline pause-prod-btn" data-id="${p.id}" data-status="${p.status}" style="padding:4px 8px; font-size:0.8rem;">${p.status === 'active' ? 'Pause' : 'Live'}</button>
        <button class="btn btn-outline edit-prod-btn" data-id="${p.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
        <button class="btn btn-outline del-prod-btn" data-id="${p.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
      </td>`;
    return tr;
  }

  // A COLOR group row — one per color, no matter how many sizes it has.
  // This is the "sub product" row the admin actually thinks of as a
  // product; its individual sizes are only edited inside the parent's
  // Edit form (Variants section), not as separate rows here.
  function buildColorGroupRow(parent, color, docs) {
    const rep = docs.find((d) => d.stock > 0) || docs[0];
    const totalStock = docs.reduce((s, d) => s + (Number(d.stock) || 0), 0);
    const sizesLabel = docs.map((d) => d.size).filter(Boolean).join(", ");
    const sColor = rep.status === "active" ? "var(--color-success)" : "var(--color-accent-dark)";
    const img = (rep.images && rep.images[0]) ? rep.images[0] : "images/logo-placeholder.svg";
    const dateStr = rep.createdAt ? new Date(rep.createdAt).toLocaleDateString("en-IN") : "—";
    const missingCostPrice = rep.costPrice === undefined || rep.costPrice === null || rep.costPrice === 0;

    const tr = document.createElement("tr");
    tr.style.background = "#fafaf7";
    tr.innerHTML = `
      <td></td>
      <td><img src="${esc(img)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" alt=""></td>
      <td><span style="padding-left:24px; color:var(--color-ink-soft);">↳ ${esc(color || "(no color)")} — </span>${esc(rep.title)}${missingCostPrice ? ` <span title="Cost Price not set — profit reports will show N/A for this product until you add it in Edit" style="color:var(--color-accent-dark); font-size:0.8rem; white-space:nowrap;">⚠ Cost price missing</span>` : ""} <span style="color:var(--color-ink-soft); font-size:0.78rem;">(${docs.length} size${docs.length === 1 ? "" : "s"}${sizesLabel ? ": " + esc(sizesLabel) : ""})</span></td>
      <td>${esc(rep.brand || "—")}</td>
      <td>${esc((rep.tags || []).join(", "))}</td>
      <td>${esc(rep.category)}</td>
      <td>${dateStr}</td>
      <td style="color:${totalStock > 0 ? 'inherit' : 'var(--color-danger)'}; font-weight:bold;">${totalStock}</td>
      <td style="color:${sColor}; font-weight:bold;">${esc((rep.status || "").toUpperCase())}</td>
      <td>${rep.sourcePlatformUrl ? `<button class="btn btn-outline source-platform-btn" data-url="${esc(rep.sourcePlatformUrl)}" style="padding:4px 8px; font-size:0.8rem;">Source Platform</button>` : '<span style="color:var(--color-ink-soft); font-size:0.8rem;">—</span>'}</td>
      <td><button class="btn btn-outline sync-color-btn" data-parent="${parent.id}" data-color="${esc(color)}" title="Pull Name, Description, Category, Brand, Tags, Delivery info and Images from the parent for every size in this color, then publish" style="padding:4px 8px; font-size:0.8rem;">🔄 Auto Sync</button></td>
      <td>
        <button class="btn btn-outline pause-color-btn" data-parent="${parent.id}" data-color="${esc(color)}" data-status="${rep.status}" style="padding:4px 8px; font-size:0.8rem;">${rep.status === 'active' ? 'Pause' : 'Live'}</button>
        <button class="btn btn-outline edit-color-btn" data-parent="${parent.id}" data-color="${esc(color)}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
        <button class="btn btn-outline del-color-btn" data-parent="${parent.id}" data-color="${esc(color)}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
      </td>`;
    return tr;
  }

  function renderProductsTable() {
    const tbody = document.getElementById("products-table-body");
    tbody.innerHTML = "";
    const topLevel = productsList.filter((p) => !p.isVariant);

    topLevel.forEach((p) => {
      const children = p.hasVariants ? productsList.filter((c) => c.isVariant && c.parentId === p.id) : [];
      const byColor = new Map();
      children.forEach((c) => {
        const key = c.color || "";
        if (!byColor.has(key)) byColor.set(key, []);
        byColor.get(key).push(c);
      });
      tbody.appendChild(buildProductRow(p, { isChild: false, hasChildren: byColor.size > 0, childCount: byColor.size }));
      if (byColor.size > 0 && expandedProductParents.has(p.id)) {
        byColor.forEach((docs, color) => tbody.appendChild(buildColorGroupRow(p, color, docs)));
      }
    });

    tbody.querySelectorAll(".product-expand-btn").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.id;
      if (expandedProductParents.has(id)) expandedProductParents.delete(id); else expandedProductParents.add(id);
      renderProductsTable();
    }));
    tbody.querySelectorAll(".pause-prod-btn").forEach((b) => b.addEventListener("click", () => toggleProductStatus(b.dataset.id, b.dataset.status)));
    tbody.querySelectorAll(".edit-prod-btn").forEach((b) => b.addEventListener("click", () => editProduct(b.dataset.id)));
    tbody.querySelectorAll(".del-prod-btn").forEach((b) => b.addEventListener("click", () => deleteProduct(b.dataset.id)));
    tbody.querySelectorAll(".source-platform-btn").forEach((b) => b.addEventListener("click", () => window.open(b.dataset.url, "_blank", "noopener,noreferrer")));
    tbody.querySelectorAll(".sync-variant-btn").forEach((b) => b.addEventListener("click", () => syncVariantFromListRow(b.dataset.id)));
    tbody.querySelectorAll(".sync-all-btn").forEach((b) => b.addEventListener("click", () => syncAllVariantsFromListRow(b.dataset.id)));

    // Color-group row actions — every one of these acts on ALL size docs
    // sharing that (parentId, color) pair at once.
    function colorGroupDocs(parentId, color) {
      return productsList.filter((c) => c.isVariant && c.parentId === parentId && (c.color || "") === color);
    }
    tbody.querySelectorAll(".edit-color-btn").forEach((b) => b.addEventListener("click", () => {
      const parentId = b.dataset.parent, color = b.dataset.color;
      const rep = colorGroupDocs(parentId, color)[0];
      if (rep) editProduct(rep.id);
    }));
    tbody.querySelectorAll(".del-color-btn").forEach((b) => b.addEventListener("click", async () => {
      const parentId = b.dataset.parent, color = b.dataset.color;
      const docs = colorGroupDocs(parentId, color);
      if (!confirm(`Delete the "${color}" color — ALL ${docs.length} size${docs.length === 1 ? "" : "s"} — permanently? This cannot be undone.`)) return;
      for (const d of docs) await deleteDoc(doc(db, "products", d.id));
    }));
    tbody.querySelectorAll(".pause-color-btn").forEach((b) => b.addEventListener("click", async () => {
      const parentId = b.dataset.parent, color = b.dataset.color, currentStatus = b.dataset.status;
      const newStatus = currentStatus === "active" ? "draft" : "active";
      const docs = colorGroupDocs(parentId, color);
      for (const d of docs) await updateDoc(doc(db, "products", d.id), { status: newStatus });
    }));
    tbody.querySelectorAll(".sync-color-btn").forEach((b) => b.addEventListener("click", async () => {
      const parentId = b.dataset.parent, color = b.dataset.color;
      const docs = colorGroupDocs(parentId, color);
      const original = b.textContent;
      b.textContent = "Syncing..."; b.disabled = true;
      try {
        for (const d of docs) await syncOneVariant(d.id);
      } catch (err) {
        alert("Couldn't sync: " + err.message);
      } finally {
        b.textContent = original; b.disabled = false;
      }
    }));
  }

  // Same field-sync as the "🔄 Auto Sync from Parent" button inside Edit
  // (buildVariantSyncPatch above), but callable straight from the All
  // Products table without opening Edit first — and this version also
  // publishes the variant (status: "active") once synced, per the
  // "sync + save + publish in one click" request.
  async function syncOneVariant(variantId) {
    const variant = productsList.find((p) => p.id === variantId);
    if (!variant || !variant.isVariant || !variant.parentId) {
      throw new Error("This isn't a variant product.");
    }
    const parent = productsList.find((p) => p.id === variant.parentId);
    if (!parent) throw new Error("Can't find the parent product — it may have been deleted.");
    const syncPatch = { ...buildVariantSyncPatch(parent), status: "active" };
    await updateDoc(doc(db, "products", variantId), syncPatch);
  }

  async function syncVariantFromListRow(variantId) {
    const btn = document.querySelector(`.sync-variant-btn[data-id="${variantId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "Syncing..."; }
    try {
      await syncOneVariant(variantId);
      if (btn) { btn.textContent = "Synced ✓"; }
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = "🔄 Auto Sync"; } }, 1200);
    } catch (err) {
      alert("Couldn't sync: " + err.message);
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Auto Sync"; }
    }
  }

  async function syncAllVariantsFromListRow(parentId) {
    const children = productsList.filter((p) => p.isVariant && p.parentId === parentId);
    if (children.length === 0) return;
    if (!confirm(`Auto Sync all ${children.length} variant(s) of this product from the parent's current Name, Description, Category, Brand, Tags, Delivery info and Images, then publish them all?`)) return;
    const btn = document.querySelector(`.sync-all-btn[data-id="${parentId}"]`);
    if (btn) { btn.disabled = true; btn.textContent = "Syncing..."; }
    try {
      for (const child of children) await syncOneVariant(child.id);
      if (btn) { btn.textContent = "Synced ✓"; }
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = "🔄 Sync All"; } }, 1200);
    } catch (err) {
      alert("Couldn't sync all variants: " + err.message);
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Sync All"; }
    }
  }

  function editProduct(id) {
    const p = productsList.find((x) => x.id === id);
    if (!p) return;
    pendingGalleryFiles = [];
    document.getElementById("prod-gallery-preview").innerHTML = "";
    document.getElementById("prod-id").value = id;
    document.getElementById("prod-name").value = p.title || "";
    document.getElementById("prod-slug").value = p.slug || "";
    document.getElementById("prod-keyphrase").value = p.keyphrase || "";
    document.getElementById("prod-seo-title").value = p.seoTitle || "";
    document.getElementById("prod-seo-desc").value = p.seoDesc || "";
    document.getElementById("prod-mrp").value = p.mrp ?? "";
    document.getElementById("prod-price").value = p.sellingPrice ?? "";
    updateProductPricePreview();
    // Older products saved before this field existed won't have it —
    // leave blank rather than defaulting to 0, so the admin notices and
    // fills in the real number instead of accidentally saving "free".
    document.getElementById("prod-cost-price").value = (p.costPrice !== undefined && p.costPrice !== null) ? p.costPrice : "";
    document.getElementById("prod-stock").value = p.stock ?? "";
    document.getElementById("prod-tags").value = (p.tags || []).join(", ");
    document.getElementById("prod-sku").value = p.sku || "";
    document.getElementById("prod-hsn").value = p.hsnCode || "";
    document.getElementById("prod-source-url").value = p.sourcePlatformUrl || "";
    sdRTE.setHTML(p.shortDescription || "");
    ldRTE.setHTML(p.description || "");
    document.getElementById("prod-delivery-fee").value = p.deliveryFee ?? 0;
    document.getElementById("prod-delivery-partner-name").value = p.deliveryPartnerName || "";
    document.getElementById("prod-existing-images").value = JSON.stringify(p.images || []);
    document.getElementById("prod-existing-delivery-img").value = p.deliveryPartnerImage || "";
    function refreshFeaturePreview() {
      const imgs = JSON.parse(document.getElementById("prod-existing-images").value || "[]");
      previewExistingImages(document.getElementById("prod-feature-preview"), imgs[0] ? [imgs[0]] : [], () => {
        imgs[0] = "";
        document.getElementById("prod-existing-images").value = JSON.stringify(imgs);
        refreshFeaturePreview();
      });
    }
    function refreshGalleryExistingPreview() {
      const imgs = JSON.parse(document.getElementById("prod-existing-images").value || "[]");
      previewExistingImages(document.getElementById("prod-gallery-preview"), imgs.slice(1), (idx) => {
        imgs.splice(1 + idx, 1);
        document.getElementById("prod-existing-images").value = JSON.stringify(imgs);
        refreshGalleryExistingPreview();
      });
    }
    function refreshDeliveryLogoPreview() {
      const url = document.getElementById("prod-existing-delivery-img").value;
      previewExistingImages(document.getElementById("prod-delivery-preview"), url ? [url] : [], () => {
        document.getElementById("prod-existing-delivery-img").value = "";
        refreshDeliveryLogoPreview();
      });
    }
    refreshFeaturePreview();
    refreshGalleryExistingPreview();
    refreshDeliveryLogoPreview();
    setTimeout(() => {
      document.getElementById("prod-category").value = p.category || "";
      document.getElementById("prod-brand").value = p.brand || "";
    }, 100);

    // Variant-related form state — two cases: editing one COLOR of a
    // variant family (isVariant), or a plain product / the parent
    // template of a variant family (hasVariants, possibly false).
    document.getElementById("prod-is-variant").value = p.isVariant ? "1" : "";
    document.getElementById("prod-parent-id").value = p.parentId || "";
    if (p.isVariant) {
      // Per-doc pricing fields are meaningless here — every size in this
      // color has its OWN price/stock/HSN/etc, edited in the box below —
      // so hide them and drop their `required` (they're not part of the
      // form being submitted in this mode).
      document.getElementById("variant-top-pricing-wrap").style.display = "none";
      document.getElementById("prod-mrp").required = false;
      document.getElementById("prod-price").required = false;
      document.getElementById("prod-stock").required = false;

      // A color can't itself have other colors — that's parent-only.
      document.getElementById("variants-toggle-wrap").style.display = "none";
      document.getElementById("prod-has-variants").checked = false;

      document.getElementById("variant-sync-wrap").style.display = p.parentId ? "" : "none";

      // Show the box UI, but scoped to ONLY this one color — no "add a
      // different color" controls here (that's a parent-level action).
      document.getElementById("variants-section").style.display = "";
      document.getElementById("variant-add-color-wrap").style.display = "none";
      document.getElementById("variants-section-title").textContent = `Sizes for "${p.color || ""}"`;
      document.getElementById("variants-section-hint").textContent = `Every size below belongs ONLY to "${p.color || ""}" — add, remove, or reprice a size here without touching any other color. Renaming the Color field and saving relabels this whole product (all its sizes) to the new name.`;
      document.getElementById("prod-variant-color").value = p.color || "";
      document.getElementById("variant-boxes-container").innerHTML = "";
      const sameColorDocs = productsList.filter((c) => c.isVariant && c.parentId === p.parentId && (c.color || "") === (p.color || ""));
      document.getElementById("variant-boxes-container").appendChild(buildColorBox(p.color || "", sameColorDocs));
    } else {
      document.getElementById("variant-top-pricing-wrap").style.display = "";
      document.getElementById("prod-mrp").required = false;
      document.getElementById("prod-price").required = true;
      document.getElementById("prod-stock").required = true;
      document.getElementById("variant-sync-wrap").style.display = "none";
      document.getElementById("variants-toggle-wrap").style.display = "";
      document.getElementById("prod-has-variants").checked = !!p.hasVariants;
      document.getElementById("variants-section").style.display = p.hasVariants ? "" : "none";
      document.getElementById("variant-add-color-wrap").style.display = "";
      document.getElementById("variants-section-title").textContent = "Variants";
      document.getElementById("variants-section-hint").textContent = "A different COLOR is a different product on the site — each color gets its own box below and its own page. Sizes are NOT separate products: every size lives inside its color's box, with its own stock and (optionally) its own price, so you can add/remove a size or change its price without touching the others.";
      document.getElementById("variant-sizes-input").value = "";
      document.getElementById("variant-colors-input").value = "";
      document.getElementById("variant-boxes-container").innerHTML = "";
      if (p.hasVariants) populateVariantBoxesForParent(id);
    }

    document.getElementById("product-form-title").textContent = p.isVariant ? `Edit "${p.color || ""}"` : "Edit Product";
    renderSeoChecklist();
    goToSection("store-add-product");
  }

  // Ensures no two products share a slug — if "terracotta-diya-set" is taken,
  // tries "terracotta-diya-set-2", "-3", etc. `excludeId` lets an edit keep its own slug.
  function ensureUniqueSlug(baseSlug, excludeId) {
    // Variants don't use `slug` for routing (they use parentId +
    // variantSlug), so they're excluded here too — belt and suspenders
    // alongside not writing `slug` onto them in the first place.
    const taken = new Set(
      productsList.filter((p) => p.id !== excludeId && !p.isVariant).map((p) => p.slug).filter(Boolean)
    );
    if (!taken.has(baseSlug)) return baseSlug;
    let n = 2;
    while (taken.has(`${baseSlug}-${n}`)) n++;
    return `${baseSlug}-${n}`;
  }

  async function toggleProductStatus(id, currentStatus) {
    const newStatus = currentStatus === "active" ? "draft" : "active";
    await updateDoc(doc(db, "products", id), { status: newStatus });
  }

  async function deleteProduct(id) {
    const p = productsList.find((x) => x.id === id);
    const children = p && p.hasVariants ? productsList.filter((c) => c.isVariant && c.parentId === id) : [];

    if (children.length > 0) {
      const choice = confirm(
        `This product has ${children.length} variant(s). Press OK to delete the product AND all ${children.length} variant(s), or Cancel to keep them (you can delete each variant individually instead).`
      );
      if (!choice) return;
      for (const c of children) await deleteDoc(doc(db, "products", c.id));
      await deleteDoc(doc(db, "products", id));
      return;
    }

    if (!confirm("Delete this product permanently?")) return;
    await deleteDoc(doc(db, "products", id));
  }

  async function handleProductSave(status) {
    const title = document.getElementById("prod-name").value.trim();
    if (!title) return alert("Product name is required");
    if (!document.getElementById("prod-category").value) return alert("Please select a category");
    if (document.getElementById("prod-cost-price").value.trim() === "") {
      return alert("Cost Price is required — it's what you pay for this product, used to calculate profit in reports. It's never shown to customers.");
    }
    if (!sdRTE.getText().trim()) return alert("Short Description is required");

    const isVariant = document.getElementById("prod-is-variant").value === "1";
    const hasVariants = !isVariant && variantsToggle.checked;
    // A single color's scoped edit uses the exact same box UI as the
    // parent's — just with one box in it — so both paths process
    // `variantBoxesContainer` the same way.
    const usesColorBoxes = hasVariants || isVariant;
    const colorBoxes = usesColorBoxes ? Array.from(variantBoxesContainer.children) : [];
    if (usesColorBoxes) {
      if (colorBoxes.length === 0) {
        alert(isVariant ? "Add at least one size, or use Delete Color on the products list to remove this color entirely." : "Add at least one color, or turn off \"This product has variants\".");
        return;
      }
      for (const box of colorBoxes) {
        const colorVal = box.querySelector(".vc-color-input").value.trim();
        if (!colorVal) { alert("Every color box needs a color name."); return; }
        const rows = Array.from(box.querySelectorAll(".size-row"));
        if (rows.length === 0) { alert(`Add at least one size for "${colorVal}", or remove that color.`); return; }
        for (const row of rows) {
          if (row.querySelector(".sr-size").value.trim() === "") {
            alert(`Every size row for "${colorVal}" needs a size name.`);
            return;
          }
          if (row.querySelector(".sr-stock").value.trim() === "") {
            alert(`Stock is required for ${colorVal} / ${row.querySelector(".sr-size").value.trim()}.`);
            return;
          }
        }
      }
    }

    const saveBtn = status === "active" ? document.getElementById("publish-prod-btn") : document.getElementById("draft-prod-btn");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Uploading..."; saveBtn.disabled = true;
    document.getElementById("product-save-status").textContent = "";
    if (window.LoadingOverlay) window.LoadingOverlay.show();

    try {
      // Feature + gallery images
      let images = JSON.parse(document.getElementById("prod-existing-images").value || "[]");
      const featureFile = document.getElementById("prod-feature-img").files[0];
      const galleryFiles = pendingGalleryFiles.slice(0, 5);

      if (featureFile) {
        const featureUrl = await uploadToImgBB(featureFile);
        images = [featureUrl, ...images.slice(1)];
      }
      if (galleryFiles.length > 0) {
        const galleryUrls = [];
        for (const f of galleryFiles) galleryUrls.push(await uploadToImgBB(f));
        images = [images[0] || "", ...galleryUrls].filter(Boolean);
      }

      // Delivery partner logo
      let deliveryPartnerImage = document.getElementById("prod-existing-delivery-img").value || "";
      const deliveryFile = document.getElementById("prod-delivery-img").files[0];
      if (deliveryFile) deliveryPartnerImage = await uploadToImgBB(deliveryFile);

      const pId = document.getElementById("prod-id").value;
      const rawSlug = document.getElementById("prod-slug").value.trim() || generateSlug(title);
      const finalSlug = ensureUniqueSlug(generateSlug(rawSlug), pId || null);
      if (finalSlug !== rawSlug) {
        document.getElementById("prod-slug").value = finalSlug;
      }

      const pData = {
        title,
        slug: finalSlug,
        keyphrase: document.getElementById("prod-keyphrase").value.trim(),
        seoTitle: document.getElementById("prod-seo-title").value.trim(),
        seoDesc: document.getElementById("prod-seo-desc").value.trim(),
        category: document.getElementById("prod-category").value,
        brand: document.getElementById("prod-brand").value,
        mrp: Number(document.getElementById("prod-mrp").value) || 0,
        sellingPrice: Number(document.getElementById("prod-price").value) || 0,
        costPrice: Number(document.getElementById("prod-cost-price").value) || 0,
        stock: Number(document.getElementById("prod-stock").value) || 0,
        sku: document.getElementById("prod-sku").value,
        hsnCode: document.getElementById("prod-hsn").value.trim(),
        sourcePlatformUrl: document.getElementById("prod-source-url").value.trim(),
        tags: document.getElementById("prod-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
        shortDescription: sdRTE.getHTML(),
        description: ldRTE.getHTML(),
        deliveryFee: Number(document.getElementById("prod-delivery-fee").value) || 0,
        deliveryPartnerName: document.getElementById("prod-delivery-partner-name").value,
        deliveryPartnerImage,
        images,
        status,
        // Parent-only bookkeeping. A plain product (no variants at all)
        // just carries hasVariants:false harmlessly.
        hasVariants,
        variantAxes: hasVariants ? {
          sizes: document.getElementById("variant-sizes-input").value.split(",").map((s) => s.trim()).filter(Boolean),
          colors: document.getElementById("variant-colors-input").value.split(",").map((c) => c.trim()).filter(Boolean)
        } : null,
        updatedAt: new Date().toISOString()
      };

      const trueParentId = document.getElementById("prod-parent-id").value;
      if (isVariant) {
        // A scoped color edit never touches a top-level "products" doc of
        // its own (pId is just one of several sibling size docs) — the
        // box loop below handles every size doc directly instead. These
        // per-doc pricing fields are hidden/unused in this mode; zeroed
        // here only as a safe fallback if a brand-new size row is left
        // blank (its own box fields are what actually get saved).
        pData.isVariant = true;
        pData.parentId = trueParentId;
        pData.mrp = 0; pData.sellingPrice = 0; pData.stock = 0;
        pData.hsnCode = ""; pData.sourcePlatformUrl = ""; pData.sku = "";
        delete pData.hasVariants;
        delete pData.variantAxes;
      }

      let docId = pId;
      if (!isVariant) {
        if (pId) {
          await updateDoc(doc(db, "products", pId), pData);
        } else {
          pData.createdAt = new Date().toISOString();
          const ref = await addDoc(collection(db, "products"), pData);
          docId = ref.id;
        }
      }

      // Create/update one real product doc PER SIZE, grouped by color box.
      // A color box's `variantSlug` (based on the color name only) is what
      // makes every size inside it land on the SAME product page — that's
      // the whole "one product per color, sizes live inside it" behaviour.
      // Renaming the box's Color field and saving re-patches that new
      // color (and a fresh variantSlug) onto every size doc in the box,
      // which is what makes "this red product is now called pink" a
      // one-step rename instead of a rebuild.
      if (usesColorBoxes) {
        // Shared (non-per-size) fields — applied to every EXISTING size
        // doc only in "scoped" mode (editing one color directly IS
        // editing that product's own live fields). In "parent" mode,
        // existing children are left alone on a plain re-save — that's
        // what the "Auto Sync" button is for — so a parent edit never
        // silently overwrites a live child's content.
        const sharedFields = { ...pData };
        delete sharedFields.slug;
        delete sharedFields.hasVariants;
        delete sharedFields.variantAxes;
        delete sharedFields.mrp;
        delete sharedFields.sellingPrice;
        delete sharedFields.stock;
        delete sharedFields.hsnCode;
        delete sharedFields.sourcePlatformUrl;
        delete sharedFields.sku;
        delete sharedFields.isVariant;
        delete sharedFields.parentId;

        for (const box of colorBoxes) {
          const colorVal = box.querySelector(".vc-color-input").value.trim();
          const variantSlug = slugifyVariant(colorVal);
          const rows = Array.from(box.querySelectorAll(".size-row"));

          for (const row of rows) {
            const size = row.querySelector(".sr-size").value.trim();
            const mrpVal = row.querySelector(".sr-mrp").value.trim();
            const priceVal = row.querySelector(".sr-price").value.trim();
            const hsnVal = row.querySelector(".sr-hsn").value.trim();
            const sourceVal = row.querySelector(".sr-source").value.trim();
            const stockVal = row.querySelector(".sr-stock").value.trim();

            if (row.dataset.existingId) {
              const patch = { size, color: colorVal, variantSlug, stock: Number(stockVal) || 0 };
              if (mrpVal !== "") patch.mrp = Number(mrpVal);
              if (priceVal !== "") patch.sellingPrice = Number(priceVal);
              if (hsnVal !== "") patch.hsnCode = hsnVal;
              if (sourceVal !== "") patch.sourcePlatformUrl = sourceVal;
              if (isVariant) Object.assign(patch, sharedFields);
              await updateDoc(doc(db, "products", row.dataset.existingId), patch);
            } else {
              // New rows (no data-existing-id) get a full copy of
              // everything just saved above, EXCEPT MRP/Sale
              // Price/HSN/Source URL/Stock — those come from the row
              // itself if filled in, or fall back to a one-time snapshot
              // of the shared value if left blank.
              const childData = {
                ...pData,
                isVariant: true,
                parentId: isVariant ? trueParentId : docId,
                size, color: colorVal,
                mrp: mrpVal !== "" ? Number(mrpVal) : pData.mrp,
                sellingPrice: priceVal !== "" ? Number(priceVal) : pData.sellingPrice,
                hsnCode: hsnVal !== "" ? hsnVal : pData.hsnCode,
                sourcePlatformUrl: sourceVal !== "" ? sourceVal : pData.sourcePlatformUrl,
                stock: Number(stockVal) || 0,
                hasVariants: false,
                variantAxes: null,
                variantSlug,
                createdAt: new Date().toISOString()
              };
              // Not `slug` — that field drives /products/:slug routing and
              // ensureUniqueSlug()'s collision check for NORMAL products.
              // A variant is never reached by that route (it uses parentId
              // + variantSlug instead), so copying the parent's slug here
              // would just sit there unused — and worse, on the parent's
              // NEXT save, ensureUniqueSlug() would see its own slug as
              // "already taken" by this child and needlessly append "-2".
              delete childData.slug;
              delete childData.updatedAt;
              await addDoc(collection(db, "products"), childData);
            }
          }
        }
      }

      pendingGalleryFiles = [];
      resetProductForm();
      goToSection("store-products");
    } catch (err) {
      document.getElementById("product-save-status").textContent = "Error: " + err.message;
      document.getElementById("product-save-status").style.color = "var(--color-danger)";
    } finally {
      saveBtn.textContent = originalText; saveBtn.disabled = false;
      if (window.LoadingOverlay) window.LoadingOverlay.hide();
    }
  }

  document.getElementById("publish-prod-btn").addEventListener("click", () => handleProductSave("active"));
  document.getElementById("draft-prod-btn").addEventListener("click", () => handleProductSave("draft"));

  wireBulkSelect("products-table-body", "select-all-products", "bulk-delete-products-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "products", id));
  });

  // ================================================================
  // PRODUCT VARIANTS (Size × Color sub-products)
  // ----------------------------------------------------------------
  // A variant is a REAL product document in the same `products`
  // collection (isVariant:true, parentId:<parent's id>) — this is what
  // makes it show up automatically everywhere a normal product already
  // does (home/category/search/cart/checkout/sitemap/feed) with zero
  // extra query logic in most of those places. The parent itself is
  // excluded from all public-facing queries once it has variants (see
  // api/list.js and js/product-loader.js) — it only exists from then on
  // as an admin-side "template" record.
  // ================================================================
  function updateProductPricePreview() {
    const previewEl = document.getElementById("prod-price-preview");
    if (!previewEl) return;
    const mrp = Number(document.getElementById("prod-mrp").value) || 0;
    const price = Number(document.getElementById("prod-price").value) || 0;
    if (!price) { previewEl.textContent = "Enter a Sale Price to see the live website price preview here."; return; }

    const finalPrice = applyMarginToPrice(price);
    const parts = [];
    if (mrp > price) {
      parts.push(`MRP ₹${mrp} − Sale Price ₹${price} = ₹${(mrp - price).toFixed(2)} off`);
    } else if (mrp > 0) {
      parts.push(`MRP ₹${mrp} is not higher than Sale Price ₹${price} — no discount badge will show`);
    } else {
      parts.push(`No MRP entered — no discount badge will show`);
    }
    if (finalPrice !== price) {
      const { type, value } = currentMarginSettings();
      const marginText = type === "percent" ? `${value}%` : `₹${value}`;
      parts.push(`+ Store Margin (${marginText}) = <strong>₹${finalPrice}</strong> final price on the website`);
    } else {
      parts.push(`No Store Margin set — <strong>₹${price}</strong> will show on the website exactly as entered`);
    }
    previewEl.innerHTML = parts.join(" &nbsp;|&nbsp; ");
  }
  ["prod-mrp", "prod-price"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateProductPricePreview);
  });

  const variantsToggle = document.getElementById("prod-has-variants");
  const variantsSection = document.getElementById("variants-section");
  const variantBoxesContainer = document.getElementById("variant-boxes-container");
  const variantSyncWrap = document.getElementById("variant-sync-wrap");

  variantsToggle.addEventListener("change", () => {
    variantsSection.style.display = variantsToggle.checked ? "" : "none";
  });

  function slugifyVariant(text) {
    return String(text || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-+|-+$)/g, "");
  }

  // A single SIZE row inside a color box. Each row maps 1:1 to a real
  // product doc under the hood (own stock/price/sku) — but visually and
  // editorially it's just "a size", not "a product". `existingDoc` is that
  // doc when editing, or null for a brand-new size being added.
  function buildSizeRow(size, existingDoc) {
    const row = document.createElement("div");
    row.className = "size-row";
    row.dataset.existingId = existingDoc ? existingDoc.id : "";
    row.style.cssText = "display:flex; align-items:flex-end; gap:6px; flex-wrap:wrap; border-top:1px dashed var(--color-border,#e2ddd0); padding-top:8px; margin-top:8px;";

    const mrp = (existingDoc && existingDoc.mrp !== undefined && existingDoc.mrp !== null) ? existingDoc.mrp : "";
    const price = (existingDoc && existingDoc.sellingPrice !== undefined && existingDoc.sellingPrice !== null) ? existingDoc.sellingPrice : "";
    const hsn = existingDoc ? (existingDoc.hsnCode || "") : "";
    const sourceUrl = existingDoc ? (existingDoc.sourcePlatformUrl || "") : "";
    const stock = (existingDoc && existingDoc.stock !== undefined) ? existingDoc.stock : "";

    row.innerHTML = `
      <div class="form-field" style="flex:0 0 90px; margin:0;"><label style="font-size:0.78rem;">Size <span class="required-star">*</span></label><input type="text" class="sr-size" value="${esc(size || "")}" placeholder="S"></div>
      <div class="form-field" style="flex:1 1 80px; margin:0;"><label style="font-size:0.78rem;">MRP ₹ <span class="field-hint" style="display:inline;">(opt.)</span></label><input type="number" class="sr-mrp" min="0" value="${mrp}" placeholder="parent's"></div>
      <div class="form-field" style="flex:1 1 80px; margin:0;"><label style="font-size:0.78rem;">Sale Price ₹ <span class="field-hint" style="display:inline;">(opt.)</span></label><input type="number" class="sr-price" min="0" value="${price}" placeholder="parent's"></div>
      <div class="form-field" style="flex:1 1 90px; margin:0;"><label style="font-size:0.78rem;">HSN <span class="field-hint" style="display:inline;">(opt.)</span></label><input type="text" class="sr-hsn" value="${esc(hsn)}" placeholder="parent's"></div>
      <div class="form-field" style="flex:1 1 110px; margin:0;"><label style="font-size:0.78rem;">Source URL <span class="field-hint" style="display:inline;">(opt.)</span></label><input type="url" class="sr-source" value="${esc(sourceUrl)}" placeholder="parent's"></div>
      <div class="form-field" style="flex:0 0 70px; margin:0;"><label style="font-size:0.78rem;">Stock <span class="required-star">*</span></label><input type="number" class="sr-stock" min="0" value="${stock}"></div>
      <div style="display:flex; gap:4px; margin-bottom:2px;">
        <button type="button" class="btn btn-outline sr-delete-btn" style="padding:2px 6px; font-size:0.75rem; color:var(--color-danger); border-color:var(--color-danger);">🗑</button>
      </div>
    `;

    if (existingDoc) {
      row.querySelector(".sr-delete-btn").addEventListener("click", async () => {
        if (!confirm(`Delete the "${size}" size permanently? This cannot be undone.`)) return;
        await deleteDoc(doc(db, "products", existingDoc.id));
        row.remove();
      });
    } else {
      row.querySelector(".sr-delete-btn").addEventListener("click", () => row.remove());
    }
    return row;
  }

  // A COLOR box — this is the real "sub-product" from the shopper's point
  // of view: one color = one product page. It holds an editable list of
  // size rows (add/remove/rename/reprice) and a writable Color name, so
  // renaming "Red" to "Pink" and saving just relabels this whole group —
  // no need to recreate anything.
  function buildColorBox(color, existingDocs, defaultSizes) {
    existingDocs = existingDocs || [];
    const box = document.createElement("div");
    box.className = "variant-box";
    box.dataset.color = color;
    box.style.cssText = "border:1px solid var(--color-border,#e2ddd0); border-radius:6px; padding:12px; background:#fff;";

    box.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:4px; flex-wrap:wrap; gap:6px;">
        <div class="form-field" style="margin:0; flex:1 1 200px;">
          <label style="font-size:0.78rem;">Color <span class="required-star">*</span> <span class="field-hint" style="display:inline;">— editable; renaming updates every size below</span></label>
          <input type="text" class="vc-color-input" value="${esc(color || "")}" placeholder="Red">
        </div>
        <div style="display:flex; gap:6px;">
          <button type="button" class="btn btn-outline vc-add-size-btn" style="padding:2px 8px; font-size:0.78rem;">+ Add Size</button>
          <button type="button" class="btn btn-outline vc-remove-color-btn" style="padding:2px 8px; font-size:0.78rem; color:var(--color-danger); border-color:var(--color-danger);">${existingDocs.length ? "🗑 Delete Color" : "Remove"}</button>
        </div>
      </div>
      <div class="vc-size-rows"></div>
    `;

    const rowsWrap = box.querySelector(".vc-size-rows");
    if (existingDocs.length > 0) {
      existingDocs.forEach((d) => rowsWrap.appendChild(buildSizeRow(d.size, d)));
    } else {
      (defaultSizes && defaultSizes.length ? defaultSizes : [""]).forEach((s) => rowsWrap.appendChild(buildSizeRow(s, null)));
    }

    box.querySelector(".vc-add-size-btn").addEventListener("click", () => {
      rowsWrap.appendChild(buildSizeRow("", null));
    });

    box.querySelector(".vc-remove-color-btn").addEventListener("click", async () => {
      if (existingDocs.length > 0) {
        if (!confirm(`Delete the "${color}" color — ALL ${existingDocs.length} of its sizes — permanently? This cannot be undone.`)) return;
        for (const d of existingDocs) await deleteDoc(doc(db, "products", d.id));
      }
      box.remove();
    });

    return box;
  }

  document.getElementById("add-variants-btn").addEventListener("click", () => {
    const colors = document.getElementById("variant-colors-input").value.split(",").map((c) => c.trim()).filter(Boolean);
    const defaultSizes = document.getElementById("variant-sizes-input").value.split(",").map((s) => s.trim()).filter(Boolean);
    if (!colors.length) { alert("Enter at least one color, comma-separated (e.g. Red, Blue)."); return; }

    const existingColors = new Set(
      Array.from(variantBoxesContainer.children).map((box) => (box.dataset.color || "").toLowerCase())
    );
    colors.forEach((color) => {
      if (existingColors.has(color.toLowerCase())) return; // already have a box for this color — don't duplicate
      variantBoxesContainer.appendChild(buildColorBox(color, [], defaultSizes));
      existingColors.add(color.toLowerCase());
    });
  });

  function populateVariantBoxesForParent(parentId) {
    variantBoxesContainer.innerHTML = "";
    const children = productsList.filter((p) => p.isVariant && p.parentId === parentId);
    const byColor = new Map();
    children.forEach((c) => {
      const key = c.color || "";
      if (!byColor.has(key)) byColor.set(key, []);
      byColor.get(key).push(c);
    });
    byColor.forEach((docs, color) => variantBoxesContainer.appendChild(buildColorBox(color, docs)));
  }

  // Shared by the "🔄 Auto Sync from Parent" button inside Edit (below)
  // and the "Auto Sync" / "Sync All" buttons in the All Products table
  // (see buildProductRow / renderProductsTable) — same fields every time,
  // so the two entry points can never quietly drift apart.
  function buildVariantSyncPatch(parent) {
    return {
      title: parent.title, keyphrase: parent.keyphrase, seoTitle: parent.seoTitle, seoDesc: parent.seoDesc,
      category: parent.category, brand: parent.brand, tags: parent.tags || [],
      shortDescription: parent.shortDescription, description: parent.description,
      deliveryFee: parent.deliveryFee, deliveryPartnerName: parent.deliveryPartnerName, deliveryPartnerImage: parent.deliveryPartnerImage,
      images: parent.images || []
    };
  }

  document.getElementById("variant-auto-sync-btn").addEventListener("click", async () => {
    const parentId = document.getElementById("prod-parent-id").value;
    const parent = productsList.find((p) => p.id === parentId);
    if (!parent) { alert("Can't find the parent product — it may have been deleted."); return; }
    const color = document.getElementById("prod-variant-color").value;
    const groupDocs = productsList.filter((c) => c.isVariant && c.parentId === parentId && (c.color || "") === color);
    if (!confirm(`Overwrite Name, Description, Category, Brand, Tags, Delivery info and Images for ALL ${groupDocs.length} size(s) of "${color}" with the parent's current data? Sizes, prices, HSN and Source URL are kept as-is.`)) return;

    const variantId = document.getElementById("prod-id").value;
    const syncPatch = buildVariantSyncPatch(parent);
    try {
      for (const d of groupDocs) await updateDoc(doc(db, "products", d.id), syncPatch);
      // Refresh the open form so the admin sees the synced values immediately.
      editProduct(variantId);
      alert("Synced from parent.");
    } catch (err) {
      alert("Couldn't sync: " + err.message);
    }
  });

  // ================================================================
  // BLOG POSTS
  // ================================================================
  // Step 1: data + list/delete only. The Add/Edit form (block editor) is
  // built in step 2 — resetBlogPostForm() is a placeholder until then so
  // nav.js's fresh-form wiring doesn't error out when "+ Add Post" is clicked.
  let blogPostsList = [];

  // ----------------------------------------------------------------
  // Rich text editor: WordPress-Classic-Editor-style "Visual" / "Code"
  // toggle. bp-content-visual is a contenteditable div driven by
  // document.execCommand for formatting; bp-content-code is a plain
  // <textarea> holding the same content as raw HTML. Only one is ever
  // being typed into at a time, so instead of fighting cursor position
  // by re-rendering the live pane on every keystroke, each pane keeps
  // its own value up to date internally and the OTHER pane is synced
  // whenever: (a) the user switches tabs, or (b) after a short pause in
  // typing (so "Code" already matches if you peek without switching).
  // That gives the "both stay live" feel WordPress users expect without
  // the contenteditable cursor jumping to the start on every re-render.
  const rteVisual = document.getElementById("bp-content-visual");
  const rteCode = document.getElementById("bp-content-code");
  const rteImgToolbar = document.getElementById("rte-img-toolbar");
  let rteActiveTab = "visual";
  let rteSelectedImage = null;
  let rteSyncTimer = null;

  function rteSyncCodeFromVisual() { rteCode.value = rteVisual.innerHTML; }
  function rteSyncVisualFromCode() { rteVisual.innerHTML = rteCode.value; }

  function rteScheduleSync(fromTab) {
    clearTimeout(rteSyncTimer);
    rteSyncTimer = setTimeout(() => {
      if (fromTab === "visual") rteSyncCodeFromVisual();
      else rteSyncVisualFromCode();
    }, 400);
  }

  rteVisual.addEventListener("input", () => rteScheduleSync("visual"));
  rteCode.addEventListener("input", () => rteScheduleSync("code"));

  document.querySelectorAll("#blog-add-post .rte-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.rteTab;
      if (tab === rteActiveTab) return;
      clearTimeout(rteSyncTimer);
      if (rteActiveTab === "visual") rteSyncCodeFromVisual();
      else rteSyncVisualFromCode();

      rteActiveTab = tab;
      document.querySelectorAll("#blog-add-post .rte-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      rteVisual.hidden = tab !== "visual";
      rteCode.hidden = tab !== "code";
      if (tab === "visual") { hideImageToolbar(); rteVisual.focus(); } else { rteCode.focus(); }
    });
  });

  // --- Formatting toolbar (execCommand-based — simple, no dependency,
  // works the same way the old WordPress Classic Editor toolbar did) ---
  document.querySelectorAll(".rte-btn[data-cmd]").forEach((btn) => {
    btn.addEventListener("click", () => {
      rteVisual.focus();
      document.execCommand(btn.dataset.cmd, false, null);
      rteSyncCodeFromVisual();
    });
  });
  document.getElementById("rte-block-select").addEventListener("change", (e) => {
    const val = e.target.value;
    e.target.selectedIndex = 0; // acts as an action menu, not a state display
    if (!val) return;
    rteVisual.focus();
    document.execCommand("formatBlock", false, val);
    rteSyncCodeFromVisual();
  });
  // execCommand("fontSize") is the only reliable cross-browser way to wrap
  // an arbitrary (possibly multi-node) selection in something we can style —
  // it inserts legacy <font size="N"> tags, which we immediately swap for
  // <span class="rte-fs-*"> so the size comes from our own CSS classes
  // (shared with the live post page's .prose) instead of the browser's
  // fixed 7-step HTML font sizes.
  const RTE_FONT_SIZE_MAP = { "rte-fs-sm": "2", "rte-fs-normal": "3", "rte-fs-lg": "5", "rte-fs-xl": "7" };
  document.getElementById("rte-fontsize-select").addEventListener("change", (e) => {
    const cls = e.target.value;
    e.target.selectedIndex = 0;
    if (!cls) return;
    rteVisual.focus();
    document.execCommand("fontSize", false, RTE_FONT_SIZE_MAP[cls] || "3");
    rteVisual.querySelectorAll("font[size]").forEach((f) => {
      const span = document.createElement("span");
      span.className = cls;
      while (f.firstChild) span.appendChild(f.firstChild);
      f.replaceWith(span);
    });
    rteSyncCodeFromVisual();
  });
  document.getElementById("rte-link-btn").addEventListener("click", () => {
    const url = prompt("Link URL:", "https://");
    if (!url) return;
    rteVisual.focus();
    document.execCommand("createLink", false, url);
    rteSyncCodeFromVisual();
  });

  // --- Image insert: upload via the same ImgBB pipeline used elsewhere,
  // then drop an <img> at the cursor, wrapped so size/align classes
  // (applied via the mini image toolbar below) have something to target. ---
  const rteImageFile = document.getElementById("rte-image-file");
  document.getElementById("rte-image-btn").addEventListener("click", () => rteImageFile.click());
  rteImageFile.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const url = await uploadToImgBB(file);
      rteVisual.focus();
      const html = `<img src="${esc(url)}" class="rte-img--medium rte-img--center" alt="">`;
      if (!document.execCommand("insertHTML", false, html)) {
        rteVisual.insertAdjacentHTML("beforeend", html);
      }
      rteSyncCodeFromVisual();
    } catch (err) {
      alert("Image upload failed: " + err.message);
    }
  });

  // --- Selecting an image inside the editor shows a mini toolbar for
  // size (S/M/L/Full) and alignment (left/center/right), plus a caption
  // field (rendered as a <figcaption> wrapped around the image on save). ---
  function showImageToolbar(img) {
    rteSelectedImage = img;
    document.querySelectorAll(".rte-editor img").forEach((el) => el.classList.remove("rte-img--selected"));
    img.classList.add("rte-img--selected");
    rteImgToolbar.hidden = false;
    document.getElementById("rte-img-caption").value = img.closest("figure")?.querySelector("figcaption")?.textContent || "";
  }
  function hideImageToolbar() {
    if (rteSelectedImage) rteSelectedImage.classList.remove("rte-img--selected");
    rteSelectedImage = null;
    rteImgToolbar.hidden = true;
  }
  rteVisual.addEventListener("click", (e) => {
    if (e.target.tagName === "IMG") showImageToolbar(e.target);
    else hideImageToolbar();
  });
  document.querySelectorAll(".rte-btn[data-imgsize]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!rteSelectedImage) return;
      rteSelectedImage.classList.remove("rte-img--small", "rte-img--medium", "rte-img--large", "rte-img--full");
      rteSelectedImage.classList.add("rte-img--" + btn.dataset.imgsize);
      rteSyncCodeFromVisual();
    });
  });
  document.querySelectorAll(".rte-btn[data-imgalign]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!rteSelectedImage) return;
      rteSelectedImage.classList.remove("rte-img--left", "rte-img--center", "rte-img--right", "rte-img--none");
      rteSelectedImage.classList.add("rte-img--" + btn.dataset.imgalign);
      rteSyncCodeFromVisual();
    });
  });
  document.getElementById("rte-img-caption").addEventListener("input", (e) => {
    if (!rteSelectedImage) return;
    const text = e.target.value;
    let figure = rteSelectedImage.closest("figure");
    if (!text) {
      // No caption: unwrap back to a bare <img> if it was wrapped.
      if (figure) figure.replaceWith(rteSelectedImage);
    } else {
      if (!figure) {
        figure = document.createElement("figure");
        rteSelectedImage.replaceWith(figure);
        figure.appendChild(rteSelectedImage);
      }
      let caption = figure.querySelector("figcaption");
      if (!caption) { caption = document.createElement("figcaption"); figure.appendChild(caption); }
      caption.textContent = text;
    }
    rteSyncCodeFromVisual();
  });
  document.getElementById("rte-img-remove").addEventListener("click", () => {
    if (!rteSelectedImage) return;
    (rteSelectedImage.closest("figure") || rteSelectedImage).remove();
    hideImageToolbar();
    rteSyncCodeFromVisual();
  });

  function getBlogContentHTML() {
    return rteActiveTab === "visual" ? rteVisual.innerHTML : rteCode.value;
  }
  function setBlogContentHTML(html) {
    rteVisual.innerHTML = html || "";
    rteCode.value = html || "";
  }

  // --- Settings panel show/hide (the ⚙ button in the editor topbar) ---
  const wpPanelToggleBtn = document.getElementById("wp-toggle-panel-btn");
  const wpEditorPanel = document.getElementById("wp-editor-panel");
  if (wpPanelToggleBtn && wpEditorPanel) {
    wpPanelToggleBtn.addEventListener("click", () => {
      const nowHidden = wpEditorPanel.classList.toggle("panel-hidden");
      wpPanelToggleBtn.classList.toggle("active", !nowHidden);
    });
  }

  // --- Live Preview: opens the post, exactly as typed so far (including
  // unsaved changes), in a new tab — same idea as WordPress's Preview button. ---
  const previewBlogPostBtn = document.getElementById("preview-blogpost-btn");
  if (previewBlogPostBtn) {
    previewBlogPostBtn.addEventListener("click", () => {
      const title = document.getElementById("bp-title").value.trim() || "(untitled)";
      const coverImg = document.getElementById("bp-cover-preview").querySelector("img");
      const cover = (coverImg && coverImg.src) || document.getElementById("bp-existing-cover").value || "";
      const content = getBlogContentHTML();
      const categories = document.getElementById("bp-categories").value.split(",").map((s) => s.trim()).filter(Boolean);
      const tags = document.getElementById("bp-tags").value.split(",").map((s) => s.trim()).filter(Boolean);
      const pillsHTML = (categories.length || tags.length)
        ? "<div class=\"taxonomy-pills\">" +
          categories.map((c) => "<span class=\"taxonomy-pill taxonomy-pill--category\">" + esc(c) + "</span>").join("") +
          tags.map((t) => "<span class=\"taxonomy-pill\">#" + esc(t) + "</span>").join("") +
          "</div>"
        : "";
      const win = window.open("", "_blank");
      if (!win) { alert("Please allow pop-ups for this site to preview the post."); return; }
      win.document.write(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(title) + " — Preview</title>" +
        "<link rel=\"stylesheet\" href=\"" + location.origin + "/css/main.css\">" +
        "<link rel=\"stylesheet\" href=\"" + location.origin + "/css/components.css\">" +
        "<style>body{max-width:760px;margin:40px auto;padding:0 20px 60px;font-family:sans-serif;overflow-wrap:break-word;word-break:break-word;}" +
        ".wp-preview-badge{display:inline-block;background:#e8a33d;color:#fff;font-size:0.75rem;font-weight:bold;letter-spacing:.03em;padding:4px 12px;border-radius:999px;margin-bottom:18px;}" +
        "h1{overflow-wrap:break-word;word-break:break-word;}" +
        ".wp-preview-cover{width:100%;max-height:420px;object-fit:cover;border-radius:8px;margin-bottom:24px;}</style>" +
        "</head><body><span class=\"wp-preview-badge\">PREVIEW — not yet saved</span><h1>" + esc(title) + "</h1>" +
        pillsHTML +
        (cover ? "<img class=\"wp-preview-cover\" src=\"" + esc(cover) + "\" alt=\"\">" : "") +
        "<div class=\"prose\">" + content + "</div></body></html>"
      );
      win.document.close();
    });
  }

  // One-time migration: older posts were saved as an array of typed
  // blocks (heading/paragraph/image) rather than a single HTML string.
  // Converting them into equivalent HTML lets old posts open straight
  // into the new editor and keep working exactly as before.
  function blocksToHTML(blocks) {
    return (blocks || []).map((b) => {
      if (b.type === "heading") return `<h2>${esc(b.text || "")}</h2>`;
      if (b.type === "paragraph") return `<p>${esc(b.text || "")}</p>`;
      if (b.type === "image" && b.imageUrl) {
        const img = `<img src="${esc(b.imageUrl)}" class="rte-img--medium rte-img--center" alt="${esc(b.caption || "")}">`;
        return b.caption ? `<figure>${img}<figcaption>${esc(b.caption)}</figcaption></figure>` : `<figure>${img}</figure>`;
      }
      return "";
    }).join("\n");
  }

  // Same lightweight writing-checklist pattern as the product form.
  function renderBlogSeoChecklist() {
    const list = document.getElementById("bp-seo-checklist");
    if (!list) return;
    const kp = (document.getElementById("bp-keyphrase").value || "").trim().toLowerCase();
    const seoTitle = (document.getElementById("bp-seo-title").value || document.getElementById("bp-title").value || "").toLowerCase();
    const seoDesc = (document.getElementById("bp-seo-desc").value || "").toLowerCase();
    const slug = (document.getElementById("bp-slug").value || "").toLowerCase();

    if (!kp) { list.innerHTML = '<li style="color:#888;">Add a focus keyphrase to see SEO checks.</li>'; return; }

    const checks = [
      { label: "In SEO Title", ok: seoTitle.includes(kp) },
      { label: "In SEO Description", ok: seoDesc.includes(kp) },
      { label: "In URL slug", ok: slug.includes(generateSlug(kp)) },
      { label: `Title length ok (${seoTitle.length}/70)`, ok: seoTitle.length > 0 && seoTitle.length <= 70 },
      { label: `Description length ok (${seoDesc.length}/165)`, ok: seoDesc.length >= 50 && seoDesc.length <= 165 },
    ];
    list.innerHTML = checks.map(c =>
      `<li style="color:${c.ok ? 'var(--color-success, #1a7f37)' : 'var(--color-danger, #c0392b)'};">${c.ok ? '✓' : '✗'} ${c.label}</li>`
    ).join("");
  }
  ["bp-keyphrase", "bp-seo-title", "bp-seo-desc", "bp-slug"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderBlogSeoChecklist);
  });
  document.getElementById("bp-title").addEventListener("input", (e) => {
    document.getElementById("bp-slug").value = generateSlug(e.target.value);
    renderBlogSeoChecklist();
  });

  document.getElementById("bp-cover-img").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("bp-cover-preview"), 1));

  function ensureUniqueBlogSlug(baseSlug, excludeId) {
    const taken = new Set(blogPostsList.filter((p) => p.id !== excludeId).map((p) => p.slug).filter(Boolean));
    if (!taken.has(baseSlug)) return baseSlug;
    let n = 2;
    while (taken.has(`${baseSlug}-${n}`)) n++;
    return `${baseSlug}-${n}`;
  }

  function resetBlogPostForm() {
    document.getElementById("bp-id").value = "";
    document.getElementById("bp-existing-cover").value = "";
    document.getElementById("bp-title").value = "";
    document.getElementById("bp-slug").value = "";
    document.getElementById("bp-keyphrase").value = "";
    document.getElementById("bp-seo-title").value = "";
    document.getElementById("bp-seo-desc").value = "";
    selectedBlogCatNames = new Set();
    renderBlogCategoriesChecklist();
    syncBlogCategoriesHiddenField();
    document.getElementById("bp-tags").value = "";
    document.getElementById("bp-cover-img").value = "";
    document.getElementById("bp-cover-preview").innerHTML = "";
    document.getElementById("blogpost-form-title").textContent = "Add New Post";
    rteActiveTab = "visual";
    document.querySelectorAll("#blog-add-post .rte-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.rteTab === "visual"));
    rteVisual.hidden = false;
    rteCode.hidden = true;
    hideImageToolbar();
    setBlogContentHTML("");
    renderBlogSeoChecklist();
  }

  function editBlogPost(id) {
    const p = blogPostsList.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("bp-id").value = id;
    document.getElementById("bp-title").value = p.title || "";
    document.getElementById("bp-slug").value = p.slug || "";
    document.getElementById("bp-keyphrase").value = p.keyphrase || "";
    document.getElementById("bp-seo-title").value = p.seoTitle || "";
    document.getElementById("bp-seo-desc").value = p.seoDesc || "";
    selectedBlogCatNames = new Set(p.categories || []);
    renderBlogCategoriesChecklist();
    syncBlogCategoriesHiddenField();
    document.getElementById("bp-tags").value = (p.tags || []).join(", ");
    document.getElementById("bp-existing-cover").value = p.coverImage || "";
    document.getElementById("bp-cover-preview").innerHTML = "";
    previewExistingImages(document.getElementById("bp-cover-preview"), p.coverImage ? [p.coverImage] : []);
    rteActiveTab = "visual";
    document.querySelectorAll("#blog-add-post .rte-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.rteTab === "visual"));
    rteVisual.hidden = false;
    rteCode.hidden = true;
    hideImageToolbar();
    // Posts saved before this editor existed only have `blocks`; convert
    // those to HTML once so they open normally. Anything saved since has
    // `content` already and is used as-is.
    setBlogContentHTML(p.content != null ? p.content : blocksToHTML(p.blocks));
    renderBlogSeoChecklist();
    document.getElementById("blogpost-form-title").textContent = "Edit Post";
    goToSection("blog-add-post");
  }
  window.editBlogPost = editBlogPost;

  async function handleBlogPostSave(status) {
    const title = document.getElementById("bp-title").value.trim();
    if (!title) return alert("Post title is required");

    const saveBtn = status === "published" ? document.getElementById("publish-blogpost-btn") : document.getElementById("draft-blogpost-btn");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Saving..."; saveBtn.disabled = true;
    document.getElementById("blogpost-save-status").textContent = "";

    try {
      let coverImage = document.getElementById("bp-existing-cover").value || "";
      const coverFile = document.getElementById("bp-cover-img").files[0];
      if (coverFile) coverImage = await uploadToImgBB(coverFile);

      const pId = document.getElementById("bp-id").value;
      const rawSlug = document.getElementById("bp-slug").value.trim() || generateSlug(title);
      const finalSlug = ensureUniqueBlogSlug(generateSlug(rawSlug), pId || null);
      if (finalSlug !== rawSlug) document.getElementById("bp-slug").value = finalSlug;

      const pData = {
        title,
        slug: finalSlug,
        keyphrase: document.getElementById("bp-keyphrase").value.trim(),
        seoTitle: document.getElementById("bp-seo-title").value.trim(),
        seoDesc: document.getElementById("bp-seo-desc").value.trim(),
        categories: document.getElementById("bp-categories").value.split(",").map((s) => s.trim()).filter(Boolean),
        tags: document.getElementById("bp-tags").value.split(",").map((s) => s.trim()).filter(Boolean),
        coverImage,
        content: getBlogContentHTML(),
        status,
        updatedAt: new Date().toISOString()
      };

      if (pId) {
        await updateDoc(doc(db, "blogPosts", pId), pData);
      } else {
        pData.createdAt = new Date().toISOString();
        await addDoc(collection(db, "blogPosts"), pData);
      }
      resetBlogPostForm();
      goToSection("blog-posts");
    } catch (err) {
      document.getElementById("blogpost-save-status").textContent = "Error: " + err.message;
      document.getElementById("blogpost-save-status").style.color = "var(--color-danger)";
    } finally {
      saveBtn.textContent = originalText; saveBtn.disabled = false;
    }
  }

  document.getElementById("publish-blogpost-btn").addEventListener("click", () => handleBlogPostSave("published"));
  document.getElementById("draft-blogpost-btn").addEventListener("click", () => handleBlogPostSave("draft"));

  let unsubBlogPosts = null;
  function listenBlogPosts() {
    if (unsubBlogPosts) return;
    unsubBlogPosts = onSnapshot(collection(db, "blogPosts"), (snap) => {
      blogPostsList = [];
      snap.forEach((d) => blogPostsList.push({ id: d.id, ...d.data() }));
      renderBlogPostsTable();
    }, (err) => console.error("blogPosts listener error", err));
  }

  function renderBlogPostsTable() {
    const tbody = document.getElementById("blogposts-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    // Newest first — createdAt is an ISO string, so plain string comparison
    // sorts correctly the same way it does for orders elsewhere in this file.
    const sorted = [...blogPostsList].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    sorted.forEach((p) => {
      const sColor = p.status === "published" ? "var(--color-success)" : "var(--color-accent-dark)";
      const img = p.coverImage || "images/logo-placeholder.svg";
      const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="row-select" data-id="${p.id}"></td>
        <td><img src="${esc(img)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" alt=""></td>
        <td>${esc(p.title || "(untitled)")}</td>
        <td>${dateStr}</td>
        <td style="color:${sColor}; font-weight:bold;">${esc((p.status || "draft").toUpperCase())}</td>
        <td>
          <button class="btn btn-outline edit-blogpost-btn" data-id="${p.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline del-blogpost-btn" data-id="${p.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".edit-blogpost-btn").forEach((b) => b.addEventListener("click", () => editBlogPost(b.dataset.id)));
    tbody.querySelectorAll(".del-blogpost-btn").forEach((b) => b.addEventListener("click", () => deleteBlogPost(b.dataset.id)));
  }

  async function deleteBlogPost(id) {
    if (!confirm("Delete this blog post permanently?")) return;
    await deleteDoc(doc(db, "blogPosts", id));
  }

  wireBulkSelect("blogposts-table-body", "select-all-blogposts", "bulk-delete-blogposts-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "blogPosts", id));
  });

  // ================================================================
  // PAGES
  // ================================================================
  let pagesList = [];
  let pagesSeeded = false;

  // Reserved slugs — names already used by a real static file/route in this
  // project. A custom page using one of these would silently never be
  // reachable (the real file always wins over our catch-all rewrite), so
  // block it at save time instead of letting the admin discover it later.
  const RESERVED_SLUGS = new Set([
    "about", "terms", "cart", "checkout", "admin", "404", "index", "page",
    "robots", "sitemap", "manifest", "share", "share-blog", "product",
    "category", "blog", "products", "product-feed", "api", "images",
    "css", "js", "lib", "partials", "config", "home"
  ]);

  // Default pages that already exist as static HTML files. Seeded once
  // (only if the "pages" collection is completely empty) so they show up
  // in All Pages and become editable, without touching/losing whatever is
  // already live in the actual .html files' <head> tags right now.
  const DEFAULT_PAGES_SEED = [
    {
      slug: "home", isDefault: true, heading: "AzubaTrends — Everyday goods for the home",
      metaTitle: "AzubaTrends — Everyday goods for the home",
      metaDesc: "Handmade and hand-loomed home goods, delivered across West Bengal. Terracotta, jute, brass, kantha textiles, and more.",
      keyphrase: "", content: "", contentPosition: "after-products", status: "published"
    },
    {
      slug: "about", isDefault: true, heading: "About Us",
      metaTitle: "About Us — AzubaTrends",
      metaDesc: "About AzubaTrends — a home goods store delivering across West Bengal.",
      keyphrase: "", content: "", contentPosition: "normal", status: "published"
    },
    {
      slug: "terms", isDefault: true, heading: "Terms & Conditions",
      metaTitle: "Terms & Conditions — AzubaTrends",
      metaDesc: "Terms and conditions for shopping with AzubaTrends.",
      keyphrase: "", content: "", contentPosition: "normal", status: "published"
    },
    {
      slug: "404", isDefault: true, heading: "Page not found",
      metaTitle: "Page not found — AzubaTrends",
      metaDesc: "The page you're looking for doesn't exist.",
      keyphrase: "", content: "", contentPosition: "normal", status: "published"
    }
  ];

  // Default pages (about/terms) already ship with real placeholder copy
  // written directly into their .html files — that text is what visitors
  // see today, but the Firestore doc's `content` field is intentionally
  // seeded blank (see DEFAULT_PAGES_SEED comment above: "empty = admin
  // hasn't touched this yet", so the live static markup isn't silently
  // overwritten by an empty editor on first save).
  //
  // The problem that caused: opening Edit for About/Terms in the admin
  // showed a BLANK editor, even though the page clearly has content live
  // on the site — it just wasn't sitting in Firestore yet. This constant
  // is that same static copy, kept only so editPage() can pre-fill the
  // editor with it for *display* purposes when the Firestore field is
  // still empty. Nothing here is written to Firestore until the admin
  // actually hits Publish/Save — at that point it becomes real, editable,
  // saved content like any other page.
  const DEFAULT_PAGE_LIVE_CONTENT = {
    about: `<h2>Our story</h2>
<p>AzubaTrends started as a way to bring hand-made and hand-loomed goods from artisans across West Bengal directly to nearby homes — without a showroom, and without the usual markup. "AzubaTrends" means courtyard: the shared, everyday space where a home actually happens.</p>
<h2>What we sell</h2>
<p>Everything in the shop is either handmade or hand-finished — terracotta, jute, brass, copper, and hand-stitched textiles among them. Replace this paragraph with real sourcing details, artisan partners, or workshop locations once available.</p>
<h2>Delivery area</h2>
<p>We currently deliver within West Bengal, India only. If an address falls outside that area, checkout will let you know before you pay.</p>
<h2>Get in touch</h2>
<p>Questions about an order or a product? Reach us at <a href="mailto:admin@example.com">admin@example.com</a>.</p>`,
    terms: `<h2>1. About these terms</h2>
<p>These terms govern purchases made on this website. By placing an order, you agree to the terms on this page as they stand at the time of your order.</p>
<h2>2. Delivery area</h2>
<p>Orders are currently delivered within West Bengal, India only. Addresses outside this area cannot be accepted at checkout.</p>
<h2>3. Ordering &amp; payment</h2>
<p>No account or login is required to place an order — checkout is guest-only. Accepted payment methods, order confirmation, and cancellation details will be listed here by the site owner.</p>
<h2>4. Pricing &amp; availability</h2>
<p>Prices are shown in Indian Rupees (₹) and include any discount already applied at checkout. Stock is limited and not reserved until an order is placed; an item may occasionally sell out between browsing and checkout.</p>
<h2>5. Returns &amp; refunds</h2>
<p>We accept returns and exchanges within <strong>7 days of delivery</strong>.</p>
<p><strong>Defective, damaged, or wrong item received:</strong> Contact us within 7 days of delivery with photos of the item. We'll offer a free replacement or a full refund, and any return shipping cost in this case is on us.</p>
<p><strong>Change of mind (non-defective returns):</strong> We also accept returns for items you simply don't want, as long as the item is unused, unwashed, and in its original packaging with tags intact. In this case, return shipping is paid by the customer, and the refund is issued once we receive and inspect the returned item.</p>
<p><strong>Exchanges:</strong> Available for size/variant issues on the same product, subject to stock availability, within the same 7-day window.</p>
<p><strong>Refund method &amp; timeline:</strong> Refunds are issued to the original payment method (or via UPI for Cash on Delivery orders) within 5–7 business days of the returned item passing inspection.</p>
<p>To start a return or exchange, contact us using the details on the <a href="/about">About</a> page with your order number.</p>
<h2>6. Reviews</h2>
<p>Product reviews are submitted voluntarily by visitors and reflect their own opinions. Reviews may include an uploaded photo; do not submit anything you don't have the rights to share.</p>
<h2>7. Contact</h2>
<p>Questions about these terms can be sent to <a href="mailto:admin@example.com">admin@example.com</a>.</p>`
  };

  async function seedDefaultPagesIfEmpty() {
    if (pagesSeeded) return;
    pagesSeeded = true;
    try {
      const existing = new Set(pagesList.map((p) => p.slug));
      const missing = DEFAULT_PAGES_SEED.filter((p) => !existing.has(p.slug));
      if (missing.length === 0) return;
      for (const p of missing) {
        const now = new Date().toISOString();
        await addDoc(collection(db, "pages"), { ...p, createdAt: now, updatedAt: now });
      }
    } catch (err) {
      console.error("seedDefaultPagesIfEmpty error", err);
    }
  }

  let unsubPages = null;
  function listenPages() {
    if (unsubPages) return;
    unsubPages = onSnapshot(collection(db, "pages"), (snap) => {
      pagesList = [];
      snap.forEach((d) => pagesList.push({ id: d.id, ...d.data() }));
      seedDefaultPagesIfEmpty();
      renderPagesTable();
    }, (err) => console.error("pages listener error", err));
  }

  function renderPagesTable() {
    const tbody = document.getElementById("pages-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    const sorted = [...pagesList].sort((a, b) => {
      if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1; // defaults first
      return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
    });
    sorted.forEach((p) => {
      const sColor = p.status === "published" ? "var(--color-success)" : "var(--color-accent-dark)";
      const dateStr = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString("en-IN") : "—";
      const url = p.slug === "home" ? "/" : `/${p.slug}`;
      const deleteBtn = p.isDefault
        ? `<button class="btn btn-outline" disabled title="Default pages can't be deleted, only edited" style="padding:4px 8px; font-size:0.8rem; opacity:0.5; cursor:not-allowed;">Delete</button>`
        : `<button class="btn btn-outline del-page-btn" data-id="${p.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${p.isDefault ? "" : `<input type="checkbox" class="row-select" data-id="${p.id}">`}</td>
        <td>${esc(p.heading || "(untitled)")}</td>
        <td><a href="${esc(url)}" target="_blank" style="color:var(--color-primary);">${esc(url)}</a></td>
        <td>${p.isDefault ? '<span style="font-weight:bold;">Default</span>' : "Custom"}</td>
        <td style="color:${sColor}; font-weight:bold;">${esc((p.status || "draft").toUpperCase())}</td>
        <td>${dateStr}</td>
        <td>
          <button class="btn btn-outline edit-page-btn" data-id="${p.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          ${deleteBtn}
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".edit-page-btn").forEach((b) => b.addEventListener("click", () => editPage(b.dataset.id)));
    tbody.querySelectorAll(".del-page-btn").forEach((b) => b.addEventListener("click", () => deletePage(b.dataset.id)));

    const totalEl = document.getElementById("pages-total-count");
    const defEl = document.getElementById("pages-default-count");
    const custEl = document.getElementById("pages-custom-count");
    if (totalEl) {
      const defCount = pagesList.filter((p) => p.isDefault).length;
      totalEl.textContent = pagesList.length;
      defEl.textContent = defCount;
      custEl.textContent = pagesList.length - defCount;
    }
  }

  async function deletePage(id) {
    const p = pagesList.find((x) => x.id === id);
    if (p && p.isDefault) { alert("Default pages can't be deleted — only edited."); return; }
    if (!confirm("Delete this page permanently?")) return;
    await deleteDoc(doc(db, "pages", id));
  }

  wireBulkSelect("pages-table-body", "select-all-pages", "bulk-delete-pages-btn", async (ids) => {
    // Default pages never render a checkbox (see renderPagesTable), so any
    // id reaching here is already guaranteed custom — but double-check
    // against Firestore rules' own protection as a second safety net.
    for (const id of ids) {
      const p = pagesList.find((x) => x.id === id);
      if (p && p.isDefault) continue;
      await deleteDoc(doc(db, "pages", id));
    }
  });

  // --- Page editor: simplified rich-text editor (same execCommand approach
  // as the blog post editor, but scoped to its own ids/classes so the two
  // editors never cross-wire each other). ---
  const pgRteVisual = document.getElementById("pg-content-visual");
  const pgRteCode = document.getElementById("pg-content-code");
  let pgRteActiveTab = "visual";
  function pgSyncCodeFromVisual() { pgRteCode.value = pgRteVisual.innerHTML; }
  function pgSyncVisualFromCode() { pgRteVisual.innerHTML = pgRteCode.value; }

  document.querySelectorAll('[data-pgrte-tab]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.pgrteTab;
      if (tab === pgRteActiveTab) return;
      if (pgRteActiveTab === "visual") pgSyncCodeFromVisual(); else pgSyncVisualFromCode();
      pgRteActiveTab = tab;
      document.querySelectorAll('[data-pgrte-tab]').forEach((b) => b.classList.toggle("active", b === btn));
      pgRteVisual.hidden = tab !== "visual";
      pgRteCode.hidden = tab !== "code";
      (tab === "visual" ? pgRteVisual : pgRteCode).focus();
    });
  });
  document.querySelectorAll('#pg-rte-toolbar .rte-btn[data-pgcmd]').forEach((btn) => {
    btn.addEventListener("click", () => {
      pgRteVisual.focus();
      document.execCommand(btn.dataset.pgcmd, false, null);
      pgSyncCodeFromVisual();
    });
  });
  document.getElementById("pg-rte-block-select").addEventListener("change", (e) => {
    const val = e.target.value;
    e.target.selectedIndex = 0;
    if (!val) return;
    pgRteVisual.focus();
    document.execCommand("formatBlock", false, val);
    pgSyncCodeFromVisual();
  });
  document.getElementById("pg-rte-link-btn").addEventListener("click", () => {
    const url = prompt("Link URL:");
    if (!url) return;
    pgRteVisual.focus();
    document.execCommand("createLink", false, url);
    pgSyncCodeFromVisual();
  });
  pgRteVisual.addEventListener("input", pgSyncCodeFromVisual);
  pgRteCode.addEventListener("input", pgSyncVisualFromCode);

  function getPageContentHTML() { return pgRteActiveTab === "visual" ? pgRteVisual.innerHTML : pgRteCode.value; }
  function setPageContentHTML(html) { pgRteVisual.innerHTML = html || ""; pgRteCode.value = html || ""; }

  const pgPanelToggleBtn = document.getElementById("wp-toggle-page-panel-btn");
  const pgEditorPanel = document.getElementById("wp-editor-page-panel");
  if (pgPanelToggleBtn && pgEditorPanel) {
    pgPanelToggleBtn.addEventListener("click", () => {
      const nowHidden = pgEditorPanel.classList.toggle("panel-hidden");
      pgPanelToggleBtn.classList.toggle("active", !nowHidden);
    });
  }

  function renderPageSeoChecklist() {
    const list = document.getElementById("pg-seo-checklist");
    if (!list) return;
    const kp = (document.getElementById("pg-keyphrase").value || "").trim().toLowerCase();
    const seoTitle = (document.getElementById("pg-meta-title").value || document.getElementById("pg-heading").value || "").toLowerCase();
    const seoDesc = (document.getElementById("pg-meta-desc").value || "").toLowerCase();
    const slug = (document.getElementById("pg-slug").value || "").toLowerCase();

    if (!kp) { list.innerHTML = '<li style="color:#888;">Add a focus keyphrase to see SEO checks.</li>'; return; }

    const checks = [
      { label: "In Meta Title", ok: seoTitle.includes(kp) },
      { label: "In Meta Description", ok: seoDesc.includes(kp) },
      { label: "In URL slug", ok: slug.includes(generateSlug(kp)) },
      { label: `Title length ok (${seoTitle.length}/70)`, ok: seoTitle.length > 0 && seoTitle.length <= 70 },
      { label: `Description length ok (${seoDesc.length}/165)`, ok: seoDesc.length >= 50 && seoDesc.length <= 165 },
    ];
    list.innerHTML = checks.map(c =>
      `<li style="color:${c.ok ? 'var(--color-success, #1a7f37)' : 'var(--color-danger, #c0392b)'};">${c.ok ? '✓' : '✗'} ${c.label}</li>`
    ).join("");
  }
  ["pg-keyphrase", "pg-meta-title", "pg-meta-desc", "pg-slug"].forEach((id) => {
    document.getElementById(id).addEventListener("input", renderPageSeoChecklist);
  });
  document.getElementById("pg-heading").addEventListener("input", (e) => {
    // Default pages keep their fixed slug (home/about/terms/404) — only
    // custom pages get their slug auto-derived from the heading as typed.
    if (document.getElementById("pg-is-default").value !== "true") {
      document.getElementById("pg-slug").value = generateSlug(e.target.value);
      document.getElementById("pg-slug-preview").textContent = document.getElementById("pg-slug").value || "slug";
    }
    renderPageSeoChecklist();
  });
  document.getElementById("pg-slug").addEventListener("input", (e) => {
    document.getElementById("pg-slug-preview").textContent = e.target.value || "slug";
    renderPageSeoChecklist();
  });
  document.getElementById("pg-image").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("pg-image-preview"), 1));

  function ensureUniquePageSlug(baseSlug, excludeId) {
    const taken = new Set(pagesList.filter((p) => p.id !== excludeId).map((p) => p.slug).filter(Boolean));
    if (!taken.has(baseSlug)) return baseSlug;
    let n = 2;
    while (taken.has(`${baseSlug}-${n}`)) n++;
    return `${baseSlug}-${n}`;
  }

  function resetPageForm() {
    document.getElementById("pg-id").value = "";
    document.getElementById("pg-is-default").value = "false";
    document.getElementById("pg-existing-image").value = "";
    document.getElementById("pg-heading").value = "";
    document.getElementById("pg-slug").value = "";
    document.getElementById("pg-slug").readOnly = false;
    document.getElementById("pg-slug-preview").textContent = "slug";
    document.getElementById("pg-default-slug-note").style.display = "none";
    document.getElementById("pg-content-position").value = "normal";
    document.getElementById("pg-keyphrase").value = "";
    document.getElementById("pg-meta-title").value = "";
    document.getElementById("pg-meta-desc").value = "";
    document.getElementById("pg-image").value = "";
    document.getElementById("pg-image-preview").innerHTML = "";
    document.getElementById("page-form-title").textContent = "Add New Page";
    pgRteActiveTab = "visual";
    document.querySelectorAll('[data-pgrte-tab]').forEach((b) => b.classList.toggle("active", b.dataset.pgrteTab === "visual"));
    pgRteVisual.hidden = false;
    pgRteCode.hidden = true;
    setPageContentHTML("");
    renderPageSeoChecklist();
  }

  function editPage(id) {
    const p = pagesList.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("pg-id").value = id;
    document.getElementById("pg-is-default").value = p.isDefault ? "true" : "false";
    document.getElementById("pg-heading").value = p.heading || "";
    document.getElementById("pg-slug").value = p.slug || "";
    document.getElementById("pg-slug").readOnly = !!p.isDefault; // default pages: URL locked
    document.getElementById("pg-slug-preview").textContent = p.slug || "slug";
    document.getElementById("pg-default-slug-note").style.display = p.isDefault ? "block" : "none";
    document.getElementById("pg-content-position").value = p.contentPosition || "normal";
    document.getElementById("pg-keyphrase").value = p.keyphrase || "";
    document.getElementById("pg-meta-title").value = p.metaTitle || "";
    document.getElementById("pg-meta-desc").value = p.metaDesc || "";
    document.getElementById("pg-existing-image").value = p.image || "";
    document.getElementById("pg-image-preview").innerHTML = "";
    previewExistingImages(document.getElementById("pg-image-preview"), p.image ? [p.image] : []);
    pgRteActiveTab = "visual";
    document.querySelectorAll('[data-pgrte-tab]').forEach((b) => b.classList.toggle("active", b.dataset.pgrteTab === "visual"));
    pgRteVisual.hidden = false;
    pgRteCode.hidden = true;

    // Firestore content empty on a default page usually just means
    // "nobody has saved anything here yet" — NOT that the page has no
    // content. About/Terms already have real copy live on the site
    // (baked into the .html file). Pre-fill from that so the editor
    // shows what's actually live instead of a blank box, and shows a
    // small note that this text isn't "officially" saved until Publish
    // is pressed.
    const hasRealContent = !!(p.content && p.content.trim());
    const fallback = !hasRealContent ? (DEFAULT_PAGE_LIVE_CONTENT[p.slug] || "") : "";
    setPageContentHTML(hasRealContent ? p.content : fallback);

    const statusEl = document.getElementById("page-save-status");
    if (statusEl) {
      if (!hasRealContent && fallback) {
        statusEl.textContent = "Showing the content currently live on the site. Press Publish to save it here so it's officially editable going forward.";
        statusEl.style.color = "var(--color-ink-soft)";
      } else {
        statusEl.textContent = "";
      }
    }

    renderPageSeoChecklist();
    document.getElementById("page-form-title").textContent = "Edit Page";
    goToSection("add-page");
  }
  window.editPage = editPage;

  async function handlePageSave(status) {
    const heading = document.getElementById("pg-heading").value.trim();
    if (!heading) return alert("Page heading is required");

    const isDefault = document.getElementById("pg-is-default").value === "true";
    const saveBtn = status === "published" ? document.getElementById("publish-page-btn") : document.getElementById("draft-page-btn");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Saving..."; saveBtn.disabled = true;
    document.getElementById("page-save-status").textContent = "";

    try {
      const pId = document.getElementById("pg-id").value;
      let finalSlug = document.getElementById("pg-slug").value.trim() || generateSlug(heading);
      finalSlug = generateSlug(finalSlug);

      if (!isDefault) {
        if (RESERVED_SLUGS.has(finalSlug)) {
          throw new Error(`"/${finalSlug}" is already used by a core page of the site. Please choose a different slug.`);
        }
        finalSlug = ensureUniquePageSlug(finalSlug, pId || null);
        document.getElementById("pg-slug").value = finalSlug;
      }
      // Default pages keep whatever slug they were seeded with, always —
      // never overwritten from the (locked/read-only) slug field.
      if (isDefault) {
        const existingDefault = pagesList.find((x) => x.id === pId);
        finalSlug = existingDefault ? existingDefault.slug : finalSlug;
      }

      let image = document.getElementById("pg-existing-image").value || "";
      const imageFile = document.getElementById("pg-image").files[0];
      if (imageFile) image = await uploadToImgBB(imageFile);

      const pData = {
        heading,
        slug: finalSlug,
        contentPosition: document.getElementById("pg-content-position").value,
        keyphrase: document.getElementById("pg-keyphrase").value.trim(),
        metaTitle: document.getElementById("pg-meta-title").value.trim(),
        metaDesc: document.getElementById("pg-meta-desc").value.trim(),
        image,
        content: getPageContentHTML(),
        status,
        isDefault,
        updatedAt: new Date().toISOString()
      };

      if (pId) {
        await updateDoc(doc(db, "pages", pId), pData);
      } else {
        pData.createdAt = new Date().toISOString();
        await addDoc(collection(db, "pages"), pData);
      }
      resetPageForm();
      goToSection("all-pages");
    } catch (err) {
      document.getElementById("page-save-status").textContent = "Error: " + err.message;
      document.getElementById("page-save-status").style.color = "var(--color-danger)";
    } finally {
      saveBtn.textContent = originalText; saveBtn.disabled = false;
    }
  }

  document.getElementById("publish-page-btn").addEventListener("click", () => handlePageSave("published"));
  document.getElementById("draft-page-btn").addEventListener("click", () => handlePageSave("draft"));

  const previewPageBtn = document.getElementById("preview-page-btn");
  if (previewPageBtn) {
    previewPageBtn.addEventListener("click", () => {
      const heading = document.getElementById("pg-heading").value.trim() || "(untitled)";
      const imgEl = document.getElementById("pg-image-preview").querySelector("img");
      const image = (imgEl && imgEl.src) || document.getElementById("pg-existing-image").value || "";
      const content = getPageContentHTML();
      const win = window.open("", "_blank");
      if (!win) { alert("Please allow pop-ups for this site to preview the page."); return; }
      win.document.write(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + esc(heading) + " — Preview</title>" +
        "<link rel=\"stylesheet\" href=\"" + location.origin + "/css/main.css\">" +
        "<link rel=\"stylesheet\" href=\"" + location.origin + "/css/components.css\">" +
        "<style>body{max-width:760px;margin:40px auto;padding:0 20px 60px;font-family:sans-serif;overflow-wrap:break-word;word-break:break-word;}" +
        ".wp-preview-badge{display:inline-block;background:#e8a33d;color:#fff;font-size:0.75rem;font-weight:bold;letter-spacing:.03em;padding:4px 12px;border-radius:999px;margin-bottom:18px;}" +
        "h1{overflow-wrap:break-word;word-break:break-word;}" +
        ".wp-preview-img{width:100%;max-height:420px;object-fit:cover;border-radius:8px;margin-bottom:24px;}</style>" +
        "</head><body><span class=\"wp-preview-badge\">PREVIEW — not yet saved</span><h1>" + esc(heading) + "</h1>" +
        (image ? "<img class=\"wp-preview-img\" src=\"" + esc(image) + "\" alt=\"\">" : "") +
        "<div class=\"prose\">" + content + "</div></body></html>"
      );
      win.document.close();
    });
  }

  // ================================================================
  // ORDERS
  // ================================================================
  let ordersList = [];
  let currentOrderTab = "all";

  const ACTIVE_STATUSES = ["Pending", "Processing", "Shipped"];

  function orderMatchesTab(order, tab) {
    const status = order.status || "Pending";
    if (tab === "all") return true;
    if (tab === "active") return ACTIVE_STATUSES.includes(status);
    if (tab === "finished") return status === "Delivered";
    if (tab === "cancelled") return status === "Cancelled";
    return true;
  }

  let unsubOrders = null;
  function listenOrders() {
    if (unsubOrders) return;
    unsubOrders = onSnapshot(collection(db, "orders"), (snap) => {
      ordersList = [];
      snap.forEach((d) => ordersList.push({ id: d.id, ...d.data() }));
      ordersList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      renderOrdersTable();
      renderDashboard();
      renderAnalytics();
      // Keep an already-open order details modal in sync too (e.g. status
      // changed from another tab/device while this admin had it open).
      if (currentEditingOrderId && document.getElementById("order-details-modal").style.display !== "none") {
        const stillExists = ordersList.some((o) => o.id === currentEditingOrderId);
        if (stillExists) viewOrder(currentEditingOrderId);
      }
    }, (err) => console.error("orders listener error", err));
  }

  function renderOrdersTable() {
    const tbody = document.getElementById("orders-table-body");
    tbody.innerHTML = "";
    ordersList.filter((o) => orderMatchesTab(o, currentOrderTab)).forEach((o) => {
      let sColor = "var(--color-accent-dark)";
      if (o.status === "Delivered") sColor = "var(--color-success)";
      if (o.status === "Cancelled") sColor = "var(--color-danger)";
      if (o.status === "Shipped") sColor = "var(--color-primary)";
      const dateStr = o.createdAt ? new Date(o.createdAt).toLocaleDateString("en-IN") : "—";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="row-select" data-id="${o.id}"></td>
        <td><strong>${esc(o.orderId)}</strong></td>
        <td>${dateStr}</td>
        <td>${esc(o.customerName)}</td>
        <td>${fmtRupee(o.finalTotal)}</td>
        <td>${esc(o.paymentMethod)}</td>
        <td style="color:${sColor}; font-weight:bold;">${esc(o.status || 'Pending')}</td>
        <td>
          <button class="btn btn-primary view-order-btn" data-id="${o.id}" style="padding:4px 8px; font-size:0.8rem;">Process</button>
          <button class="btn btn-outline invoice-order-btn" data-id="${o.id}" data-order-id="${esc(o.orderId)}" style="padding:4px 8px; font-size:0.8rem;">⬇ Invoice</button>
          <button class="btn btn-outline del-order-btn" data-id="${o.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".view-order-btn").forEach((b) => b.addEventListener("click", () => viewOrder(b.dataset.id)));
    tbody.querySelectorAll(".invoice-order-btn").forEach((b) => b.addEventListener("click", () => downloadSingleInvoice(b.dataset.id, b.dataset.orderId, b)));
    tbody.querySelectorAll(".del-order-btn").forEach((b) => b.addEventListener("click", () => deleteOrder(b.dataset.id)));
  }

  async function deleteOrder(id) {
    if (!confirm("Delete this order permanently? This cannot be undone.")) return;
    await deleteDoc(doc(db, "orders", id));
  }

  // Fetches a file (PDF/ZIP) from an admin-only API route, authenticated
  // with the admin's live Firebase ID token, and triggers a normal
  // browser download — same token pattern already used by
  // product-import-tester.html against api/import-product.js.
  async function downloadAdminFile(url, fallbackFilename, btn, busyLabel) {
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = busyLabel; }
    if (window.LoadingOverlay) window.LoadingOverlay.show();
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) { /* not JSON */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : fallbackFilename;
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
    } catch (err) {
      alert("Couldn't download: " + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
      if (window.LoadingOverlay) window.LoadingOverlay.hide();
    }
  }

  function downloadSingleInvoice(dbId, orderIdLabel, btn) {
    downloadAdminFile(`/api/admin-tools?action=invoice&orderId=${encodeURIComponent(dbId)}`, `Invoice-${orderIdLabel}.pdf`, btn, "Generating…");
  }

  document.getElementById("download-all-invoices-btn").addEventListener("click", async () => {
    const btn = document.getElementById("download-all-invoices-btn");
    const statusEl = document.getElementById("download-all-invoices-status");
    if (statusEl) statusEl.textContent = `Generating ${ordersList.length} invoice(s) — this can take a little while for a lot of orders, please don't close this tab…`;
    await downloadAdminFile(`/api/admin-tools?action=invoice-bulk`, `Invoices-${todayFileStamp()}.zip`, btn, "Generating ZIP…");
    if (statusEl) statusEl.textContent = "";
  });

  wireBulkSelect("orders-table-body", "select-all-orders", "bulk-delete-orders-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "orders", id));
  });

  wireTabStrip("#store-orders .tab-strip", "orderTab", (tab) => { currentOrderTab = tab; renderOrdersTable(); });

  let currentEditingOrderId = null;

  function viewOrder(dbId) {
    const o = ordersList.find((x) => x.id === dbId);
    if (!o) return;
    currentEditingOrderId = dbId;
    document.getElementById("modal-order-id").textContent = "Order: " + o.orderId;
    document.getElementById("modal-order-status").value = o.status || "Pending";

    const custDetails = document.getElementById("modal-cust-details");
    custDetails.innerHTML = "";
    const lines = [
      ["Name", o.customerName], ["Phone", o.customerPhone], ["Email", o.customerEmail],
      ["Address", `${o.customerAddress || ""}, ${o.customerCity || ""}, ${o.customerState || ""} - ${o.customerPincode || ""}`],
      ["Payment Method", o.paymentMethod],
      ["Order Email", o.emailStatus === "sent" ? "✓ Sent" : o.emailStatus === "failed" ? `✗ Failed — ${o.emailError || "unknown error"}` : "— (not attempted / still sending)"]
    ];
    if (o.autoPlaced) {
      lines.splice(4, 0, ["Placed via", "⏱ Auto-placed after the 3-minute checkout timer — customer never tapped \"I have paid\". Verify carefully."]);
    }
    lines.forEach(([label, val]) => {
      const p = document.createElement("div");
      const b = document.createElement("b"); b.textContent = label + ": ";
      const span = document.createElement("span"); span.textContent = val || "—";
      p.appendChild(b); p.appendChild(span);
      custDetails.appendChild(p);
    });

    // Payment screenshot — this is the real verification proof now (the
    // old manual last-6-digit UTR box is gone). Clicking it opens the
    // full-size image in a new tab so admin can zoom in and check it
    // against their bank/UPI app.
    if (o.paymentMethod === "UPI") {
      const p = document.createElement("div");
      const b = document.createElement("b"); b.textContent = "Payment Screenshot: ";
      p.appendChild(b);
      if (o.paymentScreenshotUrl) {
        const thumb = document.createElement("img");
        thumb.src = o.paymentScreenshotUrl;
        thumb.alt = "Payment screenshot";
        thumb.style.cssText = "max-width:120px; max-height:120px; border-radius:6px; border:1px solid var(--color-border,#e2ddd0); cursor:zoom-in; display:block; margin-top:4px;";
        thumb.addEventListener("click", () => openAdminLightbox(o.paymentScreenshotUrl));
        p.appendChild(thumb);
      } else {
        const span = document.createElement("span");
        span.textContent = o.autoPlaced ? "— (order auto-placed, no screenshot was uploaded)" : "— not uploaded";
        span.style.color = "var(--color-danger)";
        p.appendChild(span);
      }
      custDetails.appendChild(p);
    }

    const subtotal = o.subtotal ?? o.finalTotal;
    const discount = o.discount || 0;
    const deliveryFee = o.deliveryFee || 0;
    const codCharge = o.codCharge || 0;
    document.getElementById("modal-price-breakdown").innerHTML = `
      Subtotal: <b>${fmtRupee(subtotal)}</b><br>
      ${discount ? `Discount${o.couponCode ? ' (' + esc(o.couponCode) + ')' : ''}: <b>-${fmtRupee(discount)}</b><br>` : ''}
      ${deliveryFee ? `Delivery Fee: <b>+${fmtRupee(deliveryFee)}</b><br>` : ''}
      ${codCharge ? `COD Charge: <b>+${fmtRupee(codCharge)}</b><br>` : ''}
      Final Total: <b style="color:var(--color-success); font-size:1.1rem;">${fmtRupee(o.finalTotal)}</b>
    `;

    const itemsUl = document.getElementById("modal-order-items");
    itemsUl.innerHTML = "";
    (o.items || []).forEach((item) => {
      const li = document.createElement("li");
      li.style.cssText = "padding:5px 0; border-bottom:1px dashed #ddd; display:flex; align-items:center; justify-content:space-between; gap:10px;";

      const label = document.createElement("span");
      label.textContent = `${item.title} x ${item.quantity} (₹${item.price} each)`;
      li.appendChild(label);

      // The order stores a snapshot of the item at purchase time, not the
      // source link — look that up on the CURRENT product record instead,
      // since the source platform URL can change/be added after the order
      // was placed. If the product was since deleted, there's nothing to
      // link to.
      const product = productsList.find((p) => p.id === item.productId);
      if (product && product.sourcePlatformUrl) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn-outline";
        btn.style.cssText = "padding:4px 8px; font-size:0.78rem; flex-shrink:0;";
        btn.textContent = "Source Platform";
        btn.addEventListener("click", () => window.open(product.sourcePlatformUrl, "_blank", "noopener,noreferrer"));
        li.appendChild(btn);
      }

      itemsUl.appendChild(li);
    });
    document.getElementById("order-details-modal").style.display = "block";

    const notifyNote = document.getElementById("modal-notify-status-note");
    const notifyBox = document.getElementById("modal-notify-customer");
    if (!SETTINGS.emailjs_statusTemplateId) {
      notifyBox.checked = false;
      notifyBox.disabled = true;
      notifyNote.textContent = "Set up an \"Order Status Update Template ID\" in Settings > Account to enable this.";
    } else if (!o.customerEmail) {
      notifyBox.checked = false;
      notifyBox.disabled = true;
      notifyNote.textContent = "This order has no customer email on file — can't notify.";
    } else {
      notifyBox.disabled = false;
      notifyBox.checked = true;
      notifyNote.textContent = `Will email ${o.customerEmail}`;
    }
  }

  document.getElementById("close-order-modal").addEventListener("click", () => {
    document.getElementById("order-details-modal").style.display = "none";
  });
  // Sends a status-change email directly to the GUEST's own address (the
  // one they typed at checkout — no customer account exists, so this is
  // the only "contact point" we have, same as OrderEmail.send in
  // checkout.js but pointed at the customer instead of the admin, using a
  // SEPARATE EmailJS template (SETTINGS.emailjs_statusTemplateId) so the
  // wording can say "your order shipped" instead of "new order received".
  let statusEmailSdkReady = false;
  function loadEmailJsSdk() {
    return new Promise((resolve, reject) => {
      if (statusEmailSdkReady && window.emailjs) return resolve();
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
      script.onload = () => {
        try {
          window.emailjs.init({ publicKey: SETTINGS.emailjs_publicKey });
          statusEmailSdkReady = true;
          resolve();
        } catch (err) { reject(err); }
      };
      script.onerror = () => reject(new Error("Failed to load EmailJS SDK"));
      document.head.appendChild(script);
    });
  }

  async function sendStatusUpdateEmail(order, newStatus) {
    await loadEmailJsSdk();
    return window.emailjs.send(SETTINGS.emailjs_serviceId, SETTINGS.emailjs_statusTemplateId, {
      order_id: order.orderId,
      customer_name: order.customerName,
      new_status: newStatus,
      final_total: fmtRupee(order.finalTotal),
      to_email: order.customerEmail
    });
  }

  document.getElementById("update-status-btn").addEventListener("click", async () => {
    const newStatus = document.getElementById("modal-order-status").value;
    const shouldNotify = document.getElementById("modal-notify-customer").checked && !document.getElementById("modal-notify-customer").disabled;
    const order = ordersList.find((o) => o.id === currentEditingOrderId);
    const btn = document.getElementById("update-status-btn");
    btn.disabled = true; btn.textContent = "Updating...";

    try {
      await updateDoc(doc(db, "orders", currentEditingOrderId), { status: newStatus });
    } catch (err) {
      alert("Could not update status: " + (err.message || err));
      btn.disabled = false; btn.textContent = "Update";
      return;
    }

    if (newStatus === "Cancelled" && order && SETTINGS.telegramApiKey) {
      // Fire-and-forget — a Telegram hiccup should never block the status
      // update itself, which already succeeded above.
      fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": SETTINGS.telegramApiKey },
        body: JSON.stringify({
          event: "order_cancelled",
          data: {
            orderId: order.orderId,
            customerName: order.customerName,
            finalTotal: order.finalTotal,
            adminOrderUrl: `${window.location.origin}/admin.html`
          }
        })
      }).catch((err) => console.warn("Telegram order_cancelled notify failed (non-fatal):", err));
    }

    if (shouldNotify && order) {
      try {
        await sendStatusUpdateEmail(order, newStatus);
        alert("Status updated and customer notified by email!");
      } catch (err) {
        console.warn("Status-update email failed", err);
        alert("Status updated, but the customer email failed to send. (Order status itself is saved correctly.)");
      }
    } else {
      alert("Status updated!");
    }
    btn.disabled = false; btn.textContent = "Update";
  });

  // ================================================================
  // DASHBOARD + ANALYTICS
  // ================================================================
  function renderDashboard() {
    const total = productsList.length;
    const active = productsList.filter((p) => p.status === "active").length;
    const oos = productsList.filter((p) => Number(p.stock) === 0).length;
    const nonCancelled = ordersList.filter((o) => o.status !== "Cancelled");
    const revenue = nonCancelled.reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0);

    document.getElementById("stat-total-products").textContent = total;
    document.getElementById("stat-active-products").textContent = active;
    document.getElementById("stat-oos-products").textContent = oos;
    document.getElementById("stat-total-orders").textContent = ordersList.length;
    document.getElementById("stat-total-revenue").textContent = fmtRupee(revenue);
  }

  function renderBarList(container, rows, maxValue) {
    container.innerHTML = "";
    rows.forEach(({ label, value, colorVar }) => {
      const pct = maxValue > 0 ? Math.round((value / maxValue) * 100) : 0;
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <span class="bar-label">${esc(label)}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%; background:${colorVar || 'var(--color-primary)'};"></span></span>
        <span class="bar-value">${esc(String(value))}</span>`;
      container.appendChild(row);
    });
  }

  // Local YYYY-MM-DD (not UTC) — the previous version keyed days off
  // toISOString(), which is UTC, while the bar *label* used the local
  // weekday. Since IST is UTC+5:30, any order placed in the first ~5.5
  // hours of the local day landed in the previous UTC day's bucket, so it
  // silently showed up under the wrong day (or was missing from "today").
  // Using local date parts everywhere keeps the bucket and its label in
  // sync with the admin's own calendar.
  function localDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function renderAnalytics() {
    // Revenue, last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    const dayRevenue = days.map((d) => {
      const key = localDateKey(d);
      const total = ordersList
        .filter((o) => o.status !== "Cancelled" && o.createdAt && localDateKey(new Date(o.createdAt)) === key)
        .reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0);
      return { label: d.toLocaleDateString("en-IN", { weekday: "short" }), value: total };
    });
    const maxRevenue = Math.max(1, ...dayRevenue.map((d) => d.value));
    const revenueContainer = document.getElementById("analytics-revenue-bars");
    renderBarList(revenueContainer, dayRevenue, maxRevenue);

    // If every bar is ₹0, the raw bars look identical to "broken" (empty
    // grey tracks, no colour). That's usually not a bug — it means every
    // order in the database is dated outside this exact 7-day window
    // (common with old seed/test orders). Say so explicitly instead of
    // leaving an ambiguous blank chart, and point at where the all-time
    // numbers (which DO include everything, any date) can be found.
    const totalRevenueThisWeek = dayRevenue.reduce((s, d) => s + d.value, 0);
    let emptyNote = document.getElementById("analytics-revenue-empty-note");
    if (totalRevenueThisWeek === 0 && ordersList.length > 0) {
      if (!emptyNote) {
        emptyNote = document.createElement("p");
        emptyNote.id = "analytics-revenue-empty-note";
        emptyNote.style.cssText = "color:var(--color-ink-soft); font-size:0.85rem; margin-top:10px;";
        revenueContainer.parentElement.appendChild(emptyNote);
      }
      emptyNote.textContent = `No revenue in the last 7 days specifically, even though there are ${ordersList.length} order(s) total in the database — they're just dated outside this window (older test orders, etc). See "Total Sales" on the Overview tab for the all-time figure.`;
    } else if (emptyNote) {
      emptyNote.remove();
    }

    // Orders by status
    const statuses = ["Pending", "Processing", "Shipped", "Delivered", "Cancelled"];
    const statusRows = statuses.map((s) => ({
      label: s,
      value: ordersList.filter((o) => (o.status || "Pending") === s).length,
      colorVar: s === "Cancelled" ? "var(--color-danger)" : s === "Delivered" ? "var(--color-success)" : "var(--color-primary)"
    }));
    const maxStatus = Math.max(1, ...statusRows.map((r) => r.value));
    renderBarList(document.getElementById("analytics-status-bars"), statusRows, maxStatus);

    // Top products by quantity sold (across all non-cancelled orders)
    const qtyByProduct = {};
    const revenueByProduct = {};
    ordersList.filter((o) => o.status !== "Cancelled").forEach((o) => {
      (o.items || []).forEach((item) => {
        qtyByProduct[item.title] = (qtyByProduct[item.title] || 0) + Number(item.quantity || 0);
        revenueByProduct[item.title] = (revenueByProduct[item.title] || 0) + Number(item.price || 0) * Number(item.quantity || 0);
      });
    });
    const top = Object.entries(qtyByProduct).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const tbody = document.getElementById("analytics-top-products");
    tbody.innerHTML = "";
    if (top.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--color-muted);">No sales yet.</td></tr>`;
    }
    top.forEach(([title, qty], i) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${i + 1}</td><td>${esc(title)}</td><td>${qty}</td><td>${fmtRupee(revenueByProduct[title])}</td>`;
      tbody.appendChild(tr);
    });
  }

  // ================================================================
  // SETTINGS (Account / Payment / Support — three separate forms,
  // all merged into the same settings/store_config Firestore doc so
  // saving one tab never wipes out the others).
  // ================================================================
  wireTabStrip("#settings .tab-strip", "settingsTab", (tab) => {
    document.querySelectorAll("#settings .tab-panel").forEach((p) => p.classList.remove("active"));
    document.getElementById(`settings-tab-${tab}`).classList.add("active");
  });

  async function loadSettings() {
    try {
      const docSnap = await getDoc(doc(db, "settings", "store_config"));
      SETTINGS = docSnap.exists() ? docSnap.data() : {};
    } catch (err) {
      SETTINGS = {};
    }
    document.getElementById("set-store-name").value = SETTINGS.storeName || "";
    document.getElementById("set-admin-name").value = SETTINGS.adminName || "";
    document.getElementById("set-admin-username").value = SETTINGS.adminUsername || "";
    document.getElementById("set-seller-name").value = SETTINGS.sellerName || "";
    document.getElementById("set-seller-id").value = SETTINGS.sellerId || "";
    document.getElementById("set-seller-address").value = SETTINGS.sellerAddress || "";
    document.getElementById("set-tax-enabled").checked = !!SETTINGS.taxEnabled;
    document.getElementById("set-seller-state").value = SETTINGS.sellerState || "";
    document.getElementById("set-gst-number").value = SETTINGS.gstNumber || "";
    document.getElementById("set-tax-rate").value = SETTINGS.taxRate ?? 0;
    document.getElementById("set-imgbb-key").value = SETTINGS.imgbbKey || "";
    document.getElementById("set-email-pub").value = SETTINGS.emailjs_publicKey || "";
    document.getElementById("set-email-srv").value = SETTINGS.emailjs_serviceId || "";
    document.getElementById("set-email-tpl").value = SETTINGS.emailjs_templateId || "";
    document.getElementById("set-email-customer-tpl").value = SETTINGS.emailjs_customerTemplateId || "";
    document.getElementById("set-email-status-tpl").value = SETTINGS.emailjs_statusTemplateId || "";
    document.getElementById("set-telegram-api-key").value = SETTINGS.telegramApiKey || "";
    document.getElementById("set-ga4-id").value = SETTINGS.ga4MeasurementId || "";
    document.getElementById("set-meta-pixel-id").value = SETTINGS.metaPixelId || "";
    document.getElementById("feed-sitemap-url").textContent = `${window.location.origin}/sitemap.xml`;
    document.getElementById("feed-robots-url").textContent = `${window.location.origin}/robots.txt`;
    document.getElementById("feed-product-url").textContent = `${window.location.origin}/product-feed.csv`;
    document.getElementById("set-upi-id").value = SETTINGS.upiId || "";
    document.getElementById("set-cod-charge").value = SETTINGS.codExtraCharge ?? 30;
    document.getElementById("set-support-email").value = SETTINGS.supportEmail || "";
    document.getElementById("set-support-phone").value = SETTINGS.supportPhone || "";
    const marginSettings = SETTINGS.storeMargin || { type: "percent", value: "" };
    document.getElementById("set-margin-type").value = marginSettings.type || "percent";
    document.getElementById("set-margin-value").value = marginSettings.value ?? "";
    updateMarginExampleHint();
    const sidebarLabel = document.querySelector("[data-site-name]");
    if (sidebarLabel) sidebarLabel.textContent = (SETTINGS.storeName || "AzubaTrends") + " Admin";
  }

  async function saveSettingsPatch(patch, btn) {
    const originalText = btn.textContent;
    btn.textContent = "Saving..."; btn.disabled = true;
    try {
      await setDoc(doc(db, "settings", "store_config"), patch, { merge: true });
      Object.assign(SETTINGS, patch);
      alert("Saved!");
    } catch (err) {
      alert("Failed to save: " + err.message);
    } finally {
      btn.textContent = originalText; btn.disabled = false;
    }
  }

  document.getElementById("account-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsPatch({
      storeName: document.getElementById("set-store-name").value,
      adminName: document.getElementById("set-admin-name").value,
      adminUsername: document.getElementById("set-admin-username").value,
      sellerName: document.getElementById("set-seller-name").value.trim(),
      sellerId: document.getElementById("set-seller-id").value.trim(),
      sellerAddress: document.getElementById("set-seller-address").value.trim(),
      taxEnabled: document.getElementById("set-tax-enabled").checked,
      sellerState: document.getElementById("set-seller-state").value.trim(),
      gstNumber: document.getElementById("set-gst-number").value.trim(),
      taxRate: Number(document.getElementById("set-tax-rate").value) || 0,
      imgbbKey: document.getElementById("set-imgbb-key").value,
      emailjs_publicKey: document.getElementById("set-email-pub").value,
      emailjs_serviceId: document.getElementById("set-email-srv").value,
      emailjs_templateId: document.getElementById("set-email-tpl").value,
      emailjs_customerTemplateId: document.getElementById("set-email-customer-tpl").value,
      emailjs_statusTemplateId: document.getElementById("set-email-status-tpl").value,
      telegramApiKey: document.getElementById("set-telegram-api-key").value,
    }, document.getElementById("save-account-settings-btn"));
  });

  document.getElementById("marketing-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsPatch({
      ga4MeasurementId: document.getElementById("set-ga4-id").value.trim(),
      metaPixelId: document.getElementById("set-meta-pixel-id").value.trim(),
    }, document.getElementById("save-marketing-settings-btn"));
  });

  document.getElementById("payment-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsPatch({
      upiId: document.getElementById("set-upi-id").value,
      codExtraCharge: Number(document.getElementById("set-cod-charge").value) || 0,
    }, document.getElementById("save-payment-settings-btn"));
  });

  function currentMarginSettings() {
    const type = document.getElementById("set-margin-type").value === "flat" ? "flat" : "percent";
    const value = Number(document.getElementById("set-margin-value").value) || 0;
    return { type, value };
  }

  function applyMarginToPrice(price) {
    const p = Number(price) || 0;
    const { type, value } = currentMarginSettings();
    if (!value || value <= 0) return p;
    const marked = type === "flat" ? p + value : p + (p * value) / 100;
    return Math.round(marked);
  }

  function updateMarginExampleHint() {
    const { type, value } = currentMarginSettings();
    const hint = document.getElementById("margin-example-hint");
    if (!value || value <= 0) {
      hint.textContent = "No margin set — products will show their Sale Price exactly as entered.";
      return;
    }
    const sample = 500;
    const marked = applyMarginToPrice(sample);
    hint.textContent = type === "percent"
      ? `Example: a ₹${sample} Sale Price will show as ₹${marked} on the site (${value}% added).`
      : `Example: a ₹${sample} Sale Price will show as ₹${marked} on the site (₹${value} added flat).`;
  }
  document.getElementById("set-margin-type").addEventListener("change", updateMarginExampleHint);
  document.getElementById("set-margin-value").addEventListener("input", updateMarginExampleHint);

  document.getElementById("margin-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsPatch({ storeMargin: currentMarginSettings() }, document.getElementById("save-margin-settings-btn"));
  });

  document.getElementById("recalc-ratings-btn").addEventListener("click", async () => {
    const btn = document.getElementById("recalc-ratings-btn");
    const statusEl = document.getElementById("recalc-ratings-status");
    btn.disabled = true;
    btn.textContent = "Recalculating…";
    statusEl.textContent = "";
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/admin-tools?action=recalc-ratings", { headers: { Authorization: `Bearer ${idToken}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      statusEl.textContent = `Done — ${data.productsUpdated} product(s) updated. Ratings will show up on the site within a minute or so (cache refresh).`;
    } catch (err) {
      statusEl.textContent = "Failed: " + err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = "Recalculate All Product Ratings";
    }
  });

  document.getElementById("support-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsPatch({
      supportEmail: document.getElementById("set-support-email").value,
      supportPhone: document.getElementById("set-support-phone").value,
    }, document.getElementById("save-support-settings-btn"));
  });

  // ================================================================
  // Telegram Integration
  // ================================================================
  let telegramBotsList = [];
  let unsubTelegramBots = null;

  function listenTelegramBots() {
    if (unsubTelegramBots) return;
    unsubTelegramBots = onSnapshot(collection(db, "telegram_bots"), (snap) => {
      telegramBotsList = [];
      snap.forEach((d) => telegramBotsList.push({ id: d.id, ...d.data() }));
      renderTelegramBotsTable();
    });
  }

  const EVENT_LABELS = {
    new_order: "🛒 New Order",
    out_of_stock: "⚠️ Out of Stock",
    low_stock: "🟡 Low Stock",
    new_review: "⭐ New Review",
    order_cancelled: "❌ Order Cancelled",
    daily_digest: "📊 Daily Summary"
  };

  function renderTelegramBotsTable() {
    const tbody = document.getElementById("telegram-bots-table-body");
    tbody.innerHTML = "";
    if (telegramBotsList.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--color-muted);">No bots added yet — use the form below.</td></tr>`;
      return;
    }
    telegramBotsList.forEach((b) => {
      const eventsLabel = (b.events || []).map((e) => EVENT_LABELS[e] || e).join(", ") || "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${esc(b.name)}</td>
        <td style="font-family:monospace; font-size:0.8rem;">${esc(b.chatId)}</td>
        <td style="font-size:0.8rem;">${esc(eventsLabel)}</td>
        <td style="color:${b.active ? 'var(--color-success)' : 'var(--color-ink-soft)'}; font-weight:bold;">${b.active ? "Yes" : "No"}</td>
        <td>
          <button class="btn btn-outline tg-edit-btn" data-id="${b.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline tg-del-btn" data-id="${b.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".tg-edit-btn").forEach((btn) => btn.addEventListener("click", () => editTelegramBot(btn.dataset.id)));
    tbody.querySelectorAll(".tg-del-btn").forEach((btn) => btn.addEventListener("click", () => deleteTelegramBot(btn.dataset.id)));
  }

  function resetTelegramForm() {
    document.getElementById("telegram-bot-form").reset();
    document.getElementById("tg-edit-id").value = "";
    document.getElementById("telegram-form-title").textContent = "Add Bot";
    document.getElementById("tg-cancel-edit-btn").style.display = "none";
    document.getElementById("tg-status-msg").textContent = "";
    document.querySelectorAll(".tg-event-check").forEach((c) => { c.checked = (c.value === "new_order" || c.value === "out_of_stock"); });
  }

  function editTelegramBot(id) {
    const b = telegramBotsList.find((x) => x.id === id);
    if (!b) return;
    document.getElementById("tg-edit-id").value = id;
    document.getElementById("tg-name").value = b.name || "";
    document.getElementById("tg-token").value = b.token || "";
    document.getElementById("tg-chat-id").value = b.chatId || "";
    document.getElementById("tg-active").checked = !!b.active;
    document.querySelectorAll(".tg-event-check").forEach((c) => { c.checked = (b.events || []).includes(c.value); });
    document.getElementById("telegram-form-title").textContent = `Edit Bot: ${b.name}`;
    document.getElementById("tg-cancel-edit-btn").style.display = "inline-block";
    document.getElementById("tg-status-msg").textContent = "";
    document.getElementById("settings-tab-telegram").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function deleteTelegramBot(id) {
    if (!confirm("Delete this bot? It will stop receiving notifications immediately.")) return;
    await deleteDoc(doc(db, "telegram_bots", id));
  }

  document.getElementById("tg-cancel-edit-btn").addEventListener("click", resetTelegramForm);

  document.getElementById("telegram-bot-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const editId = document.getElementById("tg-edit-id").value;
    const payload = {
      name: document.getElementById("tg-name").value.trim(),
      token: document.getElementById("tg-token").value.trim(),
      chatId: document.getElementById("tg-chat-id").value.trim(),
      active: document.getElementById("tg-active").checked,
      events: Array.from(document.querySelectorAll(".tg-event-check:checked")).map((c) => c.value)
    };
    const btn = document.getElementById("save-telegram-bot-btn");
    btn.disabled = true; btn.textContent = "Saving...";
    try {
      if (editId) {
        await updateDoc(doc(db, "telegram_bots", editId), payload);
      } else {
        await addDoc(collection(db, "telegram_bots"), payload);
      }
      document.getElementById("tg-status-msg").style.color = "var(--color-success)";
      document.getElementById("tg-status-msg").textContent = "✓ Saved.";
      resetTelegramForm();
    } catch (err) {
      document.getElementById("tg-status-msg").style.color = "var(--color-danger)";
      document.getElementById("tg-status-msg").textContent = "Could not save: " + (err.message || err);
    }
    btn.disabled = false; btn.textContent = "Save Bot";
  });

  async function callTelegramTestApi(action) {
    const statusEl = document.getElementById("tg-status-msg");
    if (!SETTINGS.telegramApiKey) {
      statusEl.style.color = "var(--color-danger)";
      statusEl.textContent = "Set a \"Telegram Notify API Key\" in Settings > Account first (must match TELEGRAM_NOTIFY_API_KEY in Vercel).";
      return;
    }
    const token = document.getElementById("tg-token").value.trim();
    const chatId = document.getElementById("tg-chat-id").value.trim();
    if (!token) {
      statusEl.style.color = "var(--color-danger)";
      statusEl.textContent = "Enter a bot token first.";
      return;
    }
    if (action === "test" && !chatId) {
      statusEl.style.color = "var(--color-danger)";
      statusEl.textContent = "Enter a Chat ID first (or use Fetch Chat ID).";
      return;
    }

    statusEl.style.color = "var(--color-ink-soft)";
    statusEl.textContent = action === "test" ? "Sending test message..." : "Fetching chat ID...";

    try {
      const res = await fetch("/api/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": SETTINGS.telegramApiKey },
        body: JSON.stringify({ action, token, chatId, storeName: SETTINGS.storeName || "your store" })
      });
      if (res.status === 404) {
        statusEl.style.color = "var(--color-danger)";
        statusEl.textContent = "api/telegram not found — make sure you're on the Vercel deployment, not GitHub Pages or a local file.";
        return;
      }
      const data = await res.json();
      if (!data.ok) {
        statusEl.style.color = "var(--color-danger)";
        statusEl.textContent = data.error || "Something went wrong.";
        return;
      }
      if (action === "fetchChatId") {
        document.getElementById("tg-chat-id").value = data.chatId;
        statusEl.style.color = "var(--color-success)";
        statusEl.textContent = `✓ Found chat: ${data.chatTitle || data.chatId}`;
      } else {
        statusEl.style.color = "var(--color-success)";
        statusEl.textContent = "✓ Test message sent — check your Telegram chat.";
      }
    } catch (err) {
      statusEl.style.color = "var(--color-danger)";
      statusEl.textContent = "Request failed: " + (err.message || err);
    }
  }

  document.getElementById("tg-fetch-chat-id-btn").addEventListener("click", () => callTelegramTestApi("fetchChatId"));
  document.getElementById("tg-test-btn").addEventListener("click", () => callTelegramTestApi("test"));

  // ================================================================
  // CSV export buttons (Overview / Products / Brands / Coupons / Orders)
  // ================================================================
  const ovRangeSelect = document.getElementById("ov-export-range");
  const ovFromWrap = document.getElementById("ov-export-from-wrap");
  const ovToWrap = document.getElementById("ov-export-to-wrap");
  if (ovRangeSelect) {
    ovRangeSelect.addEventListener("change", () => {
      const isCustom = ovRangeSelect.value === "custom";
      ovFromWrap.style.display = isCustom ? "" : "none";
      ovToWrap.style.display = isCustom ? "" : "none";
    });
  }

  document.getElementById("ov-export-csv-btn")?.addEventListener("click", () => {
    const range = ovRangeSelect.value;
    const from = document.getElementById("ov-export-from").value;
    const to = document.getElementById("ov-export-to").value;
    if (range === "custom" && (!from || !to)) { alert("Please pick both a From and To date for a custom range."); return; }
    const rows = buildOverviewReportCSV(range, from, to);
    downloadCSV(`overview-report-${range}-${todayFileStamp()}.csv`, rows);
  });

  document.getElementById("export-products-csv-btn")?.addEventListener("click", () => {
    downloadCSV(`products-${todayFileStamp()}.csv`, buildProductsReportCSV());
  });

  document.getElementById("export-brands-csv-btn")?.addEventListener("click", () => {
    downloadCSV(`brands-${todayFileStamp()}.csv`, buildBrandsReportCSV());
  });

  document.getElementById("export-coupons-csv-btn")?.addEventListener("click", () => {
    downloadCSV(`coupons-${todayFileStamp()}.csv`, buildCouponsReportCSV());
  });

  document.getElementById("export-orders-csv-btn")?.addEventListener("click", () => {
    downloadCSV(`orders-${todayFileStamp()}.csv`, buildOrdersReportCSV());
  });

  // ================================================================
  // Boot sequence — realtime sync
  // ================================================================
  // Every list (products/categories/brands/coupons/orders) is now backed by
  // an onSnapshot listener instead of a one-time getDocs call, so placing a
  // new order, editing a product from another tab, etc. shows up here the
  // instant Firestore pushes the change — no manual reload, no hard reload.
  let syncStarted = false;

  async function startRealtimeSync() {
    if (syncStarted) return;
    syncStarted = true;

    await loadSettings();
    listenCategories();
    listenBrands();
    listenCoupons();
    listenProducts();
    listenOrders();
    listenTelegramBots();
    listenBlogPosts();
    listenBlogCategories();
    listenPages();

    // Reopen whichever section the admin was last looking at (Overview by
    // default) instead of always resetting to the first sidebar item on a
    // browser reload.
    let target = "dash-overview";
    try {
      const saved = localStorage.getItem(LAST_SECTION_KEY);
      if (saved && document.getElementById(saved)) target = saved;
    } catch (err) { /* storage unavailable, fall back to default */ }
    goToSection(target, { silent: true });
  }

  function stopRealtimeSync() {
    [unsubCategories, unsubBrands, unsubCoupons, unsubProducts, unsubOrders, unsubTelegramBots, unsubBlogPosts, unsubBlogCategories, unsubPages].forEach((unsub) => {
      if (typeof unsub === "function") unsub();
    });
    unsubCategories = unsubBrands = unsubCoupons = unsubProducts = unsubOrders = unsubTelegramBots = unsubBlogPosts = unsubBlogCategories = unsubPages = null;
    syncStarted = false;
    pagesSeeded = false;
  }

}, 500);