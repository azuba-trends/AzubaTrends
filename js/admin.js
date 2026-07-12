import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

setTimeout(() => {
  const { auth, db, signInWithEmailAndPassword, onAuthStateChanged, signOut } = window.FirebaseApp;
  
  // ⚠️ YOUR IMGBB API KEY HERE ⚠️
  const IMGBB_API_KEY = "8cbafdd38fd0a3b95d9ce8efae74565";

  // --- 1. CORE ---
  onAuthStateChanged(auth, (user) => {
    if (user) {
      document.getElementById("login-screen").style.display = "none";
      document.getElementById("admin-layout").style.display = "flex";
      loadAllData(); 
    } else {
      document.getElementById("login-screen").style.display = "block";
      document.getElementById("admin-layout").style.display = "none";
    }
  });

  document.getElementById("admin-login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    signInWithEmailAndPassword(auth, document.getElementById("admin-email").value, document.getElementById("admin-password").value)
      .catch(() => document.getElementById("login-error").style.display = "block");
  });
  document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

  // Navigation
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
      e.target.classList.add("active");
      document.getElementById(e.target.dataset.target).classList.add("active");
    });
  });

  // Helpers
  function generateSlug(text) { return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, ''); }
  
  async function uploadToImgBB(file) {
    if(!file) return null;
    const formData = new FormData(); formData.append("image", file);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
    const data = await res.json();
    if (data.success) return data.data.url;
    return null;
  }

  // --- 2. DASHBOARD ---
  async function loadDashboardStats() {
    let totProd = 0, actProd = 0, oosProd = 0, totSales = 0;
    
    Object.values(window.loadedProducts || {}).forEach(p => {
      totProd++;
      if(p.status === 'active') actProd++;
      if(p.stock <= 0) oosProd++;
    });
    
    Object.values(window.loadedOrders || {}).forEach(o => {
      if(o.status === 'Delivered') totSales += Number(o.finalTotal || 0);
    });

    document.getElementById("stat-tot-prod").textContent = totProd;
    document.getElementById("stat-act-prod").textContent = actProd;
    document.getElementById("stat-oos-prod").textContent = oosProd;
    document.getElementById("stat-tot-sales").textContent = "₹" + totSales;
  }

  // --- 3. CATEGORIES & BRANDS ---
  // Categories
  document.getElementById("show-add-cat-btn").addEventListener("click", () => {
    document.getElementById("add-category-form").reset(); document.getElementById("cat-id").value = "";
    document.getElementById("add-cat-form-container").style.display = "block";
  });
  document.getElementById("cancel-cat-btn").addEventListener("click", () => document.getElementById("add-cat-form-container").style.display = "none");
  document.getElementById("cat-name").addEventListener("input", (e) => document.getElementById("cat-slug").value = generateSlug(e.target.value));
  document.getElementById("cat-type").addEventListener("change", (e) => { document.getElementById("parent-cat-dropdown-container").style.display = e.target.value === "child" ? "block" : "none"; });

  async function loadCategories() {
    const snap = await getDocs(collection(db, "categories"));
    const tbody = document.getElementById("categories-table-body");
    const parentSel = document.getElementById("parent-cat-select");
    const prodCatSel = document.getElementById("prod-category");
    tbody.innerHTML = ""; parentSel.innerHTML = ""; prodCatSel.innerHTML = "<option value=''>Select Category</option>";
    window.loadedCategories = {};

    snap.forEach(docSnap => {
      const d = docSnap.data(); window.loadedCategories[docSnap.id] = d;
      tbody.innerHTML += `<tr><td><input type="checkbox"></td><td>${d.name}</td><td>${d.type}</td><td>
        <button class="btn btn-outline" onclick="editCategory('${docSnap.id}')" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
        <button class="btn btn-outline" onclick="deleteDocItem('categories', '${docSnap.id}')" style="color:red; padding:4px 8px; font-size:0.8rem;">Del</button>
      </td></tr>`;
      prodCatSel.innerHTML += `<option value="${d.name}">${d.name}</option>`;
      if(d.type === 'parent') parentSel.innerHTML += `<option value="${d.slug}">${d.name}</option>`;
    });
  }

  window.editCategory = (id) => {
    const d = window.loadedCategories[id];
    document.getElementById("cat-id").value = id;
    document.getElementById("cat-name").value = d.name; document.getElementById("cat-slug").value = d.slug.split("/").pop();
    document.getElementById("cat-type").value = d.type; document.getElementById("cat-desc").value = d.description || "";
    document.getElementById("cat-meta-title").value = d.metaTitle || ""; document.getElementById("cat-meta-desc").value = d.metaDesc || "";
    document.getElementById("parent-cat-dropdown-container").style.display = d.type === "child" ? "block" : "none";
    document.getElementById("add-cat-form-container").style.display = "block";
  };

  document.getElementById("add-category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("cat-id").value;
    let finalSlug = document.getElementById("cat-slug").value;
    if (document.getElementById("cat-type").value === "child") finalSlug = `${document.getElementById("parent-cat-select").value}/${finalSlug}`;
    
    let imageUrl = await uploadToImgBB(document.getElementById("cat-image").files[0]);
    const data = { name: document.getElementById("cat-name").value, slug: finalSlug, type: document.getElementById("cat-type").value, description: document.getElementById("cat-desc").value, metaTitle: document.getElementById("cat-meta-title").value, metaDesc: document.getElementById("cat-meta-desc").value };
    if(imageUrl) data.imageUrl = imageUrl;

    if(id) { await updateDoc(doc(db, "categories", id), data); } 
    else { data.createdAt = new Date().toISOString(); await addDoc(collection(db, "categories"), data); }
    document.getElementById("add-cat-form-container").style.display = "none"; loadCategories();
  });

  // Brands
  document.getElementById("show-add-brand-btn").addEventListener("click", () => {
    document.getElementById("add-brand-form").reset(); document.getElementById("brand-id").value = "";
    document.getElementById("add-brand-form-container").style.display = "block";
  });
  document.getElementById("cancel-brand-btn").addEventListener("click", () => document.getElementById("add-brand-form-container").style.display = "none");
  document.getElementById("brand-name").addEventListener("input", (e) => document.getElementById("brand-slug").value = generateSlug(e.target.value));

  async function loadBrands() {
    const snap = await getDocs(collection(db, "brands"));
    const tbody = document.getElementById("brands-table-body");
    const prodBrandSel = document.getElementById("prod-brand");
    tbody.innerHTML = ""; prodBrandSel.innerHTML = "<option value=''>Select Brand</option>";
    window.loadedBrands = {};

    snap.forEach(docSnap => {
      const d = docSnap.data(); window.loadedBrands[docSnap.id] = d;
      tbody.innerHTML += `<tr><td><input type="checkbox"></td><td>${d.name}</td><td>${d.slug}</td><td>
        <button class="btn btn-outline" onclick="editBrand('${docSnap.id}')" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
        <button class="btn btn-outline" onclick="deleteDocItem('brands', '${docSnap.id}')" style="color:red; padding:4px 8px; font-size:0.8rem;">Del</button>
      </td></tr>`;
      prodBrandSel.innerHTML += `<option value="${d.name}">${d.name}</option>`;
    });
  }

  window.editBrand = (id) => {
    const d = window.loadedBrands[id];
    document.getElementById("brand-id").value = id;
    document.getElementById("brand-name").value = d.name; document.getElementById("brand-slug").value = d.slug;
    document.getElementById("brand-desc").value = d.description || "";
    document.getElementById("brand-meta-title").value = d.metaTitle || ""; document.getElementById("brand-meta-desc").value = d.metaDesc || "";
    document.getElementById("add-brand-form-container").style.display = "block";
  };

  document.getElementById("add-brand-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("brand-id").value;
    let imageUrl = await uploadToImgBB(document.getElementById("brand-image").files[0]);
    const data = { name: document.getElementById("brand-name").value, slug: document.getElementById("brand-slug").value, description: document.getElementById("brand-desc").value, metaTitle: document.getElementById("brand-meta-title").value, metaDesc: document.getElementById("brand-meta-desc").value };
    if(imageUrl) data.imageUrl = imageUrl;

    if(id) { await updateDoc(doc(db, "brands", id), data); } 
    else { data.createdAt = new Date().toISOString(); await addDoc(collection(db, "brands"), data); }
    document.getElementById("add-brand-form-container").style.display = "none"; loadBrands();
  });


  // --- 4. PRODUCTS ---
  document.getElementById("show-add-prod-btn").addEventListener("click", () => {
    document.getElementById("product-form").reset(); document.getElementById("prod-id").value = "";
    document.getElementById("add-prod-form-container").style.display = "block";
  });
  document.getElementById("cancel-prod-btn").addEventListener("click", () => document.getElementById("add-prod-form-container").style.display = "none");
  document.getElementById("prod-name").addEventListener("input", (e) => document.getElementById("prod-slug").value = generateSlug(e.target.value));

  async function loadProducts() {
    const tbody = document.getElementById("products-table-body");
    const snap = await getDocs(collection(db, "products"));
    tbody.innerHTML = ""; window.loadedProducts = {};
    
    snap.forEach((docSnap) => {
      const p = docSnap.data(); window.loadedProducts[docSnap.id] = p;
      tbody.innerHTML += `<tr>
        <td><input type="checkbox"></td>
        <td>${p.title}</td><td>${p.brand || '-'}</td><td>${p.category}</td><td>${(p.tags||[]).join(", ")}</td>
        <td>${new Date(p.createdAt||Date.now()).toLocaleDateString()}</td>
        <td style="color:${p.status==='active'?'green':'orange'}; font-weight:bold;">${p.status.toUpperCase()}</td>
        <td>
          <button class="btn btn-outline" onclick="editProduct('${docSnap.id}')" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
          <button class="btn btn-outline" onclick="toggleStatus('products', '${docSnap.id}', '${p.status}')" style="padding:4px 8px; font-size:0.8rem;">${p.status === 'active' ? 'Pause' : 'Live'}</button>
          <button class="btn btn-outline" onclick="deleteDocItem('products', '${docSnap.id}')" style="color:red; padding:4px 8px; font-size:0.8rem;">Del</button>
        </td>
      </tr>`;
    });
    loadDashboardStats();
  }

  window.editProduct = (id) => {
    const p = window.loadedProducts[id];
    document.getElementById("prod-id").value = id;
    document.getElementById("prod-name").value = p.title; document.getElementById("prod-slug").value = p.slug;
    document.getElementById("prod-category").value = p.category; document.getElementById("prod-brand").value = p.brand || "";
    document.getElementById("prod-mrp").value = p.mrp; document.getElementById("prod-price").value = p.sellingPrice;
    document.getElementById("prod-stock").value = p.stock; document.getElementById("prod-sku").value = p.sku || "";
    document.getElementById("prod-tags").value = (p.tags || []).join(", ");
    document.getElementById("prod-delivery-partner").value = p.deliveryPartner || ""; document.getElementById("prod-delivery-fee").value = p.deliveryFee || 0;
    document.getElementById("prod-short-desc").value = p.shortDescription || ""; document.getElementById("prod-long-desc").value = p.description || "";
    document.getElementById("add-prod-form-container").style.display = "block"; window.scrollTo(0,0);
  };

  async function handleProductSave(status) {
    const title = document.getElementById("prod-name").value; if(!title) return;
    const btn = status === "active" ? document.getElementById("publish-prod-btn") : document.getElementById("draft-prod-btn");
    btn.textContent = "Saving..."; btn.disabled = true;

    try {
      let imageUrls = [];
      const feat = document.getElementById("prod-feature-img").files[0];
      const gals = document.getElementById("prod-gallery-imgs").files;
      const delImg = document.getElementById("prod-delivery-img").files[0];
      
      if(feat) imageUrls.push(await uploadToImgBB(feat));
      for(let i=0; i<Math.min(gals.length, 4); i++) imageUrls.push(await uploadToImgBB(gals[i]));
      
      const pData = {
        title: title, slug: document.getElementById("prod-slug").value,
        category: document.getElementById("prod-category").value, brand: document.getElementById("prod-brand").value,
        mrp: Number(document.getElementById("prod-mrp").value), sellingPrice: Number(document.getElementById("prod-price").value),
        stock: Number(document.getElementById("prod-stock").value), sku: document.getElementById("prod-sku").value,
        tags: document.getElementById("prod-tags").value.split(",").map(t=>t.trim()),
        deliveryPartner: document.getElementById("prod-delivery-partner").value, deliveryFee: Number(document.getElementById("prod-delivery-fee").value),
        shortDescription: document.getElementById("prod-short-desc").value, description: document.getElementById("prod-long-desc").value,
        status: status, updatedAt: new Date().toISOString()
      };
      
      if(imageUrls.length > 0) pData.images = imageUrls;
      if(delImg) pData.deliveryPartnerImage = await uploadToImgBB(delImg);

      const id = document.getElementById("prod-id").value;
      if (id) { await updateDoc(doc(db, "products", id), pData); } 
      else { pData.createdAt = new Date().toISOString(); await addDoc(collection(db, "products"), pData); }
      
      document.getElementById("add-prod-form-container").style.display = "none"; loadProducts();
    } catch (e) { alert("Error saving"); } finally { btn.textContent = status==="active"?"Publish":"Save Draft"; btn.disabled = false; }
  }
  document.getElementById("publish-prod-btn").addEventListener("click", () => handleProductSave("active"));
  document.getElementById("draft-prod-btn").addEventListener("click", () => handleProductSave("draft"));


  // --- 5. ORDERS ---
  let currentOrderTab = 'Active';
  document.querySelectorAll(".tabs .tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".tabs .tab-btn").forEach(b => b.classList.remove("active"));
      e.target.classList.add("active");
      currentOrderTab = e.target.dataset.filter;
      renderOrders();
    });
  });

  async function loadOrders() {
    const snap = await getDocs(collection(db, "orders"));
    window.loadedOrders = {};
    snap.forEach(docSnap => window.loadedOrders[docSnap.id] = { id: docSnap.id, ...docSnap.data() });
    renderOrders(); loadDashboardStats();
  }

  function renderOrders() {
    const tbody = document.getElementById("orders-table-body"); tbody.innerHTML = "";
    Object.values(window.loadedOrders).forEach(o => {
      // Filtering Logic
      const stat = o.status || 'Pending';
      if(currentOrderTab === 'Active' && ['Delivered', 'Cancelled'].includes(stat)) return;
      if(currentOrderTab === 'Finished' && stat !== 'Delivered') return;
      if(currentOrderTab === 'Cancelled' && stat !== 'Cancelled') return;

      tbody.innerHTML += `<tr>
        <td><strong>${o.orderId}</strong></td><td>${new Date(o.createdAt).toLocaleDateString()}</td>
        <td>${o.customerName}</td><td>₹${o.finalTotal}</td>
        <td style="font-weight:bold; color:${stat==='Delivered'?'green':stat==='Cancelled'?'red':'orange'}">${stat}</td>
        <td><button class="btn btn-primary" onclick="viewOrder('${o.id}')" style="padding:4px 8px; font-size:0.8rem;">Process</button></td>
      </tr>`;
    });
  }

  window.viewOrder = (id) => {
    const o = window.loadedOrders[id]; document.getElementById("modal-order-id").dataset.id = id;
    document.getElementById("modal-order-id").textContent = "Order: " + o.orderId;
    document.getElementById("modal-order-status").value = o.status || "Pending";
    document.getElementById("modal-order-total").textContent = "₹" + o.finalTotal;
    document.getElementById("modal-cust-details").innerHTML = `<b>Name:</b> ${o.customerName}<br><b>Phone:</b> ${o.customerPhone}<br><b>Email:</b> ${o.customerEmail}<br><b>Address:</b> ${o.customerAddress}, ${o.customerCity}, ${o.customerState} - ${o.customerPincode}`;
    const ul = document.getElementById("modal-order-items"); ul.innerHTML = "";
    (o.items||[]).forEach(i => ul.innerHTML += `<li style="padding: 5px 0; border-bottom: 1px dashed #ddd;">${i.title} <b>x ${i.quantity}</b> (₹${i.price} each)</li>`);
    document.getElementById("order-details-modal").style.display = "block";
  };
  document.getElementById("close-order-modal").addEventListener("click", () => document.getElementById("order-details-modal").style.display = "none");
  document.getElementById("update-status-btn").addEventListener("click", async () => {
    const id = document.getElementById("modal-order-id").dataset.id;
    await updateDoc(doc(db, "orders", id), { status: document.getElementById("modal-order-status").value });
    alert("Status Updated!"); loadOrders(); document.getElementById("order-details-modal").style.display = "none";
  });


  // --- 6. SETTINGS & UTILS ---
  async function loadSettings() {
    const snap = await getDoc(doc(db, "settings", "store_config"));
    if(snap.exists()) {
      const s = snap.data();
      document.getElementById("set-store-name").value = s.storeName || ""; document.getElementById("set-admin-name").value = s.adminName || "";
      document.getElementById("set-upi-id").value = s.upiId || ""; document.getElementById("set-support-email").value = s.supportEmail || ""; document.getElementById("set-support-phone").value = s.supportPhone || "";
      document.getElementById("set-email-pub").value = s.emailjs_publicKey || ""; document.getElementById("set-email-srv").value = s.emailjs_serviceId || ""; document.getElementById("set-email-tpl").value = s.emailjs_templateId || "";
    }
  }

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await setDoc(doc(db, "settings", "store_config"), {
      storeName: document.getElementById("set-store-name").value, adminName: document.getElementById("set-admin-name").value,
      upiId: document.getElementById("set-upi-id").value, supportEmail: document.getElementById("set-support-email").value, supportPhone: document.getElementById("set-support-phone").value,
      emailjs_publicKey: document.getElementById("set-email-pub").value, emailjs_serviceId: document.getElementById("set-email-srv").value, emailjs_templateId: document.getElementById("set-email-tpl").value
    });
    alert("Settings Saved!");
  });

  window.deleteDocItem = async (col, id) => { if(confirm("Are you sure?")) { await deleteDoc(doc(db, col, id)); loadAllData(); } };
  window.toggleStatus = async (col, id, current) => { await updateDoc(doc(db, col, id), { status: current === 'active' ? 'draft' : 'active' }); loadAllData(); };

  async function loadAllData() { await loadCategories(); await loadBrands(); await loadProducts(); await loadOrders(); await loadSettings(); }
}, 500);