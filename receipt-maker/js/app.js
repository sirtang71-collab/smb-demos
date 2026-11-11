/* Receipt & Invoice Maker — app logic: form state, EN/ID i18n,
   live totals, canvas PNG render, pdf-lib PDF render.
   Everything stays in the browser; the form autosaves to localStorage. */
(function () {
  "use strict";
  var Core = window.ReceiptCore;

  var I18N = {
    en: {
      h1: "Receipt & Invoice Maker",
      tagline: "A proper receipt for every sale — made in under a minute, sent as a picture or PDF.",
      privacy_badge: "🔒 Runs 100% in your browser. Your data is saved only on this device — nothing is uploaded, no account, no tracking.",
      sec_shop: "1 · Your shop", f_shop: "Shop name", ph_shop: "e.g. Berkah Coffee",
      f_phone: "Phone / WhatsApp (optional)", f_buyer: "Buyer name", ph_buyer: "e.g. Sari",
      f_date: "Date", f_currency: "Currency", f_invno: "Receipt number", btn_newno: "↻ New",
      sec_items: "2 · Items", col_item: "Item", col_qty: "Qty", col_price: "Price", col_amount: "Amount",
      btn_add: "＋ Add item",
      f_shipping: "Shipping", f_discount: "Discount",
      t_subtotal: "Subtotal", t_shipping: "Shipping", t_discount: "Discount", t_total: "TOTAL",
      sec_out: "3 · Get your receipt", btn_png: "⬇ Download image (PNG)", btn_pdf: "⬇ Download PDF",
      btn_clear: "Start over", sec_preview: "Preview",
      hint_local: "Everything you type is stored only in this browser (local storage) so it is still here when you come back. Nothing is sent to a server.",
      svc_text: "Sending receipts by hand is fine — until the orders pile up. Our WhatsApp auto-reply & order assistant answers buyers, takes orders and sends the details while you sleep.",
      svc_link: "See the service on Fiverr →",
      foot_strong: "Your data never leaves this device.",
      foot_text: "Everything runs locally in your browser. No uploads, no accounts, no tracking.",
      foot_note: "The preview is exactly what the PNG shows; the PDF carries the same content in text form.",
      ph_item: "Item name", ph_price: "Price",
      r_item: "ITEM", r_amount: "AMOUNT", r_buyer: "Buyer", r_subtotal: "Subtotal",
      r_shipping: "Shipping", r_discount: "Discount", r_total: "TOTAL",
      r_thanks: "Thank you!", r_made: "Made with Atang Lab's free Receipt Maker",
      s_png: "Image saved — check your downloads.", s_pdf: "PDF saved — check your downloads.",
      confirm_clear: "Clear everything and start a new receipt?",
    },
    id: {
      h1: "Pembuat Nota & Invoice",
      tagline: "Nota yang rapi untuk setiap penjualan — dibuat kurang dari semenit, dikirim sebagai gambar atau PDF.",
      privacy_badge: "🔒 100% berjalan di browser Anda. Data hanya tersimpan di perangkat ini — tidak diunggah, tanpa akun, tanpa pelacakan.",
      sec_shop: "1 · Toko Anda", f_shop: "Nama toko", ph_shop: "cth. Kopi Berkah",
      f_phone: "Telepon / WhatsApp (opsional)", f_buyer: "Nama pembeli", ph_buyer: "cth. Sari",
      f_date: "Tanggal", f_currency: "Mata uang", f_invno: "Nomor nota", btn_newno: "↻ Baru",
      sec_items: "2 · Barang", col_item: "Barang", col_qty: "Jml", col_price: "Harga", col_amount: "Jumlah",
      btn_add: "＋ Tambah barang",
      f_shipping: "Ongkir", f_discount: "Diskon",
      t_subtotal: "Subtotal", t_shipping: "Ongkir", t_discount: "Diskon", t_total: "TOTAL",
      sec_out: "3 · Ambil nota Anda", btn_png: "⬇ Unduh gambar (PNG)", btn_pdf: "⬇ Unduh PDF",
      btn_clear: "Mulai ulang", sec_preview: "Pratinjau",
      hint_local: "Semua yang Anda ketik hanya tersimpan di browser ini (local storage), jadi tetap ada saat Anda kembali. Tidak ada yang dikirim ke server.",
      svc_text: "Mengirim nota satu per satu itu mudah — sampai pesanan menumpuk. Asisten auto-reply & pesanan WhatsApp kami menjawab pembeli, menerima pesanan, dan mengirim detailnya selagi Anda tidur.",
      svc_link: "Lihat layanannya di Fiverr →",
      foot_strong: "Data Anda tidak pernah meninggalkan perangkat ini.",
      foot_text: "Semua berjalan lokal di browser Anda. Tanpa unggahan, tanpa akun, tanpa pelacakan.",
      foot_note: "Pratinjau sama persis dengan isi PNG; PDF membawa konten yang sama dalam bentuk teks.",
      ph_item: "Nama barang", ph_price: "Harga",
      r_item: "BARANG", r_amount: "JUMLAH", r_buyer: "Pembeli", r_subtotal: "Subtotal",
      r_shipping: "Ongkir", r_discount: "Diskon", r_total: "TOTAL",
      r_thanks: "Terima kasih!", r_made: "Dibuat dengan Pembuat Nota gratis Atang Lab",
      s_png: "Gambar tersimpan — cek folder unduhan Anda.", s_pdf: "PDF tersimpan — cek folder unduhan Anda.",
      confirm_clear: "Hapus semua dan mulai nota baru?",
    },
  };

  var LS_DOC = "receiptMaker.doc.v1";
  var LS_LANG = "receiptMaker.lang";
  var lang = "en";
  try { lang = localStorage.getItem(LS_LANG) === "id" ? "id" : "en"; } catch (e) {}
  function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key; }

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    shop: $("shop-name"), phone: $("shop-phone"), buyer: $("buyer-name"),
    date: $("doc-date"), currency: $("currency"), invNo: $("inv-no"),
    items: $("items"), shipping: $("shipping"), discount: $("discount"),
    tSubtotal: $("t-subtotal"), tShipping: $("t-shipping"),
    tDiscount: $("t-discount"), tTotal: $("t-total"),
    status: $("status"), preview: $("preview"),
  };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function blankDoc() {
    return {
      shop: "", phone: "", buyer: "", date: todayStr(), currency: "IDR",
      invNo: Core.makeInvoiceNo(new Date()),
      items: [{ name: "", qty: "1", price: "" }],
      shipping: "", discount: "",
    };
  }

  function loadDoc() {
    try {
      var raw = localStorage.getItem(LS_DOC);
      if (raw) {
        var d = JSON.parse(raw);
        if (d && Array.isArray(d.items) && d.items.length) return Object.assign(blankDoc(), d);
      }
    } catch (e) {}
    return blankDoc();
  }

  function saveDoc(doc) {
    try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); } catch (e) {}
  }

  /* ---------- item rows ---------- */
  function addItemRow(item) {
    var row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML =
      '<input type="text" class="it-name" autocomplete="off">' +
      '<input type="text" class="it-qty" inputmode="decimal" autocomplete="off">' +
      '<input type="text" class="it-price" inputmode="decimal" autocomplete="off">' +
      '<span class="line-amt">—</span>' +
      '<button type="button" class="rm" aria-label="Remove item">✕</button>';
    row.querySelector(".it-name").value = item.name || "";
    row.querySelector(".it-name").placeholder = t("ph_item");
    row.querySelector(".it-qty").value = item.qty != null ? item.qty : "1";
    row.querySelector(".it-price").value = item.price || "";
    row.querySelector(".it-price").placeholder = t("ph_price");
    row.querySelector(".rm").addEventListener("click", function () {
      if (els.items.children.length > 1) row.remove();
      else {
        row.querySelector(".it-name").value = "";
        row.querySelector(".it-qty").value = "1";
        row.querySelector(".it-price").value = "";
      }
      refresh();
    });
    row.addEventListener("input", refresh);
    els.items.appendChild(row);
    return row;
  }

  function readDoc() {
    var items = [];
    Array.prototype.forEach.call(els.items.children, function (row) {
      items.push({
        name: row.querySelector(".it-name").value.trim(),
        qty: row.querySelector(".it-qty").value,
        price: row.querySelector(".it-price").value,
      });
    });
    return {
      shop: els.shop.value.trim(), phone: els.phone.value.trim(),
      buyer: els.buyer.value.trim(), date: els.date.value || todayStr(),
      currency: els.currency.value, invNo: els.invNo.value.trim(),
      items: items, shipping: els.shipping.value, discount: els.discount.value,
    };
  }

  function computeFrom(doc) {
    var code = doc.currency;
    var items = doc.items.map(function (it) {
      return {
        name: it.name,
        qty: Core.parseAmount(it.qty, code),
        price: Core.parseAmount(it.price, code),
      };
    });
    // Rows the seller left completely blank do not belong on the receipt.
    var visible = items.filter(function (it) { return it.name || it.price || it.qty; });
    var totals = Core.computeTotals(visible,
      Core.parseAmount(doc.shipping, code), Core.parseAmount(doc.discount, code));
    return { doc: doc, totals: totals };
  }

  /* ---------- text wrapping (shared by canvas measure/draw) ---------- */
  var scratch = document.createElement("canvas").getContext("2d");
  function wrapLines(ctx, text, maxWidth, maxLines) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    var lines = [], cur = "";
    for (var i = 0; i < words.length; i++) {
      var test = cur ? cur + " " + words[i] : words[i];
      if (ctx.measureText(test).width <= maxWidth || !cur) cur = test;
      else { lines.push(cur); cur = words[i]; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last + "…";
    }
    return lines;
  }

  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  /* Lay out the receipt top-down. If ctx is a real context, also draw.
     Returns the total pixel height for width 840. */
  function layoutReceipt(ctx, doc, totals, draw) {
    var W = 840, PAD = 56, RIGHT = W - PAD, CW = W - PAD * 2;
    var code = doc.currency;
    var y = 0;
    function line(yy, color, width) {
      if (draw) {
        ctx.strokeStyle = color; ctx.lineWidth = width || 2;
        ctx.beginPath(); ctx.moveTo(PAD, yy); ctx.lineTo(RIGHT, yy); ctx.stroke();
      }
    }
    function text(str, x, yy, font, color, align) {
      if (draw) {
        ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align || "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(str, x, yy);
      }
    }
    // Header
    y += 78;
    ctx.font = "700 44px " + FONT;
    var shopLines = wrapLines(ctx, doc.shop || "—", CW, 2);
    shopLines.forEach(function (ln, i) {
      text(ln, W / 2, y + i * 52, "700 44px " + FONT, "#0d3266", "center");
    });
    y += (shopLines.length - 1) * 52;
    if (doc.phone) {
      y += 40;
      text(doc.phone, W / 2, y, "26px " + FONT, "#48525e", "center");
    }
    y += 28; line(y, "#1450a0", 3); y += 42;
    // Meta
    text(doc.invNo, PAD, y, "600 25px " + FONT, "#1d2733");
    text(Core.formatDate(doc.date, lang), RIGHT, y, "25px " + FONT, "#48525e", "right");
    if (doc.buyer) {
      y += 38;
      text(t("r_buyer") + ": " + doc.buyer, PAD, y, "25px " + FONT, "#1d2733");
    }
    y += 24; line(y, "#c3d2e6", 2); y += 40;
    // Column header
    text(t("r_item"), PAD, y, "700 22px " + FONT, "#6b7683");
    text(t("r_amount"), RIGHT, y, "700 22px " + FONT, "#6b7683", "right");
    y += 14;
    // Items
    totals.lines.forEach(function (ln) {
      ctx.font = "600 27px " + FONT;
      var nameLines = wrapLines(ctx, ln.name || "—", 452, 3);
      var firstBaseline = y + 30;
      nameLines.forEach(function (nl, i) {
        text(nl, PAD, firstBaseline + i * 34, "600 27px " + FONT, "#1d2733");
      });
      text(Core.formatMoney(ln.amount, code), RIGHT, firstBaseline, "600 27px " + FONT, "#1d2733", "right");
      var detailY = firstBaseline + (nameLines.length - 1) * 34 + 30;
      text(Core.formatQty(ln.qty) + " × " + Core.formatMoney(ln.price, code),
        PAD, detailY, "23px " + FONT, "#6b7683");
      y = detailY + 22;
    });
    if (!totals.lines.length) {
      y += 30;
      text("—", PAD, y, "25px " + FONT, "#6b7683");
      y += 22;
    }
    line(y, "#c3d2e6", 2); y += 42;
    // Totals (right block)
    var LX = 380;
    function trow(label, value, font, color) {
      text(label, LX, y, font, color || "#1d2733");
      text(value, RIGHT, y, font, color || "#1d2733", "right");
      y += 38;
    }
    trow(t("r_subtotal"), Core.formatMoney(totals.subtotal, code), "26px " + FONT);
    if (totals.shippingCents > 0) trow(t("r_shipping"), Core.formatMoney(totals.shipping, code), "26px " + FONT);
    if (totals.discountCents > 0) trow(t("r_discount"), "−" + Core.formatMoney(totals.discount, code), "26px " + FONT, "#b3122e");
    y -= 8; line(y, "#1450a0", 3); y += 48;
    trow(t("r_total"), Core.formatMoney(totals.total, code), "700 34px " + FONT, "#0d3266");
    // Footer
    y += 26;
    text(t("r_thanks"), W / 2, y, "700 28px " + FONT, "#0d3266", "center");
    y += 34;
    text(t("r_made"), W / 2, y, "20px " + FONT, "#8a95a3", "center");
    y += 52;
    return y;
  }

  function renderCanvas(canvas, doc, totals) {
    var h = layoutReceipt(scratch, doc, totals, false);
    canvas.width = 840;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    layoutReceipt(ctx, doc, totals, true);
    return { width: canvas.width, height: canvas.height };
  }

  /* ---------- PDF ---------- */
  function wrapPdf(font, text, size, maxWidth, maxLines) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    if (!words.length) return [""];
    var lines = [], cur = "";
    words.forEach(function (w) {
      var test = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(test, size) <= maxWidth || !cur) cur = test;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      while (last.length && font.widthOfTextAtSize(last + "...", size) > maxWidth) last = last.slice(0, -1);
      lines[maxLines - 1] = last + "...";
    }
    return lines;
  }

  async function buildPdf(doc, totals) {
    var PDFLib = window.PDFLib;
    var pdf = await PDFLib.PDFDocument.create();
    var bold = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
    var reg = await pdf.embedFont(PDFLib.StandardFonts.Helvetica);
    var S = Core.sanitizeForPdf;
    var code = doc.currency;
    var money = function (v) { return S(Core.formatMoney(v, code, { pdf: true })); };

    // Measure pass (mirrors draw pass below).
    var W = 420, PAD = 30, RIGHT = W - PAD;
    function measure() {
      var y = 46;
      var shopLines = wrapPdf(bold, S(doc.shop || "-"), 19, W - PAD * 2, 2);
      y += (shopLines.length - 1) * 23;
      if (doc.phone) y += 17;
      y += 12 + 8 + 18; // divider + meta line
      if (doc.buyer) y += 16;
      y += 10 + 8 + 24; // divider + col header + clearance to first item
      totals.lines.forEach(function (ln) {
        var nl = wrapPdf(bold, S(ln.name || "-"), 10.5, 225, 3);
        y += 13 + (nl.length - 1) * 13 + 12 + 9;
      });
      if (!totals.lines.length) y += 22;
      y += 8 + 16 + 16; // divider + subtotal
      if (totals.shippingCents > 0) y += 16;
      if (totals.discountCents > 0) y += 16;
      y += 6 + 20 + 20 + 15 + 26; // total + thanks + made + bottom pad
      return Math.max(y, 280);
    }
    var H = measure();
    var page = pdf.addPage([W, H]);
    var ink = PDFLib.rgb(0.114, 0.153, 0.2), blue = PDFLib.rgb(0.051, 0.196, 0.4),
        gray = PDFLib.rgb(0.283, 0.322, 0.369), light = PDFLib.rgb(0.765, 0.824, 0.902),
        red = PDFLib.rgb(0.702, 0.07, 0.18);
    var cy = 46; // distance from top to current baseline
    function txt(str, x, size, font, color, align) {
      var s = S(str);
      var w = font.widthOfTextAtSize(s, size);
      var xx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
      page.drawText(s, { x: xx, y: H - cy, size: size, font: font, color: color });
    }
    function hline(yy, color, thickness) {
      page.drawLine({ start: { x: PAD, y: H - yy }, end: { x: RIGHT, y: H - yy }, thickness: thickness, color: color });
    }
    var shopLines = wrapPdf(bold, S(doc.shop || "-"), 19, W - PAD * 2, 2);
    shopLines.forEach(function (ln, i) { txt(ln, W / 2, 19, bold, blue, "center"); if (i < shopLines.length - 1) cy += 23; });
    if (doc.phone) { cy += 17; txt(doc.phone, W / 2, 10.5, reg, gray, "center"); }
    cy += 12; hline(cy, blue, 1.4); cy += 8 + 10;
    txt(doc.invNo, PAD, 10.5, bold, ink);
    txt(Core.formatDate(doc.date, lang), RIGHT, 10.5, reg, gray, "right");
    if (doc.buyer) { cy += 16; txt(t("r_buyer") + ": " + doc.buyer, PAD, 10.5, reg, ink); }
    cy += 10; hline(cy, light, 0.8); cy += 8 + 6;
    txt(t("r_item"), PAD, 8.5, bold, gray);
    txt(t("r_amount"), RIGHT, 8.5, bold, gray, "right");
    cy += 18;
    totals.lines.forEach(function (ln) {
      var nl = wrapPdf(bold, S(ln.name || "-"), 10.5, 225, 3);
      nl.forEach(function (s2, i) { txt(s2, PAD, 10.5, bold, ink); if (i === 0) txt(money(ln.amount), RIGHT, 10.5, bold, ink, "right"); if (i < nl.length - 1) cy += 13; });
      cy += 12;
      txt(Core.formatQty(ln.qty) + " x " + money(ln.price), PAD, 9, reg, gray);
      cy += 9;
    });
    if (!totals.lines.length) { cy += 13; txt("-", PAD, 10.5, reg, gray); cy += 9; }
    hline(cy, light, 0.8); cy += 8 + 8;
    var LX = 195;
    function prow(label, value, size, font, color) {
      txt(label, LX, size, font, color);
      txt(value, RIGHT, size, font, color, "right");
      cy += size + 5;
    }
    prow(t("r_subtotal"), money(totals.subtotal), 11, reg, ink);
    if (totals.shippingCents > 0) prow(t("r_shipping"), money(totals.shipping), 11, reg, ink);
    if (totals.discountCents > 0) prow(t("r_discount"), "-" + money(totals.discount), 11, reg, red);
    cy += 1; hline(cy, blue, 1.4); cy += 6 + 8;
    prow(t("r_total"), money(totals.total), 14, bold, blue);
    cy += 8;
    txt(t("r_thanks"), W / 2, 12, bold, blue, "center");
    cy += 14;
    txt(t("r_made"), W / 2, 7.5, reg, gray, "center");
    return await pdf.save();
  }

  /* ---------- downloads ---------- */
  function saveBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function setStatus(msg, ok) {
    els.status.textContent = msg;
    els.status.className = "status " + (ok ? "ok" : msg ? "error" : "");
  }

  window.ReceiptMaker = { lastExport: null };

  function downloadPNG() {
    var state = computeFrom(readDoc());
    var off = document.createElement("canvas");
    var dims = renderCanvas(off, state.doc, state.totals);
    window.ReceiptMaker.lastExport = {
      kind: "png", width: dims.width, height: dims.height,
      totalCents: state.totals.totalCents, currency: state.doc.currency,
      totalFormatted: Core.formatMoney(state.totals.total, state.doc.currency),
      lineCount: state.totals.lines.length,
    };
    off.toBlob(function (blob) {
      saveBlob(blob, "receipt-" + state.doc.invNo + ".png");
      setStatus(t("s_png"), true);
    }, "image/png");
  }

  async function downloadPDF() {
    var state = computeFrom(readDoc());
    try {
      var bytes = await buildPdf(state.doc, state.totals);
      window.ReceiptMaker.lastExport = {
        kind: "pdf", sizeBytes: bytes.length,
        totalCents: state.totals.totalCents, currency: state.doc.currency,
        totalFormatted: Core.formatMoney(state.totals.total, state.doc.currency, { pdf: true }),
        lineCount: state.totals.lines.length,
      };
      saveBlob(new Blob([bytes], { type: "application/pdf" }), "receipt-" + state.doc.invNo + ".pdf");
      setStatus(t("s_pdf"), true);
    } catch (err) {
      setStatus("PDF error: " + err.message, false);
    }
  }

  /* ---------- refresh / wiring ---------- */
  var refreshTimer = null;
  function refresh() {
    var doc = readDoc();
    saveDoc(doc);
    var state = computeFrom(doc);
    var code = doc.currency;
    els.tSubtotal.textContent = Core.formatMoney(state.totals.subtotal, code);
    els.tShipping.textContent = Core.formatMoney(state.totals.shipping, code);
    els.tDiscount.textContent = "−" + Core.formatMoney(state.totals.discount, code);
    els.tTotal.textContent = Core.formatMoney(state.totals.total, code);
    Array.prototype.forEach.call(els.items.children, function (row, i) {
      var it = state.totals.lines[i];
      // line-amt mirrors the raw row (before blank-row filtering) — recompute here
      var qty = Core.parseAmount(row.querySelector(".it-qty").value, code);
      var price = Core.parseAmount(row.querySelector(".it-price").value, code);
      row.querySelector(".line-amt").textContent =
        qty && price ? Core.formatMoney(Math.round(qty * Math.round(price * 100)) / 100, code) : "—";
    });
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () { renderCanvas(els.preview, doc, state.totals); }, 100);
  }

  function applyLang() {
    document.documentElement.lang = lang === "id" ? "id" : "en";
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (el) {
      el.placeholder = t(el.getAttribute("data-i18n-ph"));
    });
    Array.prototype.forEach.call(els.items.children, function (row) {
      row.querySelector(".it-name").placeholder = t("ph_item");
      row.querySelector(".it-price").placeholder = t("ph_price");
    });
    $("lang-en").classList.toggle("active", lang === "en");
    $("lang-id").classList.toggle("active", lang === "id");
    refresh();
  }

  function fillForm(doc) {
    els.shop.value = doc.shop; els.phone.value = doc.phone;
    els.buyer.value = doc.buyer; els.date.value = doc.date;
    els.currency.value = doc.currency; els.invNo.value = doc.invNo;
    els.shipping.value = doc.shipping; els.discount.value = doc.discount;
    els.items.innerHTML = "";
    doc.items.forEach(addItemRow);
  }

  function init() {
    var doc = loadDoc();
    fillForm(doc);
    ["shop-name", "shop-phone", "buyer-name", "doc-date", "currency", "shipping", "discount"]
      .forEach(function (id) { $(id).addEventListener("input", refresh); $(id).addEventListener("change", refresh); });
    $("add-item").addEventListener("click", function () { addItemRow({ name: "", qty: "1", price: "" }); refresh(); });
    $("inv-regen").addEventListener("click", function () { els.invNo.value = Core.makeInvoiceNo(new Date()); refresh(); });
    $("dl-png").addEventListener("click", downloadPNG);
    $("dl-pdf").addEventListener("click", downloadPDF);
    $("clear-all").addEventListener("click", function () {
      if (!window.confirm(t("confirm_clear"))) return;
      try { localStorage.removeItem(LS_DOC); } catch (e) {}
      fillForm(blankDoc());
      setStatus("", true);
      refresh();
    });
    $("lang-en").addEventListener("click", function () { lang = "en"; try { localStorage.setItem(LS_LANG, "en"); } catch (e) {} applyLang(); });
    $("lang-id").addEventListener("click", function () { lang = "id"; try { localStorage.setItem(LS_LANG, "id"); } catch (e) {} applyLang(); });
    applyLang();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
