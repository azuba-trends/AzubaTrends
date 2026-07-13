// api/product.js
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Safe specifically for embedding inside a <script> block as a JS string
// literal (escapeHtml alone isn't enough there — </script> or a stray quote
// could still break out).
function escapeForScript(str) {
  return String(str ?? "").replace(/[<>&'"\\]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export default async function handler(req, res) {
  const { id } = req.query;

  // Agar id nahi hai, toh normal product page bhej do
  if (!id) {
    return res.redirect(301, '/product.html');
  }

  try {
    // 1. Firebase REST API se data fetch karna
    // Note: Project ID 'azubatrends-32349' aapki firebaseConfig se li gayi hai
    const firebaseUrl = `https://firestore.googleapis.com/v1/projects/azubatrends-32349/databases/(default)/documents/products/${encodeURIComponent(id)}`;

    const response = await fetch(firebaseUrl);
    const data = await response.json();

    // 2. Data extract karna (Firestore REST API ka format thoda alag hota hai)
    const product = data.fields;
    const rawTitle = product?.title?.stringValue || "AzubaTrends Product";
    const rawDescription = product?.shortDescription?.stringValue || "Buy amazing products on AzubaTrends.";
    const rawImageUrl = product?.images?.arrayValue?.values?.[0]?.stringValue || "https://yourwebsite.com/images/logo-placeholder.png";

    const title = escapeHtml(rawTitle);
    const description = escapeHtml(rawDescription);
    const imageUrl = escapeHtml(rawImageUrl);
    const safeIdForScript = escapeForScript(id);

    // 3. Custom HTML banakar (Meta Tags ke sath) bhejna
    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <!-- STANDARD SEO -->
        <title>${title} - AzubaTrends</title>
        <meta name="description" content="${description}">

        <!-- OPEN GRAPH (Facebook, WhatsApp) -->
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${description}">
        <meta property="og:image" content="${imageUrl}">
        <meta property="og:type" content="product">

        <!-- TWITTER -->
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="${title}">
        <meta name="twitter:description" content="${description}">
        <meta name="twitter:image" content="${imageUrl}">

        <!-- Redirect to real page for normal users -->
        <script>
          // Jab normal user (chrome/safari) ise open karega,
          // toh wo original product page par chala jayega jahan cart/UI load hoga.
          window.location.replace("/product.html?id=${safeIdForScript}");
        </script>
      </head>
      <body>
        <!-- Bots ko sirf head tags chahiye hote hain, isliye body khali chhod sakte hain -->
        <h1>${title}</h1>
        <p>${description}</p>
        <img src="${imageUrl}" alt="${title}">
      </body>
      </html>
    `;

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);

  } catch (error) {
    console.error(error);
    res.redirect(301, '/product.html?id=' + encodeURIComponent(id));
  }
}