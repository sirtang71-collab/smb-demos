/* wa-business-card — app logic: live preview, QR render from the
   vendored qrcode-generator module matrix, PNG + .vcf downloads,
   copy-to-clipboard, wa.me direct-chat link.
   Everything stays in the browser; the form autosaves to localStorage.
   The QR is drawn by hand from qrcode.getModuleCount()/isDark() onto a
   canvas with a 4-module white quiet zone — the library's own table /
   canvas output is never used. No network requests: the only links out
   are the hub link and the Fiverr link the user clicks. */
(function () {
  "use strict";
  var Core = window.WaCardCore;

  var LS_DOC = "waCard.doc.v1";
  var QR_SIZE = 512;
  var QR_EC = "M";
  var QUIET = 4;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    name: $("bc-name"), phone: $("bc-phone"), intro: $("bc-intro"), org: $("bc-org"),
    payloadOut: $("bc-vcard"), canvas: $("bc-canvas"),
    status: $("bc-status"), resultInfo: $("bc-result-info"),
    dlPng: $("bc-dl-png"), dlVcf: $("bc-dl-vcf"),
    copyVcf: $("bc-copy-vcf"), waBtn: $("bc-wa-btn"),
    waLinkText: $("bc-wa-link"),
  };

  window.WaCard = { lastExport: null, renderInfo: null, lastVCard: null };

  function blankDoc() {
    return { name: "", phone: "", intro: "", org: "" };
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
      localStorage.setItem(LS_DOC, JSON.stringify({
        name: els.name.value, phone: els.phone.value,
        intro: els.intro.value, org: els.org.value,
      }));
    } catch (e) {}
  }
  function fillForm(doc) {
    els.name.value = doc.name || "";
    els.phone.value = doc.phone || "";
    els.intro.value = doc.intro || "";
    els.org.value = doc.org || "";
  }

  /* Draw the QR module matrix onto a canvas of exactly `size` px.
     4-module quiet zone, integer cell size, centred. Returns render
     info or throws when the payload does not fit the QR capacity. */
  function drawQR(canvas, payload, size, ec) {
    var qr = qrcode(0, ec);
    qr.addData(payload);
    qr.make();
    var count = qr.getModuleCount();
    var cell = Math.max(1, Math.floor(size / (count + QUIET * 2)));
    var offset = Math.floor((size - cell * count) / 2);
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000000";
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
      }
    }
    return { moduleCount: count, cell: cell, offset: offset, size: size, ec: ec, payload: payload };
  }

  function drawPlaceholder(canvas, size, message) {
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#9aa3ab";
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(message, size / 2, size / 2);
  }

  function setStatus(msg, ok) {
    els.status.textContent = msg;
    els.status.className = "status " + (ok ? "ok" : msg ? "error" : "");
  }

  function render() {
    saveDoc();
    var res = Core.buildVCard({
      name: els.name.value, phone: els.phone.value,
      intro: els.intro.value, org: els.org.value,
    });
    if (!res.ok) {
      els.payloadOut.value = "";
      els.waLinkText.textContent = "";
      els.waBtn.hidden = true;
      window.WaCard.renderInfo = null;
      window.WaCard.lastVCard = null;
      window.WaCard.lastExport = null;
      drawPlaceholder(els.canvas, QR_SIZE, "—");
      els.dlPng.disabled = true;
      els.dlVcf.disabled = true;
      els.copyVcf.disabled = true;
      els.resultInfo.textContent = "";
      if (res.error === "empty-name" || res.error === "empty-phone") setStatus("", true);
      else if (res.error === "bad-phone") setStatus("Phone number looks wrong — use digits with the country code, e.g. +62 812 3456 7890.", false);
      else setStatus("Fill in your name and phone number first.", false);
      return;
    }
    els.payloadOut.value = res.payload.replace(/\r\n/g, "\n");
    els.waLinkText.textContent = res.waLink;
    els.waBtn.hidden = false;
    els.waBtn.href = res.waLink;
    window.WaCard.lastVCard = res.payload;
    try {
      var info = drawQR(els.canvas, res.payload, QR_SIZE, QR_EC);
      window.WaCard.renderInfo = info;
      window.WaCard.lastExport = null;
      els.dlPng.disabled = false;
      els.dlVcf.disabled = false;
      els.copyVcf.disabled = false;
      els.resultInfo.textContent = "QR code: " + info.moduleCount + " × " + info.moduleCount +
        " modules (version " + ((info.moduleCount - 21) / 4 + 1) + ", error correction " +
        info.ec + ") · vCard " + res.payload.length + " characters · chat link " + res.waLink + ".";
      setStatus("", true);
    } catch (err) {
      window.WaCard.renderInfo = null;
      window.WaCard.lastExport = null;
      drawPlaceholder(els.canvas, QR_SIZE, "—");
      els.dlPng.disabled = true;
      els.dlVcf.disabled = true;
      els.copyVcf.disabled = true;
      setStatus("Too much text for a QR code — shorten the intro.", false);
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
    var info = window.WaCard.renderInfo;
    if (!info) return;
    window.WaCard.lastExport = {
      kind: "png", size: info.size, moduleCount: info.moduleCount,
      cell: info.cell, offset: info.offset, ec: info.ec, payload: info.payload,
    };
    els.canvas.toBlob(function (blob) {
      saveBlob(blob, "whatsapp-business-card-qr.png");
      setStatus("QR code saved — check your downloads.", true);
    }, "image/png");
  }

  function downloadVcf() {
    var vcard = window.WaCard.lastVCard;
    if (!vcard) return;
    var filename = Core.slugifyName(els.name.value) + ".vcf";
    window.WaCard.lastExport = {
      kind: "vcf", filename: filename, bytes: new TextEncoder().encode(vcard).length,
      payload: vcard,
    };
    saveBlob(new Blob([vcard], { type: "text/vcard;charset=utf-8" }), filename);
    setStatus("Contact card saved — check your downloads.", true);
  }

  function copyVcf() {
    var vcard = window.WaCard.lastVCard;
    if (!vcard) return;
    function done() { setStatus("vCard copied — paste it anywhere.", true); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = vcard;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); }
      catch (e) { setStatus("Copy failed — select the text above and copy it by hand.", false); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(vcard).then(done, fallback);
    } else fallback();
  }

  function init() {
    fillForm(loadDoc());
    ["bc-name", "bc-phone", "bc-intro", "bc-org"].forEach(function (id) {
      $(id).addEventListener("input", render);
      $(id).addEventListener("change", render);
    });
    els.dlPng.addEventListener("click", downloadPNG);
    els.dlVcf.addEventListener("click", downloadVcf);
    els.copyVcf.addEventListener("click", copyVcf);
    $("bc-clear").addEventListener("click", function () {
      if (!window.confirm("Clear everything and start over?")) return;
      try { localStorage.removeItem(LS_DOC); } catch (e) {}
      fillForm(blankDoc());
      setStatus("", true);
      render();
    });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
