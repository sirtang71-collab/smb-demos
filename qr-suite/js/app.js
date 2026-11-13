/* QR Suite — app logic: tabs, EN/ID i18n, QR render from the module
   matrix, PNG download, batch mode.
   Everything stays in the browser; the form autosaves to localStorage.
   The QR is drawn by hand from qrcode.getModuleCount()/isDark() onto a
   canvas with a 4-module white quiet zone — the library's own table /
   canvas output is never used. */
(function () {
  "use strict";
  var Core = window.QRSuiteCore;

  var I18N = {
    en: {
      h1: "QR Suite",
      tagline: "One QR code for your shop link, your WiFi, or your contact card — made in seconds, printed anywhere.",
      privacy_badge: "🔒 Runs 100% in your browser. Your data is saved only on this device — nothing is uploaded, no account, no tracking.",
      sec_make: "1 · Make your QR code",
      tab_link: "🔗 Link / Text", tab_wifi: "📶 WiFi", tab_vcard: "👤 Contact (vCard)",
      f_link: "Link or text", ph_link: "e.g. https://shopee.co.id/your-shop",
      hint_link: "Any URL or plain text — buyers scan it and open it straight away.",
      f_ssid: "WiFi name (SSID)", ph_ssid: "e.g. Toko Kopi WiFi",
      f_wifipass: "Password", ph_wifipass: "WiFi password",
      f_enc: "Security", enc_open: "Open network (no password)",
      f_hidden: "Hidden network",
      hint_wifi: "Print it and stick it on the counter — customers join your WiFi by scanning, no typing.",
      f_name: "Name", ph_name: "e.g. Sari Wijaya",
      f_phone: "Phone / WhatsApp", f_email: "Email",
      f_org: "Shop / organisation", ph_org: "e.g. Toko Kopi",
      hint_vcard: "Scanning saves your contact straight into the buyer's phone — no typing, no typos.",
      sec_options: "2 · Options",
      f_size: "Image size", f_ec: "Error correction",
      f_dark: "Code colour", f_light: "Background colour",
      hint_ec: "Higher error correction makes the code denser but still scannable when printed small or partly covered.",
      sec_payload: "3 · What the code contains",
      sec_out: "4 · Get your QR code",
      btn_png: "⬇ Download PNG", btn_clear: "Start over",
      sec_batch: "Batch mode — up to 12 links at once",
      f_batch: "One link per line", ph_batch: "https://your-shop.com/product-1\nhttps://your-shop.com/product-2\n…",
      btn_batch: "Generate batch",
      hint_batch: "Each code downloads on its own — handy for product labels, table cards or flyers. Batch codes are 256 × 256 px, error correction M.",
      svc_text: "A QR code gets buyers to your shop — our WhatsApp auto-reply & order assistant answers them, takes the order and sends the details while you sleep.",
      svc_link: "See the service on Fiverr →",
      foot_strong: "Your data never leaves this device.",
      foot_text: "Everything runs locally in your browser. No uploads, no accounts, no tracking.",
      foot_note: "The preview is exactly what the PNG shows — same size, same code.",
      s_png: "QR code saved — check your downloads.",
      s_batch: "Batch ready — {n} QR codes.",
      s_batch_dl: "Saved — check your downloads.",
      e_empty: "Enter something first — the QR code is empty.",
      e_too_long: "Too much text for a QR code — shorten it or lower the error correction.",
      e_batch_empty: "Paste at least one link first.",
      e_batch_many: "Batch is limited to 12 links — you pasted {n}.",
      confirm_clear: "Clear everything and start over?",
    },
    id: {
      h1: "QR Suite",
      tagline: "Satu kode QR untuk tautan toko, WiFi, atau kartu kontak Anda — jadi dalam hitungan detik, bisa dicetak di mana saja.",
      privacy_badge: "🔒 100% berjalan di browser Anda. Data hanya tersimpan di perangkat ini — tidak diunggah, tanpa akun, tanpa pelacakan.",
      sec_make: "1 · Buat kode QR Anda",
      tab_link: "🔗 Tautan / Teks", tab_wifi: "📶 WiFi", tab_vcard: "👤 Kontak (vCard)",
      f_link: "Tautan atau teks", ph_link: "cth. https://shopee.co.id/toko-anda",
      hint_link: "URL atau teks apa saja — pembeli memindai lalu langsung membukanya.",
      f_ssid: "Nama WiFi (SSID)", ph_ssid: "cth. WiFi Toko Kopi",
      f_wifipass: "Kata sandi", ph_wifipass: "Kata sandi WiFi",
      f_enc: "Keamanan", enc_open: "Jaringan terbuka (tanpa kata sandi)",
      f_hidden: "Jaringan tersembunyi",
      hint_wifi: "Cetak dan tempel di meja kasir — pelanggan bergabung ke WiFi Anda dengan memindai, tanpa mengetik.",
      f_name: "Nama", ph_name: "cth. Sari Wijaya",
      f_phone: "Telepon / WhatsApp", f_email: "Email",
      f_org: "Toko / organisasi", ph_org: "cth. Toko Kopi",
      hint_vcard: "Sekali pindai, kontak Anda langsung tersimpan di ponsel pembeli — tanpa mengetik, tanpa salah ketik.",
      sec_options: "2 · Pengaturan",
      f_size: "Ukuran gambar", f_ec: "Koreksi kesalahan",
      f_dark: "Warna kode", f_light: "Warna latar",
      hint_ec: "Koreksi kesalahan yang lebih tinggi membuat kode lebih padat tapi tetap bisa dipindai saat dicetak kecil atau sebagian tertutup.",
      sec_payload: "3 · Isi kode ini",
      sec_out: "4 · Ambil kode QR Anda",
      btn_png: "⬇ Unduh PNG", btn_clear: "Mulai ulang",
      sec_batch: "Mode batch — sampai 12 tautan sekaligus",
      f_batch: "Satu tautan per baris", ph_batch: "https://toko-anda.com/produk-1\nhttps://toko-anda.com/produk-2\n…",
      btn_batch: "Buat batch",
      hint_batch: "Setiap kode diunduh sendiri-sendiri — cocok untuk label produk, kartu meja, atau brosur. Kode batch berukuran 256 × 256 px, koreksi kesalahan M.",
      svc_text: "Kode QR mengantar pembeli ke toko Anda — asisten auto-reply & pesanan WhatsApp kami menjawab mereka, menerima pesanan, dan mengirim detailnya selagi Anda tidur.",
      svc_link: "Lihat layanannya di Fiverr →",
      foot_strong: "Data Anda tidak pernah meninggalkan perangkat ini.",
      foot_text: "Semua berjalan lokal di browser Anda. Tanpa unggahan, tanpa akun, tanpa pelacakan.",
      foot_note: "Pratinjau sama persis dengan isi PNG — ukuran dan kode yang sama.",
      s_png: "Kode QR tersimpan — cek folder unduhan Anda.",
      s_batch: "Batch siap — {n} kode QR.",
      s_batch_dl: "Tersimpan — cek folder unduhan Anda.",
      e_empty: "Isi dulu — kode QR masih kosong.",
      e_too_long: "Teks terlalu panjang untuk kode QR — persingkat atau turunkan koreksi kesalahan.",
      e_batch_empty: "Tempel setidaknya satu tautan dulu.",
      e_batch_many: "Batch dibatasi 12 tautan — Anda menempel {n}.",
      confirm_clear: "Hapus semua dan mulai dari awal?",
    },
  };

  var LS_DOC = "qrSuite.doc.v1";
  var LS_LANG = "qrSuite.lang";
  var lang = "en";
  try { lang = localStorage.getItem(LS_LANG) === "id" ? "id" : "en"; } catch (e) {}
  function t(key, vars) {
    var s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }

  var $ = function (id) { return document.getElementById(id); };
  var mode = "link";
  var els = {
    linkText: $("link-text"),
    wifiSsid: $("wifi-ssid"), wifiPass: $("wifi-pass"), wifiEnc: $("wifi-enc"), wifiHidden: $("wifi-hidden"),
    vcName: $("vc-name"), vcPhone: $("vc-phone"), vcEmail: $("vc-email"), vcOrg: $("vc-org"),
    optSize: $("opt-size"), optEc: $("opt-ec"), optDark: $("opt-dark"), optLight: $("opt-light"),
    payloadOut: $("payload-out"), canvas: $("qr-canvas"),
    status: $("status"), dlPng: $("dl-png"),
    batchText: $("batch-text"), batchGrid: $("batch-grid"), batchStatus: $("batch-status"),
  };

  window.QRSuite = { lastExport: null, renderInfo: null, batchCount: 0, batchItems: [] };

  function blankDoc() {
    return {
      mode: "link", linkText: "", wifiSsid: "", wifiPass: "", wifiEnc: "WPA", wifiHidden: false,
      vcName: "", vcPhone: "", vcEmail: "", vcOrg: "",
      optSize: "512", optEc: "M", optDark: "#000000", optLight: "#ffffff", batchText: "",
    };
  }
  function loadDoc() {
    try {
      var raw = localStorage.getItem(LS_DOC);
      if (raw) { var d = JSON.parse(raw); if (d) return Object.assign(blankDoc(), d); }
    } catch (e) {}
    return blankDoc();
  }
  function saveDoc() {
    try { localStorage.setItem(LS_DOC, JSON.stringify(readDoc())); } catch (e) {}
  }
  function readDoc() {
    return {
      mode: mode, linkText: els.linkText.value, wifiSsid: els.wifiSsid.value,
      wifiPass: els.wifiPass.value, wifiEnc: els.wifiEnc.value, wifiHidden: els.wifiHidden.checked,
      vcName: els.vcName.value, vcPhone: els.vcPhone.value, vcEmail: els.vcEmail.value,
      vcOrg: els.vcOrg.value, optSize: els.optSize.value, optEc: els.optEc.value,
      optDark: els.optDark.value, optLight: els.optLight.value, batchText: els.batchText.value,
    };
  }
  function fillForm(doc) {
    mode = doc.mode || "link";
    els.linkText.value = doc.linkText || "";
    els.wifiSsid.value = doc.wifiSsid || ""; els.wifiPass.value = doc.wifiPass || "";
    els.wifiEnc.value = doc.wifiEnc || "WPA"; els.wifiHidden.checked = !!doc.wifiHidden;
    els.vcName.value = doc.vcName || ""; els.vcPhone.value = doc.vcPhone || "";
    els.vcEmail.value = doc.vcEmail || ""; els.vcOrg.value = doc.vcOrg || "";
    els.optSize.value = doc.optSize || "512"; els.optEc.value = doc.optEc || "M";
    els.optDark.value = doc.optDark || "#000000"; els.optLight.value = doc.optLight || "#ffffff";
    els.batchText.value = doc.batchText || "";
    applyMode();
  }

  function buildPayload() {
    if (mode === "wifi") {
      return Core.buildWifi({
        ssid: els.wifiSsid.value, password: els.wifiPass.value,
        encryption: els.wifiEnc.value, hidden: els.wifiHidden.checked,
      });
    }
    if (mode === "vcard") {
      return Core.buildVCard({
        name: els.vcName.value, phone: els.vcPhone.value,
        email: els.vcEmail.value, org: els.vcOrg.value,
      });
    }
    return Core.buildText(els.linkText.value);
  }

  /* Draw the QR module matrix onto a canvas of exactly `size` px.
     4-module quiet zone, integer cell size, centred. Returns render
     info or throws when the payload does not fit the QR capacity. */
  function drawQR(canvas, payload, size, ec, dark, light) {
    var qr = qrcode(0, ec);
    qr.addData(payload);
    qr.make();
    var count = qr.getModuleCount();
    var QUIET = 4;
    var cell = Math.max(1, Math.floor(size / (count + QUIET * 2)));
    var offset = Math.floor((size - cell * count) / 2);
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = dark;
    for (var r = 0; r < count; r++) {
      for (var c = 0; c < count; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
      }
    }
    return { moduleCount: count, cell: cell, offset: offset, size: size, ec: ec, dark: dark, light: light, payload: payload };
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
  function setBatchStatus(msg, ok) {
    els.batchStatus.textContent = msg;
    els.batchStatus.className = "status " + (ok ? "ok" : msg ? "error" : "");
  }

  function render() {
    saveDoc();
    var res = buildPayload();
    var size = parseInt(els.optSize.value, 10) || 512;
    var ec = els.optEc.value;
    if (!res.ok) {
      els.payloadOut.value = "";
      window.QRSuite.renderInfo = null;
      window.QRSuite.lastExport = null;
      drawPlaceholder(els.canvas, size, "—");
      els.dlPng.disabled = true;
      if (res.error === "empty-ssid" || res.error === "empty-name" || res.error === "empty-text") setStatus("", true);
      else setStatus(t("e_empty"), false);
      return;
    }
    els.payloadOut.value = res.payload.replace(/\r\n/g, "\n");
    try {
      var info = drawQR(els.canvas, res.payload, size, ec, els.optDark.value, els.optLight.value);
      window.QRSuite.renderInfo = info;
      window.QRSuite.lastExport = null;
      els.dlPng.disabled = false;
      setStatus("", true);
    } catch (err) {
      window.QRSuite.renderInfo = null;
      window.QRSuite.lastExport = null;
      drawPlaceholder(els.canvas, size, "—");
      els.dlPng.disabled = true;
      setStatus(t("e_too_long"), false);
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
    var info = window.QRSuite.renderInfo;
    if (!info) return;
    window.QRSuite.lastExport = {
      kind: "png", size: info.size, moduleCount: info.moduleCount,
      cell: info.cell, offset: info.offset, ec: info.ec,
      payload: info.payload, mode: mode,
    };
    els.canvas.toBlob(function (blob) {
      saveBlob(blob, "qr-code.png");
      setStatus(t("s_png"), true);
    }, "image/png");
  }

  function runBatch() {
    var parsed = Core.parseBatch(els.batchText.value);
    els.batchGrid.innerHTML = "";
    window.QRSuite.batchCount = 0;
    window.QRSuite.batchItems = [];
    if (!parsed.ok) {
      if (parsed.error === "too-many") setBatchStatus(t("e_batch_many", { n: parsed.count }), false);
      else setBatchStatus(t("e_batch_empty"), false);
      saveDoc();
      return;
    }
    var items = [];
    parsed.items.forEach(function (link, i) {
      var box = document.createElement("div");
      box.className = "batch-item";
      var cv = document.createElement("canvas");
      var label = document.createElement("div");
      label.className = "batch-label";
      label.textContent = link;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mini-btn";
      btn.textContent = "⬇ PNG";
      box.appendChild(cv);
      box.appendChild(label);
      box.appendChild(btn);
      els.batchGrid.appendChild(box);
      try {
        var info = drawQR(cv, link, 256, "M", els.optDark.value, els.optLight.value);
        items.push({ index: i + 1, link: link, moduleCount: info.moduleCount, cell: info.cell, offset: info.offset });
        btn.addEventListener("click", function () {
          cv.toBlob(function (blob) {
            saveBlob(blob, "qr-batch-" + (i + 1) + ".png");
            setBatchStatus(t("s_batch_dl"), true);
          }, "image/png");
        });
      } catch (err) {
        label.textContent = link + " — too long";
        btn.disabled = true;
      }
    });
    window.QRSuite.batchCount = items.length;
    window.QRSuite.batchItems = items;
    setBatchStatus(t("s_batch", { n: items.length }), true);
    saveDoc();
  }

  function applyMode() {
    document.querySelectorAll(".tab").forEach(function (b) {
      var active = b.getAttribute("data-mode") === mode;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", active ? "true" : "false");
    });
    $("panel-link").hidden = mode !== "link";
    $("panel-wifi").hidden = mode !== "wifi";
    $("panel-vcard").hidden = mode !== "vcard";
    render();
  }

  function applyLang() {
    document.documentElement.lang = lang === "id" ? "id" : "en";
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n]"), function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-ph]"), function (el) {
      el.placeholder = t(el.getAttribute("data-i18n-ph"));
    });
    $("lang-en").classList.toggle("active", lang === "en");
    $("lang-id").classList.toggle("active", lang === "id");
    render();
  }

  function init() {
    var doc = loadDoc();
    fillForm(doc);
    document.querySelectorAll(".tab").forEach(function (b) {
      b.addEventListener("click", function () { mode = b.getAttribute("data-mode"); applyMode(); });
    });
    ["link-text", "wifi-ssid", "wifi-pass", "wifi-enc", "wifi-hidden",
     "vc-name", "vc-phone", "vc-email", "vc-org",
     "opt-size", "opt-ec", "opt-dark", "opt-light"].forEach(function (id) {
      $(id).addEventListener("input", render);
      $(id).addEventListener("change", render);
    });
    $("dl-png").addEventListener("click", downloadPNG);
    $("batch-go").addEventListener("click", runBatch);
    $("clear-all").addEventListener("click", function () {
      if (!window.confirm(t("confirm_clear"))) return;
      try { localStorage.removeItem(LS_DOC); } catch (e) {}
      fillForm(blankDoc());
      els.batchGrid.innerHTML = "";
      window.QRSuite.batchCount = 0;
      window.QRSuite.batchItems = [];
      setStatus("", true);
      setBatchStatus("", true);
      render();
    });
    $("lang-en").addEventListener("click", function () { lang = "en"; try { localStorage.setItem(LS_LANG, "en"); } catch (e) {} applyLang(); });
    $("lang-id").addEventListener("click", function () { lang = "id"; try { localStorage.setItem(LS_LANG, "id"); } catch (e) {} applyLang(); });
    applyLang();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
