/* Receipt Maker — pure logic core (browser + Node, no DOM).
   Money is handled in integer cents internally so totals never drift.
   Exposed as window.ReceiptCore in the browser and module.exports in Node. */
(function (global) {
  "use strict";

  var CURRENCIES = {
    IDR: { code: "IDR", symbol: "Rp ", pdfSymbol: "Rp ", thousands: ".", decimal: ",", decimals: 2 },
    USD: { code: "USD", symbol: "$", pdfSymbol: "$", thousands: ",", decimal: ".", decimals: 2 },
    PHP: { code: "PHP", symbol: "₱", pdfSymbol: "PHP ", thousands: ",", decimal: ".", decimals: 2 },
  };

  function currency(code) {
    return CURRENCIES[code] || CURRENCIES.IDR;
  }

  /* Parse a user-typed amount into a Number.
     Accepts Indonesian ("45.000", "15.500,50") and international
     ("1,500.00", "19.99") styles. The currency disambiguates a lone
     dot followed by exactly 3 digits: thousands for IDR, decimal else. */
  function parseAmount(raw, code) {
    if (raw === null || raw === undefined) return 0;
    if (typeof raw === "number") return isFinite(raw) ? raw : 0;
    var s = String(raw).replace(/[^\d.,-]/g, "");
    if (!s || s === "-" || s === "." || s === ",") return 0;
    var neg = s.charAt(0) === "-";
    s = s.replace(/-/g, "");
    var lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
    var normalized;
    if (lastDot >= 0 && lastComma >= 0) {
      // The later separator is the decimal one.
      if (lastComma > lastDot) normalized = s.replace(/\./g, "").replace(",", ".");
      else normalized = s.replace(/,/g, "");
    } else if (lastComma >= 0) {
      var partsC = s.split(",");
      if (partsC.length === 2 && partsC[1].length <= 2) normalized = s.replace(",", ".");
      else normalized = s.replace(/,/g, "");
    } else if (lastDot >= 0) {
      var partsD = s.split(".");
      if (partsD.length === 2 && partsD[1].length === 3 && code === "IDR") {
        normalized = s.replace(/\./g, ""); // 45.000 -> 45000
      } else if (partsD.length > 2) {
        normalized = s.replace(/\./g, "");
      } else {
        normalized = s;
      }
    } else {
      normalized = s;
    }
    var n = parseFloat(normalized);
    if (!isFinite(n)) return 0;
    return neg ? -n : n;
  }

  function toCents(n) { return Math.round(n * 100); }
  function fromCents(c) { return c / 100; }

  /* items: [{name, qty, price}] with qty/price already Numbers.
     shipping/discount Numbers. Returns amounts as Numbers (2dp-exact)
     plus *Cents integers for exact assertions. */
  function computeTotals(items, shipping, discount) {
    var lines = (items || []).map(function (it) {
      var qty = typeof it.qty === "number" && isFinite(it.qty) ? it.qty : 0;
      var priceCents = toCents(typeof it.price === "number" && isFinite(it.price) ? it.price : 0);
      var lineCents = Math.round(qty * priceCents);
      return {
        name: it.name || "",
        qty: qty,
        price: fromCents(priceCents),
        amount: fromCents(lineCents),
        amountCents: lineCents,
      };
    });
    var subtotalCents = lines.reduce(function (a, l) { return a + l.amountCents; }, 0);
    var shippingCents = toCents(shipping || 0);
    var discountCents = toCents(discount || 0);
    var totalCents = subtotalCents + shippingCents - discountCents;
    var clamped = false;
    if (totalCents < 0) { totalCents = 0; clamped = true; }
    return {
      lines: lines,
      subtotal: fromCents(subtotalCents),
      shipping: fromCents(shippingCents),
      discount: fromCents(discountCents),
      total: fromCents(totalCents),
      subtotalCents: subtotalCents,
      shippingCents: shippingCents,
      discountCents: discountCents,
      totalCents: totalCents,
      discountClamped: clamped,
    };
  }

  function groupThousands(intStr, sep) {
    return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  }

  /* Format an amount. IDR drops the decimals for whole rupiah
     (Rp 135.500); cents appear only when non-zero (Rp 15.500,50).
     USD/PHP always show 2 decimals ($45.47 / ₱1,234.50).
     opts.pdf swaps in the PDF-font-safe symbol (PHP -> "PHP "). */
  function formatMoney(amount, code, opts) {
    var cur = currency(code);
    var sym = opts && opts.pdf ? cur.pdfSymbol : cur.symbol;
    var cents = toCents(amount || 0);
    var neg = cents < 0;
    cents = Math.abs(cents);
    var intPart = Math.floor(cents / 100);
    var frac = cents % 100;
    var out = groupThousands(String(intPart), cur.thousands);
    var showFrac = code === "IDR" ? frac !== 0 : true;
    if (showFrac) out += cur.decimal + String(frac).padStart(2, "0");
    return (neg ? "-" : "") + sym + out;
  }

  function formatQty(qty) {
    if (typeof qty !== "number" || !isFinite(qty)) return "0";
    var s = (Math.round(qty * 1000) / 1000).toString();
    return s;
  }

  function makeInvoiceNo(date, rand) {
    var d = date instanceof Date ? date : new Date();
    var r = typeof rand === "number" ? rand : Math.random();
    var ymd = String(d.getFullYear()) +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0");
    var suffix = String(Math.floor(r * 1000)).padStart(3, "0");
    return "INV-" + ymd + "-" + suffix;
  }

  var MONTHS = {
    en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
  };

  /* "2026-11-12" (or a Date) -> "12 Nov 2026" */
  function formatDate(value, lang) {
    var d;
    if (value instanceof Date) d = value;
    else if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      var p = value.split("-");
      d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    } else d = new Date();
    var months = MONTHS[lang] || MONTHS.en;
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
  }

  /* pdf-lib standard fonts encode WinAnsi only. Strip anything outside a
     safe set so export never throws; the PNG path keeps the full text. */
  function sanitizeForPdf(text) {
    return String(text == null ? "" : text).split("").map(function (ch) {
      var cp = ch.codePointAt(0);
      if (cp >= 32 && cp <= 126) return ch;
      if (cp >= 160 && cp <= 255) return ch;
      if (cp === 0x2013 || cp === 0x2014 || cp === 0x2018 || cp === 0x2019 ||
          cp === 0x201C || cp === 0x201D || cp === 0x2022 || cp === 0x2026 ||
          cp === 0x20AC) return ch;
      if (ch === "₱") return ""; // handled via pdfSymbol "PHP "
      return "";
    }).join("");
  }

  var api = {
    CURRENCIES: CURRENCIES,
    currency: currency,
    parseAmount: parseAmount,
    computeTotals: computeTotals,
    formatMoney: formatMoney,
    formatQty: formatQty,
    makeInvoiceNo: makeInvoiceNo,
    formatDate: formatDate,
    sanitizeForPdf: sanitizeForPdf,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.ReceiptCore = api;
})(typeof window !== "undefined" ? window : globalThis);
