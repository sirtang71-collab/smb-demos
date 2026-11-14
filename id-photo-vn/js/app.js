'use strict';
/* Vietnam ID Photo Maker — all processing is local.
   Logic (presets, range fitting, JPEG padding, print-sheet layout): js/core.js.
   Background choice = canvas fill colour behind the photo. This tool
   does NOT cut out or replace the background inside the photo itself;
   the fill is what shows where the photo has transparent areas (PNG)
   and it is the colour the exported frame is based on. */
(function () {
  var Core = window.VnPhotoCore;
  var KB = Core.KB;

  function $(id) { return document.getElementById(id); }
  function fmtKB(bytes) { return (bytes / KB).toFixed(1) + ' KB'; }

  // Last export / sheet, also read by the QC harness.
  var State = { lastResult: null, lastError: null, lastSheet: null };
  window.VnPhoto = State;

  /* ---------- print sheet (10x15 cm @ 300 DPI) ---------- */
  function updateSheetInfo() {
    var info = $('vn-sheet-info');
    if (!img) { info.textContent = 'Add a photo first — the sheet tiles the selected size onto one 10×15 cm page (1181×1772 px at 300 DPI), with dashed cut lines. Print at 100% scale (no fit-to-page).'; return; }
    var spec = currentSpec();
    var lay = Core.layoutSheet(spec.wPx, spec.hPx);
    info.textContent = 'Print sheet: ' + lay.count + ' copies (' + lay.cols + ' × ' + lay.rows + ') of ' +
      spec.wPx + '×' + spec.hPx + ' px on one ' + Core.SHEET.label + ' sheet (' +
      Core.SHEET.wPx + '×' + Core.SHEET.hPx + ' px).';
  }

  function buildSheetCanvas(spec) {
    var single = renderOutputCanvas(spec);
    var sheet = document.createElement('canvas');
    sheet.width = Core.SHEET.wPx; sheet.height = Core.SHEET.hPx;
    var sctx = sheet.getContext('2d');
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    var lay = Core.layoutSheet(spec.wPx, spec.hPx);
    lay.positions.forEach(function (pos) {
      sctx.drawImage(single, pos.x, pos.y);
      sctx.strokeStyle = '#c8c8c8';
      sctx.lineWidth = 1;
      sctx.setLineDash([6, 4]);
      sctx.strokeRect(pos.x + 0.5, pos.y + 0.5, spec.wPx - 1, spec.hPx - 1);
      sctx.setLineDash([]);
    });
    return { sheet: sheet, count: lay.count };
  }

  /* ---------- background colour (canvas fill) ---------- */
  var bgColor = '#ffffff';
  document.querySelectorAll('input[name="vn-bg"]').forEach(function (r) {
    r.addEventListener('change', function () {
      bgColor = r.value;
      document.querySelectorAll('.bg-chip').forEach(function (c) {
        c.classList.toggle('selected', c.querySelector('input').checked);
      });
      drawStage();
    });
  });

  /* ---------- presets ---------- */
  var selectedId = Core.PRESETS[0].id;

  function specLabel(s) {
    var range = (s.minKB ? s.minKB + '–' : '≤') + s.maxKB + ' KB';
    return s.wPx + '×' + s.hPx + ' px · ' + range;
  }

  function buildPresets() {
    var list = $('preset-list');
    Core.PRESETS.forEach(function (p) { list.appendChild(card(p.id, p.name, specLabel(p))); });
    list.appendChild(card('custom', 'Custom — my notice is different', 'Set your own pixel size and KB window'));
    selectPreset(selectedId);
  }
  function card(id, name, spec) {
    var label = document.createElement('label');
    label.className = 'preset-card';
    label.dataset.preset = id;
    var input = document.createElement('input');
    input.type = 'radio'; input.name = 'preset'; input.value = id;
    var nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = name;
    var sp = document.createElement('span'); sp.className = 'pspec'; sp.textContent = spec;
    label.appendChild(input); label.appendChild(nm); label.appendChild(sp);
    input.addEventListener('change', function () { selectPreset(id); });
    return label;
  }
  function selectPreset(id) {
    selectedId = id;
    document.querySelectorAll('.preset-card').forEach(function (c) {
      var on = c.dataset.preset === id;
      c.classList.toggle('selected', on);
      c.querySelector('input').checked = on;
    });
    $('custom-fields').hidden = id !== 'custom';
    var p = Core.PRESETS.find(function (x) { return x.id === id; });
    $('preset-note').textContent = p ? p.note : 'Custom size: the exported file will have exactly these pixel dimensions and must land inside your KB window.';
    if (p) {
      $('vn-min').value = p.minKB == null ? '' : p.minKB;
      $('vn-max').value = p.maxKB;
      $('cu-w').value = p.wPx;
      $('cu-h').value = p.hPx;
    }
    resetStageAspect();
    drawStage();
    updateSheetInfo();
  }

  function currentSpec() {
    var min = parseFloat($('vn-min').value);
    var kb = {
      minKB: isNaN(min) || min === 0 ? null : min,
      maxKB: parseFloat($('vn-max').value),
    };
    if (selectedId !== 'custom') {
      var p = Core.PRESETS.find(function (x) { return x.id === selectedId; });
      return Object.assign({ id: p.id, wPx: p.wPx, hPx: p.hPx }, kb);
    }
    return Object.assign({
      id: 'custom',
      wPx: parseInt($('cu-w').value, 10),
      hPx: parseInt($('cu-h').value, 10),
    }, kb);
  }
  ['cu-w', 'cu-h', 'vn-min', 'vn-max'].forEach(function (id) {
    $(id).addEventListener('input', function () { resetStageAspect(); drawStage(); updateSheetInfo(); });
  });

  /* ---------- photo + crop stage ---------- */
  var img = null;          // HTMLImageElement
  var zoom = 1, ox = 0, oy = 0;   // offsets in OUTPUT pixel coordinates

  function fitScale(spec) { return Math.max(spec.wPx / img.width, spec.hPx / img.height); }
  function drawSize(spec) {
    var s = fitScale(spec) * zoom;
    return { w: img.width * s, h: img.height * s };
  }
  function clampOffsets(spec) {
    var d = drawSize(spec);
    ox = Math.min(0, Math.max(spec.wPx - d.w, ox));
    oy = Math.min(0, Math.max(spec.hPx - d.h, oy));
  }
  function centerImage(spec) {
    var d = drawSize(spec);
    ox = (spec.wPx - d.w) / 2;
    oy = (spec.hPx - d.h) / 2;
  }

  function resetStageAspect() {
    var spec = currentSpec();
    if (!Number.isFinite(spec.wPx) || !Number.isFinite(spec.hPx) || spec.wPx <= 0 || spec.hPx <= 0) return;
    var stage = $('vn-stage');
    var w = 360, h = Math.round(360 * spec.hPx / spec.wPx);
    if (h > 480) { h = 480; w = Math.round(480 * spec.wPx / spec.hPx); }
    stage.width = w; stage.height = h;
    $('stage-wrap').style.width = w + 'px';
    if (img) { zoom = 1; $('vn-zoom').value = 1; centerImage(spec); }
  }

  function drawStage() {
    var stage = $('vn-stage');
    var ctx = stage.getContext('2d');
    ctx.fillStyle = '#e6ebf1';
    ctx.fillRect(0, 0, stage.width, stage.height);
    if (!img) return;
    var spec = currentSpec();
    clampOffsets(spec);
    var d = drawSize(spec);
    var k = stage.width / spec.wPx;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, stage.width, stage.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, ox * k, oy * k, d.w * k, d.h * k);
  }

  // drag to reposition
  (function () {
    var stage = $('vn-stage');
    var drag = null;
    stage.addEventListener('pointerdown', function (e) {
      if (!img) return;
      drag = { x: e.clientX, y: e.clientY };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!drag || !img) return;
      var spec = currentSpec();
      var rect = stage.getBoundingClientRect();
      var k = spec.wPx / rect.width;
      ox += (e.clientX - drag.x) * k;
      oy += (e.clientY - drag.y) * k;
      drag = { x: e.clientX, y: e.clientY };
      drawStage();
    });
    stage.addEventListener('pointerup', function () { drag = null; });
    stage.addEventListener('pointercancel', function () { drag = null; });
  })();

  $('vn-zoom').addEventListener('input', function () {
    if (!img) return;
    var spec = currentSpec();
    var before = drawSize(spec);
    zoom = parseFloat($('vn-zoom').value);
    var after = drawSize(spec);
    // keep the stage centre anchored while zooming
    ox -= (after.w - before.w) / 2;
    oy -= (after.h - before.h) / 2;
    drawStage();
  });

  function setStatus(msg, kind) {
    var el = $('vn-status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function loadFile(file) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function () {
      img = image;
      zoom = 1; $('vn-zoom').value = 1;
      var spec = currentSpec();
      centerImage(spec);
      $('vn-stage-empty').style.display = 'none';
      $('vn-info').textContent = file.name + ' — ' + img.width + '×' + img.height + ' px, ' + fmtKB(file.size);
      $('vn-btn').disabled = false;
      $('vn-sheet-btn').disabled = false;
      State.lastResult = null; State.lastError = null; State.lastSheet = null;
      $('vn-result-wrap').hidden = true;
      setStatus('');
      drawStage();
      updateSheetInfo();
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      setStatus('That file could not be read as an image.', 'error');
    };
    image.src = url;
  }
  $('vn-file').addEventListener('change', function (e) { loadFile(e.target.files[0]); });
  var drop = document.querySelector('.drop');
  ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
    drop.addEventListener(ev, function (e) {
      e.preventDefault();
      drop.classList.toggle('dragover', ev === 'dragover');
      if (ev === 'drop' && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });
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

  function renderOutputCanvas(spec) {
    var c = document.createElement('canvas');
    c.width = spec.wPx; c.height = spec.hPx;
    var ctx = c.getContext('2d');
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var d = drawSize(spec);
    ctx.drawImage(img, ox, oy, d.w, d.h);
    return c;
  }

  $('vn-btn').addEventListener('click', async function () {
    var spec = currentSpec();
    var invalid = Core.validateSpec(spec);
    if (invalid) { setStatus('✗ ' + invalid, 'error'); return; }
    if (!img) return;
    $('vn-btn').disabled = true;
    setStatus('Working…');
    State.lastResult = null; State.lastError = null;
    try {
      var out = renderOutputCanvas(spec);
      var encodeAtQuality = function (q) { return canvasToJpegBytes(out, q); };
      var r = await Core.encodeToRangeFixedDims(encodeAtQuality, spec);
      var rangeTxt = (spec.minKB ? spec.minKB + '–' : '≤') + spec.maxKB + ' KB';
      if (!r.ok) {
        $('vn-result-wrap').hidden = true;
        State.lastError = r;
        if (r.reason === 'below-min') {
          setStatus('✗ This image is too small or too plain to reach the ' + spec.minKB + ' KB minimum honestly: at full quality it makes only ' + fmtKB(r.sizeBytes) + '. Filling the rest would take more than ' + Core.PAD_RATIO_LIMIT + '× padding, which portals that re-encode would strip away — the file would be rejected anyway. Please use the original full-size photo, not a thumbnail, screenshot or chat-app copy.', 'error');
        } else {
          setStatus('✗ Even at the lowest quality, this photo is ' + fmtKB(r.sizeBytes) + ' at ' + spec.wPx + '×' + spec.hPx + ' px — over the ' + spec.maxKB + ' KB maximum. Try a cleaner, less noisy original (avoid high-ISO night shots).', 'error');
        }
        return;
      }
      var blob = new Blob([r.bytes], { type: 'image/jpeg' });
      var dl = $('vn-download');
      if (dl._url) URL.revokeObjectURL(dl._url);
      dl._url = URL.createObjectURL(blob);
      dl.href = dl._url;
      dl.download = 'vn-photo-' + spec.id + '.jpg';
      dl.textContent = '⬇ Download vn-photo-' + spec.id + '.jpg';
      var ri = $('vn-result-img');
      if (ri._url) URL.revokeObjectURL(ri._url);
      ri._url = URL.createObjectURL(blob);
      ri.src = ri._url;
      $('vn-result-info').textContent = spec.wPx + ' × ' + spec.hPx + ' px · ' + fmtKB(r.sizeBytes) + ' · required window ' + rangeTxt;
      $('vn-result-wrap').hidden = false;
      var msg = '✓ ' + fmtKB(r.sizeBytes) + ' — inside the required ' + rangeTxt + ' window · ' + spec.wPx + ' × ' + spec.hPx + ' px';
      if (r.paddedBytes > 0) msg += ' · minimum reached with standard JPEG padding (' + fmtKB(r.paddedBytes) + '), picture itself unchanged';
      setStatus(msg, 'ok');
      State.lastResult = { bytes: r.bytes, quality: r.quality, sizeBytes: r.sizeBytes, paddedBytes: r.paddedBytes, spec: spec, bg: bgColor };
    } catch (err) {
      setStatus('✗ Something went wrong: ' + err.message, 'error');
      State.lastError = { reason: 'exception', note: String(err && err.message || err) };
    } finally {
      $('vn-btn').disabled = false;
    }
  });

  /* ---------- print sheet ---------- */
  $('vn-sheet-btn').addEventListener('click', async function () {
    if (!img) return;
    var spec = currentSpec();
    var invalid = Core.validateSpec(spec);
    if (invalid) { $('vn-sheet-status').textContent = '✗ ' + invalid; return; }
    $('vn-sheet-btn').disabled = true;
    $('vn-sheet-status').textContent = 'Working…';
    try {
      var built = buildSheetCanvas(spec);
      var blob = await new Promise(function (resolve, reject) {
        built.sheet.toBlob(function (b) { b ? resolve(b) : reject(new Error('Sheet encode failed.')); }, 'image/jpeg', 0.95);
      });
      // Persistent anchor the user clicks (same pattern as the
      // single-photo download — a programmatic click from page code
      // does not reliably start a download in headless Chrome, and
      // showing the link matches the single-export UX).
      var dl = $('vn-sheet-download');
      if (dl._url) URL.revokeObjectURL(dl._url);
      dl._url = URL.createObjectURL(blob);
      dl.href = dl._url;
      dl.download = 'vn-photo-' + spec.id + '-sheet-10x15.jpg';
      dl.hidden = false;
      State.lastSheet = { count: built.count, w: Core.SHEET.wPx, h: Core.SHEET.hPx, sizeBytes: blob.size, id: spec.id };
      $('vn-sheet-status').textContent = '✓ Sheet ready: ' + Core.SHEET.wPx + '×' + Core.SHEET.hPx +
        ' px with ' + built.count + ' copies — click the download link below. Print at 100% scale (no fit-to-page).';
    } catch (err) {
      $('vn-sheet-status').textContent = '✗ Something went wrong: ' + err.message;
    } finally {
      $('vn-sheet-btn').disabled = false;
    }
  });

  buildPresets();
  drawStage();
  updateSheetInfo();
})();
