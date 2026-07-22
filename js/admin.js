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
  const NON_RESTORABLE_SECTIONS = new Set(["store-add-product", "store-add-category", "store-add-brand", "store-add-coupon", "blog-add-post", "blog-add-category"]);

  function goToSection(target, opts) {
    document.querySelectorAll(".sidebar .nav-btn").forEach((b) => b.classList.remove("active"));
    const sidebarMatch = document.querySelector(`.sidebar .nav-btn[data-target="${target}"]`);
    if (sidebarMatch) sidebarMatch.classList.add("active");
    // If we're landing on a nested "Add X" page, expand its parent "All X"
    // group so the highlighted sub-item is actually visible in the sidebar.
    if (sidebarMatch && sidebarMatch.classList.contains("nav-subbtn")) {
      const parentItem = sidebarMatch.closest(".nav-item");
      if (parentItem) {
        const submenu = parentItem.querySelector(".nav-submenu");
        const caret = parentItem.querySelector(".nav-caret");
        if (submenu) submenu.classList.add("open");
        if (caret) { caret.classList.add("open"); caret.setAttribute("aria-expanded", "true"); }
      }
    }
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    const el = document.getElementById(target);
    if (!el) return;
    el.classList.add("active");
    // WordPress-style full-screen editor: hide the sidebar/topbar while the
    // Add/Edit Post screen is open, same as post-new.php / post.php.
    document.getElementById("admin-layout").classList.toggle("editor-mode", target === "blog-add-post");
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

  // Expand/collapse the "All X" -> "Add X" sidebar groups. The caret is a
  // separate button from the nav-btn so clicking it toggles the submenu
  // without also navigating to that section.
  document.querySelectorAll(".nav-caret").forEach((caret) => {
    caret.addEventListener("click", (e) => {
      e.stopPropagation();
      const item = caret.closest(".nav-item");
      const submenu = item && item.querySelector(".nav-submenu");
      if (!submenu) return;
      const isOpen = submenu.classList.toggle("open");
      caret.classList.toggle("open", isOpen);
      caret.setAttribute("aria-expanded", String(isOpen));
    });
  });

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
    const seoDesc = (document.getElementById("prod-seo-desc").value || document.getElementById("prod-short-desc")?.value || "").toLowerCase();
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
  ["prod-keyphrase", "prod-seo-title", "prod-seo-desc", "prod-slug", "prod-short-desc"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderSeoChecklist);
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
    renderSeoChecklist();
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

  function renderProductsTable() {
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
        <td>${p.sourcePlatformUrl ? `<button class="btn btn-outline source-platform-btn" data-url="${esc(p.sourcePlatformUrl)}" style="padding:4px 8px; font-size:0.8rem;">Source Platform</button>` : '<span style="color:var(--color-ink-soft); font-size:0.8rem;">—</span>'}</td>
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
    tbody.querySelectorAll(".source-platform-btn").forEach((b) => b.addEventListener("click", () => window.open(b.dataset.url, "_blank", "noopener,noreferrer")));
  }

  function editProduct(id) {
    const p = productsList.find((x) => x.id === id);
    if (!p) return;
    document.getElementById("prod-id").value = id;
    document.getElementById("prod-name").value = p.title || "";
    document.getElementById("prod-slug").value = p.slug || "";
    document.getElementById("prod-keyphrase").value = p.keyphrase || "";
    document.getElementById("prod-seo-title").value = p.seoTitle || "";
    document.getElementById("prod-seo-desc").value = p.seoDesc || "";
    document.getElementById("prod-mrp").value = p.mrp ?? "";
    document.getElementById("prod-price").value = p.sellingPrice ?? "";
    document.getElementById("prod-stock").value = p.stock ?? "";
    document.getElementById("prod-tags").value = (p.tags || []).join(", ");
    document.getElementById("prod-sku").value = p.sku || "";
    document.getElementById("prod-source-url").value = p.sourcePlatformUrl || "";
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
    renderSeoChecklist();
    goToSection("store-add-product");
  }

  // Ensures no two products share a slug — if "terracotta-diya-set" is taken,
  // tries "terracotta-diya-set-2", "-3", etc. `excludeId` lets an edit keep its own slug.
  function ensureUniqueSlug(baseSlug, excludeId) {
    const taken = new Set(
      productsList.filter((p) => p.id !== excludeId).map((p) => p.slug).filter(Boolean)
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
    if (!confirm("Delete this product permanently?")) return;
    await deleteDoc(doc(db, "products", id));
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
        stock: Number(document.getElementById("prod-stock").value) || 0,
        sku: document.getElementById("prod-sku").value,
        sourcePlatformUrl: document.getElementById("prod-source-url").value.trim(),
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

      if (pId) {
        await updateDoc(doc(db, "products", pId), pData);
      } else {
        pData.createdAt = new Date().toISOString();
        await addDoc(collection(db, "products"), pData);
      }
      resetProductForm();
      goToSection("store-products");
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

  document.querySelectorAll(".rte-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.rteTab;
      if (tab === rteActiveTab) return;
      clearTimeout(rteSyncTimer);
      if (rteActiveTab === "visual") rteSyncCodeFromVisual();
      else rteSyncVisualFromCode();

      rteActiveTab = tab;
      document.querySelectorAll(".rte-tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
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
    document.querySelectorAll(".rte-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.rteTab === "visual"));
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
    document.querySelectorAll(".rte-tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.rteTab === "visual"));
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
        const a = document.createElement("a");
        a.href = o.paymentScreenshotUrl;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "🔍 View Screenshot";
        a.style.cssText = "color: var(--color-primary); font-weight: 600;";
        p.appendChild(a);
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
    [unsubCategories, unsubBrands, unsubCoupons, unsubProducts, unsubOrders, unsubTelegramBots, unsubBlogPosts, unsubBlogCategories].forEach((unsub) => {
      if (typeof unsub === "function") unsub();
    });
    unsubCategories = unsubBrands = unsubCoupons = unsubProducts = unsubOrders = unsubTelegramBots = unsubBlogPosts = unsubBlogCategories = null;
    syncStarted = false;
  }

}, 500);