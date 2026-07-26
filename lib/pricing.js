// lib/pricing.js
//
// Store Margin: an optional markup the admin can layer on top of every
// product's own Sale Price, so the price shown to shoppers (and the price
// actually charged at checkout) is "seller's price + admin's margin" —
// NOT a separate "platform fee" line anywhere. As far as the customer,
// the cart, the order, and the invoice are concerned, this marked-up
// number simply IS the product's price.
//
// Settings shape (settings/store_config doc):
//   storeMargin: { type: "percent" | "flat", value: <number> }
// Missing/invalid settings => no markup (returns the price unchanged).
//
// IMPORTANT: only ever apply this to the SELLING price shown to/charged
// to customers. Never apply it to MRP (that's the seller's own reference
// price) and never apply it anywhere in the admin panel, where the admin
// must always see/edit their own real, unmarked-up numbers.
export function applyStoreMargin(sellingPrice, settings) {
  const price = Number(sellingPrice) || 0;
  const margin = settings && settings.storeMargin;
  if (!margin || !margin.value) return price;

  const value = Number(margin.value) || 0;
  if (value <= 0) return price;

  const marked = margin.type === "flat" ? price + value : price + (price * value) / 100;
  // Whole rupees only — matches how every other price on the site is
  // shown (₹399, never ₹399.50), so the marked-up price doesn't stick
  // out as the one number on the page with decimals.
  return Math.round(marked);
}
