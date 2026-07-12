import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

setTimeout(() => {
  const { auth, db, signInWithEmailAndPassword, onAuthStateChanged, signOut } = window.FirebaseApp;
  
  // REPLACE THIS WITH YOUR ACTUAL IMGBB API KEY
  const IMGBB_API_KEY = "a8cbafdd38fd0a3b95d9ce8efae74565";

  // --- 1. AUTHENTICATION & UI ROUTING ---
  const loginScreen = document.getElementById("login-screen");
  const adminLayout = document.getElementById("admin-layout");

  onAuthStateChanged(auth, (user) => {
    if (user) {
      loginScreen.style.display = "none";
      adminLayout.style.display = "flex";
      loadAllData(); // Load everything when logged in
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

  // Sidebar Navigation
  document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));
      e.target.classList.add("active");
      document.getElementById(e.target.dataset.target).classList.add("active");
    });
  });

  // Helper: Generate Slug
  function generateSlug(text) {
    return text.toString().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\-]+/g, '').replace(/\-\-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  }

  // Helper: Upload Images via ImgBB
  async function uploadToImgBB(file) {
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: "POST", body: formData });
    const data = await res.json();
    if (data.success) return data.data.url;
    throw new Error("Image upload failed");
  }

  async function uploadProductImages() {
    let uploadedUrls = [];
    const featureImgFile = document.getElementById("prod-feature-img").files[0];
    const galleryFiles = document.getElementById("prod-gallery-imgs").files;

    if (featureImgFile) uploadedUrls.push(await uploadToImgBB(featureImgFile));
    if (galleryFiles.length > 0) {
      const limit = Math.min(galleryFiles.length, 4);
      for (let i = 0; i < limit; i++) uploadedUrls.push(await uploadToImgBB(galleryFiles[i]));
    }
    return uploadedUrls; 
  }

  // --- 2. CATEGORY MANAGEMENT ---
  let categoriesList = [];

  document.getElementById("show-add-cat-btn").addEventListener("click", () => document.getElementById("add-cat-form-container").style.display = "block");
  document.getElementById("cancel-cat-btn").addEventListener("click", () => {
    document.getElementById("add-cat-form-container").style.display = "none";
    document.getElementById("add-category-form").reset();
  });

  document.getElementById("cat-name").addEventListener("input", (e) => { document.getElementById("cat-slug").value = generateSlug(e.target.value); });
  document.getElementById("cat-type").addEventListener("change", (e) => {
    document.getElementById("parent-cat-dropdown-container").style.display = e.target.value === "child" ? "block" : "none";
  });

  async function loadCategories() {
    const querySnapshot = await getDocs(collection(db, "categories"));
    categoriesList = [];
    const tbody = document.getElementById("categories-table-body");
    const parentSelect = document.getElementById("parent-cat-select");
    tbody.innerHTML = ""; parentSelect.innerHTML = "";

    querySnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      categoriesList.push({ id: docSnap.id, ...data });
      tbody.innerHTML += `
        <tr>
          <td>${data.name}</td>
          <td>${data.type.toUpperCase()}</td>
          <td>/${data.slug}</td>
          <td><button class="btn btn-outline" onclick="deleteCategory('${docSnap.id}')" style="color:red; padding:4px 8px; font-size:0.8rem;">Delete</button></td>
        </tr>
      `;
      if(data.type === 'parent') {
        parentSelect.innerHTML += `<option value="${data.slug}">${data.name}</option>`;
      }
    });
    populateCategoryDropdown(); // update products dropdown too
  }

  window.deleteCategory = async (id) => {
    if(confirm("Delete this category?")) { await deleteDoc(doc(db, "categories", id)); loadCategories(); }
  };

  document.getElementById("add-category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-cat-btn");
    btn.textContent = "Saving..."; btn.disabled = true;

    try {
      let finalSlug = document.getElementById("cat-slug").value;
      if (document.getElementById("cat-type").value === "child") {
        finalSlug = `${document.getElementById("parent-cat-select").value}/${finalSlug}`;
      }
      await addDoc(collection(db, "categories"), {
        name: document.getElementById("cat-name").value,
        slug: finalSlug,
        type: document.getElementById("cat-type").value,
        description: document.getElementById("cat-desc").value,
        metaTitle: document.getElementById("cat-meta-title").value,
        metaDesc: document.getElementById("cat-meta-desc").value,
        createdAt: new Date().toISOString()
      });
      document.getElementById("add-category-form").reset();
      document.getElementById("add-cat-form-container").style.display = "none";
      loadCategories();
    } catch (err) { alert("Error saving category!"); } 
    finally { btn.textContent = "Save Category"; btn.disabled = false; }
  });

  // --- 3. PRODUCTS MANAGEMENT ---
  document.getElementById("show-add-prod-btn").addEventListener("click", () => {
    document.getElementById("product-form").reset();
    document.getElementById("prod-id").value = "";
    document.getElementById("product-form-title").textContent = "Add New Product";
    document.getElementById("add-prod-form-container").style.display = "block";
  });
  
  document.getElementById("cancel-prod-btn").addEventListener("click", () => document.getElementById("add-prod-form-container").style.display = "none");
  document.getElementById("prod-name").addEventListener("input", (e) => { document.getElementById("prod-slug").value = generateSlug(e.target.value); });

  function populateCategoryDropdown() {
    const sel = document.getElementById("prod-category");
    sel.innerHTML = "<option value=''>Select Category</option>";
    categoriesList.forEach(cat => sel.innerHTML += `<option value="${cat.name}">${cat.name}</option>`);
  }

  async function loadProducts() {
    const tbody = document.getElementById("products-table-body");
    const querySnapshot = await getDocs(collection(db, "products"));
    tbody.innerHTML = "";
    window.loadedProducts = {};
    
    querySnapshot.forEach((docSnap) => {
      const p = docSnap.data();
      window.loadedProducts[docSnap.id] = p;
      const sColor = p.status === "active" ? "green" : "orange";
      const img = (p.images && p.images[0]) ? p.images[0] : "images/logo-placeholder.png";

      tbody.innerHTML += `
        <tr>
          <td><img src="${img}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;"></td>
          <td>${p.title}</td>
          <td>${p.category}</td>
          <td>₹${p.sellingPrice}</td>
          <td style="color:${p.stock > 0 ? 'black' : 'red'}; font-weight:bold;">${p.stock}</td>
          <td style="color:${sColor}; font-weight:bold;">${p.status.toUpperCase()}</td>
          <td>
            <button class="btn btn-outline" onclick="editProduct('${docSnap.id}')" style="padding:4px 8px; font-size:0.8rem;">Edit</button>
            <button class="btn btn-outline" onclick="toggleProductStatus('${docSnap.id}', '${p.status}')" style="padding:4px 8px; font-size:0.8rem;">${p.status === 'active' ? 'Pause' : 'Live'}</button>
            <button class="btn btn-outline" onclick="deleteProduct('${docSnap.id}')" style="color:red; padding:4px 8px; font-size:0.8rem;">Del</button>
          </td>
        </tr>
      `;
    });
  }

  window.editProduct = (id) => {
    const p = window.loadedProducts[id];
    document.getElementById("prod-id").value = id;
    document.getElementById("prod-name").value = p.title;
    document.getElementById("prod-slug").value = p.slug;
    document.getElementById("prod-mrp").value = p.mrp;
    document.getElementById("prod-price").value = p.sellingPrice;
    document.getElementById("prod-stock").value = p.stock;
    document.getElementById("prod-brand").value = p.brand || "";
    document.getElementById("prod-tags").value = (p.tags || []).join(", ");
    document.getElementById("prod-sku").value = p.sku || "";
    document.getElementById("prod-short-desc").value = p.shortDescription || "";
    document.getElementById("prod-long-desc").value = p.description || "";
    setTimeout(() => { document.getElementById("prod-category").value = p.category; }, 100);
    
    document.getElementById("product-form-title").textContent = "Edit Product";
    document.getElementById("add-prod-form-container").style.display = "block";
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.toggleProductStatus = async (id, currentStatus) => {
    const newStatus = currentStatus === "active" ? "draft" : "active";
    await updateDoc(doc(db, "products", id), { status: newStatus });
    loadProducts();
  };

  window.deleteProduct = async (id) => {
    if(confirm("Delete product permanently?")) { await deleteDoc(doc(db, "products", id)); loadProducts(); }
  };

  async function handleProductSave(status) {
    const title = document.getElementById("prod-name").value;
    if(!title) return alert("Product name is required");
    const saveBtn = status === "active" ? document.getElementById("publish-prod-btn") : document.getElementById("draft-prod-btn");
    const originalText = saveBtn.textContent;
    saveBtn.textContent = "Uploading..."; saveBtn.disabled = true;

    try {
      const newImageUrls = await uploadProductImages();
      const pData = {
        title: title,
        slug: document.getElementById("prod-slug").value,
        category: document.getElementById("prod-category").value,
        brand: document.getElementById("prod-brand").value,
        mrp: Number(document.getElementById("prod-mrp").value),
        sellingPrice: Number(document.getElementById("prod-price").value),
        stock: Number(document.getElementById("prod-stock").value),
        sku: document.getElementById("prod-sku").value,
        tags: document.getElementById("prod-tags").value.split(",").map(t => t.trim()),
        shortDescription: document.getElementById("prod-short-desc").value,
        description: document.getElementById("prod-long-desc").value,
        status: status,
        updatedAt: new Date().toISOString()
      };

      const pId = document.getElementById("prod-id").value;
      if (pId) {
        if (newImageUrls.length > 0) pData.images = newImageUrls;
        await updateDoc(doc(db, "products", pId), pData);
      } else {
        pData.images = newImageUrls;
        pData.createdAt = new Date().toISOString();
        await addDoc(collection(db, "products"), pData);
      }
      document.getElementById("product-form").reset();
      document.getElementById("add-prod-form-container").style.display = "none";
      loadProducts();
    } catch (err) { alert("Error saving product: " + err.message); } 
    finally { saveBtn.textContent = originalText; saveBtn.disabled = false; }
  }

  document.getElementById("publish-prod-btn").addEventListener("click", () => handleProductSave("active"));
  document.getElementById("draft-prod-btn").addEventListener("click", () => handleProductSave("draft"));


  // --- 4. ORDERS MANAGEMENT ---
  async function loadOrders() {
    const tbody = document.getElementById("orders-table-body");
    const querySnapshot = await getDocs(collection(db, "orders"));
    tbody.innerHTML = ""; window.loadedOrders = {};

    querySnapshot.forEach((docSnap) => {
      const o = docSnap.data();
      window.loadedOrders[docSnap.id] = { id: docSnap.id, ...o };
      
      let sColor = "orange";
      if(o.status === "Delivered") sColor = "green";
      if(o.status === "Cancelled") sColor = "red";
      if(o.status === "Shipped") sColor = "blue";

      tbody.innerHTML += `
        <tr>
          <td><strong>${o.orderId}</strong></td>
          <td>${new Date(o.createdAt).toLocaleDateString()}</td>
          <td>${o.customerName}</td>
          <td>₹${o.finalTotal}</td>
          <td>${o.paymentMethod}</td>
          <td style="color: ${sColor}; font-weight: bold;">${o.status || 'Pending'}</td>
          <td><button class="btn btn-primary" onclick="viewOrder('${docSnap.id}')" style="padding:4px 8px; font-size:0.8rem;">Process</button></td>
        </tr>
      `;
    });
  }

  let currentEditingOrderId = null;
  window.viewOrder = (dbId) => {
    const o = window.loadedOrders[dbId];
    currentEditingOrderId = dbId;
    document.getElementById("modal-order-id").textContent = "Order: " + o.orderId;
    document.getElementById("modal-order-status").value = o.status || "Pending";
    document.getElementById("modal-order-total").textContent = "₹" + o.finalTotal;
    
    document.getElementById("modal-cust-details").innerHTML = `
      <b>Name:</b> ${o.customerName}<br><b>Phone:</b> ${o.customerPhone}<br><b>Email:</b> ${o.customerEmail}<br>
      <b>Address:</b> ${o.customerAddress}, ${o.customerCity}, ${o.customerState} - ${o.customerPincode}
    `;

    const itemsUl = document.getElementById("modal-order-items");
    itemsUl.innerHTML = "";
    (o.items || []).forEach(item => {
      itemsUl.innerHTML += `<li style="padding: 5px 0; border-bottom: 1px dashed #ddd;">${item.title} <b>x ${item.quantity}</b> (₹${item.price} each)</li>`;
    });
    document.getElementById("order-details-modal").style.display = "block";
  };

  document.getElementById("close-order-modal").addEventListener("click", () => document.getElementById("order-details-modal").style.display = "none");
  document.getElementById("update-status-btn").addEventListener("click", async () => {
    const newStatus = document.getElementById("modal-order-status").value;
    await updateDoc(doc(db, "orders", currentEditingOrderId), { status: newStatus });
    alert("Status updated!"); loadOrders();
  });


  // --- 5. SETTINGS MANAGEMENT ---
  async function loadSettings() {
    try {
      const docSnap = await getDoc(doc(db, "settings", "store_config"));
      if (docSnap.exists()) {
        const s = docSnap.data();
        document.getElementById("set-store-name").value = s.storeName || "";
        document.getElementById("set-upi-id").value = s.upiId || "";
        document.getElementById("set-support-email").value = s.supportEmail || "";
        document.getElementById("set-support-phone").value = s.supportPhone || "";
        document.getElementById("set-email-pub").value = s.emailjs_publicKey || "";
        document.getElementById("set-email-srv").value = s.emailjs_serviceId || "";
        document.getElementById("set-email-tpl").value = s.emailjs_templateId || "";
      }
    } catch(err) { console.log("No settings found"); }
  }

  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("save-settings-btn");
    btn.textContent = "Saving...";
    try {
      await setDoc(doc(db, "settings", "store_config"), {
        storeName: document.getElementById("set-store-name").value,
        upiId: document.getElementById("set-upi-id").value,
        supportEmail: document.getElementById("set-support-email").value,
        supportPhone: document.getElementById("set-support-phone").value,
        emailjs_publicKey: document.getElementById("set-email-pub").value,
        emailjs_serviceId: document.getElementById("set-email-srv").value,
        emailjs_templateId: document.getElementById("set-email-tpl").value,
      });
      alert("Settings saved!");
    } catch (err) { alert("Failed to save."); } 
    finally { btn.textContent = "Save All Settings"; }
  });

  // Load All Data Sequence
  async function loadAllData() {
    await loadCategories();
    await loadProducts();
    await loadOrders();
    await loadSettings();
  }

}, 500);