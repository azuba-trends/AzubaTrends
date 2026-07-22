// api/import-product.js
//
// WHAT THIS DOES (and does NOT do)
// ---------------------------------------------------------------------
// Given a third-party product URL (e.g. a Meesho/IndiaMART/any store
// product page), this fetches that page SERVER-SIDE (avoiding the CORS
// block a browser would hit trying to fetch another site directly) and
// reads its Open Graph tags (og:title, og:description, og:image) — the
// same tags WhatsApp/Google use to build a link preview. It also
// downloads the image itself server-side and returns it as a base64
// data URL, so the browser can upload it to ImgBB without hitting CORS
// on the image fetch either.
//
// This is a ONE-TIME IMPORT HELPER, not a live sync: it prefills the Add
// Product form once, when the admin clicks "Import from URL". It does
// NOT keep watching that page, does NOT auto-update price/stock later,
// and does NOT work for pages that require login or block bots/crawlers
// (some marketplace product pages do). Price extraction is deliberately
// NOT attempted — every site formats price differently and guessing
// wrong is worse than leaving it blank for the admin to type in.
//
// ADMIN-ONLY: this route makes the server fetch whatever URL it's given,
// which is exactly the shape of an SSRF/open-proxy risk if left public —
// anyone could use your deployment to fetch arbitrary pages/images
// through your server's IP. So this requires the same Firebase ID token
// admin.html already gets on login (see lib/firebase-admin.js ->
// verifyAdminToken). product-import-tester.html sends it automatically
// once you're signed in there.

import { verifyAdminToken } from "../lib/firebase-admin.js";

function extractMeta(html, prop) {
  // Matches <meta property="og:title" content="..."> in either attribute
  // order (content before or after property), single or double quotes.
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${prop}["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${prop}["']`, "i")
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return "";
}

function decodeHtmlEntities(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export default async function handler(req, res) {
  try {
    await verifyAdminToken(req);
  } catch (err) {
    console.error("import-product: rejected unauthenticated request:", err.message);
    return res.status(401).json({ error: "Please sign in as admin first." });
  }

  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing ?url= parameter." });

  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error("bad protocol");
  } catch (err) {
    return res.status(400).json({ error: "That doesn't look like a valid URL." });
  }

  try {
    const pageRes = await fetch(target.toString(), {
      headers: {
        // A closer approximation of a real browser request. This helps on
        // sites doing light User-Agent checks, but will NOT reliably get
        // past serious bot-protection (Cloudflare/Akamai/PerimeterX-style
        // WAFs) that big marketplaces like Meesho/Flipkart/Amazon run —
        // those detect far more than just headers, and bypassing them
        // properly needs a full headless browser, which is out of scope
        // for a lightweight tool like this.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9"
      }
    });

    if (!pageRes.ok) {
      if (pageRes.status === 403 || pageRes.status === 429) {
        return res.status(502).json({
          error: `This site is actively blocking automated requests (HTTP ${pageRes.status}). This is common on large marketplaces (Meesho, Flipkart, Amazon, Myntra) that run bot-protection — it's not fixable from this tool. Smaller/independent stores usually work fine.`
        });
      }
      return res.status(502).json({ error: `That page returned an error (HTTP ${pageRes.status}). It may block automated requests.` });
    }

    const html = await pageRes.text();

    const title = extractMeta(html, "og:title") || extractMeta(html, "title");
    const description = extractMeta(html, "og:description") || extractMeta(html, "description");
    let imageUrl = extractMeta(html, "og:image");

    if (!title && !imageUrl) {
      return res.status(422).json({
        error: "Couldn't find any product info on that page — it may not have Open Graph tags, or it may require login to view."
      });
    }

    // Resolve a relative image URL (some sites use "/img/x.jpg" instead
    // of a full URL) against the product page's own origin.
    let imageDataUrl = null;
    if (imageUrl) {
      try {
        const absoluteImageUrl = new URL(imageUrl, target.origin).toString();
        const imgRes = await fetch(absoluteImageUrl);
        if (imgRes.ok) {
          const contentType = imgRes.headers.get("content-type") || "image/jpeg";
          const buffer = Buffer.from(await imgRes.arrayBuffer());
          // Cap at ~4MB so this never returns an unreasonably huge payload.
          if (buffer.length < 4 * 1024 * 1024) {
            imageDataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
          }
        }
      } catch (err) {
        // Image fetch failing shouldn't fail the whole import — the admin
        // still gets title/description and can add an image manually.
        console.warn("Could not fetch source image:", err.message);
      }
    }

    return res.status(200).json({
      title: title || "",
      description: description || "",
      sourceImageUrl: imageUrl || null,
      imageDataUrl // base64 data URL, or null if it couldn't be fetched
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not reach that URL. Please check it and try again." });
  }
}
