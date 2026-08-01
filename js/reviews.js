/**
 * reviews.js
 * ------------------------------------------------------------------
 * Star-rating input + review form + review list for product.html,
 * redesigned to match Meesho's product-page reviews pattern:
 *   - a rating summary card (average score + Excellent/Very Good/Good/
 *     Average/Poor bars, like Meesho's breakdown)
 *   - only the first couple of reviews shown inline on the page
 *   - a "View all reviews" button that opens a scrollable right-side
 *     drawer (full width on small screens) with its own "View more"
 *     pagination, rather than dumping every review onto the page or
 *     into the drawer at once
 *   - a review form whose photo picker is a "+" button inside the
 *     comment box (opens a small popover -> "Add images" -> file
 *     picker), with selected photos previewed as removable thumbnails
 *     underneath, and up to 5 photos per review
 *
 * ---- Backed by Firestore, not localStorage --------------------
 * Reviews live in the `reviews` collection in Firestore (guests can
 * read/create, only admin can edit/delete — see firestore.rules), so
 * every review is visible to every visitor, in real time, on any
 * device. Photos are uploaded to ImgBB (same service the admin panel
 * uses for product images) and only the resulting URLs are stored —
 * never a base64 blob — since a single Firestore document has a 1MB
 * size limit.
 * ------------------------------------------------------------------
 */

const Reviews = (function () {
  const FIRESTORE_SDK = 'https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js';
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB per photo
  const MAX_IMAGES = 5; // per review
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const PAGE_PREVIEW_COUNT = 2; // reviews shown inline on the page before "View all"
  const DRAWER_BATCH_SIZE = 5;  // reviews per "View more" batch inside the drawer

  const TIER_LABELS = [
    { stars: 5, label: "Excellent", tier: "excellent" },
    { stars: 4, label: "Very Good", tier: "verygood" },
    { stars: 3, label: "Good", tier: "good" },
    { stars: 2, label: "Average", tier: "average" },
    { stars: 1, label: "Poor", tier: "poor" }
  ];

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

  function tierForRating(rating) {
    const r = Math.round(Number(rating) || 0);
    if (r >= 5) return "excellent";
    if (r === 4) return "verygood";
    if (r === 3) return "good";
    if (r === 2) return "average";
    return "poor";
  }

  // Maps a rating tier to a clear green (4-5★) / yellow (3★) / red (1-2★)
  // scale so the badge color actually reflects the star count at a glance,
  // instead of everything except 1★ looking the same.
  function badgeTierClass(tier) {
    if (tier === "excellent" || tier === "verygood") return "great"; // 4-5★ → green (CSS default)
    if (tier === "good") return "okay"; // 3★ → yellow
    return "poor"; // average(2★)/poor(1★) → red
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
      return "Each image must be under 2MB.";
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

  function reviewImages(review) {
    if (Array.isArray(review.imageUrls) && review.imageUrls.length > 0) return review.imageUrls;
    if (review.imageUrl) return [review.imageUrl];
    return [];
  }

  function buildReviewItem(review) {
    const item = document.createElement("div");
    item.className = "review-item";

    const head = document.createElement("div");
    head.className = "review-item__head";

    const badge = document.createElement("span");
    badge.className = "review-item__rating-badge";
    badge.dataset.tier = badgeTierClass(tierForRating(review.rating));
    badge.textContent = `${Number(review.rating || 0).toFixed(1)} ★`;

    const author = document.createElement("span");
    author.className = "review-item__author";
    Security.setTextSafely(author, review.authorLabel || "Guest");

    const date = document.createElement("span");
    date.className = "review-item__date";
    date.textContent = "Posted on " + formatDate(review.date);

    head.appendChild(badge);
    head.appendChild(author);
    head.appendChild(date);

    const comment = document.createElement("p");
    comment.className = "review-item__comment";
    Security.setTextSafely(comment, review.comment);

    item.appendChild(head);
    item.appendChild(comment);

    const imgs = reviewImages(review);
    if (imgs.length > 0) {
      const imagesRow = document.createElement("div");
      imagesRow.className = "review-item__images";
      imgs.forEach((url) => {
        const img = document.createElement("img");
        img.className = "review-item__image";
        img.src = url;
        img.loading = "lazy";
        img.alt = "Photo attached to review by " + (review.authorLabel || "a guest");
        img.addEventListener("click", () => openReviewLightbox(review, img));
        imagesRow.appendChild(img);
      });
      item.appendChild(imagesRow);
    }

    return item;
  }

  function renderReviewList(container, list, { emptyMessage } = {}) {
    container.innerHTML = "";
    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "form-hint";
      empty.textContent = emptyMessage || "No reviews yet — be the first to add one.";
      container.appendChild(empty);
      return;
    }
    list.forEach((review) => container.appendChild(buildReviewItem(review)));
  }

  // Reuses the page's existing #lightbox (already present on product.html
  // for the main product gallery) so there's exactly one lightbox
  // implementation on the page instead of a second competing one. Falls
  // back to just opening the image in a new tab if that lightbox markup
  // isn't present for some reason.
  function openReviewLightbox(review, imgEl) {
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    if (!lightbox || !lightboxImg) {
      window.open(imgEl.src, "_blank", "noopener,noreferrer");
      return;
    }
    lightboxImg.src = imgEl.src;
    lightboxImg.alt = imgEl.alt;

    const caption = document.getElementById("lightbox-caption");
    if (caption) {
      const starsEl = document.getElementById("lightbox-caption-stars");
      if (starsEl) renderStars(starsEl, review.rating);
      const authorEl = document.getElementById("lightbox-caption-author");
      if (authorEl) Security.setTextSafely(authorEl, review.authorLabel || "Guest");
      const commentEl = document.getElementById("lightbox-caption-comment");
      if (commentEl) Security.setTextSafely(commentEl, review.comment);
      caption.hidden = false;
    }
    lightbox.hidden = false;
  }

  function renderSummaryBars(container, list) {
    container.innerHTML = "";
    const total = list.length;
    const counts = { excellent: 0, verygood: 0, good: 0, average: 0, poor: 0 };
    list.forEach((r) => { counts[tierForRating(r.rating)]++; });

    TIER_LABELS.forEach(({ label, tier }) => {
      const count = counts[tier];
      const pct = total > 0 ? (count / total) * 100 : 0;
      const row = document.createElement("div");
      row.className = "reviews-summary__bar-row";
      row.dataset.tier = (tier === "excellent" || tier === "verygood") ? "great" : (tier === "good" ? "okay" : "poor");
      row.innerHTML = `
        <span>${label}</span>
        <span class="reviews-summary__bar-track"><span class="reviews-summary__bar-fill" style="width:${pct}%"></span></span>
        <span class="reviews-summary__bar-count">${count}</span>`;
      container.appendChild(row);
    });
  }

  /**
   * Wires up a review form + summary + preview list + "view all" drawer
   * for one product. `els` = {
   *   form, starInput, commentInput,
   *   addImageBtn, imagePopover, addImageOption, imageInput, imagePreviews,
   *   imageError, summaryScore, summaryStars, summaryCount, summaryBars,
   *   list, viewAllBtn, drawerOverlay, drawerBody, drawerClose, drawerTitle,
   *   toast, onSummary
   * }
   */
  function init(productId, els) {
    let selectedRating = 0;
    let selectedFiles = []; // File objects queued for upload on submit
    let fullList = []; // last fetched review list, reused by the drawer

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

    // ---- "+" add-image button -> popover -> "Add images" -> file picker ----
    function closeImagePopover() {
      els.imagePopover.classList.remove("is-open");
      els.addImageBtn.setAttribute("aria-expanded", "false");
    }
    if (els.addImageBtn && els.imagePopover) {
      els.addImageBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = els.imagePopover.classList.toggle("is-open");
        els.addImageBtn.setAttribute("aria-expanded", open ? "true" : "false");
      });
      document.addEventListener("click", (e) => {
        if (!els.imagePopover.contains(e.target) && e.target !== els.addImageBtn) closeImagePopover();
      });
    }
    if (els.addImageOption) {
      els.addImageOption.addEventListener("click", () => {
        closeImagePopover();
        els.imageInput.click();
      });
    }

    function renderPreviews() {
      els.imagePreviews.innerHTML = "";
      selectedFiles.forEach((file, idx) => {
        const wrap = document.createElement("div");
        wrap.className = "review-photo-preview";
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        img.alt = "Selected photo " + (idx + 1);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "review-photo-preview__remove";
        removeBtn.setAttribute("aria-label", "Remove photo");
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          selectedFiles.splice(idx, 1);
          renderPreviews();
        });
        wrap.appendChild(img);
        wrap.appendChild(removeBtn);
        els.imagePreviews.appendChild(wrap);
      });
    }

    els.imageInput.addEventListener("change", () => {
      els.imageError.classList.remove("is-visible");
      const incoming = Array.from(els.imageInput.files || []);
      els.imageInput.value = ""; // allow re-selecting the same file later

      for (const file of incoming) {
        if (selectedFiles.length >= MAX_IMAGES) {
          Security.setTextSafely(els.imageError, `You can attach up to ${MAX_IMAGES} photos.`);
          els.imageError.classList.add("is-visible");
          break;
        }
        const error = validateImageFile(file);
        if (error) {
          Security.setTextSafely(els.imageError, error);
          els.imageError.classList.add("is-visible");
          continue;
        }
        selectedFiles.push(file);
      }
      renderPreviews();
    });

    const charCountEl = document.getElementById("review-char-count");
    if (charCountEl) {
      els.commentInput.addEventListener("input", () => {
        const len = els.commentInput.value.length;
        charCountEl.textContent = `${len} / 1000`;
        charCountEl.style.color = len > 1000 ? "var(--color-danger)" : "";
      });
    }

    function renderSummary(list) {
      const { average, count } = getAverage(list);
      Security.setTextSafely(els.summaryScore, count > 0 ? average.toFixed(1) : "—");
      renderStars(els.summaryStars, average);
      Security.setTextSafely(
        els.summaryCount,
        count > 0 ? `${count} rating${count > 1 ? "s" : ""}` : "No reviews yet"
      );
      if (els.summaryBars) renderSummaryBars(els.summaryBars, list);
      if (typeof els.onSummary === "function") els.onSummary({ average, count });
    }

    function renderPagePreview(list) {
      const preview = list.slice(0, PAGE_PREVIEW_COUNT);
      renderReviewList(els.list, preview);
      if (els.viewAllBtn) {
        els.viewAllBtn.hidden = list.length <= PAGE_PREVIEW_COUNT;
        Security.setTextSafely(els.viewAllBtn, `View all ${list.length} reviews →`);
      }
    }

    // ---- "View all reviews" drawer, paginated with a "View more" button ----
    let drawerShown = 0;
    function renderDrawerBatch(reset) {
      if (reset) { els.drawerBody.innerHTML = ""; drawerShown = 0; }
      const nextBatch = fullList.slice(drawerShown, drawerShown + DRAWER_BATCH_SIZE);
      const listWrap = els.drawerBody.querySelector(".review-list") || (() => {
        const w = document.createElement("div");
        w.className = "review-list";
        els.drawerBody.appendChild(w);
        return w;
      })();
      if (drawerShown === 0 && fullList.length === 0) {
        const empty = document.createElement("p");
        empty.className = "form-hint";
        empty.textContent = "No reviews yet — be the first to add one.";
        listWrap.appendChild(empty);
      }
      nextBatch.forEach((review) => listWrap.appendChild(buildReviewItem(review)));
      drawerShown += nextBatch.length;

      let moreBtn = els.drawerBody.querySelector(".review-load-more-btn");
      if (moreBtn) moreBtn.remove();
      if (drawerShown < fullList.length) {
        moreBtn = document.createElement("button");
        moreBtn.type = "button";
        moreBtn.className = "btn btn-outline review-load-more-btn";
        moreBtn.textContent = `View more (${fullList.length - drawerShown} left)`;
        moreBtn.addEventListener("click", () => renderDrawerBatch(false));
        els.drawerBody.appendChild(moreBtn);
      }
    }

    function openDrawer() {
      if (!els.drawerOverlay) return;
      if (els.drawerTitle) Security.setTextSafely(els.drawerTitle, `All Reviews (${fullList.length})`);
      renderDrawerBatch(true);
      els.drawerOverlay.hidden = false;
      document.body.style.overflow = "hidden";
    }
    function closeDrawer() {
      if (!els.drawerOverlay) return;
      els.drawerOverlay.hidden = true;
      document.body.style.overflow = "";
    }
    if (els.viewAllBtn) els.viewAllBtn.addEventListener("click", openDrawer);
    if (els.drawerClose) els.drawerClose.addEventListener("click", closeDrawer);
    if (els.drawerOverlay) {
      els.drawerOverlay.addEventListener("click", (e) => { if (e.target === els.drawerOverlay) closeDrawer(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.drawerOverlay.hidden) closeDrawer(); });
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
      fullList = list;
      renderSummary(list);
      renderPagePreview(list);
    }

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
      if (comment.length < 10) {
        Security.setTextSafely(els.imageError, "Please write at least 10 characters so your review is useful to others.");
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

      let imageUrls = [];
      if (selectedFiles.length > 0) {
        try {
          imageUrls = await Promise.all(selectedFiles.map((file) => uploadReviewImage(file)));
        } catch (err) {
          Security.setTextSafely(els.imageError, err.message || "Could not upload your photos — please try again.");
          els.imageError.classList.add("is-visible");
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit review"; }
          return;
        }
      }

      // The real enforcement (rate limit, profanity, length) happens
      // server-side in api/submit-review.js — this can't be bypassed by
      // skipping this file and hitting Firestore directly, unlike the old
      // approach. This request also carries the honeypot field's value
      // so the server can do the same silent-bot-catch check.
      const honeypotField = els.form.querySelector('[name="website"]');
      try {
        const res = await fetch("/api/submit-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId,
            rating: selectedRating,
            comment,
            imageUrls,
            website: honeypotField ? honeypotField.value : ""
          })
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Your review couldn't be submitted. Please try again.");
        }
      } catch (err) {
        console.error("Reviews: could not save via api/submit-review", err);
        Security.setTextSafely(els.imageError, err.message || "Your review couldn't be saved — please check your connection and try again.");
        els.imageError.classList.add("is-visible");
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit review"; }
        return;
      }

      // Reset form
      els.form.reset();
      selectedRating = 0;
      selectedFiles = [];
      renderPreviews();
      closeImagePopover();
      paintStarInput();
      if (charCountEl) charCountEl.textContent = "0 / 1000";
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Submit review"; }
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
