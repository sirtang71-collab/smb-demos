/* WhatsApp Loyalty Stamp Card Generator — app logic: form state,
   EN/ID i18n, 1080x1080 canvas render, PNG download, wa.me share.
   Everything stays in the browser; the form autosaves to localStorage. */
(function () {
  "use strict";
  var Core = window.StampCore;

  var I18N = {
    en: {
      h1: "WhatsApp Loyalty Stamp Card",
      tagline: "A stamp card your customers actually keep — made in under a minute, shared on WhatsApp as a picture.",
      privacy_badge: "🔒 Runs 100% in your browser. Your data is saved only on this device — nothing is uploaded, no account, no tracking.",
      sec_card: "1 · Your card", f_shop: "Shop name", ph_shop: "e.g. Berkah Coffee",
      f_title: "Card title", ph_title: "Loyalty Card",
      f_total: "Total stamps", f_reward: "Reward text", ph_reward: "e.g. 10th coffee FREE",
      f_earned: "Stamps already earned",
      f_accent: "Accent colour",
      f_wa: "WhatsApp number (optional — for the Share button)",
      sec_out: "2 · Get your card", btn_png: "⬇ Download card (PNG)", btn_wa: "💬 Share on WhatsApp",
      btn_clear: "Start over", sec_preview: "Preview",
      hint_local: "Everything you type is stored only in this browser (local storage) so it is still here when you come back. Nothing is sent to a server.",
      svc_text: "A stamp card brings customers back — but only if someone answers them when they message. Our WhatsApp auto-reply & order assistant answers buyers, takes orders and sends the details while you sleep.",
      svc_link: "See the service on Fiverr →",
      foot_strong: "Your data never leaves this device.",
      foot_text: "Everything runs locally in your browser. No uploads, no accounts, no tracking.",
      foot_note: "The preview is exactly what the PNG shows — a 1080 × 1080 square card, ready for WhatsApp.",
      r_show: "Show this card at checkout",
      s_png: "Card saved — check your downloads.",
      s_wa: "Opening WhatsApp with your card message…",
      confirm_clear: "Clear everything and start a new card?",
    },
    id: {
      h1: "Kartu Stempel Loyalitas WhatsApp",
      tagline: "Kartu stempel yang benar-benar disimpan pelanggan — dibuat kurang dari semenit, dibagikan di WhatsApp sebagai gambar.",
      privacy_badge: "🔒 100% berjalan di browser Anda. Data hanya tersimpan di perangkat ini — tidak diunggah, tanpa akun, tanpa pelacakan.",
      sec_card: "1 · Kartu Anda", f_shop: "Nama toko", ph_shop: "cth. Kopi Berkah",
      f_title: "Judul kartu", ph_title: "Kartu Loyalitas",
      f_total: "Jumlah stempel", f_reward: "Teks hadiah", ph_reward: "cth. Kopi ke-10 GRATIS",
      f_earned: "Stempel yang sudah didapat",
      f_accent: "Warna aksen",
      f_wa: "Nomor WhatsApp (opsional — untuk tombol Bagikan)",
      sec_out: "2 · Ambil kartu Anda", btn_png: "⬇ Unduh kartu (PNG)", btn_wa: "💬 Bagikan di WhatsApp",
      btn_clear: "Mulai ulang", sec_preview: "Pratinjau",
      hint_local: "Semua yang Anda ketik hanya tersimpan di browser ini (local storage), jadi tetap ada saat Anda kembali. Tidak ada yang dikirim ke server.",
      svc_text: "Kartu stempel membuat pelanggan kembali — tapi hanya jika ada yang menjawab saat mereka chat. Asisten auto-reply & pesanan WhatsApp kami menjawab pembeli, menerima pesanan, dan mengirim detailnya selagi Anda tidur.",
      svc_link: "Lihat layanannya di Fiverr →",
      foot_strong: "Data Anda tidak pernah meninggalkan perangkat ini.",
      foot_text: "Semua berjalan lokal di browser Anda. Tanpa unggahan, tanpa akun, tanpa pelacakan.",
      foot_note: "Pratinjau sama persis dengan isi PNG — kartu persegi 1080 × 1080, siap untuk WhatsApp.",
      r_show: "Tunjukkan kartu ini saat pembayaran",
      s_png: "Kartu tersimpan — cek folder unduhan Anda.",
      s_wa: "Membuka WhatsApp dengan pesan kartu Anda…",
      confirm_clear: "Hapus semua dan mulai kartu baru?",
    },
  };

  var LS_DOC = "stampCard.doc.v1";
  var LS_LANG = "stampCard.lang";
  var lang = "en";
  try { lang = localStorage.getItem(LS_LANG) === "id" ? "id" : "en"; } catch (e) {}
  function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key; }

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    shop: $("shop-name"), title: $("card-title"), total: $("total-stamps"),
    earned: $("earned"), earnedLabel: $("earned-label"),
    reward: $("reward-text"), wa: $("wa-number"),
    status: $("status"), preview: $("preview"),
  };

  function blankDoc() {
    return { shop: "", title: "Loyalty Card", total: 10, earned: 0,
             reward: "10th coffee FREE", accent: "blue", wa: "" };
  }

  function loadDoc() {
    try {
      var raw = localStorage.getItem(LS_DOC);
      if (raw) {
        var d = JSON.parse(raw);
        if (d) return Object.assign(blankDoc(), d);
      }
    } catch (e) {}
    return blankDoc();
  }

  function saveDoc(doc) {
    try { localStorage.setItem(LS_DOC, JSON.stringify(doc)); } catch (e) {}
  }

  function readDoc() {
    var accent = "blue";
    var sel = document.querySelector('input[name="accent"]:checked');
    if (sel) accent = sel.value;
    return {
      shop: els.shop.value.trim(),
      title: els.title.value.trim() || "Loyalty Card",
      total: parseInt(els.total.value, 10) || 10,
      earned: parseInt(els.earned.value, 10) || 0,
      reward: els.reward.value.trim(),
      accent: accent,
      wa: els.wa.value.trim(),
    };
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

  var FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  /* Render the 1080x1080 card onto any canvas. Geometry comes from
     StampCore.stampLayout so the verifier can reproduce it exactly. */
  function renderCard(canvas, doc) {
    var W = Core.CARD_W, H = Core.CARD_H;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext("2d");
    var accent = Core.accentById(doc.accent);
    var earned = Core.clampEarned(doc.earned, doc.total);
    var layout = Core.stampLayout(doc.total);

    // Background
    ctx.fillStyle = Core.BG_HEX;
    ctx.fillRect(0, 0, W, H);

    // Header band
    ctx.fillStyle = accent.hex;
    ctx.fillRect(0, 0, W, Core.HEADER_H);

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 76px " + FONT;
    var shopLines = wrapLines(ctx, doc.shop || "Your Shop", W - 120, 1);
    ctx.fillText(shopLines[0], W / 2, 128);
    ctx.font = "500 46px " + FONT;
    var titleLines = wrapLines(ctx, doc.title || "Loyalty Card", W - 120, 1);
    ctx.fillText(titleLines[0], W / 2, 212);
    // Thin white rule under the header text
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(W / 2 - 90, 252, 180, 4);

    // Stamp grid
    layout.centers.forEach(function (c, i) {
      var filled = i < earned;
      ctx.beginPath();
      ctx.arc(c.x, c.y, layout.r, 0, Math.PI * 2);
      if (filled) {
        ctx.fillStyle = accent.hex;
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "700 64px " + FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("★", c.x, c.y + 2);
        ctx.textBaseline = "alphabetic";
      } else {
        ctx.setLineDash([12, 9]);
        ctx.strokeStyle = accent.hex;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 5;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    });

    // Footer: reward + instruction
    ctx.textAlign = "center";
    ctx.fillStyle = "#1d2733";
    ctx.font = "700 46px " + FONT;
    var rewardLines = wrapLines(ctx, doc.reward || "", W - 120, 1);
    if (rewardLines[0]) ctx.fillText(rewardLines[0], W / 2, 930);
    ctx.fillStyle = "#6b7683";
    ctx.font = "400 30px " + FONT;
    ctx.fillText(t("r_show"), W / 2, 992);

    return { width: W, height: H, layout: layout, accentHex: accent.hex, earned: earned };
  }

  /* ---------- downloads / share ---------- */
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

  window.StampCard = { lastExport: null, lastLayout: null };

  function downloadPNG() {
    var doc = readDoc();
    var off = document.createElement("canvas");
    var info = renderCard(off, doc);
    window.StampCard.lastLayout = info;
    off.toBlob(function (blob) {
      window.StampCard.lastExport = {
        kind: "png", width: info.width, height: info.height,
        sizeBytes: blob ? blob.size : null,
        shop: doc.shop, total: doc.total, earned: info.earned,
        accent: doc.accent, accentHex: info.accentHex,
        filename: "loyalty-stamp-card-" + Core.slugifyShop(doc.shop) + ".png",
      };
      saveBlob(blob, window.StampCard.lastExport.filename);
      setStatus(t("s_png"), true);
    }, "image/png");
  }

  function shareWhatsApp() {
    var doc = readDoc();
    var url = Core.waLink(doc);
    window.StampCard.lastShareUrl = url;
    setStatus(t("s_wa"), true);
    window.open(url, "_blank", "noopener");
  }

  /* ---------- refresh / wiring ---------- */
  function refresh() {
    var doc = readDoc();
    // Keep the slider clamped to the chosen total.
    els.earned.max = String(doc.total);
    if (parseInt(els.earned.value, 10) > doc.total) els.earned.value = String(doc.total);
    doc.earned = parseInt(els.earned.value, 10) || 0;
    els.earnedLabel.textContent = doc.earned + " / " + doc.total;
    saveDoc(doc);
    renderCard(els.preview, doc);
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
    refresh();
  }

  function fillForm(doc) {
    els.shop.value = doc.shop; els.title.value = doc.title;
    els.total.value = String(doc.total); els.earned.value = String(doc.earned);
    els.earned.max = String(doc.total);
    els.reward.value = doc.reward; els.wa.value = doc.wa;
    var radio = document.querySelector('input[name="accent"][value="' + (doc.accent || "blue") + '"]');
    if (radio) radio.checked = true;
  }

  function init() {
    var doc = loadDoc();
    fillForm(doc);
    ["shop-name", "card-title", "reward-text", "wa-number"].forEach(function (id) {
      $(id).addEventListener("input", refresh);
    });
    $("total-stamps").addEventListener("change", refresh);
    $("earned").addEventListener("input", refresh);
    Array.prototype.forEach.call(document.querySelectorAll('input[name="accent"]'), function (r) {
      r.addEventListener("change", refresh);
    });
    $("dl-png").addEventListener("click", downloadPNG);
    $("share-wa").addEventListener("click", shareWhatsApp);
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
