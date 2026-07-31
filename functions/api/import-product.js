// functions/api/import-product.js
//
// *** RECONSTRUCTED BY THE MIGRATION MANAGER ***
// Worker 3's REPORT.md describes this as "✅ import-product.js — fully
// converted" (see "Status by file"), but the actual file was missing from
// the delivered zip. Rebuilt from the original api/import-product.js plus
// Worker 3's written description of exactly what changed. If Worker 3
// still has the real file, diff it against this one before deploying —
// this is a reconstruction, not a verified-identical copy.
//
// WHAT THIS DOES (unchanged from the original):
// Given a third-party product URL, fetches that page server-side, reads
// its Open Graph tags (og:title/description/image), downloads the image
// server-side, and returns it as a base64 data URL so the admin's browser
// never has to fight CORS importing from another site. One-time import
// helper, not a live sync. ADMIN-ONLY — this makes the server fetch
// arbitrary URLs, which is an SSRF/open-proxy risk if left public.
//
// Conversion changes (per Worker 3's report):
//   - req.query.url          -> new URL(request.url).searchParams.get("url")
//   - res.status().json()    -> new Response(JSON.stringify(...), {status})
//   - verifyAdminToken(req)  -> requireAdmin(request, env)  (lib/auth.js)
//   - Buffer.from(...).toString("base64") -> manual arrayBufferToBase64()
//     (Buffer isn't guaranteed available on Workers; this only touches
//     Web-standard ArrayBuffer/Uint8Array/btoa)
//   - Outbound fetch() calls unchanged — Workers' global fetch covers this.

import { requireAdmin } from "../../lib/auth.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function extractMeta(html, prop) {
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

// Buffer isn't guaranteed on Workers — build a base64 string from a plain
// ArrayBuffer using only Web-standard APIs (Uint8Array + btoa).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000; // avoid call-stack blowups on large images
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    await requireAdmin(request, env);
  } catch (err) {
    console.error("import-product: rejected unauthenticated request:", err.message);
    return json({ error: "Please sign in as admin first." }, 401);
  }

  const url = new URL(request.url).searchParams.get("url");
  if (!url) return json({ error: "Missing ?url= parameter." }, 400);

  let target;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error("bad protocol");
  } catch (err) {
    return json({ error: "That doesn't look like a valid URL." }, 400);
  }

  try {
    const pageRes = await fetch(target.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9"
      }
    });

    if (!pageRes.ok) {
      if (pageRes.status === 403 || pageRes.status === 429) {
        return json({
          error: `This site is actively blocking automated requests (HTTP ${pageRes.status}). This is common on large marketplaces (Meesho, Flipkart, Amazon, Myntra) that run bot-protection — it's not fixable from this tool. Smaller/independent stores usually work fine.`
        }, 502);
      }
      return json({ error: `That page returned an error (HTTP ${pageRes.status}). It may block automated requests.` }, 502);
    }

    const html = await pageRes.text();

    const title = extractMeta(html, "og:title") || extractMeta(html, "title");
    const description = extractMeta(html, "og:description") || extractMeta(html, "description");
    let imageUrl = extractMeta(html, "og:image");

    if (!title && !imageUrl) {
      return json({
        error: "Couldn't find any product info on that page — it may not have Open Graph tags, or it may require login to view."
      }, 422);
    }

    let imageDataUrl = null;
    if (imageUrl) {
      try {
        const absoluteImageUrl = new URL(imageUrl, target.origin).toString();
        const imgRes = await fetch(absoluteImageUrl);
        if (imgRes.ok) {
          const contentType = imgRes.headers.get("content-type") || "image/jpeg";
          const arrayBuffer = await imgRes.arrayBuffer();
          // Cap at ~4MB so this never returns an unreasonably huge payload.
          if (arrayBuffer.byteLength < 4 * 1024 * 1024) {
            imageDataUrl = `data:${contentType};base64,${arrayBufferToBase64(arrayBuffer)}`;
          }
        }
      } catch (err) {
        console.warn("Could not fetch source image:", err.message);
      }
    }

    return json({
      title: title || "",
      description: description || "",
      sourceImageUrl: imageUrl || null,
      imageDataUrl
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Could not reach that URL. Please check it and try again." }, 500);
  }
}
