// lib/invoice.js
//
// Order-invoice PDF generation, ported from the original Vercel
// api/admin-tools.js's pdfkit-based drawInvoice(). pdfkit is Node-stream
// based and unsafe on Cloudflare Workers; pdf-lib is pure JS and confirmed
// to work on Workers with no compat flags. The original already did its
// own manual x/y positioning (no pdfkit auto text-flow), so this is a
// bounded 1:1 rewrite against pdf-lib's lower-level drawing API, not a
// redesign. Layout, columns, tax logic, and Indian-numbering/currency
// formatting are unchanged from the original.
//
// pdf-lib's coordinate system has (0,0) at the BOTTOM-left of the page and
// y increasing upward — the opposite of pdfkit, which places (0,0) at the
// TOP-left with y increasing downward. Every helper below takes a
// "yFromTop" value (same numbers the original pdfkit code used) and
// converts internally, so the layout math below reads the same as the
// original file.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_WIDTH = 595.28; // A4 in points
const PAGE_HEIGHT = 841.89;
const LEFT = 40;
const RIGHT = 555;

function hex(color) {
  const n = parseInt(color.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const COLOR_BLACK = rgb(0, 0, 0);
const COLOR_GREY_LINE = hex("#cccccc");
const COLOR_GREY_LINE_DARK = hex("#999999");
const COLOR_GREY_TEXT = hex("#555555");
const COLOR_HEADER_BG = hex("#f0ede6");

// ---------------------------------------------------------------------
// Number -> Indian-English words (for "Amount in Words"), unchanged from
// the original — pure math, no dependency on pdfkit or Firestore.
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
export function integerToWordsIndian(n) {
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
export function amountToWords(amount) {
  const rupees = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - rupees) * 100);
  let words = "Rupees " + integerToWordsIndian(rupees);
  if (paise > 0) words += " and " + twoDigitWords(paise) + " Paise";
  return words + " Only";
}

function fmtINR(n) {
  return "Rs. " + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Simple greedy word-wrap for the one column (item description) that can
// realistically overflow its width — everything else in this layout is
// short enough (prices, qty, dates) to stay on one line.
function wrapText(font, size, text, maxWidth) {
  const words = String(text ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const trial = current ? current + " " + word : word;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

// ---------------------------------------------------------------------
// Draws one order's invoice onto a fresh page of `pdfDoc`. Mirrors the
// original drawInvoice(doc, order, settings) 1:1 in layout/content.
// ---------------------------------------------------------------------
async function drawInvoice(pdfDoc, order, settings, fonts) {
  const { regular, bold } = fonts;
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const text = (str, x, yFromTop, opts = {}) => {
    const size = opts.size || 9;
    const font = opts.bold ? bold : regular;
    const color = opts.color || COLOR_BLACK;
    let drawX = x;
    if (opts.align === "right" && opts.width) {
      const w = font.widthOfTextAtSize(String(str), size);
      drawX = x + opts.width - w;
    }
    page.drawText(String(str ?? ""), {
      x: drawX,
      y: PAGE_HEIGHT - yFromTop - size,
      size,
      font,
      color
    });
  };

  const line = (x1, x2, yFromTop, color = COLOR_GREY_LINE) => {
    page.drawLine({
      start: { x: x1, y: PAGE_HEIGHT - yFromTop },
      end: { x: x2, y: PAGE_HEIGHT - yFromTop },
      thickness: 1,
      color
    });
  };

  const rectFilled = (x, yFromTop, w, h, fillColor, borderColor) => {
    page.drawRectangle({
      x,
      y: PAGE_HEIGHT - yFromTop - h,
      width: w,
      height: h,
      color: fillColor,
      borderColor,
      borderWidth: borderColor ? 1 : 0
    });
  };

  const sellerName = settings.sellerName || settings.storeName || "Store";
  const sellerId = settings.sellerId || "";
  const sellerAddress = settings.sellerAddress || "";
  const sellerState = settings.sellerState || "";
  const gstNumber = settings.gstNumber || "";
  const taxRate = Number(settings.taxRate) || 0;
  // Tax is OFF by default and stays off unless the admin explicitly ticks
  // "This business is GST-registered" in Settings — filling in a GSTIN
  // alone does NOT turn tax on; the checkbox is the single source of truth.
  const hasTax = !!(settings.taxEnabled && settings.gstNumber && taxRate > 0);
  const isIntraState = !order.customerState || !sellerState ||
    order.customerState.trim().toLowerCase() === sellerState.trim().toLowerCase();

  const invoiceNumber = `INV-${order.orderId}`;
  const invoiceDate = new Date().toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN") : "";

  let y = 40;

  text(sellerName.toUpperCase(), LEFT, y, { size: 16, bold: true });
  y += 20;
  text("Tax Invoice / Bill of Supply / Cash Memo", LEFT, y, { size: 11, bold: true });
  text("(Original for Recipient)", LEFT, y + 14, { size: 8 });
  y += 32;

  line(LEFT, RIGHT, y);
  y += 10;

  // Two columns: Sold By (left) / Billing Address (right)
  const colWidth = (RIGHT - LEFT - 20) / 2;
  const soldByX = LEFT, billToX = LEFT + colWidth + 20;
  let soldByY = y, billToY = y;

  text("Sold By:", soldByX, soldByY, { size: 9, bold: true });
  soldByY += 13;
  const soldByLines = [sellerName];
  if (sellerId) soldByLines.push(`Seller ID: ${sellerId}`);
  if (sellerAddress) soldByLines.push(sellerAddress);
  if (sellerState) soldByLines.push(sellerState);
  if (gstNumber) soldByLines.push(`GST Registration No: ${gstNumber}`);
  for (const l of soldByLines) {
    for (const wrapped of wrapText(regular, 9, l, colWidth)) {
      text(wrapped, soldByX, soldByY, { size: 9 });
      soldByY += 12;
    }
  }

  text("Billing Address:", billToX, billToY, { size: 9, bold: true });
  billToY += 13;
  const billToLines = [
    order.customerName || "",
    order.customerAddress || "",
    `${order.customerCity || ""}, ${order.customerState || ""} ${order.customerPincode || ""}`
  ];
  if (order.customerPhone) billToLines.push(`Phone: ${order.customerPhone}`);
  for (const l of billToLines) {
    for (const wrapped of wrapText(regular, 9, l, colWidth)) {
      text(wrapped, billToX, billToY, { size: 9 });
      billToY += 12;
    }
  }

  y = Math.max(soldByY, billToY) + 12;
  line(LEFT, RIGHT, y);
  y += 10;

  text(`Order Number: ${order.orderId}`, LEFT, y, { size: 9 });
  text(`Invoice Number: ${invoiceNumber}`, billToX, y, { size: 9 });
  y += 13;
  text(`Order Date: ${orderDate}`, LEFT, y, { size: 9 });
  text(`Invoice Date: ${invoiceDate}`, billToX, y, { size: 9 });
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

  // Wraps each explicit "\n"-separated line of the description column to
  // its actual column width, and reports how many rendered lines that
  // took — the row height is sized off this, and every other column
  // (price/qty/etc.) is short enough to never need wrapping.
  function wrapDescColumn(desc, colWidth) {
    const rawLines = String(desc ?? "").split("\n");
    const wrapped = [];
    for (const raw of rawLines) {
      wrapped.push(...wrapText(regular, 8, raw, colWidth - 4));
    }
    return wrapped;
  }

  function drawRow(values, opts = {}) {
    const descCol = cols.find((c) => c.key === "desc");
    const descWrapped = descCol ? wrapDescColumn(values.desc, descCol.w) : [""];
    const rowHeight = opts.height || Math.max(16, 10 + descWrapped.length * 10);

    let x = LEFT;
    cols.forEach((c) => {
      if (c.key === "desc") {
        let ly = y;
        for (const l of descWrapped) {
          text(l, x + 2, ly + 3, { size: 8, bold: !!opts.bold, align: "left" });
          ly += 10;
        }
      } else {
        text(String(values[c.key] ?? ""), x + 2, y + 3, {
          size: 8,
          bold: !!opts.bold,
          align: "right",
          width: c.w - 4
        });
      }
      x += c.w;
    });
    y += rowHeight;
  }

  rectFilled(LEFT, y, RIGHT - LEFT, 18, COLOR_HEADER_BG, COLOR_GREY_LINE);
  let hx = LEFT;
  cols.forEach((c) => { text(c.label, hx + 2, y + 5, { size: 8, bold: true }); hx += c.w; });
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
    if (y > 720) { page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = 40; }
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
    });
  });

  line(LEFT, RIGHT, y, COLOR_GREY_LINE_DARK);
  y += 4;
  drawRow({
    desc: "TOTAL",
    net: fmtINR(totalNet),
    taxAmt: hasTax ? fmtINR(totalTax) : "",
    total: fmtINR(totalAmount)
  }, { bold: true });

  y += 8;
  if (order.discount) {
    text(`Discount Applied${order.couponCode ? ` (${order.couponCode})` : ""}: -${fmtINR(order.discount)}`, LEFT, y, { size: 9 });
    y += 13;
  }
  if (order.deliveryFee) {
    text(`Delivery Fee: ${fmtINR(order.deliveryFee)}`, LEFT, y, { size: 9 });
    y += 13;
  }
  if (order.codCharge) {
    text(`COD Charge: ${fmtINR(order.codCharge)}`, LEFT, y, { size: 9 });
    y += 13;
  }
  text(`Grand Total: ${fmtINR(order.finalTotal)}`, LEFT, y, { size: 10, bold: true });
  y += 20;

  text("Amount in Words:", LEFT, y, { size: 9 });
  y += 12;
  for (const l of wrapText(bold, 9, amountToWords(order.finalTotal), RIGHT - LEFT)) {
    text(l, LEFT, y, { size: 9, bold: true });
    y += 12;
  }
  y += 12;

  text("Whether tax is payable under reverse charge: No", LEFT, y, { size: 8, color: COLOR_GREY_TEXT });
  y += 12;
  text(
    `Payment Mode: ${order.paymentMethod === "COD" ? `Cash on Delivery (Collect ${fmtINR(order.finalTotal)})` : "UPI (Paid)"}`,
    LEFT, y, { size: 8, color: COLOR_GREY_TEXT }
  );
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

// Returns a single order's invoice as a Uint8Array (PDF bytes).
export async function generateInvoicePdf(order, settings) {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  await drawInvoice(pdfDoc, order, settings, { regular, bold });
  return pdfDoc.save();
}
