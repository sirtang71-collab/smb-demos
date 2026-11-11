'use strict';
/* Paket Berkas CPNS & PPPK — semua proses lokal di browser.
   AI ganti latar: MediaPipe Selfie Segmenter (WASM, vendored).
   PDF: pdf-lib (vendored). Logika ukuran: js/core.js (window.CPNSCore). */
(function () {
  var Core = window.CPNSCore;
  var KB = Core.KB;
  var PDFDocument = window.PDFLib.PDFDocument;

  function $(id) { return document.getElementById(id); }
  function setStatus(el, msg, isError) {
    el.textContent = msg || '';
    el.className = 'status' + (isError ? ' error' : '');
  }
  function fmtKB(bytes) { return (bytes / KB).toFixed(1) + ' KB'; }

  // Hasil terakhir tiap alat — juga dipakai harness QC untuk verifikasi.
  var Kit = { lastPasFoto: null, lastKompres: null, lastFotoPdf: null, lastGabung: null };
  window.CPNSKit = Kit;

  /* ---------- helpers ---------- */
  function imgFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Gambar tidak bisa dibaca.')); };
      img.src = url;
    });
  }
  function canvasToJpegBytes(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('Encode JPG gagal.')); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
      }, 'image/jpeg', quality);
    });
  }
  // encodeAt(quality, scale) for Core.encodeToTargetSize, from a source canvas.
  function canvasEncoder(sourceCanvas) {
    return function (quality, scale) {
      var c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(sourceCanvas.width * scale));
      c.height = Math.max(2, Math.round(sourceCanvas.height * scale));
      var ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(sourceCanvas, 0, 0, c.width, c.height);
      return canvasToJpegBytes(c, quality);
    };
  }
  function setDownload(linkEl, bytes, mime) {
    var blob = new Blob([bytes], { type: mime });
    if (linkEl._url) URL.revokeObjectURL(linkEl._url);
    linkEl._url = URL.createObjectURL(blob);
    linkEl.href = linkEl._url;
    linkEl.hidden = false;
    return linkEl._url;
  }
  function fileListUI(listEl, files, onChange) {
    function render() {
      listEl.innerHTML = '';
      files.forEach(function (f, i) {
        var li = document.createElement('li');
        var name = document.createElement('span');
        name.className = 'fname'; name.textContent = (i + 1) + '. ' + f.name;
        li.appendChild(name);
        [['↑', -1], ['↓', 1]].forEach(function (pair) {
          var b = document.createElement('button');
          b.textContent = pair[0]; b.type = 'button';
          b.addEventListener('click', function () {
            var j = i + pair[1];
            if (j < 0 || j >= files.length) return;
            var tmp = files[i]; files[i] = files[j]; files[j] = tmp;
            render(); onChange();
          });
          li.appendChild(b);
        });
        var rm = document.createElement('button');
        rm.textContent = '✕'; rm.type = 'button';
        rm.addEventListener('click', function () { files.splice(i, 1); render(); onChange(); });
        li.appendChild(rm);
        listEl.appendChild(li);
      });
    }
    return render;
  }

  /* ---------- tabs ---------- */
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.tool').forEach(function (s) { s.classList.remove('active'); });
      tab.classList.add('active');
      $('tool-' + tab.dataset.tool).classList.add('active');
    });
  });

  /* ================================================================
     MediaPipe Selfie Segmenter - segmentasi orang di perangkat.
     Engine dipilih berdasarkan bukti (lihat QC.md): U2NetP adalah model
     saliency umum - pada foto uji ia mempertahankan kotak latar berwarna
     dan membuang bahu/kaos. Selfie Segmenter memang dilatih untuk orang.
     PENTING (terverifikasi pada file model yang di-vendor ini): masker
     kategori bersifat biner, orang = 0, latar = 255. Dan matte HARUS
     ditulis ke kanal ALPHA - 'destination-in' hanya membaca alpha.
     ================================================================ */
  var segmenterPromise = null;

  function getSegmenter() {
    if (!segmenterPromise) {
      segmenterPromise = (async function () {
        var base = window.location.href;
        var vision = await import(new URL('assets/vendor/mediapipe/vision_bundle.mjs', base).href);
        var fileset = await vision.FilesetResolver.forVisionTasks(
          new URL('assets/vendor/mediapipe/wasm', base).href);
        return vision.ImageSegmenter.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: new URL('models/selfie_segmenter.tflite', base).href,
            delegate: 'CPU',
          },
          runningMode: 'IMAGE',
          outputCategoryMask: true,
          outputConfidenceMasks: false,
        });
      })().catch(function (e) { segmenterPromise = null; throw e; });
    }
    return segmenterPromise;
  }

  // Jalankan segmenter atas canvas sumber -> canvas RGBA ukuran sama
  // dengan alpha = matte orang.
  async function alphaCanvasFrom(sourceCanvas) {
    var segmenter = await getSegmenter();
    var result = segmenter.segment(sourceCanvas);
    if (!result || !result.categoryMask) throw new Error('Segmentasi tidak menghasilkan masker.');
    var mask = result.categoryMask.getAsUint8Array();
    var W = sourceCanvas.width, H = sourceCanvas.height;
    if (mask.length !== W * H) throw new Error('Ukuran masker tidak cocok: ' + mask.length + ' vs ' + (W * H));
    var small = document.createElement('canvas');
    small.width = W; small.height = H;
    var sctx = small.getContext('2d');
    var imgData = sctx.createImageData(W, H);
    for (var j = 0; j < W * H; j += 1) {
      var a = mask[j] === 0 ? 255 : 0; // model ini: orang = 0, latar = 255
      imgData.data[j * 4] = 255; imgData.data[j * 4 + 1] = 255; imgData.data[j * 4 + 2] = 255; imgData.data[j * 4 + 3] = a;
    }
    sctx.putImageData(imgData, 0, 0);
    var out = document.createElement('canvas');
    out.width = W; out.height = H;
    var octx = out.getContext('2d');
    octx.drawImage(sourceCanvas, 0, 0, W, H);
    octx.globalCompositeOperation = 'destination-in';
    octx.filter = 'blur(1px)';
    octx.drawImage(small, 0, 0, W, H);
    octx.filter = 'none';
    octx.globalCompositeOperation = 'source-over';
    return out;
  }

  function compositeOnColor(alphaCanvas, color) {
    var out = document.createElement('canvas');
    out.width = alphaCanvas.width; out.height = alphaCanvas.height;
    var ctx = out.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(alphaCanvas, 0, 0);
    return out;
  }

  /* ================================================================
     1) PAS FOTO — crop 4x6 + ganti latar + JPG <= 200 KB (dimensi tetap)
     ================================================================ */
  var PF_W = Core.SPECS.pasFoto.wPx, PF_H = Core.SPECS.pasFoto.hPx;
  var PF_CAP = Core.SPECS.pasFoto.capBytes;
  var pf = { img: null, zoom: 1, ox: 0, oy: 0 };
  var pfStage = $('pf-stage');
  var pfCtx = pfStage.getContext('2d');

  function pfBaseScale() {
    if (!pf.img) return 1;
    return Math.max(pfStage.width / pf.img.naturalWidth, pfStage.height / pf.img.naturalHeight);
  }
  function pfSourceRect() {
    var s = pfBaseScale() * pf.zoom;
    var w = pfStage.width / s, h = pfStage.height / s;
    var cx = pf.img.naturalWidth / 2 - pf.ox / s;
    var cy = pf.img.naturalHeight / 2 - pf.oy / s;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }
  function pfClampPan() {
    if (!pf.img) return;
    var s = pfBaseScale() * pf.zoom;
    var maxOx = Math.max(0, (pf.img.naturalWidth * s - pfStage.width) / 2);
    var maxOy = Math.max(0, (pf.img.naturalHeight * s - pfStage.height) / 2);
    pf.ox = Math.min(maxOx, Math.max(-maxOx, pf.ox));
    pf.oy = Math.min(maxOy, Math.max(-maxOy, pf.oy));
  }
  function pfRender() {
    pfCtx.clearRect(0, 0, pfStage.width, pfStage.height);
    if (!pf.img) return;
    pfClampPan();
    var r = pfSourceRect();
    pfCtx.drawImage(pf.img, r.x, r.y, r.w, r.h, 0, 0, pfStage.width, pfStage.height);
  }
  function pfCropCanvas() {
    var c = document.createElement('canvas');
    c.width = PF_W; c.height = PF_H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PF_W, PF_H);
    var r = pfSourceRect();
    ctx.drawImage(pf.img, r.x, r.y, r.w, r.h, 0, 0, PF_W, PF_H);
    return c;
  }
  var pfDrag = null;
  pfStage.addEventListener('pointerdown', function (e) {
    pfDrag = { id: e.pointerId, x: e.offsetX, y: e.offsetY };
    pfStage.setPointerCapture(e.pointerId);
  });
  pfStage.addEventListener('pointermove', function (e) {
    if (!pfDrag || !pf.img) return;
    var rect = pfStage.getBoundingClientRect();
    var sx = pfStage.width / rect.width, sy = pfStage.height / rect.height;
    pf.ox += (e.offsetX - pfDrag.x) * sx;
    pf.oy += (e.offsetY - pfDrag.y) * sy;
    pfDrag.x = e.offsetX; pfDrag.y = e.offsetY;
    pfRender();
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    pfStage.addEventListener(ev, function () { pfDrag = null; });
  });
  $('pf-zoom').addEventListener('input', function (e) {
    pf.zoom = parseFloat(e.target.value);
    pfRender();
  });
  $('pf-file').addEventListener('change', async function (e) {
    var f = e.target.files[0];
    if (!f) return;
    try {
      pf.img = await imgFromFile(f);
      pf.zoom = 1; pf.ox = 0; pf.oy = 0;
      $('pf-zoom').value = '1';
      $('pf-stage-empty').style.display = 'none';
      $('pf-btn').disabled = false;
      pfRender();
      setStatus($('pf-status'), 'Foto termuat (' + pf.img.naturalWidth + '×' + pf.img.naturalHeight + ' px). Atur posisi, lalu klik Buat Pas Foto.');
    } catch (err) { setStatus($('pf-status'), 'Error: ' + err.message, true); }
  });

  $('pf-btn').addEventListener('click', async function () {
    var st = $('pf-status');
    var btn = $('pf-btn');
    if (!pf.img) return;
    btn.disabled = true;
    try {
      var crop = pfCropCanvas();
      var bgVal = document.querySelector('input[name="pf-bg"]:checked').value;
      var skipBg = $('pf-nobg').checked;
      var finalCanvas = crop;
      var swapped = false;
      if (!skipBg) {
        setStatus(st, 'Memuat model AI & mengganti latar… (pertama kali bisa agak lama)');
        var alpha = await alphaCanvasFrom(crop);
        finalCanvas = compositeOnColor(alpha, Core.BG_COLORS[bgVal]);
        swapped = true;
      }
      setStatus(st, 'Menyusun JPG ≤ 200 KB…');
      var fitted = await Core.encodeUnderCapFixedDims(function (q) {
        return canvasToJpegBytes(finalCanvas, q);
      }, PF_CAP);
      var bytes = fitted.bytes;
      var url = setDownload($('pf-download'), bytes, 'image/jpeg');
      $('pf-result-img').src = url;
      $('pf-result-wrap').hidden = false;
      $('pf-result-info').textContent =
        'Hasil: ' + PF_W + '×' + PF_H + ' px · ' + fmtKB(fitted.sizeBytes) + ' (batas 200 KB)' +
        ' · kualitas JPG ' + Math.round(fitted.quality * 100) + '%' +
        (swapped ? ' · latar ' + (bgVal === 'red' ? 'merah' : 'biru') : ' · tanpa ganti latar');
      setStatus(st, fitted.over
        ? 'Peringatan: bahkan kualitas terendah masih ' + fmtKB(fitted.sizeBytes) + ' — coba foto yang lebih sederhana.'
        : 'Selesai — pas foto siap diunduh.');
      Kit.lastPasFoto = {
        sizeBytes: fitted.sizeBytes, quality: fitted.quality, over: fitted.over,
        w: PF_W, h: PF_H, bg: skipBg ? 'none' : bgVal, swapped: swapped, bytes: bytes,
      };
    } catch (err) {
      setStatus(st, 'Error: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  /* ================================================================
     2) KOMPRES KTP — JPG <= cap pilihan (kualitas, lalu skala)
     ================================================================ */
  var kc = { img: null, fileSize: 0 };
  $('kc-file').addEventListener('change', async function (e) {
    var f = e.target.files[0];
    if (!f) return;
    try {
      kc.img = await imgFromFile(f);
      kc.fileSize = f.size;
      $('kc-info').textContent = f.name + ' — ' + kc.img.naturalWidth + '×' + kc.img.naturalHeight + ' px · ' + fmtKB(f.size);
      $('kc-btn').disabled = false;
      setStatus($('kc-status'), '');
    } catch (err) { setStatus($('kc-status'), 'Error: ' + err.message, true); }
  });
  $('kc-btn').addEventListener('click', async function () {
    var st = $('kc-status');
    if (!kc.img) return;
    var capKB = parseInt(document.querySelector('input[name="kc-cap"]:checked').value, 10);
    var capBytes = capKB * KB;
    var btn = $('kc-btn');
    btn.disabled = true;
    try {
      setStatus(st, 'Mengompres ke ≤ ' + capKB + ' KB…');
      var src = document.createElement('canvas');
      var maxDim = 4000;
      var scale0 = Math.min(1, maxDim / Math.max(kc.img.naturalWidth, kc.img.naturalHeight));
      src.width = Math.round(kc.img.naturalWidth * scale0);
      src.height = Math.round(kc.img.naturalHeight * scale0);
      var sctx = src.getContext('2d');
      sctx.fillStyle = '#ffffff'; sctx.fillRect(0, 0, src.width, src.height);
      sctx.drawImage(kc.img, 0, 0, src.width, src.height);
      var encodeAt = canvasEncoder(src);
      var res = await Core.encodeToTargetSize(encodeAt, { minBytes: 0, maxBytes: capBytes });
      var bytes = await encodeAt(res.quality, res.scale);
      var outW = Math.round(src.width * res.scale), outH = Math.round(src.height * res.scale);
      var url = setDownload($('kc-download'), bytes, 'image/jpeg');
      $('kc-download').download = 'ktp-kompres-' + capKB + 'kb.jpg';
      $('kc-result-img').src = url;
      $('kc-result-wrap').hidden = false;
      $('kc-result-info').textContent =
        'Sebelum: ' + fmtKB(kc.fileSize) + ' → Sesudah: ' + fmtKB(bytes.length) + ' (batas ' + capKB + ' KB)' +
        ' · ' + outW + '×' + outH + ' px · kualitas JPG ' + Math.round(res.quality * 100) + '%';
      setStatus(st, res.ok ? 'Selesai — gambar terkompres siap diunduh.' : 'Tidak berhasil mencapai batas; hasil terbaik ditampilkan.', !res.ok);
      Kit.lastKompres = {
        sizeBytes: bytes.length, capBytes: capBytes, capKB: capKB,
        quality: res.quality, scale: res.scale, w: outW, h: outH,
        beforeBytes: kc.fileSize, ok: res.ok, bytes: bytes,
      };
    } catch (err) {
      setStatus(st, 'Error: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  /* ================================================================
     3) FOTO → PDF — total <= 800 KB (pencarian kualitas global)
     ================================================================ */
  var fpFiles = [];
  var renderFp = fileListUI($('fp-list'), fpFiles, function () {
    $('fp-btn').disabled = fpFiles.length < 1;
  });
  $('fp-file').addEventListener('change', function (e) {
    Array.prototype.forEach.call(e.target.files, function (f) { fpFiles.push(f); });
    e.target.value = '';
    renderFp();
    $('fp-btn').disabled = fpFiles.length < 1;
  });

  async function fpBuildPdf(images, quality, maxDim) {
    var out = await PDFDocument.create();
    var A4 = { w: 595.28, h: 841.89 };
    var MARGIN = 36;
    for (var i = 0; i < images.length; i++) {
      var img = images[i];
      var sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      var c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * sc);
      c.height = Math.round(img.naturalHeight * sc);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      var jpgBytes = await canvasToJpegBytes(c, quality);
      var emb = await out.embedJpg(jpgBytes);
      var landscape = emb.width > emb.height;
      var pw = landscape ? A4.h : A4.w;
      var ph = landscape ? A4.w : A4.h;
      var s2 = Math.min((pw - MARGIN * 2) / emb.width, (ph - MARGIN * 2) / emb.height, 1);
      var w = emb.width * s2, h = emb.height * s2;
      var page = out.addPage([pw, ph]);
      page.drawImage(emb, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    return out.save();
  }

  $('fp-btn').addEventListener('click', async function () {
    var st = $('fp-status');
    var btn = $('fp-btn');
    btn.disabled = true;
    try {
      setStatus(st, 'Membaca ' + fpFiles.length + ' foto…');
      var images = [];
      for (var i = 0; i < fpFiles.length; i++) images.push(await imgFromFile(fpFiles[i]));
      var cap = Core.SPECS.pdfCapBytes;
      var best = null;
      var ladders = [2000, 1400, 1000];
      for (var li = 0; li < ladders.length && !best; li++) {
        var maxDim = ladders[li];
        setStatus(st, 'Menyusun PDF (maks ' + maxDim + ' px)…');
        var hiBytes = await fpBuildPdf(images, 0.92, maxDim);
        if (hiBytes.length <= cap) { best = { bytes: hiBytes, quality: 0.92, maxDim: maxDim }; break; }
        var lo = 0.25, hi = 0.92, cand = null;
        for (var it = 0; it < 6; it++) {
          var mid = (lo + hi) / 2;
          var b = await fpBuildPdf(images, mid, maxDim);
          if (b.length <= cap) { cand = { bytes: b, quality: mid, maxDim: maxDim }; lo = mid; }
          else { hi = mid; }
        }
        if (cand) best = cand;
      }
      var over = false;
      if (!best) {
        var fallback = await fpBuildPdf(images, 0.25, 1000);
        best = { bytes: fallback, quality: 0.25, maxDim: 1000 };
        over = fallback.length > cap;
      }
      setDownload($('fp-download'), best.bytes, 'application/pdf');
      $('fp-result').textContent =
        'Hasil: ' + images.length + ' halaman · total ' + fmtKB(best.bytes.length) + ' (batas 800 KB)' +
        ' · kualitas JPG ' + Math.round(best.quality * 100) + '% · maks ' + best.maxDim + ' px';
      setStatus(st, over
        ? 'Peringatan: total masih ' + fmtKB(best.bytes.length) + ' — melebihi 800 KB. Kurangi jumlah foto atau pindai ulang lebih sederhana.'
        : 'Selesai — PDF siap diunduh.', over);
      Kit.lastFotoPdf = {
        sizeBytes: best.bytes.length, pages: images.length, quality: best.quality,
        maxDim: best.maxDim, over: over, capBytes: cap, bytes: best.bytes,
      };
    } catch (err) {
      setStatus(st, 'Error: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });

  /* ================================================================
     4) GABUNG PDF — gabung + peringatan jujur bila > 800 KB
     ================================================================ */
  var gpFiles = [];
  var renderGp = fileListUI($('gp-list'), gpFiles, function () {
    $('gp-btn').disabled = gpFiles.length < 2;
  });
  $('gp-file').addEventListener('change', function (e) {
    Array.prototype.forEach.call(e.target.files, function (f) { gpFiles.push(f); });
    e.target.value = '';
    renderGp();
    $('gp-btn').disabled = gpFiles.length < 2;
  });
  $('gp-btn').addEventListener('click', async function () {
    var st = $('gp-status');
    var btn = $('gp-btn');
    btn.disabled = true;
    $('gp-warning').hidden = true;
    try {
      setStatus(st, 'Menggabungkan…');
      var out = await PDFDocument.create();
      for (var i = 0; i < gpFiles.length; i++) {
        var srcDoc = await PDFDocument.load(await gpFiles[i].arrayBuffer(), { ignoreEncryption: true });
        var pages = await out.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach(function (pg) { out.addPage(pg); });
      }
      var bytes = await out.save();
      var verdict = Core.evaluatePdfSize(bytes.length);
      setDownload($('gp-download'), bytes, 'application/pdf');
      $('gp-result').textContent =
        'Hasil gabungan: ' + out.getPageCount() + ' halaman · ' + fmtKB(bytes.length) + ' (batas SSCASN 800 KB)';
      if (verdict.over) {
        $('gp-warning-detail').textContent =
          'Total hasil gabungan ' + fmtKB(bytes.length) + ', melebihi batas sebesar ' + fmtKB(bytes.length - verdict.capBytes) + '.';
        $('gp-warning').hidden = false;
        setStatus(st, 'Selesai dengan peringatan — lihat kotak merah di atas.', true);
      } else {
        setStatus(st, 'Selesai — ukuran aman di bawah 800 KB.');
      }
      Kit.lastGabung = {
        sizeBytes: bytes.length, pages: out.getPageCount(), over: verdict.over, bytes: bytes,
      };
    } catch (err) {
      setStatus(st, 'Error: ' + err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
})();
