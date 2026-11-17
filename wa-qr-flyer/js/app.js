/* wa-qr-flyer — app logic: live preview, QR render from the vendored
   qrcode-generator module matrix, 1080x1350 flyer PNG download,
   copy wa.me link, optional product photo.
   Everything stays in the browser; the form autosaves to localStorage
   (photo is NOT saved — it lives only for this session).
   The QR is drawn by hand from qrcode.getModuleCount()/isDark() onto
   the card canvas with a 4-module white quiet zone — the library's own
   table / canvas output is never used. No network requests: the only
   links out are the hub link and the Fiverr link the user clicks. */
(function () {
  "use strict";
  var Core = window.FlyerCore;

  var LS_DOC = "waFlyer.doc.v1";
  var QR_EC = "M";
  var QUIET = 4;
  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    shop: $("fl-shop"), product: $("fl-product"), price: $("fl-price"),
    currency: $("fl-currency"), phone: $("fl-phone"), message: $("fl-message"),
    photo: $("fl-photo"), photoName: $("fl-photo-name"),
    preview: $("fl-preview"),
    status: $("fl-status"), resultInfo: $("fl-result-info"),
    dlPng: $("fl-dl-png"), copyLink: $("fl-copy-link"), clear: $("fl-clear"),
    waBtn: $("fl-wa-btn"), waLinkText: $("fl-wa-link"),
  };

  window.Flyer = { lastExport: null, renderInfo: null, lastLink: null, photoLoaded: false };

  var photoImg = null; /* HTMLImageElement or null */

  function blankDoc() {
    return { shop: "", product: "", price: "", currency: "IDR", phone: "", message: "", accent: "green" };
  }
  function loadDoc() {
    try {
      var raw = localStorage.getItem(LS_DOC);
      if (raw) { var d = JSON.parse(raw); if (d) return Object.assign(blankDoc(), d); }
    } catch (e) {}
    return blankDoc();
  }
  function saveDoc() {
    try {
      localStorage.setItem(LS_DOC, JSON.stringify(readDoc()));
    } catch (e) {}
  }
  function readDoc() {
    var accent = "green";
    var sel = document.querySelector('input[name="accent"]:checked');
    if (sel) accent = sel.value;
    return {
      shop: els.shop.value, product: els.product.value, price: els.price.value,
      currency: els.currency.value, phone: els.phone.value, message: els.message.value,
      accent: accent,
    };
  }
  function fillForm(doc) {
    els.shop.value = doc.shop || "";
    els.product.value = doc.product || "";
    els.price.value = doc.price || "";
    els.currency.value = doc.currency || "IDR";
    els.phone.value = doc.phone || "";
    els.message.value = doc.message || "";
    var radio = document.querySelector('input[name="accent"][value="' + (doc.accent || "green") + '"]');
    if (radio) radio.checked = true;
  }

  /* ---------- text wrapping ---------- */
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

  /* Draw the QR module matrix into a square region of `ctx`.
     Returns render info (module count / cell / offsets) or throws when
     the payload does not fit the QR capacity. */
  function drawQRRegion(ctx, payload, x, y, size, ec) {
    var qr = qrcode(0, ec);
    qr.addData(payload);
    qr.make();
    var count = qr.getModuleCount();
    var cell = Math.max(1, Math.floor(size / (count + QUIET * 2)));
    var offsetX = x + Math.floor((size - cell * count) / 2);
    var offsetY = y + Math.floor((size - cell * count) / 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = "#000000";
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(offsetX + c * cell, offsetY + r * cell, cell, cell);
      }
    }
    return { moduleCount: count, cell: cell, offsetX: offsetX, offsetY: offsetY, size: size, ec: ec, payload: payload };
  }

  /* Cover-fit draw of the product photo into the photo box. */
  function drawPhotoCover(ctx, img, box) {
    var scale = Math.max(box.w / img.naturalWidth, box.h / img.naturalHeight);
    var dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    var dx = box.x + (box.w - dw) / 2, dy = box.y + (box.h - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    ctx.strokeStyle = "#c3d2e6";
    ctx.lineWidth = 2;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
  }

  /* Render the 1080x1350 flyer onto any canvas. Geometry comes from
     FlyerCore.flyerLayout() so the verifier can reproduce it exactly. */
  function renderCard(canvas, doc, flyer) {
    var L = Core.flyerLayout();
    var W = L.cardW, H = L.cardH;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext("2d");
    var accent = Core.accentById(doc.accent);

    // Background
    ctx.fillStyle = Core.BG_HEX;
    ctx.fillRect(0, 0, W, H);

    // Header band
    ctx.fillStyle = accent.hex;
    ctx.fillRect(0, 0, W, L.headerH);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 72px " + FONT;
    var shopLines = wrapLines(ctx, flyer.shop, W - 120, 1);
    ctx.fillText(shopLines[0], W / 2, 125);
    ctx.font = "500 40px " + FONT;
    ctx.globalAlpha = 0.88;
    ctx.fillText("Order on WhatsApp", W / 2, 205);
    ctx.globalAlpha = 1;

    // Product photo (optional)
    if (photoImg) drawPhotoCover(ctx, photoImg, L.photoBox);

    // Product name (up to 2 lines)
    ctx.fillStyle = "#1d2733";
    ctx.font = "700 64px " + FONT;
    var prodLines = wrapLines(ctx, flyer.product, L.productBand.w, 2);
    var prodBase = prodLines.length > 1 ? 630 : 660;
    prodLines.forEach(function (line, i) {
      ctx.fillText(line, W / 2, prodBase + i * 72);
    });

    // Price
    ctx.fillStyle = accent.hex;
    ctx.font = "800 84px " + FONT;
    ctx.fillText(flyer.priceText, W / 2, 810);

    // Divider rule
    ctx.fillStyle = accent.hex;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(W / 2 - 90, L.dividerY, 180, 4);
    ctx.globalAlpha = 1;

    // QR code
    var qrInfo = drawQRRegion(ctx, flyer.link, L.qrX, L.qrY, L.qrSize, QR_EC);

    // Caption + short wa.me fallback line
    ctx.fillStyle = "#1d2733";
    ctx.font = "600 38px " + FONT;
    ctx.fillText("Scan to order on WhatsApp", W / 2, L.captionY);
    ctx.fillStyle = "#6b7683";
    ctx.font = "400 24px " + FONT;
    ctx.fillText("wa.me/" + flyer.digits, W / 2, L.linkY);

    return {
      width: W, height: H, layout: L, accentHex: accent.hex,
      qr: qrInfo, link: flyer.link, digits: flyer.digits,
      shop: flyer.shop, product: flyer.product, priceText: flyer.priceText,
    };
  }

  function drawPlaceholder(canvas, message) {
    var L = Core.flyerLayout();
    canvas.width = L.cardW; canvas.height = L.cardH;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, L.cardW, L.cardH);
    ctx.fillStyle = "#9aa3ab";
    ctx.font = "32px " + FONT;
    ctx.textAlign = "center";
    ctx.fillText(message, L.cardW / 2, L.cardH / 2);
  }

  function setStatus(msg, ok) {
    els.status.textContent = msg;
    els.status.className = "status " + (ok ? "ok" : msg ? "error" : "");
  }

  function render() {
    saveDoc();
    var doc = readDoc();
    var res = Core.buildFlyer(doc);
    if (!res.ok) {
      els.waLinkText.textContent = "";
      els.waBtn.hidden = true;
      window.Flyer.renderInfo = null;
      window.Flyer.lastLink = null;
      window.Flyer.lastExport = null;
      drawPlaceholder(els.preview, "Fill in your shop, product, price and phone");
      els.dlPng.disabled = true;
      els.copyLink.disabled = true;
      els.resultInfo.textContent = "";
      if (res.error === "empty-shop" || res.error === "empty-product" ||
          res.error === "empty-price" || res.error === "empty-phone") setStatus("", true);
      else if (res.error === "bad-phone") setStatus("Phone number looks wrong — use digits with the country code, e.g. +62 812 3456 7890.", false);
      else setStatus("Fill in the shop, product, price and phone number first.", false);
      return;
    }
    els.waLinkText.textContent = res.link;
    els.waBtn.hidden = false;
    els.waBtn.href = res.link;
    window.Flyer.lastLink = res.link;
    try {
      var info = renderCard(els.preview, doc, res);
      window.Flyer.renderInfo = info;
      window.Flyer.lastExport = null;
      els.dlPng.disabled = false;
      els.copyLink.disabled = false;
      els.resultInfo.textContent = "Flyer: " + info.width + " × " + info.height + " px · QR " +
        info.qr.moduleCount + " × " + info.qr.moduleCount + " modules (version " +
        ((info.qr.moduleCount - 21) / 4 + 1) + ", error correction " + info.qr.ec +
        ") · price " + res.priceText + " · link " + res.link + ".";
      setStatus("", true);
    } catch (err) {
      window.Flyer.renderInfo = null;
      window.Flyer.lastExport = null;
      drawPlaceholder(els.preview, "—");
      els.dlPng.disabled = true;
      els.copyLink.disabled = true;
      setStatus("Too much text for a QR code — shorten the message.", false);
    }
  }

  function saveBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function downloadPNG() {
    var doc = readDoc();
    var res = Core.buildFlyer(doc);
    if (!res.ok) return;
    var off = document.createElement("canvas");
    var info = renderCard(off, doc, res);
    window.Flyer.renderInfo = info;
    off.toBlob(function (blob) {
      window.Flyer.lastExport = {
        kind: "png", width: info.width, height: info.height,
        sizeBytes: blob ? blob.size : null,
        layout: info.layout, qr: info.qr, accentHex: info.accentHex,
        link: info.link, digits: info.digits, shop: info.shop,
        product: info.product, priceText: info.priceText,
        photoLoaded: !!photoImg,
        filename: "wa-order-flyer-" + Core.slugifyShop(doc.shop) + ".png",
      };
      saveBlob(blob, window.Flyer.lastExport.filename);
      setStatus("Flyer saved — check your downloads.", true);
    }, "image/png");
  }

  function copyLink() {
    var link = window.Flyer.lastLink;
    if (!link) return;
    function done() { setStatus("WhatsApp link copied — paste it anywhere.", true); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { setStatus("Copy failed — select the link above and copy it by hand.", false); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, fallback);
    } else fallback();
  }

  function onPhotoFile(file) {
    if (!file) { photoImg = null; window.Flyer.photoLoaded = false; els.photoName.textContent = ""; render(); return; }
    if (!/^image\//.test(file.type || "")) {
      setStatus("That file is not an image — pick a JPG or PNG photo.", false);
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        photoImg = img;
        window.Flyer.photoLoaded = true;
        els.photoName.textContent = file.name + " (" + img.naturalWidth + "×" + img.naturalHeight + ")";
        render();
      };
      img.onerror = function () { setStatus("Could not read that image — try a JPG or PNG.", false); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function init() {
    fillForm(loadDoc());
    ["fl-shop", "fl-product", "fl-price", "fl-phone", "fl-message"].forEach(function (id) {
      $(id).addEventListener("input", render);
      $(id).addEventListener("change", render);
    });
    els.currency.addEventListener("change", render);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="accent"]'), function (r) {
      r.addEventListener("change", render);
    });
    els.photo.addEventListener("change", function () {
      onPhotoFile(els.photo.files && els.photo.files[0]);
    });
    els.dlPng.addEventListener("click", downloadPNG);
    els.copyLink.addEventListener("click", copyLink);
    els.clear.addEventListener("click", function () {
      if (!window.confirm("Clear everything and start over?")) return;
      try { localStorage.removeItem(LS_DOC); } catch (e) {}
      photoImg = null;
      window.Flyer.photoLoaded = false;
      els.photo.value = "";
      els.photoName.textContent = "";
      fillForm(blankDoc());
      setStatus("", true);
      render();
    });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
