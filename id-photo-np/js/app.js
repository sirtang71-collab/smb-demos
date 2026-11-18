'use strict';
/* Nepal Lok Sewa Photo & Signature Maker — all processing is local.
   Logic (presets, range fitting, JPEG padding): js/core.js.
   Two independent crop stages share one factory: the photo stage
   (350x450 px, 20-50 KB) and the signature stage (350x100 px,
   10-50 KB). Background is always plain white: the canvas is filled
   white first, which is what shows where an uploaded image has
   transparent areas (PNG). This tool does NOT cut out or replace the
   background inside the photo itself — take the photo against a white
   background first.
   The signature minimum is the point of this tool: a thin signature on
   clean white paper compresses to 2-3 KB, below the portal minimum,
   and gets rejected. When the export is below the minimum, the tool
   grows the file with standard JPEG COM padding — the picture does not
   change at all — and the status message says so. */
(function () {
  var Core = window.NpPhotoCore;
  var KB = Core.KB;
  var BG = '#ffffff';

  function $(id) { return document.getElementById(id); }
  function fmtKB(bytes) { return (bytes / KB).toFixed(1) + ' KB'; }

  // Last export per stage, also read by the QC harness.
  var State = {
    photo: { lastResult: null, lastError: null },
    sig: { lastResult: null, lastError: null },
  };
  window.NpPhoto = State;

  function canvasToJpegBytes(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('JPEG encode failed.')); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
      }, 'image/jpeg', quality);
    });
  }

  /* ---------- one crop stage (photo or signature) ----------
     cfg: { pfx, getSpec, downloadName, emptyText } */
  function makeStage(cfg) {
    var p = cfg.pfx; // element id prefix: 'np' or 'sg'
    var img = null;
    var zoom = 1, ox = 0, oy = 0; // offsets in OUTPUT pixel coordinates

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
      var spec = cfg.getSpec();
      if (!Number.isFinite(spec.wPx) || !Number.isFinite(spec.hPx) || spec.wPx <= 0 || spec.hPx <= 0) return;
      var stage = $(p + '-stage');
      var w = 360, h = Math.round(360 * spec.hPx / spec.wPx);
      if (h > 480) { h = 480; w = Math.round(480 * spec.wPx / spec.hPx); }
      if (h < 80) { h = 80; w = Math.round(80 * spec.wPx / spec.hPx); }
      stage.width = w; stage.height = h;
      $(p + '-stage-wrap').style.width = w + 'px';
      if (img) { zoom = 1; $(p + '-zoom').value = 1; centerImage(spec); }
    }

    function drawStage() {
      var stage = $(p + '-stage');
      var ctx = stage.getContext('2d');
      ctx.fillStyle = '#e6ebf1';
      ctx.fillRect(0, 0, stage.width, stage.height);
      if (!img) return;
      var spec = cfg.getSpec();
      clampOffsets(spec);
      var d = drawSize(spec);
      var k = stage.width / spec.wPx;
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, stage.width, stage.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, ox * k, oy * k, d.w * k, d.h * k);
    }

    // drag to reposition
    (function () {
      var stage = $(p + '-stage');
      var drag = null;
      stage.addEventListener('pointerdown', function (e) {
        if (!img) return;
        drag = { x: e.clientX, y: e.clientY };
        stage.setPointerCapture(e.pointerId);
      });
      stage.addEventListener('pointermove', function (e) {
        if (!drag || !img) return;
        var spec = cfg.getSpec();
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

    $(p + '-zoom').addEventListener('input', function () {
      if (!img) return;
      var spec = cfg.getSpec();
      var before = drawSize(spec);
      zoom = parseFloat($(p + '-zoom').value);
      var after = drawSize(spec);
      ox -= (after.w - before.w) / 2;
      oy -= (after.h - before.h) / 2;
      drawStage();
    });

    function setStatus(msg, kind) {
      var el = $(p + '-status');
      el.textContent = msg || '';
      el.className = 'status' + (kind ? ' ' + kind : '');
    }

    function loadFile(file) {
      if (!file) return;
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        img = image;
        zoom = 1; $(p + '-zoom').value = 1;
        var spec = cfg.getSpec();
        centerImage(spec);
        $(p + '-stage-empty').style.display = 'none';
        $(p + '-info').textContent = file.name + ' — ' + img.width + '×' + img.height + ' px, ' + fmtKB(file.size);
        $(p + '-btn').disabled = false;
        State[cfg.key].lastResult = null; State[cfg.key].lastError = null;
        $(p + '-result-wrap').hidden = true;
        setStatus('');
        drawStage();
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        setStatus('That file could not be read as an image.', 'error');
      };
      image.src = url;
    }
    $(p + '-file').addEventListener('change', function (e) { loadFile(e.target.files[0]); });
    var drop = document.querySelector('#' + p + '-drop');
    ['dragover', 'dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.toggle('dragover', ev === 'dragover');
        if (ev === 'drop' && e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
      });
    });

    function renderOutputCanvas(spec) {
      var c = document.createElement('canvas');
      c.width = spec.wPx; c.height = spec.hPx;
      var ctx = c.getContext('2d');
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      var d = drawSize(spec);
      ctx.drawImage(img, ox, oy, d.w, d.h);
      return c;
    }

    $(p + '-btn').addEventListener('click', async function () {
      var spec = cfg.getSpec();
      var invalid = Core.validateSpec(spec);
      if (invalid) { setStatus('✗ ' + invalid, 'error'); return; }
      if (!img) return;
      $(p + '-btn').disabled = true;
      setStatus('Working…');
      State[cfg.key].lastResult = null; State[cfg.key].lastError = null;
      try {
        var out = renderOutputCanvas(spec);
        var encodeAtQuality = function (q) { return canvasToJpegBytes(out, q); };
        var r = await Core.encodeToRangeFixedDims(encodeAtQuality, spec);
        var rangeTxt = (spec.minKB ? spec.minKB + '–' : '≤') + spec.maxKB + ' KB';
        if (!r.ok) {
          $(p + '-result-wrap').hidden = true;
          State[cfg.key].lastError = r;
          if (r.reason === 'below-min') {
            setStatus('✗ This image is too small or too plain to reach the ' + spec.minKB + ' KB minimum honestly: at full quality it makes only ' + fmtKB(r.sizeBytes) + '. Filling the rest would take more than ' + Core.PAD_RATIO_LIMIT + '× padding, which portals that re-encode would strip away — the file would be rejected anyway. Please use the original full-size image, not a thumbnail, screenshot or chat-app copy.', 'error');
          } else {
            setStatus('✗ Even at the lowest quality, this image is ' + fmtKB(r.sizeBytes) + ' at ' + spec.wPx + '×' + spec.hPx + ' px — over the ' + spec.maxKB + ' KB maximum. Try a cleaner, less noisy original (avoid high-ISO night shots).', 'error');
          }
          return;
        }
        var blob = new Blob([r.bytes], { type: 'image/jpeg' });
        var dl = $(p + '-download');
        if (dl._url) URL.revokeObjectURL(dl._url);
        dl._url = URL.createObjectURL(blob);
        dl.href = dl._url;
        dl.download = cfg.downloadName(spec);
        dl.textContent = '⬇ Download ' + cfg.downloadName(spec);
        var ri = $(p + '-result-img');
        if (ri._url) URL.revokeObjectURL(ri._url);
        ri._url = URL.createObjectURL(blob);
        ri.src = ri._url;
        $(p + '-result-info').textContent = spec.wPx + ' × ' + spec.hPx + ' px · ' + fmtKB(r.sizeBytes) + ' · required window ' + rangeTxt;
        $(p + '-result-wrap').hidden = false;
        var msg = '✓ ' + fmtKB(r.sizeBytes) + ' — inside the required ' + rangeTxt + ' window · ' + spec.wPx + ' × ' + spec.hPx + ' px';
        if (r.paddedBytes > 0) msg += ' · minimum reached with standard JPEG padding (' + fmtKB(r.paddedBytes) + '), picture itself unchanged';
        setStatus(msg, 'ok');
        State[cfg.key].lastResult = { bytes: r.bytes, quality: r.quality, sizeBytes: r.sizeBytes, paddedBytes: r.paddedBytes, spec: spec, bg: BG };
      } catch (err) {
        setStatus('✗ Something went wrong: ' + err.message, 'error');
        State[cfg.key].lastError = { reason: 'exception', note: String(err && err.message || err) };
      } finally {
        $(p + '-btn').disabled = false;
      }
    });

    return { resetStageAspect: resetStageAspect, drawStage: drawStage };
  }

  /* ---------- photo stage: presets + custom ---------- */
  var selectedId = Core.PRESETS[0].id;

  function specLabel(s) {
    var range = (s.minKB ? s.minKB + '–' : '≤') + s.maxKB + ' KB';
    return s.wPx + '×' + s.hPx + ' px · ' + range;
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
    $('np-custom-fields').hidden = id !== 'custom';
    var p = Core.PRESETS.find(function (x) { return x.id === id; });
    $('np-preset-note').textContent = p ? p.note : 'Custom size: the exported file will have exactly these pixel dimensions and must land inside your KB window.';
    if (p) {
      $('np-min').value = p.minKB == null ? '' : p.minKB;
      $('np-max').value = p.maxKB;
      $('np-cu-w').value = p.wPx;
      $('np-cu-h').value = p.hPx;
    }
    photoStage.resetStageAspect();
    photoStage.drawStage();
  }
  function photoSpec() {
    var min = parseFloat($('np-min').value);
    var kb = {
      minKB: isNaN(min) || min === 0 ? null : min,
      maxKB: parseFloat($('np-max').value),
    };
    if (selectedId !== 'custom') {
      var p = Core.PRESETS.find(function (x) { return x.id === selectedId; });
      return Object.assign({ id: p.id, wPx: p.wPx, hPx: p.hPx }, kb);
    }
    return Object.assign({
      id: 'custom',
      wPx: parseInt($('np-cu-w').value, 10),
      hPx: parseInt($('np-cu-h').value, 10),
    }, kb);
  }

  var photoStage = makeStage({
    pfx: 'np', key: 'photo', getSpec: photoSpec,
    downloadName: function (spec) { return 'nepal-photo-' + spec.id + '.jpg'; },
  });

  var list = $('np-preset-list');
  Core.PRESETS.forEach(function (p) { list.appendChild(card(p.id, p.name, specLabel(p))); });
  list.appendChild(card('custom', 'Custom — my notice is different', 'Set your own pixel size and KB window'));
  selectPreset(selectedId);
  ['np-cu-w', 'np-cu-h', 'np-min', 'np-max'].forEach(function (id) {
    $(id).addEventListener('input', function () { photoStage.resetStageAspect(); photoStage.drawStage(); });
  });

  /* ---------- signature stage: fixed strip, editable dims/KB ---------- */
  function sigSpec() {
    var min = parseFloat($('sg-min').value);
    return {
      id: Core.SIGNATURE.id,
      wPx: parseInt($('sg-w').value, 10),
      hPx: parseInt($('sg-h').value, 10),
      minKB: isNaN(min) || min === 0 ? null : min,
      maxKB: parseFloat($('sg-max').value),
    };
  }
  $('sg-note').textContent = Core.SIGNATURE.note;
  var sigStage = makeStage({
    pfx: 'sg', key: 'sig', getSpec: sigSpec,
    downloadName: function () { return 'nepal-signature.jpg'; },
  });
  ['sg-w', 'sg-h', 'sg-min', 'sg-max'].forEach(function (id) {
    $(id).addEventListener('input', function () { sigStage.resetStageAspect(); sigStage.drawStage(); });
  });
  sigStage.resetStageAspect();
  sigStage.drawStage();
  photoStage.drawStage();
})();
