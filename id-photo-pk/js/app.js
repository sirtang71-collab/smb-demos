'use strict';
/* Pakistan ID Photo Maker — all processing is local.
   Logic (presets, backgrounds, range fitting, JPEG padding): js/core.js.
   Crop stage + range export follow the same pattern as portal-photo. */
(function () {
  var Core = window.PakistanPhotoCore;
  var KB = Core.KB;

  function $(id) { return document.getElementById(id); }
  function fmtKB(bytes) { return (bytes / KB).toFixed(1) + ' KB'; }

  // Last export, also read by the QC harness.
  var State = { lastResult: null, lastError: null };
  window.PkPhoto = State;

  /* ---------- presets ---------- */
  var selectedId = Core.PRESETS[0].id;

  function specLabel(s) {
    var range = (s.minKB ? s.minKB + '–' : '≤') + s.maxKB + ' KB';
    return s.wPx + '×' + s.hPx + ' px · ' + range + (s.editableKB ? ' · KB window editable' : '');
  }

  function buildPresets() {
    var list = $('preset-list');
    Core.PRESETS.forEach(function (p) { list.appendChild(card(p.id, p.name, specLabel(p))); });
    list.appendChild(card('custom', 'Custom — my form is not listed', 'Set your own pixel size and KB window'));
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
    var p = Core.PRESETS.find(function (x) { return x.id === id; });
    $('kb-fields').hidden = !(p && p.editableKB);
    if (p && p.editableKB) {
      $('kb-min').value = p.minKB || 0;
      $('kb-max').value = p.maxKB;
    }
    $('custom-fields').hidden = id !== 'custom';
    $('preset-note').textContent = p ? p.note : 'Custom size: the exported file will have exactly these pixel dimensions and must land inside your KB window.';
    resetStageAspect();
    drawStage();
  }

  function kbFromInputs(minEl, maxEl) {
    var min = parseFloat(minEl.value);
    return {
      minKB: isNaN(min) || min === 0 ? null : min,
      maxKB: parseFloat(maxEl.value),
    };
  }

  function currentSpec() {
    if (selectedId !== 'custom') {
      var p = Core.PRESETS.find(function (x) { return x.id === selectedId; });
      var kb = (p.editableKB) ? kbFromInputs($('kb-min'), $('kb-max')) : { minKB: p.minKB, maxKB: p.maxKB };
      return { id: p.id, wPx: p.wPx, hPx: p.hPx, minKB: kb.minKB, maxKB: kb.maxKB };
    }
    var kb2 = kbFromInputs($('cu-min'), $('cu-max'));
    return {
      id: 'custom',
      wPx: parseInt($('cu-w').value, 10),
      hPx: parseInt($('cu-h').value, 10),
      minKB: kb2.minKB, maxKB: kb2.maxKB,
    };
  }
  ['cu-w', 'cu-h'].forEach(function (id) {
    $(id).addEventListener('input', function () { resetStageAspect(); drawStage(); });
  });

  /* ---------- background ---------- */
  var bgHex = Core.BACKGROUNDS[0].hex;
  var bgId = Core.BACKGROUNDS[0].id;

  function buildBackgrounds() {
    var list = $('bg-list');
    Core.BACKGROUNDS.forEach(function (b) {
      var label = document.createElement('label');
      label.className = 'bg-card' + (b.id === bgId ? ' selected' : '');
      label.dataset.bg = b.id;
      var input = document.createElement('input');
      input.type = 'radio'; input.name = 'bg'; input.value = b.id;
      input.checked = b.id === bgId;
      var sw = document.createElement('span');
      sw.className = 'swatch'; sw.style.background = b.hex;
      var nm = document.createElement('span'); nm.textContent = b.name;
      label.appendChild(input); label.appendChild(sw); label.appendChild(nm);
      input.addEventListener('change', function () {
        bgId = b.id; bgHex = b.hex;
        document.querySelectorAll('.bg-card').forEach(function (c) {
          c.classList.toggle('selected', c.dataset.bg === bgId);
        });
        drawStage();
      });
      list.appendChild(label);
    });
  }

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
    var stage = $('pk-stage');
    var w = 360, h = Math.round(360 * spec.hPx / spec.wPx);
    if (h > 480) { h = 480; w = Math.round(480 * spec.wPx / spec.hPx); }
    stage.width = w; stage.height = h;
    $('stage-wrap').style.width = w + 'px';
    if (img) { zoom = 1; $('pk-zoom').value = 1; centerImage(spec); }
  }

  function drawStage() {
    var stage = $('pk-stage');
    var ctx = stage.getContext('2d');
    if (!img) {
      ctx.fillStyle = '#e6ebf1';
      ctx.fillRect(0, 0, stage.width, stage.height);
      return;
    }
    var spec = currentSpec();
    clampOffsets(spec);
    var d = drawSize(spec);
    var k = stage.width / spec.wPx;
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, stage.width, stage.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, ox * k, oy * k, d.w * k, d.h * k);
  }

  // drag to reposition
  (function () {
    var stage = $('pk-stage');
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

  $('pk-zoom').addEventListener('input', function () {
    if (!img) return;
    var spec = currentSpec();
    var before = drawSize(spec);
    zoom = parseFloat($('pk-zoom').value);
    var after = drawSize(spec);
    // keep the stage centre anchored while zooming
    ox -= (after.w - before.w) / 2;
    oy -= (after.h - before.h) / 2;
    drawStage();
  });

  function setStatus(msg, kind) {
    var el = $('pk-status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function loadFile(file) {
    if (!file) return;
    var url = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function () {
      img = image;
      zoom = 1; $('pk-zoom').value = 1;
      var spec = currentSpec();
      centerImage(spec);
      $('pk-stage-empty').style.display = 'none';
      $('pk-info').textContent = file.name + ' — ' + img.width + '×' + img.height + ' px, ' + fmtKB(file.size);
      $('pk-btn').disabled = false;
      State.lastResult = null; State.lastError = null;
      $('pk-result-wrap').hidden = true;
      setStatus('');
      drawStage();
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      setStatus('That file could not be read as an image.', 'error');
    };
    image.src = url;
  }
  $('pk-file').addEventListener('change', function (e) { loadFile(e.target.files[0]); });
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
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    var d = drawSize(spec);
    ctx.drawImage(img, ox, oy, d.w, d.h);
    return c;
  }

  $('pk-btn').addEventListener('click', async function () {
    var spec = currentSpec();
    var invalid = Core.validateSpec(spec);
    if (invalid) { setStatus('✗ ' + invalid, 'error'); return; }
    if (!img) return;
    $('pk-btn').disabled = true;
    setStatus('Working…');
    State.lastResult = null; State.lastError = null;
    try {
      var out = renderOutputCanvas(spec);
      var encodeAtQuality = function (q) { return canvasToJpegBytes(out, q); };
      var r = await Core.encodeToRangeFixedDims(encodeAtQuality, spec);
      var rangeTxt = (spec.minKB ? spec.minKB + '–' : '≤') + spec.maxKB + ' KB';
      if (!r.ok) {
        $('pk-result-wrap').hidden = true;
        State.lastError = r;
        if (r.reason === 'below-min') {
          setStatus('✗ This image is too small or too plain to reach the ' + spec.minKB + ' KB minimum honestly: at full quality it makes only ' + fmtKB(r.sizeBytes) + '. Filling the rest would take more than ' + Core.PAD_RATIO_LIMIT + '× padding, which forms that re-encode would strip away — the file would fall under the minimum again. Please use the original full-size photo, not a thumbnail, screenshot or chat-app copy.', 'error');
        } else {
          setStatus('✗ Even at the lowest quality, this photo is ' + fmtKB(r.sizeBytes) + ' at ' + spec.wPx + '×' + spec.hPx + ' px — over the ' + spec.maxKB + ' KB maximum. Try a cleaner, less noisy original (avoid high-ISO night shots), or raise the maximum KB if your notice allows it.', 'error');
        }
        return;
      }
      var blob = new Blob([r.bytes], { type: 'image/jpeg' });
      var dl = $('pk-download');
      if (dl._url) URL.revokeObjectURL(dl._url);
      dl._url = URL.createObjectURL(blob);
      dl.href = dl._url;
      dl.download = 'pakistan-photo-' + spec.id + '.jpg';
      dl.textContent = '⬇ Download pakistan-photo-' + spec.id + '.jpg';
      var ri = $('pk-result-img');
      if (ri._url) URL.revokeObjectURL(ri._url);
      ri._url = URL.createObjectURL(blob);
      ri.src = ri._url;
      $('pk-result-info').textContent = spec.wPx + ' × ' + spec.hPx + ' px · ' + fmtKB(r.sizeBytes) + ' · required window ' + rangeTxt;
      $('pk-result-wrap').hidden = false;
      var msg = '✓ ' + fmtKB(r.sizeBytes) + ' — inside the required ' + rangeTxt + ' window · ' + spec.wPx + ' × ' + spec.hPx + ' px';
      if (r.paddedBytes > 0) msg += ' · minimum reached with standard JPEG padding (' + fmtKB(r.paddedBytes) + '), picture itself unchanged';
      setStatus(msg, 'ok');
      State.lastResult = { bytes: r.bytes, quality: r.quality, sizeBytes: r.sizeBytes, paddedBytes: r.paddedBytes, spec: spec, bg: bgId };
    } catch (err) {
      setStatus('✗ Something went wrong: ' + err.message, 'error');
      State.lastError = { reason: 'exception', note: String(err && err.message || err) };
    } finally {
      $('pk-btn').disabled = false;
    }
  });

  buildPresets();
  buildBackgrounds();
  drawStage();
})();
