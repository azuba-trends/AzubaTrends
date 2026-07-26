// functions/product-feed.csv.js
// *** ADDED BY THE MIGRATION MANAGER ***
// vercel.json has a rewrite for this ("/product-feed.csv" ->
// "/api/product-feed") that none of the 4 workers' reports mentioned —
// caught during the merge review. Without this file, the Google
// Merchant Center / Meta product feed URL silently 404s on the new
// deployment even though functions/api/product-feed.js itself works fine.
import { onRequestGet as productFeedHandler } from "./api/product-feed.js";

export async function onRequestGet(context) {
  return productFeedHandler(context);
}
