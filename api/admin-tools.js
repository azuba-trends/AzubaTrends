// api/admin-tools.js
//
// Admin-only order-invoice generation. Kept in ONE file (dispatched by
// ?action=) rather than two separate files (invoice + invoice-bulk),
// following the same pattern as api/list.js / api/telegram.js /
// api/site-meta.js — Vercel's Hobby (free) plan caps a deployment at 12
// serverless functions, so every new capability that can share a file
// with an existing one, does.
//
// Auth: same pattern as api/import-product.js — the browser sends the
// admin's live Firebase ID token (auth.currentUser.getIdToken()) as
// `Authorization: Bearer <token>`; verifyAdminToken() checks it server-
// side with the Admin SDK before anything else runs. There is no public
// path to this endpoint.
//
// GET ?action=invoice&orderId=<Firestore doc id>
//   -> streams back a single order's invoice as a PDF file.
// GET ?action=invoice-bulk
//   -> streams back a ZIP containing one PDF per order in the store.
//
// PDF GENERATION APPROACH
// ---------------------------------------------------------------------
// Uses `pdfkit`, which draws a PDF directly (text/lines/rects) without
// needing a headless browser (Puppeteer/Chromium) — that matters because
// Vercel's Hobby plan has tight function size/memory limits that a
// bundled Chromium blows past easily. pdfkit is a pure-JS, lightweight
// dependency and streams cleanly, which is why it was chosen over a
// print-a-webpage-to-PDF approach.
//
// TAX HANDLING
// ---------------------------------------------------------------------
// This store's checkout (api/place-order.js) has never added tax on top
// of what's shown at checkout — the price the customer sees IS the price
// they pay. So invoice tax lines are computed by working the GST rate
// *backward* out of that already-agreed price (tax-inclusive pricing),
// not added on top — this way the invoice's line/grand totals always
// match `finalTotal` exactly, i.e. what the customer actually paid.
// Tax only appears at all if the seller has a GSTIN set in
// Settings -> Account -> Invoice/Seller Details; otherwise this prints
// as a plain "Bill of Supply" with no tax breakdown, same as the sample
// invoice's dual title covers both cases.

import { getDb, verifyAdminToken } from "../lib/firebase-admin.js";
import PDFDocument from "pdfkit";
import archiver from "archiver";

// ---------------------------------------------------------------------
// Number -> Indian-English words (for "Amount in Words"), e.g.
// 1249.50 -> "Rupees One Thousand Two Hundred Forty Nine and Fifty Paise Only"
// ---------------------------------------------------------------------
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
}
function threeDigitWords(n) {
  if (n < 100) return twoDigitWords(n);
  return ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigitWords(n % 100) : "");
}
// Indian numbering (Lakh/Crore), not Western (Million/Billion) — matches
// how Indian tax invoices conventionally spell out amounts.
function integerToWordsIndian(n) {
  if (n === 0) return "Zero";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const rest = n;
  let parts = [];
  if (crore) parts.push(threeDigitWords(crore) + " Crore");
  if (lakh) parts.push(threeDigitWords(lakh) + " Lakh");
  if (thousand) parts.push(threeDigitWords(thousand) + " Thousand");
  if (rest) parts.push(threeDigitWords(rest));
  return parts.join(" ");
}
function amountToWords(amount) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  let words = "Rupees " + integerToWordsIndian(rupees);
  if (paise > 0) words += " and " + twoDigitWords(paise) + " Paise";
  return words + " Only";
}

function fmtINR(n) {
  return "Rs. " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------------------------------------------------------------------
// Draws one order's invoice into a pdfkit document. `doc` is an already-
// constructed PDFDocument (caller controls when pages start/end, so this
// same function works for both the single-invoice route and each entry
// of the bulk ZIP).
// ---------------------------------------------------------------------
function drawInvoice(doc, order, settings) {
  const sellerName = settings.sellerName || settings.storeName || "Store";
  const sellerId = settings.sellerId || "";
  const sellerAddress = settings.sellerAddress || "";
  const sellerState = settings.sellerState || "";
  const gstNumber = settings.gstNumber || "";
  const taxRate = Number(settings.taxRate) || 0;
  // Tax is OFF by default and stays off unless the admin explicitly ticks
  // "This business is GST-registered" in Settings — many resellers on
  // this codebase won't have a GSTIN, and their invoices should just be
  // a plain Bill of Supply with no tax lines at all. Filling in a GSTIN
  // alone does NOT turn tax on; the checkbox is the single source of truth.
  const hasTax = !!(settings.taxEnabled && settings.gstNumber && taxRate > 0);
  const isIntraState = !order.customerState || !sellerState ||
    order.customerState.trim().toLowerCase() === sellerState.trim().toLowerCase();

  const invoiceNumber = `INV-${order.orderId}`;
  const invoiceDate = new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN") : "";

  const left = 40, right = 555;
  let y = 40;

  doc.font("Helvetica-Bold").fontSize(16).text(sellerName.toUpperCase(), left, y);
  y += 20;
  doc.font("Helvetica-Bold").fontSize(11).text("Tax Invoice / Bill of Supply / Cash Memo", left, y);
  doc.font("Helvetica").fontSize(8).text("(Original for Recipient)", left, y + 14);
  y += 32;

  doc.moveTo(left, y).lineTo(right, y).strokeColor("#cccccc").stroke();
  y += 10;

  // Two columns: Sold By (left) / Billing Address (right)
  const colWidth = (right - left - 20) / 2;
  const soldByX = left, billToX = left + colWidth + 20;
  let soldByY = y, billToY = y;

  doc.font("Helvetica-Bold").fontSize(9).text("Sold By:", soldByX, soldByY);
  soldByY += 13;
  doc.font("Helvetica").fontSize(9);
  soldByY = doc.text(sellerName, soldByX, soldByY, { width: colWidth }).y;
  if (sellerId) soldByY = doc.text(`Seller ID: ${sellerId}`, soldByX, soldByY, { width: colWidth }).y;
  if (sellerAddress) soldByY = doc.text(sellerAddress, soldByX, soldByY, { width: colWidth }).y;
  if (sellerState) soldByY = doc.text(sellerState, soldByX, soldByY, { width: colWidth }).y;
  if (gstNumber) soldByY = doc.text(`GST Registration No: ${gstNumber}`, soldByX, soldByY, { width: colWidth }).y;

  doc.font("Helvetica-Bold").fontSize(9).text("Billing Address:", billToX, billToY);
  billToY += 13;
  doc.font("Helvetica").fontSize(9);
  billToY = doc.text(order.customerName || "", billToX, billToY, { width: colWidth }).y;
  billToY = doc.text(order.customerAddress || "", billToX, billToY, { width: colWidth }).y;
  billToY = doc.text(`${order.customerCity || ""}, ${order.customerState || ""} ${order.customerPincode || ""}`, billToX, billToY, { width: colWidth }).y;
  if (order.customerPhone) billToY = doc.text(`Phone: ${order.customerPhone}`, billToX, billToY, { width: colWidth }).y;

  y = Math.max(soldByY, billToY) + 12;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#cccccc").stroke();
  y += 10;

  doc.font("Helvetica").fontSize(9);
  doc.text(`Order Number: ${order.orderId}`, left, y);
  doc.text(`Invoice Number: ${invoiceNumber}`, billToX, y);
  y += 13;
  doc.text(`Order Date: ${orderDate}`, left, y);
  doc.text(`Invoice Date: ${invoiceDate}`, billToX, y);
  y += 18;

  // Item table
  const cols = hasTax
    ? [
      { key: "sl", label: "Sl.", w: 22 },
      { key: "desc", label: "Description", w: 150 },
      { key: "unit", label: "Unit Price", w: 55 },
      { key: "qty", label: "Qty", w: 28 },
      { key: "net", label: "Net Amt", w: 55 },
      { key: "taxRate", label: "Tax", w: 32 },
      { key: "taxType", label: "Tax Type", w: 55 },
      { key: "taxAmt", label: "Tax Amt", w: 50 },
      { key: "total", label: "Total", w: 55 }
    ]
    : [
      { key: "sl", label: "Sl.", w: 30 },
      { key: "desc", label: "Description", w: 260 },
      { key: "unit", label: "Unit Price", w: 75 },
      { key: "qty", label: "Qty", w: 40 },
      { key: "total", label: "Total", w: 110 }
    ];

  function drawRow(values, opts = {}) {
    const rowHeight = opts.height || 16;
    let x = left;
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    cols.forEach((c) => {
      doc.text(String(values[c.key] ?? ""), x + 2, y + 3, { width: c.w - 4, align: opts.align?.[c.key] || (c.key === "desc" ? "left" : "right") });
      x += c.w;
    });
    y += rowHeight;
  }

  doc.rect(left, y, right - left, 18).fillAndStroke("#f0ede6", "#cccccc");
  doc.fillColor("#000000");
  let hx = left;
  doc.font("Helvetica-Bold").fontSize(8);
  cols.forEach((c) => { doc.text(c.label, hx + 2, y + 5, { width: c.w - 4 }); hx += c.w; });
  y += 18;

  let totalNet = 0, totalTax = 0, totalAmount = 0;
  (order.items || []).forEach((item, i) => {
    const lineTotal = Number(item.price || 0) * Number(item.quantity || 0);
    let net = lineTotal, tax = 0, taxLabel = "";
    if (hasTax) {
      net = lineTotal / (1 + taxRate / 100);
      tax = lineTotal - net;
      taxLabel = isIntraState ? "CGST+SGST" : "IGST";
    }
    totalNet += net; totalTax += tax; totalAmount += lineTotal;

    const variantLine = (item.size || item.color) ? [item.size, item.color].filter(Boolean).join(" / ") : "";
    const descLines = [item.title];
    if (variantLine) descLines.push(variantLine);
    if (item.hsnCode) descLines.push(`HSN: ${item.hsnCode}`);
    const desc = descLines.join("\n");
    if (y > 720) { doc.addPage(); y = 40; } // simple pagination guard for very long orders
    drawRow({
      sl: i + 1,
      desc,
      unit: fmtINR(item.price),
      qty: item.quantity,
      net: fmtINR(net),
      taxRate: hasTax ? `${taxRate}%` : "",
      taxType: taxLabel,
      taxAmt: hasTax ? fmtINR(tax) : "",
      total: fmtINR(lineTotal)
    }, { height: 12 + descLines.length * 10 });
  });

  doc.moveTo(left, y).lineTo(right, y).strokeColor("#999999").stroke();
  y += 4;
  drawRow({
    desc: "TOTAL",
    net: fmtINR(totalNet),
    taxAmt: hasTax ? fmtINR(totalTax) : "",
    total: fmtINR(totalAmount)
  }, { bold: true });

  y += 8;
  if (order.discount) {
    doc.font("Helvetica").fontSize(9).text(`Discount Applied${order.couponCode ? ` (${order.couponCode})` : ""}: -${fmtINR(order.discount)}`, left, y);
    y += 13;
  }
  if (order.deliveryFee) {
    doc.text(`Delivery Fee: ${fmtINR(order.deliveryFee)}`, left, y);
    y += 13;
  }
  if (order.codCharge) {
    doc.text(`COD Charge: ${fmtINR(order.codCharge)}`, left, y);
    y += 13;
  }
  doc.font("Helvetica-Bold").fontSize(10).text(`Grand Total: ${fmtINR(order.finalTotal)}`, left, y);
  y += 20;

  doc.font("Helvetica").fontSize(9).text("Amount in Words:", left, y);
  y += 12;
  doc.font("Helvetica-Bold").text(amountToWords(order.finalTotal), left, y, { width: right - left });
  y += 24;

  doc.font("Helvetica").fontSize(8).fillColor("#555555");
  doc.text(`Whether tax is payable under reverse charge: No`, left, y); y += 12;
  doc.text(`Payment Mode: ${order.paymentMethod === "COD" ? `Cash on Delivery (Collect ${fmtINR(order.finalTotal)})` : "UPI (Paid)"}`, left, y); y += 12;
  doc.fillColor("#000000");
}

async function generateInvoiceBuffer(order, settings) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0 });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    drawInvoice(doc, order, settings);
    doc.end();
  });
}

async function loadSettings(db) {
  const snap = await db.collection("settings").doc("store_config").get();
  return snap.exists ? snap.data() : {};
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await verifyAdminToken(req);
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: " + err.message });
  }

  const db = getDb();
  const { action, orderId } = req.query;

  try {
    if (action === "invoice") {
      if (!orderId) return res.status(400).json({ error: "Missing orderId" });
      const [orderSnap, settings] = await Promise.all([
        db.collection("orders").doc(orderId).get(),
        loadSettings(db)
      ]);
      if (!orderSnap.exists) return res.status(404).json({ error: "Order not found" });
      const order = orderSnap.data();
      const buffer = await generateInvoiceBuffer(order, settings);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Invoice-${order.orderId}.pdf"`);
      return res.status(200).send(buffer);
    }

    if (action === "invoice-bulk") {
      const [ordersSnap, settings] = await Promise.all([
        db.collection("orders").get(),
        loadSettings(db)
      ]);
      if (ordersSnap.empty) return res.status(404).json({ error: "No orders found" });

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="Invoices-${new Date().toISOString().slice(0, 10)}.zip"`);

      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => { throw err; });
      archive.pipe(res);

      for (const doc of ordersSnap.docs) {
        const order = doc.data();
        try {
          const buffer = await generateInvoiceBuffer(order, settings);
          archive.append(buffer, { name: `Invoice-${order.orderId || doc.id}.pdf` });
        } catch (err) {
          console.error(`admin-tools: failed to generate invoice for order ${doc.id}:`, err.message);
          // Skip this one order rather than failing the whole ZIP —
          // one malformed order shouldn't block every other invoice.
        }
      }

      await archive.finalize();
      return;
    }

    return res.status(400).json({ error: "Unknown or missing action. Use ?action=invoice&orderId=... or ?action=invoice-bulk" });
  } catch (err) {
    console.error("admin-tools error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Something went wrong generating the invoice(s)." });
    }
  }
}


