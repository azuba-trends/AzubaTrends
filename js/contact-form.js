/**
 * contact-form.js
 * ----------------
 * Powers the Contact Us form (contact.html). Two things happen on a
 * successful submit, same "belt and suspenders" pattern as checkout's
 * OrderEmail:
 *   1. POST to /api/submit-contact — this is the SOURCE OF TRUTH. It
 *      saves a ticket to Firestore (shows up in Admin Panel > Support
 *      Tickets) and fires a Telegram alert. This step can never be
 *      skipped/bypassed from the browser (see firestore.rules).
 *   2. A best-effort EmailJS send straight to the store owner's inbox
 *      (SITE_CONFIG.adminEmail), routed through js/email-router.js's
 *      round-robin (see Settings > Email — "contactForm" purpose).
 *      If this fails (EmailJS not configured yet, quota hit, etc.) the
 *      ticket is still safely saved by step 1 — so the submission is
 *      never lost, it just might not also land as an email that day.
 */
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const subjectSelect = document.getElementById("contact-subject");
  const customSubjectWrap = document.getElementById("custom-subject-wrap");
  const customSubjectInput = document.getElementById("contact-custom-subject");
  const messageBox = document.getElementById("contact-message");
  const statusEl = document.getElementById("contact-form-status");
  const submitBtn = document.getElementById("contact-submit-btn");

  // Show/hide the "please specify" field only when "Other" is chosen.
  subjectSelect.addEventListener("change", () => {
    const isOther = subjectSelect.value === "Other";
    customSubjectWrap.style.display = isOther ? "block" : "none";
    customSubjectInput.required = isOther;
  });

  // Message box grows with content (in addition to the manual drag-handle
  // from CSS `resize: vertical`) so longer messages don't get stuck
  // scrolling inside a tiny fixed box.
  function autoGrow() {
    messageBox.style.height = "auto";
    messageBox.style.height = Math.min(messageBox.scrollHeight, 500) + "px";
  }
  messageBox.addEventListener("input", autoGrow);

  function clearErrors() {
    form.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
    statusEl.textContent = "";
    statusEl.className = "";
  }

  function showFieldError(id, msg) {
    const el = document.getElementById("error-" + id);
    if (el) el.textContent = msg;
  }

  async function sendAdminNotificationEmail(data) {
    // Best-effort only — never allowed to make the whole submission look
    // like it failed. The ticket (step 1) already succeeded by the time
    // this runs.
    try {
      await window.SITE_CONFIG_READY;
      await window.AzubaEmailRouter.send("contactForm", {
        from_name: data.name,
        from_email: data.email,
        subject: data.subject,
        message: data.message,
        to_email: SITE_CONFIG.adminEmail
      });
    } catch (err) {
      console.warn("Contact form: admin notification email failed (ticket itself is unaffected):", err);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearErrors();

    if (Security.isHoneypotTripped(form, "website")) {
      // Silently "succeed" for a bot — no point tipping it off.
      form.reset();
      return;
    }
    if (!Security.canSubmit("contact-form", 8000)) {
      statusEl.textContent = "Please wait a few seconds before sending another message.";
      statusEl.className = "error";
      return;
    }

    const name = document.getElementById("contact-name").value.trim();
    const email = document.getElementById("contact-email").value.trim();
    const subject = subjectSelect.value;
    const customSubject = customSubjectInput.value.trim();
    const message = messageBox.value.trim();

    let hasError = false;
    if (!name) { showFieldError("contact-name", "Please enter your name."); hasError = true; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showFieldError("contact-email", "Please enter a valid email address."); hasError = true; }
    if (!subject) { showFieldError("contact-subject", "Please select a subject."); hasError = true; }
    if (subject === "Other" && !customSubject) { showFieldError("contact-subject", "Please specify your subject below."); hasError = true; }
    if (message.length < 5) { showFieldError("contact-message", "Please write a message."); hasError = true; }
    if (hasError) return;

    const finalSubject = subject === "Other" ? customSubject : subject;

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    try {
      const res = await fetch("/api/submit-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, email, subject, customSubject, message,
          website: form.elements["website"] ? form.elements["website"].value : ""
        })
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(result.error || "Something went wrong. Please try again.");
      }

      // Ticket saved — now best-effort email to the admin inbox too.
      sendAdminNotificationEmail({ name, email, subject: finalSubject, message });

      statusEl.textContent = "Thanks — your message has been sent! We'll get back to you soon.";
      statusEl.className = "success";
      form.reset();
      customSubjectWrap.style.display = "none";
      messageBox.style.height = "";
    } catch (err) {
      statusEl.textContent = err.message || "Something went wrong. Please try again.";
      statusEl.className = "error";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Message";
    }
  });
});
