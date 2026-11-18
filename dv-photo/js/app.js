'use strict';
/* US DV Lottery Photo Maker — all processing is local.
   Logic (DV spec, head/eye ratios, corner whiteness, byte-ceiling
   fitting): js/core.js.
   This tool ONLY crops, resizes and re-encodes. It does NOT change
   the background inside the photo and does NOT retouch the face —
   the US 2026 rule rejects AI/app/filter edits, including background
   replacement, skin smoothing and lighting changes. The white canvas
   fill only shows through transparent areas of a PNG; for an opaque
   photo the frame is filled by the photo itself, so take the picture
   against a plain white or off-white wall first. */
(function () {
  var Core = window.DVPhotoCore;
  var SPEC = Core.DV_SPEC;
  var BG = '#ffffff'; // DV background must be plain white / off-white

  function $(id) { return document.getElementById(id); }
  function fmtKB(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

  // Last export, also read by the QC harness.
  var State = { lastResult: null, lastError: null, lastBgCheck: null };
  window.DVPhoto = State;

  /* ---------- photo + crop stage ---------- */
  var img = null;          // HTMLImageElement
  var zoom = 1, ox = 0, oy = 0;   // offsets in OUTPUT pixel coordinates

  function fitScale() { return Math.max(SPEC.wPx / img.width, SPEC.hPx / img.height); }
  function drawSize() {
    var s = fitScale() * zoom;
    return { w: img.width * s, h: img.height * s };
  }
  function clampOffsets() {
    var d = drawSize();
    ox = Math.min(0, Math.max(SPEC.wPx - d.w, ox));
    oy = Math.min(0, Math.max(SPEC.hPx - d.h, oy));
  }
  function centerImage() {
    var d = drawSize();
    ox = (SPEC.wPx - d.w) / 2;
    oy = (SPEC.hPx - d.h) / 2;
  }

  function drawStage() {
    var stage = $('dv-stage');
    var ctx = stage.getContext('2d');
    ctx.fillStyle = '#e6ebf1';
    ctx.fillRect(0, 0, stage.width, stage.height);
    if (!img) return;
    clampOffsets();
    var d = drawSize();
    var k = stage.width / SPEC.wPx; // stage px per output px
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, stage.width, stage.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, ox * k, oy * k, d.w * k, d.h * k);
    drawGuides(ctx, k);
  }

  // Head-guide overlay: outer dashed box = biggest allowed head
  // (69% of frame height), inner dashed box = smallest allowed head
  // (50%), blue band = where the eyes must fall (56-69% up from
  // the bottom). The crown must sit in the top band between the two
  // boxes, the chin in the bottom band.
  function drawGuides(ctx, k) {
    var g = Core.headGuideBoxes(SPEC.hPx);
    ctx.save();
    ctx.lineWidth = 1.5;
    // eye band
    ctx.fillStyle = 'rgba(20, 80, 160, 0.10)';
    ctx.fillRect(0, g.eyeBand.y0 * k, ctx.canvas.width, (g.eyeBand.y1 - g.eyeBand.y0) * k);
    ctx.strokeStyle = '#1450a0';
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(0.5, g.eyeBand.y0 * k + 0.5, ctx.canvas.width - 1, (g.eyeBand.y1 - g.eyeBand.y0) * k - 1);
    // max head box (red dashed)
    ctx.strokeStyle = '#b3122e';
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(g.maxBox.x * k + 0.5, g.maxBox.y * k + 0.5, g.maxBox.w * k - 1, g.maxBox.h * k - 1);
    // min head box (green dashed)
    ctx.strokeStyle = '#177245';
    ctx.setLineDash([7, 5]);
    ctx.strokeRect(g.minBox.x * k + 0.5, g.minBox.y * k + 0.5, g.minBox.w * k - 1, g.minBox.h * k - 1);
    ctx.setLineDash([]);
    // labels (white backing so they stay legible over the photo)
    ctx.font = 'bold 11px system-ui, sans-serif';
    function label(text, x, y, color) {
      // x, y are output (600px-frame) coords; convert once to canvas px
      var cx = x * k, cy = y * k;
      var w = ctx.measureText(text).width; // canvas px at the 11px font
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(cx - 2, cy - 11, w + 4, 14);
      ctx.fillStyle = color;
      ctx.fillText(text, cx, cy);
    }
    label('head ≤ 69%', g.maxBox.x + 4, g.maxBox.y - 5, '#b3122e');
    label('head ≥ 50%', g.minBox.x + 4, g.minBox.y + 14, '#177245');
    label('eyes here', 6, g.eyeBand.y0 + 13, '#1450a0');
    ctx.restore();
  }

  // drag to reposition
  (function () {
    var stage = $('dv-stage');
    var drag = null;
    stage.addEventListener('pointerdown', function (e) {
      if (!img) return;
      drag = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag || !img) return;
      var rect = stage.getBoundingClientRect();
      var k = SPEC.wPx / rect.width;
      ox += (e.clientX - drag.x) * k;
      oy += (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
      drawStage();
    });
    stage.addEventListener('pointerup', function () { drag = null; });
    stage.addEventListener('pointercancel', function () { drag = null; });
  })();

  $('dv-zoom').addEventListener('input', function () {
    if (!img) return;
    var before = drawSize();
    zoom = parseFloat($('dv-zoom').value);
    var after = drawSize();
    // keep the stage centre anchored while zooming
    ox -= (after.w - before.w) / 2;
    oy -= (after.h - before.h) / 2;
    drawStage();
  });

  function setStatus(msg, kind) {
    var el = $('dv-status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  /* ---------- background corner check (hint only) ---------- */
  function checkBackground() {
    if (!img) return;
    var maxSide = 1200;
    var s = Math.min(1, maxSide / Math.max(img.width, img.height));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    var data;
    try {
      data = ctx.getImageData(0, 0, c.width, c.height).data;
    } catch (err) {
      $('dv-bg-readout').textContent = 'Background check unavailable for this file.';
      return;
    }
    var res = Core.cornerWhiteness(function (x, y) {
      var i = (y * c.width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    }, c.width, c.height, 10);
    State.lastBgCheck = res;
    var means = res.cornerMeans.map(function (m) { return Math.round(m); }).join(', ');
    var el = $('dv-bg-readout');
    if (res.isWhite) {
      el.textContent = 'Background corners look white / off-white (corner brightness ' + means + ', darkest ' + Math.round(res.minMean) + ' of 255). Still confirm by eye — the background must be plain, with no shadows or objects.';
      el.className = 'readout ok';
    } else {
      el.textContent = 'Background corners do NOT look white (corner brightness ' + means + ', darkest ' + Math.round(res.minMean) + ' of 255 — plain white reads ~255). This tool cannot whiten or replace a background: retake the photo against a plain white or off-white wall.';
      el.className = 'readout bad';
    }
    updateChecklist();
  }

  function loadFile(file) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function () {
      img = image;
      zoom = 1; $('dv-zoom').value = 1;
      centerImage();
      $('dv-stage-empty').style.display = 'none';
      $('dv-info').textContent = file.name + ' — ' + img.width + '×' + img.height + ' px, ' + fmtKB(file.size);
      $('dv-btn').disabled = false;
      State.lastResult = null; State.lastError = null; State.lastBgCheck = null;
      $('dv-result-wrap').hidden = true;
      setStatus('');
      drawStage();
      checkBackground();
      updateChecklist();
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      setStatus('That file could not be read as an image.', 'error');
    };
    image.src = url;
  }
  $('dv-file').addEventListener('change', function (e) { loadFile(e.target.files[0]); });
  var drop = document.querySelector('.drop');
  ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.toggle('dragover', ev === 'dragover');
      if (ev === 'drop' && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });
  });

  /* ---------- head / eye measurement ---------- */
  function numVal(id) {
    var v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : NaN;
  }
  function updateHeadReadout() {
    var r = Core.checkHead(numVal('dv-crown'), numVal('dv-chin'), SPEC.hPx);
    var el = $('dv-head-readout');
    el.textContent = r.message;
    el.className = 'readout' + (r.ratioPct === null ? '' : (r.inRange ? ' ok' : ' bad'));
    $('chk-head').checked = r.inRange;
    updateChecklist();
    return r;
  }
  function updateEyeReadout() {
    var r = Core.checkEyes(numVal('dv-eye'), SPEC.hPx);
    var el = $('dv-eye-readout');
    el.textContent = r.message;
    el.className = 'readout' + (r.eyePct === null ? '' : (r.inRange ? ' ok' : ' bad'));
    $('chk-eyes').checked = r.inRange;
    updateChecklist();
    return r;
  }
  ['dv-crown', 'dv-chin'].forEach(function (id) {
    $(id).addEventListener('input', updateHeadReadout);
  });
  $('dv-eye').addEventListener('input', updateEyeReadout);

  /* ---------- checklist ---------- */
  function mark(id, done) {
    var li = $('chk-' + id).closest('li');
    li.classList.toggle('done', !!done);
  }
  function updateChecklist() {
    var r = State.lastResult;
    var sizeOk = !!(r && r.spec.wPx === 600 && r.spec.hPx === 600);
    var bytesOk = !!(r && r.sizeBytes <= SPEC.maxBytes);
    var jpegOk = !!r;
    var squareOk = !!(r && r.spec.wPx === r.spec.hPx);
    // auto items are disabled inputs: their checked state is set here,
    // by the export result only — the user cannot tick them by hand.
    $('chk-size').checked = sizeOk;
    $('chk-bytes').checked = bytesOk;
    $('chk-jpeg').checked = jpegOk;
    $('chk-square').checked = squareOk;
    mark('size', sizeOk);
    mark('bytes', bytesOk);
    mark('jpeg', jpegOk);
    mark('square', squareOk);
    mark('head', $('chk-head').checked);
    mark('eyes', $('chk-eyes').checked);
    mark('bg', $('chk-bg').checked);
    mark('recent', $('chk-recent').checked);
    mark('glasses', $('chk-glasses').checked);
    mark('noedit', $('chk-noedit').checked);
    var total = document.querySelectorAll('.checklist li.done').length;
    $('dv-check-count').textContent = total + ' of 10 checks done — the file checks (size, bytes, format, square) tick themselves after a successful export; the rest need your eyes and your word.';
  }
  document.querySelectorAll('.checklist input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', updateChecklist);
  });

  /* ---------- export ---------- */
  function canvasToJpegBytes(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('JPEG encode failed.')); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
      }, 'image/jpeg', quality);
    });
  }

  function renderOutputCanvas() {
    var c = document.createElement('canvas');
    c.width = SPEC.wPx; c.height = SPEC.hPx;
    var ctx = c.getContext('2d');
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var d = drawSize();
    ctx.drawImage(img, ox, oy, d.w, d.h);
    return c;
  }

  $('dv-btn').addEventListener('click', async function () {
    var invalid = Core.validateSpec(SPEC);
    if (invalid) { setStatus('✗ ' + invalid, 'error'); return; }
    if (!img) return;
    $('dv-btn').disabled = true;
    setStatus('Working…');
    State.lastResult = null; State.lastError = null;
    try {
      var out = renderOutputCanvas();
      var encodeAtQuality = function (q) { return canvasToJpegBytes(out, q); };
      var r = await Core.encodeToMaxBytes(encodeAtQuality, SPEC);
      if (!r.ok) {
        $('dv-result-wrap').hidden = true;
        State.lastError = r;
        setStatus('✗ Even at the lowest quality, this photo is ' + fmtKB(r.sizeBytes) + ' at 600×600 px — over the 240 KB ceiling. Use a cleaner, less noisy original (avoid high-ISO night shots or heavy grain).', 'error');
        updateChecklist();
        return;
      }
      var blob = new Blob([r.bytes], { type: 'image/jpeg' });
      var dl = $('dv-download');
      if (dl._url) URL.revokeObjectURL(dl._url);
      dl._url = URL.createObjectURL(blob);
      dl.href = dl._url;
      dl.download = 'dv-photo.jpg';
      var ri = $('dv-result-img');
      if (ri._url) URL.revokeObjectURL(ri._url);
      ri._url = URL.createObjectURL(blob);
      ri.src = ri._url;
      $('dv-result-info').textContent = '600 × 600 px · ' + r.sizeBytes.toLocaleString('en-US') + ' bytes (' + fmtKB(r.sizeBytes) + ') · JPEG · quality ' + r.quality.toFixed(2) + ' · ceiling 240,000 bytes';
      $('dv-result-wrap').hidden = false;
      setStatus('✓ ' + fmtKB(r.sizeBytes) + ' — under the 240 KB ceiling · 600 × 600 px · JPEG', 'ok');
      State.lastResult = { bytes: r.bytes, quality: r.quality, sizeBytes: r.sizeBytes, spec: SPEC };
      updateChecklist();
    } catch (err) {
      setStatus('✗ Something went wrong: ' + err.message, 'error');
      State.lastError = { reason: 'exception', note: String(err && err.message || err) };
    } finally {
      $('dv-btn').disabled = false;
    }
  });

  drawStage();
  updateChecklist();
})();
