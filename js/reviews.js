/**
 * reviews.js
 * ------------------------------------------------------------------
 * Star-rating input + review form + review list for product.html.
 *
 * ---- Now backed by Firestore, not localStorage --------------------
 * Earlier versions of this file stored reviews in the visitor's own
 * browser (localStorage), which meant a review was only ever visible
 * on the device that wrote it. This version writes to the `reviews`
 * collection in Firestore instead, the same pattern already used for
 * products/categories/coupons: guests can read and create, only the
 * admin can edit or delete (see firestore.rules). That means every
 * review is now visible to every visitor, in real time, on any device.
 *
 * A review photo, if attached, is uploaded to ImgBB (same service the
 * admin panel already uses for product images) and only the resulting
 * URL is stored in Firestore — never a base64 blob — because a single
 * Firestore document has a 1MB size limit and storing images inline
 * would blow through that after a handful of reviews.
 * ------------------------------------------------------------------
 */

const Reviews = (function () {
  const FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  async function waitForDb() {
    if (window.SITE_CONFIG_READY) {
      try { await window.SITE_CONFIG_READY; } catch (err) { /* fall through */ }
    }
    let waited = 0;
    while (!(window.FirebaseApp && window.FirebaseApp.db) && waited < 8000) {
      await new Promise((r) => setTimeout(r, 100));
      waited += 100;
    }
    if (!(window.FirebaseApp && window.FirebaseApp.db)) {
      throw new Error("Could not connect to the database.");
    }
    return window.FirebaseApp.db;
  }

  async function fetchReviews(productId) {
    const db = await waitForDb();
    const { collection, query, where, getDocs } = await import(FIRESTORE_SDK);
    const q = query(collection(db, "reviews"), where("productId", "==", productId));
    const snap = await getDocs(q);
    const list = [];
    snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
    // Sorted client-side (newest first) rather than an orderBy() in the
    // query, so this doesn't need a composite Firestore index just to work.
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    return list;
  }

  function getAverage(list) {
    if (list.length === 0) return { average: 0, count: 0 };
    const sum = list.reduce((total, r) => total + Number(r.rating || 0), 0);
    return { average: sum / list.length, count: list.length };
  }

  function renderStars(container, value, max = 5) {
    container.innerHTML = "";
    container.className = "stars";
    const pct = Math.max(0, Math.min(1, value / max)) * 100;

    const track = document.createElement("span");
    track.className = "stars__track";
    track.textContent = "★".repeat(max);

    const fill = document.createElement("span");
    fill.className = "stars__fill";
    fill.style.width = pct + "%";
    fill.textContent = "★".repeat(max);

    container.appendChild(track);
    container.appendChild(fill);
  }

  function validateImageFile(file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return "Please upload a JPG, PNG, or WEBP image.";
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return "Image is too large — please keep it under 2MB.";
    }
    return null;
  }

  async function uploadReviewImage(file) {
    const key = window.SITE_CONFIG && window.SITE_CONFIG.imgbbKey;
    if (!key) throw new Error("Image uploads aren't set up yet — the store hasn't added an ImgBB key.");
    const formData = new FormData();
    formData.append("image", file);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
      method: "POST",
      body: formData
    });
    const data = await res.json();
    if (!data || !data.data || !data.data.url) throw new Error("Image upload failed. Please try again.");
    return data.data.url;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
    } catch (err) {
      return iso;
    }
  }

  function renderReviewList(container, list) {
    container.innerHTML = "";

    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "form-hint";
      empty.textContent = "No reviews yet — be the first to add one.";
      container.appendChild(empty);
      return;
    }

    list.forEach((review) => {
      const item = document.createElement("div");
      item.className = "review-item";

      const head = document.createElement("div");
      head.className = "review-item__head";

      const starsEl = document.createElement("span");
      renderStars(starsEl, review.rating);

      const author = document.createElement("span");
      author.className = "review-item__author";
      Security.setTextSafely(author, review.authorLabel || "Guest");

      const date = document.createElement("span");
      date.className = "review-item__date";
      date.textContent = formatDate(review.date);

      head.appendChild(starsEl);
      head.appendChild(author);
      head.appendChild(date);

      const comment = document.createElement("p");
      comment.className = "review-item__comment";
      Security.setTextSafely(comment, review.comment);

      item.appendChild(head);
      item.appendChild(comment);

      if (review.imageUrl) {
        const img = document.createElement("img");
        img.className = "review-item__image";
        img.src = review.imageUrl;
        img.alt = "Photo attached to review by " + (review.authorLabel || "a guest");
        item.appendChild(img);
      }

      container.appendChild(item);
    });
  }

  /**
   * Wires up a review form + summary + list for one product.
   * `els` = { form, starInput, ratingHiddenInput, commentInput,
   *           imageInput, imageError, summaryScore, summaryStars,
   *           summaryCount, list, toast }
   */
  function init(productId, els) {
    let selectedRating = 0;

    function paintStarInput() {
      Array.from(els.starInput.children).forEach((btn, i) => {
        btn.classList.toggle("is-filled", i < selectedRating);
        btn.setAttribute("aria-pressed", i < selectedRating ? "true" : "false");
      });
    }

    // Build the 1–5 clickable star buttons once.
    els.starInput.innerHTML = "";
    for (let i = 1; i <= 5; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "★";
      btn.setAttribute("aria-label", `${i} star${i > 1 ? "s" : ""}`);
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        selectedRating = i;
        paintStarInput();
      });
      els.starInput.appendChild(btn);
    }

    function renderSummary(list) {
      const { average, count } = getAverage(list);
      Security.setTextSafely(els.summaryScore, count > 0 ? average.toFixed(1) : "—");
      renderStars(els.summaryStars, average);
      Security.setTextSafely(
        els.summaryCount,
        count > 0 ? `${count} review${count > 1 ? "s" : ""}` : "No reviews yet"
      );
    }

    async function refresh() {
      let list;
      try {
        list = await fetchReviews(productId);
      } catch (err) {
        console.error("Reviews: could not load from database", err);
        els.list.innerHTML = "";
        const errBox = document.createElement("p");
        errBox.className = "form-hint";
        errBox.textContent = "Couldn't load reviews right now — please refresh the page.";
        els.list.appendChild(errBox);
        renderSummary([]);
        return;
      }
      renderSummary(list);
      renderReviewList(els.list, list);
    }

    els.imageInput.addEventListener("change", () => {
      els.imageError.classList.remove("is-visible");
      const file = els.imageInput.files[0];
      if (!file) return;
      const error = validateImageFile(file);
      if (error) {
        Security.setTextSafely(els.imageError, error);
        els.imageError.classList.add("is-visible");
        els.imageInput.value = "";
      }
    });

    els.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      els.imageError.classList.remove("is-visible");

      // Same first line of defense used across the rest of the site.
      if (Security.isHoneypotTripped && Security.isHoneypotTripped(e.target, "website")) return;
      if (!Security.canSubmit("product-review-form-" + productId, 3000)) return;

      if (selectedRating === 0) {
        Security.setTextSafely(els.imageError, "Please select a star rating before submitting.");
        els.imageError.classList.add("is-visible");
        return;
      }
      const comment = els.commentInput.value.trim();
      if (!comment) {
        Security.setTextSafely(els.imageError, "Please add a short comment.");
        els.imageError.classList.add("is-visible");
        return;
      }
      if (comment.length > 1000) {
        Security.setTextSafely(els.imageError, "Please keep your review under 1000 characters.");
        els.imageError.classList.add("is-visible");
        return;
      }

      const submitBtn = els.form.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Submitting..."; }

      let imageUrl = null;
      const file = els.imageInput.files[0];
      if (file) {
        const error = validateImageFile(file);
        if (error) {
          Security.setTextSafely(els.imageError, error);
          els.imageError.classList.add("is-visible");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Review"; }
          return;
        }
        try {
          imageUrl = await uploadReviewImage(file);
        } catch (err) {
          Security.setTextSafely(els.imageError, err.message || "Could not upload that image — please try another file.");
          els.imageError.classList.add("is-visible");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Review"; }
          return;
        }
      }

      const review = {
        productId,
        rating: selectedRating,
        comment: comment,
        imageUrl,
        authorLabel: "Guest",
        date: new Date().toISOString()
      };

      try {
        const db = await waitForDb();
        const { collection, addDoc, serverTimestamp } = await import(FIRESTORE_SDK);
        await addDoc(collection(db, "reviews"), { ...review, createdAt: serverTimestamp() });
      } catch (err) {
        console.error("Reviews: could not save to database", err);
        Security.setTextSafely(els.imageError, "Your review couldn't be saved — please check your connection and try again.");
        els.imageError.classList.add("is-visible");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Review"; }
        return;
      }

      // Best-effort Telegram alert so the admin can spot spam/inappropriate
      // reviews quickly — never blocks or fails the review itself, which
      // already saved successfully above.
      if (window.SITE_CONFIG && window.SITE_CONFIG.telegramApiKey) {
        fetch("/api/telegram-notify", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": window.SITE_CONFIG.telegramApiKey },
          body: JSON.stringify({
            event: "new_review",
            data: {
              productId,
              productTitle: els.productTitle || productId,
              rating: review.rating,
              comment: review.comment,
              productUrl: `${window.location.origin}/product.html?id=${encodeURIComponent(productId)}`
            }
          })
        }).catch((err) => console.warn("Telegram new_review notify failed (non-fatal):", err));
      }

      // Reset form
      els.form.reset();
      selectedRating = 0;
      paintStarInput();
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit Review"; }
      if (els.toast) {
        els.toast.classList.add("is-visible");
        setTimeout(() => els.toast.classList.remove("is-visible"), 3000);
      }
      refresh();
    });

    refresh();
  }

  return { init, getAverage, renderStars };
})();

// Expose for non-module <script> usage across pages, consistent with every
// other module on the site.
if (typeof window !== "undefined") {
  window.Reviews = Reviews;
}
