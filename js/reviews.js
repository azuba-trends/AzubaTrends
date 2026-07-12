/**
 * reviews.js
 * ------------------------------------------------------------------
 * Star-rating input + review form + review list for product.html.
 *
 * ---- Persistence limitation (please read before wiring this to a
 * "real" launch) --------------------------------------------------
 * This is a static site with no database and no backend. Reviews
 * submitted here are stored in the visitor's own browser via
 * localStorage. That means:
 *   - A review is visible only on the device/browser that submitted
 *     it — NOT to other visitors, and not even to the same visitor
 *     on a different device.
 *   - The "average rating" shown is only ever an average of reviews
 *     stored locally in that one browser.
 * This is the honest, no-workaround MVP: it lets you build and demo
 * the full review UX without inventing a fake shared backend. If the
 * site owner wants reviews that every visitor can see, that needs
 * either a small hosted datastore (e.g. Firebase Firestore) or a
 * manual process of curating emailed reviews into each product's
 * JSON file — that's a product decision for the site owner, not
 * something to silently fake here.
 * ------------------------------------------------------------------
 */

const Reviews = (function () {
  const STORAGE_KEY = "angan_reviews_v1";
  const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

  function readAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (err) {
      console.error("Reviews: could not read localStorage", err);
      return [];
    }
  }

  function writeAll(reviews) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
      return true;
    } catch (err) {
      // Most likely QuotaExceededError from storing several base64 images.
      console.error("Reviews: could not write to localStorage", err);
      return false;
    }
  }

  function forProduct(productId) {
    return readAll().filter((r) => r.productId === productId);
  }

  function getAverage(productId) {
    const list = forProduct(productId);
    if (list.length === 0) return { average: 0, count: 0 };
    const sum = list.reduce((total, r) => total + r.rating, 0);
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

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
    } catch (err) {
      return iso;
    }
  }

  function renderReviewList(container, productId) {
    const list = forProduct(productId).sort((a, b) => new Date(b.date) - new Date(a.date));
    container.innerHTML = "";

    if (list.length === 0) {
      const empty = document.createElement("p");
      empty.className = "form-hint";
      empty.textContent = "No reviews on this device yet — be the first to add one.";
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

      if (review.imageDataUrl) {
        const img = document.createElement("img");
        img.className = "review-item__image";
        img.src = review.imageDataUrl;
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

    function renderSummary() {
      const { average, count } = getAverage(productId);
      Security.setTextSafely(els.summaryScore, count > 0 ? average.toFixed(1) : "—");
      renderStars(els.summaryStars, average);
      Security.setTextSafely(
        els.summaryCount,
        count > 0 ? `${count} review${count > 1 ? "s" : ""} on this device` : "No reviews yet on this device"
      );
    }

    function refresh() {
      renderSummary();
      renderReviewList(els.list, productId);
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

      let imageDataUrl = null;
      const file = els.imageInput.files[0];
      if (file) {
        const error = validateImageFile(file);
        if (error) {
          Security.setTextSafely(els.imageError, error);
          els.imageError.classList.add("is-visible");
          return;
        }
        try {
          imageDataUrl = await fileToDataUrl(file);
        } catch (err) {
          Security.setTextSafely(els.imageError, "Could not read that image — please try another file.");
          els.imageError.classList.add("is-visible");
          return;
        }
      }

      const review = {
        productId,
        rating: selectedRating,
        comment,
        imageDataUrl,
        authorLabel: "Guest",
        date: new Date().toISOString()
      };

      const all = readAll();
      all.push(review);
      const saved = writeAll(all);

      if (!saved) {
        Security.setTextSafely(
          els.imageError,
          "Your review couldn't be saved (this browser's local storage may be full). Try removing the image and submitting again."
        );
        els.imageError.classList.add("is-visible");
        return;
      }

      // Reset form
      els.form.reset();
      selectedRating = 0;
      paintStarInput();
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
