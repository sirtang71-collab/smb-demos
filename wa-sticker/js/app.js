'use strict';
/* WhatsApp Sticker Maker — all processing local in the browser.
   AI cutout: MediaPipe Selfie Segmenter (WASM, vendored) — the exact
   engine + composition verified in cpns-kit (see its QC.md): the model
   mask is binary, person = 0, background = 255, and the matte MUST be
   written into the ALPHA channel ('destination-in' reads only alpha).
   Size fitting + STORE zip: js/core.js (window.WAStickerCore). */
(function () {
  var Core = window.WAStickerCore;
  var KB = Core.KB;
  var STICKER_PX = Core.SPECS.sticker.px;      // 512
  var STICKER_CAP = Core.SPECS.sticker.capBytes; // 100 KB
  var TRAY_PX = Core.SPECS.tray.px;            // 96
  var TRAY_CAP = Core.SPECS.tray.capBytes;     // 50 KB

  function $(id) { return document.getElementById(id); }
  function setStatus(msg, isError) {
    var el = $('status');
    el.textContent = msg || '';
    el.className = 'status' + (isError ? ' error' : '');
  }
  function fmtKB(bytes) { return (bytes / KB).toFixed(1) + ' KB'; }

  // Results — also read by the QC harness for verification.
  var state = { items: [], lastZip: null };
  window.WASticker = state;

  /* ---------- helpers ---------- */
  function imgFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Could not read image: ' + file.name)); };
      img.src = url;
    });
  }
  function canvasToBlobBytes(canvas, type, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (!blob) { reject(new Error('Encode failed (' + type + ').')); return; }
        blob.arrayBuffer().then(function (buf) { resolve(new Uint8Array(buf)); }, reject);
      }, type, quality);
    });
  }
  function setDownload(linkEl, bytes, mime) {
    var blob = new Blob([bytes], { type: mime });
    if (linkEl._url) URL.revokeObjectURL(linkEl._url);
    linkEl._url = URL.createObjectURL(blob);
    linkEl.href = linkEl._url;
    linkEl.hidden = false;
    return linkEl._url;
  }
  // Read a produced blob back and confirm its real pixel dimensions.
  function decodeDims(bytes, mime) {
    var blob = new Blob([bytes], { type: mime });
    if (window.createImageBitmap) {
      return createImageBitmap(blob).then(function (bmp) {
        var d = { w: bmp.width, h: bmp.height };
        if (bmp.close) bmp.close();
        return d;
      });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  /* ---------- MediaPipe Selfie Segmenter (vendored, as in cpns-kit) ---------- */
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

  // Segment a source canvas -> same-size RGBA canvas, alpha = person matte.
  async function alphaCanvasFrom(sourceCanvas) {
    var segmenter = await getSegmenter();
    var result = segmenter.segment(sourceCanvas);
    if (!result || !result.categoryMask) throw new Error('Segmentation produced no mask.');
    var mask = result.categoryMask.getAsUint8Array();
    var W = sourceCanvas.width, H = sourceCanvas.height;
    if (mask.length !== W * H) throw new Error('Mask size mismatch: ' + mask.length + ' vs ' + (W * H));
    var small = document.createElement('canvas');
    small.width = W; small.height = H;
    var sctx = small.getContext('2d');
    var imgData = sctx.createImageData(W, H);
    for (var j = 0; j < W * H; j += 1) {
      var a = mask[j] === 0 ? 255 : 0; // this model: person = 0, background = 255
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

  /* ---------- sticker composition ---------- */
  // Draw the loaded image into a working canvas (max dim 1024) — also the
  // segmentation input size used by cpns-kit.
  function workingCanvas(img) {
    var maxDim = 1024;
    var sc = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * sc));
    c.height = Math.max(1, Math.round(img.naturalHeight * sc));
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // Bounding box of pixels with alpha > threshold; null if none.
  function alphaBBox(canvas) {
    var ctx = canvas.getContext('2d');
    var data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    var minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
    for (var y = 0; y < canvas.height; y += 1) {
      for (var x = 0; x < canvas.width; x += 1) {
        if (data[(y * canvas.width + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // Trim the subject and centre it on a transparent 512x512 canvas with
  // the requested margin fraction (of 512) kept free on every side.
  function composeSticker(subjectCanvas, paddingFrac) {
    var bbox = alphaBBox(subjectCanvas);
    if (!bbox) throw new Error('No visible subject found in the image.');
    var avail = STICKER_PX * (1 - 2 * paddingFrac);
    var scale = Math.min(avail / bbox.w, avail / bbox.h);
    var dw = bbox.w * scale, dh = bbox.h * scale;
    var out = document.createElement('canvas');
    out.width = STICKER_PX; out.height = STICKER_PX;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(subjectCanvas, bbox.x, bbox.y, bbox.w, bbox.h,
      (STICKER_PX - dw) / 2, (STICKER_PX - dh) / 2, dw, dh);
    return out;
  }

  // Re-render a 512 canvas through a smaller intermediate (softens
  // high-frequency noise) — fallback when even min WebP quality overflows.
  function softened(canvas, innerPx) {
    var small = document.createElement('canvas');
    small.width = innerPx; small.height = innerPx;
    var sctx = small.getContext('2d');
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(canvas, 0, 0, innerPx, innerPx);
    var out = document.createElement('canvas');
    out.width = STICKER_PX; out.height = STICKER_PX;
    var ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, STICKER_PX, STICKER_PX);
    return out;
  }

  // Encode to WebP <= 100 KB at fixed 512x512; soften-and-retry if needed.
  async function encodeSticker(canvas) {
    var candidates = [canvas, null, null];
    var ladder = [0, 384, 256];
    for (var i = 0; i < ladder.length; i += 1) {
      var c = i === 0 ? canvas : softened(canvas, ladder[i]);
      candidates[i] = c;
      var fitted = await Core.encodeUnderCapFixedDims(function (q) {
        return canvasToBlobBytes(c, 'image/webp', q);
      }, STICKER_CAP);
      if (!fitted.over) return { bytes: fitted.bytes, quality: fitted.quality, sizeBytes: fitted.sizeBytes, over: false, softenedTo: ladder[i] };
      if (i === ladder.length - 1) return { bytes: fitted.bytes, quality: fitted.quality, sizeBytes: fitted.sizeBytes, over: true, softenedTo: ladder[i] };
    }
  }

  // Tray icon: 96x96 PNG from the composed sticker canvas.
  async function encodeTrayIcon(stickerCanvas) {
    var c = document.createElement('canvas');
    c.width = TRAY_PX; c.height = TRAY_PX;
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(stickerCanvas, 0, 0, TRAY_PX, TRAY_PX);
    var bytes = await canvasToBlobBytes(c, 'image/png');
    return { bytes: bytes, sizeBytes: bytes.length, over: bytes.length > TRAY_CAP };
  }

  /* ---------- queue + UI ---------- */
  var queue = []; // File objects
  var usedNames = {};

  function uniqueBase(name) {
    var base = Core.sanitizeBaseName(name);
    if (!usedNames[base]) { usedNames[base] = 1; return base; }
    usedNames[base] += 1;
    return base + '-' + usedNames[base];
  }

  $('file-input').addEventListener('change', function (e) {
    Array.prototype.forEach.call(e.target.files, function (f) { queue.push(f); });
    e.target.value = '';
    $('make-btn').disabled = queue.length < 1;
    setStatus(queue.length + ' photo(s) ready. Adjust options, then tap “Make stickers”.');
  });
  var dz = $('drop-zone');
  ['dragover', 'dragenter'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('dragover'); });
  });
  dz.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    Array.prototype.forEach.call(files, function (f) { if (f.type.indexOf('image/') === 0) queue.push(f); });
    $('make-btn').disabled = queue.length < 1;
    setStatus(queue.length + ' photo(s) ready. Adjust options, then tap “Make stickers”.');
  });
  $('padding').addEventListener('input', function (e) {
    $('padding-val').textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
  });

  function addItemRow(item) {
    var li = document.createElement('li');
    var img = document.createElement('img');
    img.className = 'thumb';
    img.alt = item.name;
    var blob = new Blob([item.stickerBytes], { type: 'image/webp' });
    img.src = URL.createObjectURL(blob);
    li.appendChild(img);

    var meta = document.createElement('div');
    meta.className = 'meta';
    var fname = document.createElement('div');
    fname.className = 'fname'; fname.textContent = item.name;
    var finfo = document.createElement('div');
    finfo.className = 'finfo';
    finfo.textContent =
      'Sticker: ' + item.w + '×' + item.h + ' WebP · ' + fmtKB(item.stickerSize) + ' / 100 KB' +
      ' · quality ' + Math.round(item.quality * 100) + '%' +
      (item.mode === 'cutout' ? ' · AI cutout' : ' · original') +
      '\nTray icon: 96×96 PNG · ' + fmtKB(item.traySize) + ' / 50 KB';
    finfo.style.whiteSpace = 'pre-line';
    meta.appendChild(fname); meta.appendChild(finfo);
    if (item.over || item.trayOver) {
      var warn = document.createElement('div');
      warn.className = 'warn';
      warn.textContent = '⚠ Still over the WhatsApp limit — try a simpler photo.';
      meta.appendChild(warn);
    }
    li.appendChild(meta);

    var links = document.createElement('div');
    links.className = 'links';
    var a1 = document.createElement('a');
    a1.className = 'download small'; a1.textContent = '⬇ Sticker';
    a1.download = item.base + '.webp';
    setDownload(a1, item.stickerBytes, 'image/webp');
    var a2 = document.createElement('a');
    a2.className = 'download small tray'; a2.textContent = '⬇ Tray icon';
    a2.download = item.base + '-tray.png';
    setDownload(a2, item.trayBytes, 'image/png');
    links.appendChild(a1); links.appendChild(a2);
    li.appendChild(links);
    $('item-list').appendChild(li);
  }

  $('make-btn').addEventListener('click', async function () {
    var btn = $('make-btn');
    var mode = document.querySelector('input[name="mode"]:checked').value;
    var padding = parseFloat($('padding').value);
    btn.disabled = true;
    try {
      for (var i = 0; i < queue.length; i += 1) {
        var file = queue[i];
        setStatus('Processing ' + (i + 1) + '/' + queue.length + ': ' + file.name +
          (mode === 'cutout' ? ' (loading the AI model can take a moment the first time…)' : '…'));
        var img = await imgFromFile(file);
        var work = workingCanvas(img);
        var subject = work;
        if (mode === 'cutout') subject = await alphaCanvasFrom(work);
        var composed = composeSticker(subject, padding);
        var enc = await encodeSticker(composed);
        var dims = await decodeDims(enc.bytes, 'image/webp');
        var tray = await encodeTrayIcon(composed);
        var item = {
          name: file.name, base: uniqueBase(file.name), mode: mode,
          stickerBytes: enc.bytes, stickerSize: enc.sizeBytes, quality: enc.quality,
          over: enc.over, softenedTo: enc.softenedTo, w: dims.w, h: dims.h,
          trayBytes: tray.bytes, traySize: tray.sizeBytes, trayOver: tray.over,
        };
        state.items.push(item);
        addItemRow(item);
      }
      queue = [];
      // Zip: every sticker + the first photo's tray icon as tray-icon.png.
      if (state.items.length) {
        var entries = state.items.map(function (it) {
          return { name: it.base + '.webp', bytes: it.stickerBytes };
        });
        entries.push({ name: 'tray-icon.png', bytes: state.items[0].trayBytes });
        var zipBytes = Core.createZipStore(entries);
        setDownload($('zip-download'), zipBytes, 'application/zip');
        $('zip-wrap').hidden = false;
        state.lastZip = { sizeBytes: zipBytes.length, count: entries.length, bytes: zipBytes };
      }
      var overCount = state.items.filter(function (it) { return it.over || it.trayOver; }).length;
      setStatus('Done — ' + state.items.length + ' sticker(s) ready below.' +
        (overCount ? ' ' + overCount + ' item(s) could not fit the WhatsApp limit (marked ⚠).' : ' All within WhatsApp limits.'), overCount > 0);
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    } finally {
      btn.disabled = queue.length < 1;
    }
  });
})();
