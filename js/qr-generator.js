/**
 * qr-generator.js
 * ---------------------------------------------------------------------------
 * Builds a UPI deep link and renders it as a scannable QR code, client-side,
 * using the `qrcode` library (loaded via CDN in checkout.html — see the
 * <script src="https://cdn.jsdelivr.net/npm/qrcode@1/build/qrcode.min.js">
 * tag). No server involved: the QR just encodes a standard `upi://pay` URI
 * that any UPI app can parse.
 *
 * Exposes a global `QRGenerator` object.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /**
   * Builds the `upi://pay` deep-link string.
   * @param {{upiId: string, payeeName: string, amount: number, orderId: string}} params
   * @returns {string}
   */
  function buildUPILink({ upiId, payeeName, amount, orderId }) {
    const params = new URLSearchParams();
    params.set('pa', upiId);
    params.set('pn', payeeName);
    // UPI apps expect a plain decimal amount with 2 places, e.g. "499.00".
    params.set('am', Number(amount).toFixed(2));
    params.set('cu', 'INR');
    params.set('tn', `Order-${orderId}`);
    return `upi://pay?${params.toString()}`;
  }

  /**
   * Renders the QR code into the given <canvas> element.
   * @param {HTMLCanvasElement} canvasEl
   * @param {string} upiLink
   * @param {number} [size=240]
   * @returns {Promise<void>}
   */
  function renderQR(canvasEl, upiLink, size) {
    return new Promise((resolve, reject) => {
      if (!window.QRCode || typeof window.QRCode.toCanvas !== 'function') {
        reject(new Error('QR library not loaded'));
        return;
      }
      window.QRCode.toCanvas(
        canvasEl,
        upiLink,
        { width: size || 240, margin: 1 },
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  window.QRGenerator = { buildUPILink, renderQR };
})();
