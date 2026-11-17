/* wa-qr-flyer — pure logic core (browser + Node, no DOM).
   WhatsApp order flyer: shop + product + price + phone + prefilled
   inquiry message -> wa.me link -> QR code -> printable 1080x1350 card.
   QR encoding itself is NOT reimplemented here: the tool reuses the
   vendored qrcode-generator library already shipped by qr-suite /
   wa-business-card (assets/vendor/qrcode.min.js, MIT, byte-identical
   copy) — see QC.md.
   Exposed as window.FlyerCore in the browser and module.exports in Node. */
(function (global) {
  "use strict";

  /* ---------- card geometry (single source of truth) ----------
     Canvas 1080 x 1350 (portrait, WhatsApp status / print).
     header band: accent colour, y 0..260 (shop name + subtitle)
     photo box:   x 190..890, y 300..560 (700 x 260, optional upload)
     product band: y 580..720 (up to 2 lines, centred)
     price band:  y 740..830 (large, accent colour)
     divider rule: y 845
     QR:          400 x 400, x 340..740, y 855..1255
     caption:     baseline y 1300 ("Scan to order on WhatsApp")
     wa.me line:  baseline y 1335, small grey (fallback if QR fails)
     The canvas renderer in app.js and the PIL verifier both read these
     numbers, via window.FlyerCore in the browser and the layout JSON
     the harness dumps. */
  var CARD_W = 1080;
  var CARD_H = 1350;
  var BG_HEX = "#ffffff";
  var HEADER_H = 260;
  var PHOTO_BOX = { x: 190, y: 300, w: 700, h: 260 };
  var PRODUCT_BAND = { x: 60, y: 580, w: 960, h: 140 };
  var PRICE_BAND = { x: 60, y: 740, w: 960, h: 90 };
  var DIVIDER_Y = 845;
  var QR_SIZE = 400;
  var QR_X = 340;
  var QR_Y = 855;
  var CAPTION_Y = 1300;
  var LINK_Y = 1335;

  var ACCENTS = [
    { id: "blue", hex: "#1450a0", name: "Blue" },
    { id: "green", hex: "#177245", name: "Green" },
    { id: "purple", hex: "#6d28d9", name: "Purple" },
    { id: "red", hex: "#b3122e", name: "Red" },
  ];

  var CURRENCIES = [
    { id: "IDR", symbol: "Rp", name: "IDR (Rp)" },
    { id: "USD", symbol: "$", name: "USD ($)" },
    { id: "MYR", symbol: "RM", name: "MYR (RM)" },
    { id: "SGD", symbol: "S$", name: "SGD (S$)" },
    { id: "PHP", symbol: "₱", name: "PHP (₱)" },
    { id: "INR", symbol: "₹", name: "INR (₹)" },
    { id: "EUR", symbol: "€", name: "EUR (€)" },
    { id: "GBP", symbol: "£", name: "GBP (£)" },
  ];

  function accentById(id) {
    for (var i = 0; i < ACCENTS.length; i++) {
      if (ACCENTS[i].id === id) return ACCENTS[i];
    }
    return ACCENTS[0];
  }

  function currencyById(id) {
    for (var i = 0; i < CURRENCIES.length; i++) {
      if (CURRENCIES[i].id === id) return CURRENCIES[i];
    }
    return CURRENCIES[0];
  }

  function flyerLayout() {
    return {
      cardW: CARD_W, cardH: CARD_H, bgHex: BG_HEX,
      headerH: HEADER_H,
      photoBox: { x: PHOTO_BOX.x, y: PHOTO_BOX.y, w: PHOTO_BOX.w, h: PHOTO_BOX.h },
      productBand: { x: PRODUCT_BAND.x, y: PRODUCT_BAND.y, w: PRODUCT_BAND.w, h: PRODUCT_BAND.h },
      priceBand: { x: PRICE_BAND.x, y: PRICE_BAND.y, w: PRICE_BAND.w, h: PRICE_BAND.h },
      dividerY: DIVIDER_Y,
      qrSize: QR_SIZE, qrX: QR_X, qrY: QR_Y,
      captionY: CAPTION_Y, linkY: LINK_Y,
    };
  }

  /* Normalise a phone number to bare digits. Same rule as
     wa-business-card: strips spaces, dashes, parentheses and dots; an
     optional leading + is dropped. 7-15 digits (E.164 range). */
  function normalizePhone(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return { ok: false, error: "empty-phone" };
    var hadPlus = s.charAt(0) === "+";
    var body = hadPlus ? s.slice(1) : s;
    if (/\+/.test(body)) return { ok: false, error: "bad-phone" };
    var digits = body.replace(/[\s\-().]/g, "");
    if (!/^\d+$/.test(digits)) return { ok: false, error: "bad-phone" };
    if (digits.length < 7 || digits.length > 15) return { ok: false, error: "bad-phone" };
    return { ok: true, digits: digits };
  }

  /* Format the price for the card: "<symbol> <price as typed>".
     Price must be non-empty; only whitespace is trimmed. */
  function formatPrice(price, currencyId) {
    var p = String(price == null ? "" : price).trim();
    if (!p) return { ok: false, error: "empty-price" };
    return { ok: true, text: currencyById(currencyId).symbol + " " + p };
  }

  /* Default prefilled inquiry message, built from the flyer fields.
     Used when the seller leaves the message box empty. */
  function defaultMessage(opts) {
    var o = opts || {};
    var shop = String(o.shop == null ? "" : o.shop).trim() || "your shop";
    var product = String(o.product == null ? "" : o.product).trim();
    var priceText = formatPrice(o.price, o.currency);
    var price = priceText.ok ? priceText.text : "";
    var msg = "Hi " + shop + "! I'd like to order: " + product;
    if (price) msg += " (" + price + ").";
    else msg += ".";
    return msg;
  }

  /* wa.me link with prefilled text. digits must already be normalised.
     Message is encodeURIComponent'd (UTF-8, non-ASCII included). */
  function buildWaLink(digits, message) {
    var d = String(digits == null ? "" : digits).trim();
    if (!/^\d{7,15}$/.test(d)) return { ok: false, error: "bad-phone" };
    var msg = String(message == null ? "" : message);
    return { ok: true, link: "https://wa.me/" + d + "?text=" + encodeURIComponent(msg) };
  }

  /* opts: { shop, product, price, currency, phone, message }
     Returns { ok: true, link, digits, priceText, message } or
     { ok: false, error }. message empty -> default template. */
  function buildFlyer(opts) {
    var o = opts || {};
    var shop = String(o.shop == null ? "" : o.shop).trim();
    if (!shop) return { ok: false, error: "empty-shop" };
    var product = String(o.product == null ? "" : o.product).trim();
    if (!product) return { ok: false, error: "empty-product" };
    var price = formatPrice(o.price, o.currency);
    if (!price.ok) return { ok: false, error: price.error };
    var ph = normalizePhone(o.phone);
    if (!ph.ok) return { ok: false, error: ph.error };
    var message = String(o.message == null ? "" : o.message).trim();
    if (!message) {
      message = defaultMessage({ shop: shop, product: product, price: o.price, currency: o.currency });
    }
    var link = buildWaLink(ph.digits, message);
    if (!link.ok) return { ok: false, error: link.error };
    return {
      ok: true, shop: shop, product: product, priceText: price.text,
      digits: ph.digits, message: message, link: link.link,
    };
  }

  /* File-safe slug for the PNG download name, from the shop name. */
  function slugifyShop(shop) {
    var s = String(shop == null ? "" : shop).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "shop";
  }

  var api = {
    CARD_W: CARD_W, CARD_H: CARD_H, BG_HEX: BG_HEX,
    QR_SIZE: QR_SIZE, QR_X: QR_X, QR_Y: QR_Y,
    ACCENTS: ACCENTS, CURRENCIES: CURRENCIES,
    accentById: accentById, currencyById: currencyById,
    flyerLayout: flyerLayout,
    normalizePhone: normalizePhone,
    formatPrice: formatPrice,
    defaultMessage: defaultMessage,
    buildWaLink: buildWaLink,
    buildFlyer: buildFlyer,
    slugifyShop: slugifyShop,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.FlyerCore = api;
})(typeof window !== "undefined" ? window : globalThis);
