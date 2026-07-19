// js/tracking.js
//
// GA4 (Google Analytics) + Meta Pixel loader and a single trackEvent()
// helper used everywhere else (cart.js, checkout.js, product.html) so
// e-commerce events fire to both platforms consistently, in one place.
//
// Both the GA4 Measurement ID and Meta Pixel ID are meant to be public —
// they identify WHERE to send analytics data, not a secret that grants
// access to anything. Same exposure model as every other key already
// public in SITE_CONFIG (Firebase apiKey, EmailJS key, ImgBB key).
//
// If an ID isn't set in Admin > Settings > Marketing, that platform is
// simply skipped — nothing breaks, no console errors, trackEvent() just
// no-ops for that platform.

(function () {
  let ga4Ready = false;
  let metaPixelReady = false;

  async function waitForSiteConfig() {
    if (window.SITE_CONFIG_READY) {
      try { await window.SITE_CONFIG_READY; } catch (err) { /* fall through */ }
    }
    let waited = 0;
    while (!window.SITE_CONFIG && waited < 5000) {
      await new Promise((r) => setTimeout(r, 50));
      waited += 50;
    }
  }

  function loadGA4(measurementId) {
    if (!measurementId) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    // send_page_view: false — we fire our own page_view once the SDK is
    // confirmed loaded, avoiding a rare double-count some setups see when
    // gtag's automatic pageview races with SPA-style navigation on this
    // multi-page-but-JS-heavy site.
    window.gtag("config", measurementId, { send_page_view: false });

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.onload = () => {
      ga4Ready = true;
      window.gtag("event", "page_view");
    };
    document.head.appendChild(script);
  }

  function loadMetaPixel(pixelId) {
    if (!pixelId) return;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq("init", pixelId);
    window.fbq("track", "PageView");
    metaPixelReady = true;
  }

  /**
   * Fires `eventName` to whichever platforms are configured. `gaParams`
   * and `fbParams` can differ slightly since GA4 and Meta expect somewhat
   * different shapes for the same conceptual event — see call sites in
   * cart.js / checkout.js / product.html for the exact mappings used.
   *
   *   window.Tracking.trackEvent({
   *     ga4: { name: 'add_to_cart', params: {...} },
   *     meta: { name: 'AddToCart', params: {...} }
   *   });
   */
  function trackEvent({ ga4, meta } = {}) {
    try {
      if (ga4 && ga4Ready && window.gtag) {
        window.gtag("event", ga4.name, ga4.params || {});
      }
    } catch (err) {
      console.warn("GA4 event failed (non-fatal):", err);
    }
    try {
      if (meta && metaPixelReady && window.fbq) {
        window.fbq("track", meta.name, meta.params || {});
      }
    } catch (err) {
      console.warn("Meta Pixel event failed (non-fatal):", err);
    }
  }

  async function init() {
    await waitForSiteConfig();
    const cfg = window.SITE_CONFIG || {};
    if (cfg.ga4MeasurementId) loadGA4(cfg.ga4MeasurementId);
    if (cfg.metaPixelId) loadMetaPixel(cfg.metaPixelId);
  }

  window.Tracking = { trackEvent };
  init();
})();
