// functions/api/imagekit-list.js
//
// Powers the admin panel's Media Library "Media" tab (js/admin.js's
// openMediaLibrary()) — lists files already sitting in the store's
// ImageKit account, so an admin can re-use an already-uploaded image
// instead of uploading the same file again.
//
// Admin-only (requireAdmin — see lib/auth.js), same as admin-tools.js /
// import-product.js. Reads settings/imagekit_private via the service
// account (see imagekit-auth.js's comment for why that's the one place
// this key is ever touched), then calls ImageKit's Media API
// server-side — the private key must never reach the browser, same
// reasoning as the upload-signing endpoint.
//
// GET /api/imagekit-list?skip=0&limit=60&search=shoe
//   skip / limit -> pagination (ImageKit's own params, passed through).
//   search        -> optional, matches file name (case-insensitive
//                     substring via ImageKit's searchQuery syntax).
//
// Returns: { ok: true, files: [{ id, name, url, thumbnail, width, height,
//   size, createdAt }], hasMore: boolean }
// or { error: "..." } with a 4xx/5xx status.

import { getDoc } from "../../lib/firestore-rest.js";
import { requireAdmin } from "../../lib/auth.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  try {
    await requireAdmin(request, env);
  } catch (err) {
    return json({ error: "Not authorized." }, 401);
  }

  try {
    const privateKeyDoc = await getDoc(env, "settings/imagekit_private");
    const privateKey = privateKeyDoc && privateKeyDoc.privateKey;
    if (!privateKey) {
      return json({ error: "ImageKit isn't configured yet — add a Private Key in Settings > Image Hosting." }, 400);
    }

    const url = new URL(request.url);
    const skip = Math.max(0, parseInt(url.searchParams.get("skip") || "0", 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "60", 10) || 60));
    const search = (url.searchParams.get("search") || "").trim();

    const apiUrl = new URL("https://api.imagekit.io/v1/files");
    apiUrl.searchParams.set("skip", String(skip));
    apiUrl.searchParams.set("limit", String(limit));
    apiUrl.searchParams.set("sort", "DESC_CREATED");
    apiUrl.searchParams.set("fileType", "image");
    if (search) {
      // ImageKit's search expression language — matches on file name,
      // case-insensitive substring. See ImageKit docs > Media API > List
      // and search files.
      apiUrl.searchParams.set("searchQuery", `name : "*${search.replace(/["\\]/g, "")}*"`);
    }

    const basicAuth = btoa(`${privateKey}:`);
    const res = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Basic ${basicAuth}` }
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error("ImageKit list failed:", res.status, errBody);
      return json({ error: "Couldn't load media from ImageKit." }, 502);
    }

    const files = await res.json();
    const mapped = (Array.isArray(files) ? files : []).map((f) => ({
      id: f.fileId,
      name: f.name,
      url: f.url,
      thumbnail: f.thumbnail || f.url,
      width: f.width || null,
      height: f.height || null,
      size: f.size || null,
      createdAt: f.createdAt || null
    }));

    return json({ ok: true, files: mapped, hasMore: mapped.length === limit });
  } catch (err) {
    console.error(err);
    return json({ error: "Couldn't load media. Please try again." }, 500);
  }
}
