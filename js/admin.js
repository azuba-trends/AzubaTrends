import {
  collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc, getDoc, query, orderBy
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
      loadAllData();
    } else {
      loginScreen.style.display = "block";
      adminLayout.style.display = "none";
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
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const target = e.currentTarget.dataset.target;
      document.querySelectorAll(".sidebar .nav-btn").forEach((b) => b.classList.remove("active"));
      const sidebarMatch = document.querySelector(`.sidebar .nav-btn[data-target="${target}"]`);
      if (sidebarMatch) sidebarMatch.classList.add("active");
      document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
      document.getElementById(target).classList.add("active");

      const fresh = e.currentTarget.dataset.freshForm;
      if (fresh === "product") resetProductForm();
      if (fresh === "category") resetCategoryForm();
      if (fresh === "brand") resetBrandForm();

      window.scrollTo({ top: 0, behavior: "smooth" });
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

  // Helper: Upload image via ImgBB, using the key from Settings (never hardcoded)
  async function uploadToImgBB(file) {
    if (!SETTINGS.imgbbKey) {
      throw new Error("No ImgBB API key set. Add one in Settings > Account before uploading images.");
    }
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(SETTINGS.imgbbKey)}`, { method: "POST", body: formData });
    const data = await res.json();
    if (data.success) return data.data.url;
    throw new Error("Image upload failed: " + (data.error?.message || "unknown error"));
  }

  function previewFileList(input, container, max) {
    container.innerHTML = "";
    const files = Array.from(input.files || []).slice(0, max);
    files.forEach((file) => {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      container.appendChild(img);
    });
  }

  function previewExistingImages(container, urls) {
    container.innerHTML = "";
    (urls || []).forEach((url) => {
      const img = document.createElement("img");
      img.src = url;
      container.appendChild(img);
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

  async function loadCategories() {
    const snap = await getDocs(collection(db, "categories"));
    categoriesList = [];
    snap.forEach((d) => categoriesList.push({ id: d.id, ...d.data() }));

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
    document.querySelector('.nav-btn[data-target="store-add-category"]').click();
  }

  async function deleteCategory(id) {
    if (!confirm("Delete this category?")) return;
    await deleteDoc(doc(db, "categories", id));
    loadCategories();
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
      document.querySelector('.nav-btn[data-target="store-categories"]').click();
      loadCategories();
    } catch (err) {
      alert("Error saving category: " + err.message);
    } finally {
      btn.textContent = "Save Category"; btn.disabled = false;
    }
  });

  wireBulkSelect("categories-table-body", "select-all-categories", "bulk-delete-categories-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "categories", id));
    loadCategories();
  });

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

  async function loadBrands() {
    const snap = await getDocs(collection(db, "brands"));
    brandsList = [];
    snap.forEach((d) => brandsList.push({ id: d.id, ...d.data() }));

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
    document.querySelector('.nav-btn[data-target="store-add-brand"]').click();
  }

  async function deleteBrand(id) {
    if (!confirm("Delete this brand?")) return;
    await deleteDoc(doc(db, "brands", id));
    loadBrands();
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
      document.querySelector('.nav-btn[data-target="store-brands"]').click();
      loadBrands();
    } catch (err) {
      alert("Error saving brand: " + err.message);
    } finally {
      btn.textContent = "Save Brand"; btn.disabled = false;
    }
  });

  wireBulkSelect("brands-table-body", "select-all-brands", "bulk-delete-brands-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "brands", id));
    loadBrands();
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
  // PRODUCTS
  // ================================================================
  let productsList = [];

  document.getElementById("prod-name").addEventListener("input", (e) => {
    document.getElementById("prod-slug").value = generateSlug(e.target.value);
  });
  document.getElementById("prod-feature-img").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("prod-feature-preview"), 1));
  document.getElementById("prod-gallery-imgs").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("prod-gallery-preview"), 5));
  document.getElementById("prod-delivery-img").addEventListener("change", (e) => previewFileList(e.target, document.getElementById("prod-delivery-preview"), 1));

  function resetProductForm() {
    document.getElementById("product-form").reset();
    document.getElementById("prod-id").value = "";
    document.getElementById("prod-existing-images").value = "";
    document.getElementById("prod-existing-delivery-img").value = "";
    document.getElementById("prod-feature-preview").innerHTML = "";
    document.getElementById("prod-gallery-preview").innerHTML = "";
    document.getElementById("prod-delivery-preview").innerHTML = "";
    document.getElementById("product-form-title").textContent = "Add New Product";
  }

  async function loadProducts() {
    const snap = await getDocs(collection(db, "products"));
    productsList = [];
    snap.forEach((d) => productsList.push({ id: d.id, ...d.data() }));

    const tbody = document.getElementById("products-table-body");
    tbody.innerHTML = "";
    productsList.forEach((p) => {
      const sColor = p.status === "active" ? "var(--color-success)" : "var(--color-accent-dark)";
      const img = (p.images && p.images[0]) ? p.images[0] : "images/logo-placeholder.svg";
      const dateStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString("en-IN") : "—";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input type="checkbox" class="row-select" data-id="${p.id}"></td>
        <td><img src="${esc(img)}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;" alt=""></td>
        <td>${esc(p.title)}</td>
        <td>${esc(p.brand || "—")}</td>
        <td>${esc((p.tags || []).join(", "))}</td>
        <td>${esc(p.category)}</td>
        <td>${dateStr}</td>
        <td style="color:${p.stock > 0 ? 'inherit' : 'var(--color-danger)'}; font-weight:bold;">${p.stock}</td>
        <td style="color:${sColor}; font-weight:bold;">${esc((p.status || "").toUpperCase())}</td>
        <td>
          <button class="btn btn-outline pause-prod-btn" data-id="${p.id}" data-status="${p.status}" style="padding:4px 8px; font-size:0.8rem;">${p.status === 'active' ? 'Pause' : 'Live'}</button>
          <button class="btn btn-outline edit-prod-btn" data-id="${p.id}" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline del-prod-btn" data-id="${p.id}" style="color:var(--color-danger); padding:4px 8px; font-size:0.8rem;">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".pause-prod-btn").forEach((b) => b.addEventListener("click", () => toggleProductStatus(b.dataset.id, b.dataset.status)));
    tbody.querySelectorAll(".edit-prod-btn").forEach((b) => b.addEventListener("click", () => editProduct(b.dataset.id)));
    tbody.querySelectorAll(".del-prod-btn").forEach((b) => b.addEventListener("click", () => deleteProduct(b.dataset.id)));
  }

  function editProduct(id) {
    const p = productsList.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("prod-id").value = id;
    document.getElementById("prod-name").value = p.title || "";
    document.getElementById("prod-slug").value = p.slug || "";
    document.getElementById("prod-mrp").value = p.mrp ?? "";
    document.getElementById("prod-price").value = p.sellingPrice ?? "";
    document.getElementById("prod-stock").value = p.stock ?? "";
    document.getElementById("prod-tags").value = (p.tags || []).join(", ");
    document.getElementById("prod-sku").value = p.sku || "";
    document.getElementById("prod-short-desc").value = p.shortDescription || "";
    document.getElementById("prod-long-desc").value = p.description || "";
    document.getElementById("prod-delivery-fee").value = p.deliveryFee ?? 0;
    document.getElementById("prod-delivery-partner-name").value = p.deliveryPartnerName || "";
    document.getElementById("prod-existing-images").value = JSON.stringify(p.images || []);
    document.getElementById("prod-existing-delivery-img").value = p.deliveryPartnerImage || "";
    previewExistingImages(document.getElementById("prod-feature-preview"), p.images && p.images[0] ? [p.images[0]] : []);
    previewExistingImages(document.getElementById("prod-gallery-preview"), (p.images || []).slice(1));
    previewExistingImages(document.getElementById("prod-delivery-preview"), p.deliveryPartnerImage ? [p.deliveryPartnerImage] : []);
    setTimeout(() => {
      document.getElementById("prod-category").value = p.category || "";
      document.getElementById("prod-brand").value = p.brand || "";
    }, 100);

    document.getElementById("product-form-title").textContent = "Edit Product";
    document.querySelector('.nav-btn[data-target="store-add-product"]').click();
  }

  async function toggleProductStatus(id, currentStatus) {
    const newStatus = currentStatus === "active" ? "draft" : "active";
    await updateDoc(doc(db, "products", id), { status: newStatus });
    loadProducts();
  }

  async function deleteProduct(id) {
    if (!confirm("Delete this product permanently?")) return;
    await deleteDoc(doc(db, "products", id));
    loadProducts();
  }

  async function handleProductSave(status) {
    const title = document.getElementById("prod-name").value.trim();
    if (!title) return alert("Product name is required");
    if (!document.getElementById("prod-category").value) return alert("Please select a category");

    const saveBtn = status === "active" ? document.getElementById("publish-prod-btn") : document.getElementById("draft-prod-btn");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Uploading..."; saveBtn.disabled = true;
    document.getElementById("product-save-status").textContent = "";

    try {
      // Feature + gallery images
      let images = JSON.parse(document.getElementById("prod-existing-images").value || "[]");
      const featureFile = document.getElementById("prod-feature-img").files[0];
      const galleryFiles = Array.from(document.getElementById("prod-gallery-imgs").files || []).slice(0, 5);

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

      const pData = {
        title,
        slug: document.getElementById("prod-slug").value || generateSlug(title),
        category: document.getElementById("prod-category").value,
        brand: document.getElementById("prod-brand").value,
        mrp: Number(document.getElementById("prod-mrp").value) || 0,
        sellingPrice: Number(document.getElementById("prod-price").value) || 0,
        stock: Number(document.getElementById("prod-stock").value) || 0,
        sku: document.getElementById("prod-sku").value,
        tags: document.getElementById("prod-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
        shortDescription: document.getElementById("prod-short-desc").value,
        description: document.getElementById("prod-long-desc").value,
        deliveryFee: Number(document.getElementById("prod-delivery-fee").value) || 0,
        deliveryPartnerName: document.getElementById("prod-delivery-partner-name").value,
        deliveryPartnerImage,
        images,
        status,
        updatedAt: new Date().toISOString()
      };

      const pId = document.getElementById("prod-id").value;
      if (pId) {
        await updateDoc(doc(db, "products", pId), pData);
      } else {
        pData.createdAt = new Date().toISOString();
        await addDoc(collection(db, "products"), pData);
      }
      resetProductForm();
      document.querySelector('.nav-btn[data-target="store-products"]').click();
      loadProducts();
    } catch (err) {
      document.getElementById("product-save-status").textContent = "Error: " + err.message;
      document.getElementById("product-save-status").style.color = "var(--color-danger)";
    } finally {
      saveBtn.textContent = originalText; saveBtn.disabled = false;
    }
  }

  document.getElementById("publish-prod-btn").addEventListener("click", () => handleProductSave("active"));
  document.getElementById("draft-prod-btn").addEventListener("click", () => handleProductSave("draft"));

  wireBulkSelect("products-table-body", "select-all-products", "bulk-delete-products-btn", async (ids) => {
    for (const id of ids) await deleteDoc(doc(db, "products", id));
    loadProducts();
  });

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

  async function loadOrders() {
    const snap = await getDocs(collection(db, "orders"));
    ordersList = [];
    snap.forEach((d) => ordersList.push({ id: d.id, ...d.data() }));
    ordersList.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    renderOrdersTable();
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
        <td><strong>${esc(o.orderId)}</strong></td>
        <td>${dateStr}</td>
        <td>${esc(o.customerName)}</td>
        <td>${fmtRupee(o.finalTotal)}</td>
        <td>${esc(o.paymentMethod)}</td>
        <td style="color:${sColor}; font-weight:bold;">${esc(o.status || 'Pending')}</td>
        <td><button class="btn btn-primary view-order-btn" data-id="${o.id}" style="padding:4px 8px; font-size:0.8rem;">Process</button></td>`;
      tbody.appendChild(tr);
    });
    tbody.querySelectorAll(".view-order-btn").forEach((b) => b.addEventListener("click", () => viewOrder(b.dataset.id)));
  }

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
      ["Address", `${o.customerAddress || ""}, ${o.customerCity || ""}, ${o.customerState || ""} - ${o.customerPincode || ""}`]
    ];
    lines.forEach(([label, val]) => {
      const p = document.createElement("div");
      const b = document.createElement("b"); b.textContent = label + ": ";
      const span = document.createElement("span"); span.textContent = val || "—";
      p.appendChild(b); p.appendChild(span);
      custDetails.appendChild(p);
    });

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
      li.style.padding = "5px 0"; li.style.borderBottom = "1px dashed #ddd";
      li.textContent = `${item.title} x ${item.quantity} (₹${item.price} each)`;
      itemsUl.appendChild(li);
    });
    document.getElementById("order-details-modal").style.display = "block";
  }

  document.getElementById("close-order-modal").addEventListener("click", () => {
    document.getElementById("order-details-modal").style.display = "none";
  });
  document.getElementById("update-status-btn").addEventListener("click", async () => {
    const newStatus = document.getElementById("modal-order-status").value;
    await updateDoc(doc(db, "orders", currentEditingOrderId), { status: newStatus });
    alert("Status updated!");
    loadOrders();
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

  function renderAnalytics() {
    // Revenue, last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d);
    }
    const dayRevenue = days.map((d) => {
      const key = d.toISOString().slice(0, 10);
      const total = ordersList
        .filter((o) => o.status !== "Cancelled" && (o.createdAt || "").slice(0, 10) === key)
        .reduce((sum, o) => sum + (Number(o.finalTotal) || 0), 0);
      return { label: d.toLocaleDateString("en-IN", { weekday: "short" }), value: total };
    });
    const maxRevenue = Math.max(1, ...dayRevenue.map((d) => d.value));
    renderBarList(document.getElementById("analytics-revenue-bars"), dayRevenue, maxRevenue);

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
    document.getElementById("set-imgbb-key").value = SETTINGS.imgbbKey || "";
    document.getElementById("set-email-pub").value = SETTINGS.emailjs_publicKey || "";
    document.getElementById("set-email-srv").value = SETTINGS.emailjs_serviceId || "";
    document.getElementById("set-email-tpl").value = SETTINGS.emailjs_templateId || "";
    document.getElementById("set-upi-id").value = SETTINGS.upiId || "";
    document.getElementById("set-cod-charge").value = SETTINGS.codExtraCharge ?? 30;
    document.getElementById("set-support-email").value = SETTINGS.supportEmail || "";
    document.getElementById("set-support-phone").value = SETTINGS.supportPhone || "";
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
      imgbbKey: document.getElementById("set-imgbb-key").value,
      emailjs_publicKey: document.getElementById("set-email-pub").value,
      emailjs_serviceId: document.getElementById("set-email-srv").value,
      emailjs_templateId: document.getElementById("set-email-tpl").value,
    }, document.getElementById("save-account-settings-btn"));
  });

  document.getElementById("payment-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsPatch({
      upiId: document.getElementById("set-upi-id").value,
      codExtraCharge: Number(document.getElementById("set-cod-charge").value) || 0,
    }, document.getElementById("save-payment-settings-btn"));
  });

  document.getElementById("support-settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettingsPatch({
      supportEmail: document.getElementById("set-support-email").value,
      supportPhone: document.getElementById("set-support-phone").value,
    }, document.getElementById("save-support-settings-btn"));
  });

  // ================================================================
  // Boot sequence
  // ================================================================
  async function loadAllData() {
    await loadSettings();
    await loadCategories();
    await loadBrands();
    await loadProducts();
    await loadOrders();
    renderDashboard();
    renderAnalytics();
  }

}, 500);
