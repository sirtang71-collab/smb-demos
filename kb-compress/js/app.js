/* Compress Images to a Target KB — app logic: multi-file input,
   per-file quality binary-search + 0.9x downscale loop (core.js),
   per-file download + Download all. EN/ID i18n.
   Everything stays in the browser; nothing is uploaded. */
(function () {
  "use strict";
  var Core = window.KbCompressCore;

  var I18N = {
    en: {
      h1: "Compress Images to a Target KB",
      tagline: "Your photo is 500 KB but the form wants 100 KB? Drop it in — get back a JPEG at (almost) exactly your target size.",
      privacy_badge: "🔒 Runs 100% in your browser. Your images are never uploaded — nothing leaves this device, no account, no tracking.",
      sec_files: "1 · Your images",
      f_files: "Choose images (JPG, PNG or WebP — as many as you like)",
      hint_files: "Tip: select several files at once — each one is compressed on its own.",
      sec_target: "2 · Target size",
      f_target: "Target size (KB)",
      hint_target: "Between 10 and 2000 KB. Common asks: exam portals 20–50 KB, Shopee / Tokopedia listings under 100 KB, WhatsApp-friendly under 200 KB.",
      f_output: "Output format",
      hint_output: "PNG and WebP uploads are converted to JPEG, the format every portal accepts.",
      sec_out: "3 · Compress & download",
      btn_compress: "🗜️ Compress images",
      btn_all: "⬇ Download all",
      btn_clear: "Start over",
      col_file: "File", col_orig: "Original", col_out: "Compressed",
      col_dims: "Dimensions", col_quality: "Quality", col_status: "Result",
      hint_how: "How it works: the tool first tries JPEG quality — highest quality that still fits your target. Only if even the lowest quality is too big does it shrink the pixels (in 0.9× steps). A file already under your target is left exactly as it is, never padded up.",
      svc_text: "Listing photos, exam uploads, shop banners — if your images keep getting rejected for size, our WhatsApp auto-reply & order assistant can also take the whole listing job off your hands while you sleep.",
      svc_link: "See the service on Fiverr →",
      foot_strong: "Your data never leaves this device.",
      foot_text: "Everything runs locally in your browser. No uploads, no accounts, no tracking.",
      foot_note: "Output is always JPEG; a file already under your target is returned unchanged.",
      st_ready: "Ready — pick your images, then press Compress.",
      st_files: "{n} file(s) selected.",
      st_working: "Compressing… {done}/{total} done.",
      st_done: "Done — {ok} of {total} file(s) hit the target. Download them below.",
      st_no_files: "Choose at least one image first.",
      st_bad_target: "Target size must be between 10 and 2000 KB.",
      st_all_saved: "All files saved — check your downloads.",
      st_saved: "Saved — check your downloads.",
      st_failed: "Could not shrink {name} to the target even at the smallest size.",
      badge_ok: "✓ On target",
      badge_unchanged: "Already under target",
      badge_below: "✓ Under target",
      badge_fail: "Too big",
      note_unchanged: "Already under target — returned unchanged, not padded up.",
      note_padded: "Padded with JPEG comment segments to reach the window floor; pixels untouched.",
      confirm_clear: "Clear everything and start over?",
    },
    id: {
      h1: "Kompres Gambar ke Ukuran KB Target",
      tagline: "Foto Anda 500 KB tapi formulir minta 100 KB? Masukkan saja — dapatkan JPEG dengan ukuran (hampir) persis seperti target Anda.",
      privacy_badge: "🔒 100% berjalan di browser Anda. Gambar tidak pernah diunggah — tidak ada yang meninggalkan perangkat ini, tanpa akun, tanpa pelacakan.",
      sec_files: "1 · Gambar Anda",
      f_files: "Pilih gambar (JPG, PNG atau WebP — sebanyak yang Anda mau)",
      hint_files: "Tips: pilih beberapa file sekaligus — masing-masing dikompres sendiri.",
      sec_target: "2 · Ukuran target",
      f_target: "Ukuran target (KB)",
      hint_target: "Antara 10 dan 2000 KB. Yang umum diminta: portal ujian 20–50 KB, listing Shopee / Tokopedia di bawah 100 KB, ramah WhatsApp di bawah 200 KB.",
      f_output: "Format output",
      hint_output: "Upload PNG dan WebP diubah ke JPEG, format yang diterima semua portal.",
      sec_out: "3 · Kompres & unduh",
      btn_compress: "🗜️ Kompres gambar",
      btn_all: "⬇ Unduh semua",
      btn_clear: "Mulai ulang",
      col_file: "File", col_orig: "Asli", col_out: "Terkompres",
      col_dims: "Dimensi", col_quality: "Kualitas", col_status: "Hasil",
      hint_how: "Cara kerja: alat ini pertama mencoba kualitas JPEG — kualitas tertinggi yang masih muat di target Anda. Hanya jika kualitas terendah pun masih terlalu besar, piksel diperkecil (langkah 0,9×). File yang sudah di bawah target dibiarkan apa adanya, tidak pernah diperbesar.",
      svc_text: "Foto listing, upload ujian, banner toko — jika gambar Anda terus ditolak karena ukuran, asisten auto-reply & pesanan WhatsApp kami juga bisa mengambil alih seluruh pekerjaan listing selagi Anda tidur.",
      svc_link: "Lihat layanannya di Fiverr →",
      foot_strong: "Data Anda tidak pernah meninggalkan perangkat ini.",
      foot_text: "Semua berjalan lokal di browser Anda. Tanpa unggahan, tanpa akun, tanpa pelacakan.",
      foot_note: "Output selalu JPEG; file yang sudah di bawah target dikembalikan tanpa diubah.",
      st_ready: "Siap — pilih gambar Anda, lalu tekan Kompres.",
      st_files: "{n} file dipilih.",
      st_working: "Mengompres… {done}/{total} selesai.",
      st_done: "Selesai — {ok} dari {total} file mencapai target. Unduh di bawah.",
      st_no_files: "Pilih setidaknya satu gambar dulu.",
      st_bad_target: "Ukuran target harus antara 10 dan 2000 KB.",
      st_all_saved: "Semua file tersimpan — cek folder unduhan Anda.",
      st_saved: "Tersimpan — cek folder unduhan Anda.",
      st_failed: "Tidak bisa mengecilkan {name} ke target walau sudah ukuran terkecil.",
      badge_ok: "✓ Sesuai target",
      badge_unchanged: "Sudah di bawah target",
      badge_below: "✓ Di bawah target",
      badge_fail: "Terlalu besar",
      note_unchanged: "Sudah di bawah target — dikembalikan tanpa diubah, tidak diperbesar.",
      note_padded: "Ditambah segmen komentar JPEG hingga batas bawah jendela; piksel tidak berubah.",
      confirm_clear: "Hapus semua dan mulai ulang?",
    },
  };

  var LS_LANG = "kbCompress.lang";
  var lang = "en";
  try { lang = localStorage.getItem(LS_LANG) === "id" ? "id" : "en"; } catch (e) {}
  function t(key) { return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key; }
  function tf(key, vars) {
    var s = t(key);
    Object.keys(vars || {}).forEach(function (k) { s = s.replace("{" + k + "}", vars[k]); });
    return s;
  }

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    input: $("file-input"), target: $("target-kb"), compress: $("compress-btn"),
    all: $("download-all"), clear: $("clear-all"), status: $("status"),
    count: $("file-count"), wrap: $("results-wrap"), body: $("results-body"),
  };

  var MIN_SIDE_PX = 100;
  var MAX_SCALE_STEPS = 15;

  window.KbCompress = { results: [], targetKB: 100, done: false };

  function fmtKB(bytes) {
    if (bytes == null) return "—";
    return (bytes / 1024).toFixed(1) + " KB";
  }

  function setStatus(msg, ok) {
    els.status.textContent = msg;
    els.status.className = "status " + (ok ? "ok" : msg ? "error" : "");
  }

  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file).catch(function () { return loadViaImage(file); });
    }
    return loadViaImage(file);
  }
  function loadViaImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Cannot read image: " + file.name)); };
      img.src = url;
    });
  }

  function canvasToBytes(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error("JPEG encode failed")); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); });
      }, "image/jpeg", quality);
    });
  }

  function outFilename(file, targetKB, unchanged) {
    if (unchanged) return file.name;
    var base = file.name.replace(/\.[^.]+$/, "") || "image";
    return base + "-" + targetKB + "kb.jpg";
  }

  async function compressOne(file, targetKB) {
    var targetBytes = Core.targetBytesFor(targetKB);
    var bmp = await loadBitmap(file);
    var origW = bmp.width, origH = bmp.height;

    if (file.size <= targetBytes) {
      var origBuf = new Uint8Array(await file.arrayBuffer());
      return {
        name: file.name, filename: outFilename(file, targetKB, true),
        origBytes: file.size, outBytes: origBuf.length,
        outW: origW, outH: origH, quality: null, paddedBytes: 0,
        status: "unchanged", note: t("note_unchanged"),
        blob: new Blob([origBuf], { type: file.type || "image/jpeg" }),
      };
    }

    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var scale = 1;
    for (var step = 0; step <= MAX_SCALE_STEPS; step += 1) {
      var w = Math.max(1, Math.round(origW * scale));
      var h = Math.max(1, Math.round(origH * scale));
      canvas.width = w; canvas.height = h;
      ctx.drawImage(bmp, 0, 0, w, h);
      var result = await Core.encodeToTarget(function (q) {
        return canvasToBytes(canvas, q);
      }, targetKB);
      if (result.ok) {
        return {
          name: file.name, filename: outFilename(file, targetKB, false),
          origBytes: file.size, outBytes: result.sizeBytes,
          outW: w, outH: h, quality: result.quality, paddedBytes: result.paddedBytes,
          status: result.withinWindow ? "compressed" : "below-window",
          note: result.paddedBytes > 0 ? t("note_padded") : result.note,
          blob: new Blob([result.bytes], { type: "image/jpeg" }),
        };
      }
      // over-max at this size: shrink pixels 0.9x and retry.
      if (Math.min(w, h) <= MIN_SIDE_PX) break;
      scale *= 0.9;
    }
    if (typeof bmp.close === "function") { try { bmp.close(); } catch (e) {} }
    return {
      name: file.name, filename: outFilename(file, targetKB, false),
      origBytes: file.size, outBytes: null,
      outW: origW, outH: origH, quality: null, paddedBytes: 0,
      status: "failed", note: tf("st_failed", { name: file.name }), blob: null,
    };
  }

  function saveBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  function badgeFor(r) {
    if (r.status === "compressed") return '<span class="badge ok">' + t("badge_ok") + "</span>";
    if (r.status === "unchanged") return '<span class="badge unchanged">' + t("badge_unchanged") + "</span>";
    if (r.status === "below-window") return '<span class="badge warn">' + t("badge_below") + "</span>";
    return '<span class="badge fail">' + t("badge_fail") + "</span>";
  }

  function renderResults(results) {
    els.body.innerHTML = "";
    results.forEach(function (r, i) {
      var tr = document.createElement("tr");
      var q = r.quality == null ? "—" : (r.quality * 100).toFixed(0) + "%";
      var out = r.outBytes == null ? "—" : fmtKB(r.outBytes);
      var dims = r.outW + " × " + r.outH;
      var note = r.note ? '<div class="row-note">' + r.note + "</div>" : "";
      tr.innerHTML =
        '<td class="file-name">' + escapeHtml(r.name) + note + "</td>" +
        '<td class="num">' + fmtKB(r.origBytes) + "</td>" +
        '<td class="num">' + out + "</td>" +
        '<td class="num">' + dims + "</td>" +
        '<td class="num">' + q + "</td>" +
        "<td>" + badgeFor(r) + "</td>" +
        "<td></td>";
      var td = tr.lastElementChild;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dl-btn";
      btn.id = "dl-" + i;
      btn.textContent = "⬇ Download";
      btn.disabled = !r.blob;
      btn.addEventListener("click", function () {
        if (r.blob) { saveBlob(r.blob, r.filename); setStatus(t("st_saved"), true); }
      });
      td.appendChild(btn);
      els.body.appendChild(tr);
    });
    els.wrap.hidden = false;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function runCompress() {
    var files = Array.prototype.slice.call(els.input.files || []);
    if (!files.length) { setStatus(t("st_no_files"), false); return; }
    var targetKB = parseInt(els.target.value, 10);
    var err = Core.validateTarget(targetKB);
    if (err) { setStatus(t("st_bad_target"), false); return; }
    els.compress.disabled = true;
    els.all.disabled = true;
    els.body.innerHTML = "";
    els.wrap.hidden = true;
    window.KbCompress.done = false;
    window.KbCompress.targetKB = targetKB;
    var results = [];
    for (var i = 0; i < files.length; i += 1) {
      setStatus(tf("st_working", { done: i, total: files.length }), true);
      try {
        results.push(await compressOne(files[i], targetKB));
      } catch (e) {
        results.push({
          name: files[i].name, filename: files[i].name,
          origBytes: files[i].size, outBytes: null,
          outW: 0, outH: 0, quality: null, paddedBytes: 0,
          status: "failed", note: e.message, blob: null,
        });
      }
    }
    window.KbCompress.results = results;
    window.KbCompress.done = true;
    renderResults(results);
    var okCount = results.filter(function (r) { return r.status !== "failed"; }).length;
    setStatus(tf("st_done", { ok: okCount, total: results.length }), okCount === results.length);
    els.compress.disabled = false;
    els.all.disabled = okCount === 0;
  }

  function downloadAll() {
    var results = window.KbCompress.results || [];
    var ready = results.filter(function (r) { return r.blob; });
    if (!ready.length) return;
    ready.forEach(function (r, i) {
      setTimeout(function () { saveBlob(r.blob, r.filename); }, i * 400);
    });
    setStatus(t("st_all_saved"), true);
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
    if (!window.KbCompress.done) setStatus(t("st_ready"), true);
    if (window.KbCompress.results.length) renderResults(window.KbCompress.results);
  }

  function init() {
    els.input.addEventListener("change", function () {
      var n = els.input.files ? els.input.files.length : 0;
      els.count.textContent = n ? tf("st_files", { n: n }) : "";
      els.compress.disabled = n === 0;
      if (n) setStatus(t("st_ready"), true);
    });
    els.compress.addEventListener("click", runCompress);
    els.all.addEventListener("click", downloadAll);
    els.clear.addEventListener("click", function () {
      if (!window.confirm(t("confirm_clear"))) return;
      els.input.value = "";
      els.count.textContent = "";
      els.body.innerHTML = "";
      els.wrap.hidden = true;
      window.KbCompress.results = [];
      window.KbCompress.done = false;
      els.compress.disabled = true;
      els.all.disabled = true;
      setStatus(t("st_ready"), true);
    });
    $("lang-en").addEventListener("click", function () { lang = "en"; try { localStorage.setItem(LS_LANG, "en"); } catch (e) {} applyLang(); });
    $("lang-id").addEventListener("click", function () { lang = "id"; try { localStorage.setItem(LS_LANG, "id"); } catch (e) {} applyLang(); });
    applyLang();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
