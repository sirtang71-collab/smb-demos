'use strict';
/* Exam Photo + Signature Studio — all processing is local.
   Logic (presets, range fitting, JPEG padding, signature cleanup,
   combined layout): js/core.js. */
(function () {
  var Core = window.ExamSignCore;
  var KB = Core.KB;

  function $(id) { return document.getElementById(id); }
  function fmtKB(bytes) { return (bytes / KB).toFixed(1) + ' KB'; }

  // Last export per panel, also read by the QC harness.
  var State = { photo: null, sig: null, combined: null, photoError: null, sigError: null, combinedError: null };
  window.ExamSign = State;

  function canvasToJpegBytes(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('JPEG encode failed.')); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
      }, 'image/jpeg', quality);
    });
  }

  /* ================= one crop panel (photo or signature) =================
     A panel = preset cards + KB window inputs + file drop + drag/zoom
     stage + export button + result area. The photo and signature
     sections share everything except presets and the signature
     cleanup step. */
  function makePanel(cfg) {
    var P = {
      cfg: cfg,
      selectedId: cfg.presets[0].id,
      img: null, zoom: 1, ox: 0, oy: 0,
      lastSpec: null,
    };

    function specLabel(s) {
      var range = (s.minKB ? s.minKB + '–' : '≤') + s.maxKB + ' KB';
      return s.wPx + '×' + s.hPx + ' px · ' + range;
    }

    function buildPresets() {
      var list = $(cfg.prefix + '-preset-list');
      cfg.presets.forEach(function (p) { list.appendChild(card(p.id, p.name, specLabel(p))); });
      list.appendChild(card('custom', 'Custom — my form is not listed', 'Set your own pixel size and KB window'));
      selectPreset(P.selectedId);
    }
    function card(id, name, spec) {
      var label = document.createElement('label');
      label.className = 'preset-card';
      label.dataset.preset = id;
      var input = document.createElement('input');
      input.type = 'radio'; input.name = cfg.prefix + '-preset'; input.value = id;
      var nm = document.createElement('span'); nm.className = 'pname'; nm.textContent = name;
      var sp = document.createElement('span'); sp.className = 'pspec'; sp.textContent = spec;
      label.appendChild(input); label.appendChild(nm); label.appendChild(sp);
      input.addEventListener('change', function () { selectPreset(id); });
      return label;
    }
    function selectPreset(id) {
      P.selectedId = id;
      var cards = $(cfg.prefix + '-preset-list').querySelectorAll('.preset-card');
      cards.forEach(function (c) {
        var on = c.dataset.preset === id;
        c.classList.toggle('selected', on);
        c.querySelector('input').checked = on;
      });
      $(cfg.prefix + '-custom-fields').hidden = id !== 'custom';
      var p = cfg.presets.find(function (x) { return x.id === id; });
      $(cfg.prefix + '-preset-note').textContent = p ? p.note
        : 'Custom size: the exported file will have exactly these pixel dimensions and must land inside your KB window.';
      if (p) {
        $(cfg.prefix + '-min').value = p.minKB == null ? '' : p.minKB;
        $(cfg.prefix + '-max').value = p.maxKB;
        $(cfg.prefix + '-cu-w').value = p.wPx;
        $(cfg.prefix + '-cu-h').value = p.hPx;
      }
      resetStageAspect();
      drawStage();
      updateCombined();
    }

    function currentSpec() {
      var min = parseFloat($(cfg.prefix + '-min').value);
      var kb = {
        minKB: isNaN(min) || min === 0 ? null : min,
        maxKB: parseFloat($(cfg.prefix + '-max').value),
      };
      if (P.selectedId !== 'custom') {
        var p = cfg.presets.find(function (x) { return x.id === P.selectedId; });
        return Object.assign({ id: p.id, wPx: p.wPx, hPx: p.hPx }, kb);
      }
      return Object.assign({
        id: 'custom',
        wPx: parseInt($(cfg.prefix + '-cu-w').value, 10),
        hPx: parseInt($(cfg.prefix + '-cu-h').value, 10),
      }, kb);
    }
    P.currentSpec = currentSpec;

    [cfg.prefix + '-cu-w', cfg.prefix + '-cu-h', cfg.prefix + '-min', cfg.prefix + '-max'].forEach(function (id) {
      $(id).addEventListener('input', function () { resetStageAspect(); drawStage(); updateCombined(); });
    });

    /* ----- crop stage ----- */
    function fitScale(spec) { return Math.max(spec.wPx / P.img.width, spec.hPx / P.img.height); }
    function drawSize(spec) {
      var s = fitScale(spec) * P.zoom;
      return { w: P.img.width * s, h: P.img.height * s };
    }
    function clampOffsets(spec) {
      var d = drawSize(spec);
      P.ox = Math.min(0, Math.max(spec.wPx - d.w, P.ox));
      P.oy = Math.min(0, Math.max(spec.hPx - d.h, P.oy));
    }
    function centerImage(spec) {
      var d = drawSize(spec);
      P.ox = (spec.wPx - d.w) / 2;
      P.oy = (spec.hPx - d.h) / 2;
    }

    function resetStageAspect() {
      var spec = currentSpec();
      if (!Number.isFinite(spec.wPx) || !Number.isFinite(spec.hPx) || spec.wPx <= 0 || spec.hPx <= 0) return;
      var stage = $(cfg.prefix + '-stage');
      var w = 360, h = Math.round(360 * spec.hPx / spec.wPx);
      if (h > 480) { h = 480; w = Math.round(480 * spec.wPx / spec.hPx); }
      if (w > 360) { w = 360; h = Math.round(360 * spec.hPx / spec.wPx); }
      stage.width = w; stage.height = h;
      $(cfg.prefix + '-stage-wrap').style.width = w + 'px';
      if (P.img) { P.zoom = 1; $(cfg.prefix + '-zoom').value = 1; centerImage(spec); }
    }

    function drawStage() {
      var stage = $(cfg.prefix + '-stage');
      var ctx = stage.getContext('2d');
      ctx.fillStyle = '#e6ebf1';
      ctx.fillRect(0, 0, stage.width, stage.height);
      if (!P.img) return;
      var spec = currentSpec();
      clampOffsets(spec);
      var d = drawSize(spec);
      var k = stage.width / spec.wPx;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, stage.width, stage.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(P.img, P.ox * k, P.oy * k, d.w * k, d.h * k);
    }

    (function () {
      var stage = $(cfg.prefix + '-stage');
      var drag = null;
      stage.addEventListener('pointerdown', function (e) {
        if (!P.img) return;
        drag = { x: e.clientX, y: e.clientY };
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', function (e) {
        if (!drag || !P.img) return;
        var spec = currentSpec();
        var rect = stage.getBoundingClientRect();
        var k = spec.wPx / rect.width;
        P.ox += (e.clientX - drag.x) * k;
        P.oy += (e.clientY - drag.y) * k;
        drag = { x: e.clientX, y: e.clientY };
        drawStage();
      });
      stage.addEventListener('pointerup', function () { drag = null; });
      stage.addEventListener('pointercancel', function () { drag = null; });
    })();

    $(cfg.prefix + '-zoom').addEventListener('input', function () {
      if (!P.img) return;
      var spec = currentSpec();
      var before = drawSize(spec);
      P.zoom = parseFloat($(cfg.prefix + '-zoom').value);
      var after = drawSize(spec);
      P.ox -= (after.w - before.w) / 2;
      P.oy -= (after.h - before.h) / 2;
      drawStage();
    });

    function setStatus(msg, kind) {
      var el = $(cfg.prefix + '-status');
      el.textContent = msg || '';
      el.className = 'status' + (kind ? ' ' + kind : '');
    }
    P.setStatus = setStatus;

    function loadFile(file) {
      if (!file) return;
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        P.img = image;
        P.zoom = 1; $(cfg.prefix + '-zoom').value = 1;
        centerImage(currentSpec());
        $(cfg.prefix + '-stage-empty').style.display = 'none';
        $(cfg.prefix + '-info').textContent = file.name + ' — ' + P.img.width + '×' + P.img.height + ' px, ' + fmtKB(file.size);
        $(cfg.prefix + '-btn').disabled = false;
        State[cfg.key] = null; State[cfg.key + 'Error'] = null;
        $(cfg.prefix + '-result-wrap').hidden = true;
        setStatus('');
        drawStage();
        updateCombined();
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        setStatus('That file could not be read as an image.', 'error');
      };
      image.src = url;
    }
    $(cfg.prefix + '-file').addEventListener('change', function (e) { loadFile(e.target.files[0]); });
    var drop = document.querySelector('#' + cfg.prefix + '-drop');
    ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.toggle('dragover', ev === 'dragover');
        if (ev === 'drop' && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
      });
    });

    /* ----- render + export ----- */
    function renderOutputCanvas(spec) {
      var c = document.createElement('canvas');
      c.width = spec.wPx; c.height = spec.hPx;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var d = drawSize(spec);
      ctx.drawImage(P.img, P.ox, P.oy, d.w, d.h);
      if (cfg.enhance) {
        var idata = ctx.getImageData(0, 0, c.width, c.height);
        Core.enhanceSignature(idata);
        ctx.putImageData(idata, 0, 0);
      }
      return c;
    }
    P.renderOutputCanvas = renderOutputCanvas;

    function showResult(spec, r, fileName) {
      var blob = new Blob([r.bytes], { type: 'image/jpeg' });
      var dl = $(cfg.prefix + '-download');
      if (dl._url) URL.revokeObjectURL(dl._url);
      dl._url = URL.createObjectURL(blob);
      dl.href = dl._url;
      dl.download = fileName;
      dl.textContent = '⬇ Download ' + fileName;
      var ri = $(cfg.prefix + '-result-img');
      if (ri._url) URL.revokeObjectURL(ri._url);
      ri._url = URL.createObjectURL(blob);
      ri.src = ri._url;
      var rangeTxt = (spec.minKB ? spec.minKB + '–' : '≤') + spec.maxKB + ' KB';
      $(cfg.prefix + '-result-info').textContent = spec.wPx + ' × ' + spec.hPx + ' px · ' + fmtKB(r.sizeBytes) + ' · required window ' + rangeTxt;
      $(cfg.prefix + '-result-wrap').hidden = false;
      var msg = '✓ ' + fmtKB(r.sizeBytes) + ' — inside the required ' + rangeTxt + ' window · ' + spec.wPx + ' × ' + spec.hPx + ' px';
      if (r.paddedBytes > 0) msg += ' · minimum reached with standard JPEG padding (' + fmtKB(r.paddedBytes) + '), picture itself unchanged';
      setStatus(msg, 'ok');
    }

    $(cfg.prefix + '-btn').addEventListener('click', async function () {
      var spec = currentSpec();
      var invalid = Core.validateSpec(spec);
      if (invalid) { setStatus('✗ ' + invalid, 'error'); return; }
      if (!P.img) return;
      $(cfg.prefix + '-btn').disabled = true;
      setStatus('Working…');
      State[cfg.key] = null; State[cfg.key + 'Error'] = null;
      try {
        var out = renderOutputCanvas(spec);
        var r = await Core.encodeToRangeFixedDims(function (q) { return canvasToJpegBytes(out, q); }, spec);
        if (!r.ok) {
          $(cfg.prefix + '-result-wrap').hidden = true;
          State[cfg.key + 'Error'] = r;
          if (r.reason === 'below-min') {
            setStatus('✗ This image is too small or too plain to reach the ' + spec.minKB + ' KB minimum honestly: at full quality it makes only ' + fmtKB(r.sizeBytes) + '. Please use the original full-size image, not a thumbnail, screenshot or chat-app copy.', 'error');
          } else {
            setStatus('✗ Even at the lowest quality, this image is ' + fmtKB(r.sizeBytes) + ' at ' + spec.wPx + '×' + spec.hPx + ' px — over the ' + spec.maxKB + ' KB maximum. Try a cleaner, less noisy original.', 'error');
          }
          return;
        }
        P.lastSpec = spec;
        State[cfg.key] = { bytes: r.bytes, quality: r.quality, sizeBytes: r.sizeBytes, paddedBytes: r.paddedBytes, spec: spec };
        showResult(spec, r, cfg.fileStem + '-' + spec.id + '.jpg');
      } catch (err) {
        setStatus('✗ Something went wrong: ' + err.message, 'error');
        State[cfg.key + 'Error'] = { reason: 'exception', note: String(err && err.message || err) };
      } finally {
        $(cfg.prefix + '-btn').disabled = false;
      }
    });

    buildPresets();
    drawStage();
    return P;
  }

  var photoPanel = makePanel({
    prefix: 'ph', key: 'photo', fileStem: 'exam-photo',
    presets: Core.PHOTO_PRESETS, enhance: false,
  });
  var sigPanel = makePanel({
    prefix: 'sg', key: 'sig', fileStem: 'exam-signature',
    presets: Core.SIG_PRESETS, enhance: true,
  });

  /* ================= combined sheet ================= */
  function updateCombined() {
    // Called from panel constructors too, before both panels exist.
    if (typeof photoPanel === 'undefined' || typeof sigPanel === 'undefined') return;
    $('cb-btn').disabled = !(photoPanel.img && sigPanel.img);
  }

  function setCbStatus(msg, kind) {
    var el = $('cb-status');
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  $('cb-btn').addEventListener('click', async function () {
    var ps = photoPanel.currentSpec();
    var ss = sigPanel.currentSpec();
    var bad = Core.validateSpec(ps) || Core.validateSpec(ss);
    if (bad) { setCbStatus('✗ ' + bad, 'error'); return; }
    $('cb-btn').disabled = true;
    setCbStatus('Working…');
    State.combined = null; State.combinedError = null;
    try {
      var layout = Core.combinedLayout(ps, ss);
      var sheet = document.createElement('canvas');
      sheet.width = layout.wPx; sheet.height = layout.hPx;
      var ctx = sheet.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      ctx.drawImage(photoPanel.renderOutputCanvas(ps), layout.photoX, 0);
      ctx.drawImage(sigPanel.renderOutputCanvas(ss), layout.sigX, layout.sigY);
      // Combined sheet: no minimum size — capped at the sum of the two
      // individual maximums, best quality that fits under it.
      var capSpec = { id: 'combined', wPx: layout.wPx, hPx: layout.hPx, minKB: null, maxKB: ps.maxKB + ss.maxKB };
      var r = await Core.encodeToRangeFixedDims(function (q) { return canvasToJpegBytes(sheet, q); }, capSpec);
      if (!r.ok) {
        State.combinedError = r;
        setCbStatus('✗ The combined sheet could not be fitted under ' + capSpec.maxKB + ' KB.', 'error');
        return;
      }
      var blob = new Blob([r.bytes], { type: 'image/jpeg' });
      var dl = $('cb-download');
      if (dl._url) URL.revokeObjectURL(dl._url);
      dl._url = URL.createObjectURL(blob);
      dl.href = dl._url;
      dl.download = 'exam-photo-and-signature.jpg';
      var ri = $('cb-result-img');
      if (ri._url) URL.revokeObjectURL(ri._url);
      ri._url = URL.createObjectURL(blob);
      ri.src = ri._url;
      $('cb-result-info').textContent = layout.wPx + ' × ' + layout.hPx + ' px · ' + fmtKB(r.sizeBytes) + ' · photo on top, signature below';
      $('cb-result-wrap').hidden = false;
      setCbStatus('✓ Combined sheet ready — ' + fmtKB(r.sizeBytes) + ' · ' + layout.wPx + ' × ' + layout.hPx + ' px', 'ok');
      State.combined = { bytes: r.bytes, quality: r.quality, sizeBytes: r.sizeBytes, spec: capSpec, layout: layout };
    } catch (err) {
      setCbStatus('✗ Something went wrong: ' + err.message, 'error');
      State.combinedError = { reason: 'exception', note: String(err && err.message || err) };
    } finally {
      updateCombined();
    }
  });

  updateCombined();
})();
