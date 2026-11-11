'use strict';
/* PDF Toolbox — all processing is local, powered by pdf-lib (vendored). */
(function () {
  var PDFLib = window.PDFLib;
  var PDFDocument = PDFLib.PDFDocument;
  var degrees = PDFLib.degrees;

  /* ---------- core functions (also used by the automated QC harness) ---------- */

  // Parse "1-3,5,8-10" (1-based) into sorted-unique-preserving-order 0-based indices.
  function parseRanges(str, totalPages) {
    var out = [];
    var seen = {};
    var parts = String(str).split(',');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) continue;
      var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
      var a, b;
      if (m) { a = parseInt(m[1], 10); b = parseInt(m[2], 10); }
      else if (/^\d+$/.test(part)) { a = b = parseInt(part, 10); }
      else throw new Error('Invalid page range: "' + part + '"');
      if (a < 1 || b > totalPages || a > b) {
        throw new Error('Page range "' + part + '" is out of bounds (document has ' + totalPages + ' pages).');
      }
      for (var p = a; p <= b; p++) {
        if (!seen[p]) { seen[p] = true; out.push(p - 1); }
      }
    }
    if (!out.length) throw new Error('No pages selected.');
    return out;
  }

  async function mergePdfs(buffers) {
    var out = await PDFDocument.create();
    for (var i = 0; i < buffers.length; i++) {
      var src = await PDFDocument.load(buffers[i], { ignoreEncryption: true });
      var pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(function (pg) { out.addPage(pg); });
    }
    return out.save();
  }

  async function extractPages(buffer, rangeStr) {
    var src = await PDFDocument.load(buffer, { ignoreEncryption: true });
    var idx = parseRanges(rangeStr, src.getPageCount());
    var out = await PDFDocument.create();
    var pages = await out.copyPages(src, idx);
    pages.forEach(function (pg) { out.addPage(pg); });
    return { bytes: await out.save(), pages: idx.map(function (n) { return n + 1; }) };
  }

  async function imagesToPdf(images) {
    // images: [{ buffer, type: 'jpg' | 'png' }]
    var out = await PDFDocument.create();
    var A4 = { w: 595.28, h: 841.89 };
    var MARGIN = 36;
    for (var i = 0; i < images.length; i++) {
      var img = images[i].type === 'png'
        ? await out.embedPng(images[i].buffer)
        : await out.embedJpg(images[i].buffer);
      var landscape = img.width > img.height;
      var pw = landscape ? A4.h : A4.w;
      var ph = landscape ? A4.w : A4.h;
      var scale = Math.min((pw - MARGIN * 2) / img.width, (ph - MARGIN * 2) / img.height, 1);
      var w = img.width * scale, h = img.height * scale;
      var page = out.addPage([pw, ph]);
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    return out.save();
  }

  async function rotatePdf(buffer, rangeStr, angleDeg) {
    var doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    var total = doc.getPageCount();
    var idx = (rangeStr && String(rangeStr).trim())
      ? parseRanges(rangeStr, total)
      : doc.getPageIndices();
    idx.forEach(function (i) {
      var page = doc.getPage(i);
      var current = page.getRotation().angle || 0;
      page.setRotation(degrees((current + angleDeg) % 360));
    });
    return { bytes: await doc.save(), pages: idx.map(function (n) { return n + 1; }) };
  }

  async function countPages(buffer) {
    var doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    return doc.getPageCount();
  }

  window.PDFToolbox = {
    parseRanges: parseRanges,
    mergePdfs: mergePdfs,
    extractPages: extractPages,
    imagesToPdf: imagesToPdf,
    rotatePdf: rotatePdf,
    countPages: countPages
  };

  /* ---------- UI ---------- */
  function $(id) { return document.getElementById(id); }
  function setStatus(el, msg, isError) {
    el.textContent = msg || '';
    el.className = 'status' + (isError ? ' error' : '');
  }
  function makeDownload(linkEl, bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/pdf' });
    if (linkEl._url) URL.revokeObjectURL(linkEl._url);
    linkEl._url = URL.createObjectURL(blob);
    linkEl.href = linkEl._url;
    linkEl.download = filename;
    linkEl.hidden = false;
  }

  // Tabs
  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.tool').forEach(function (s) { s.classList.remove('active'); });
      tab.classList.add('active');
      $('tool-' + tab.dataset.tool).classList.add('active');
    });
  });

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

  /* Merge */
  var mergeFiles = [];
  var renderMerge = fileListUI($('merge-list'), mergeFiles, function () {
    $('merge-btn').disabled = mergeFiles.length < 2;
  });
  $('merge-input').addEventListener('change', function (e) {
    Array.prototype.forEach.call(e.target.files, function (f) { mergeFiles.push(f); });
    e.target.value = '';
    renderMerge();
    $('merge-btn').disabled = mergeFiles.length < 2;
    setStatus($('merge-status'), mergeFiles.length ? mergeFiles.length + ' file(s) ready. Use ↑ ↓ to reorder.' : '');
  });
  $('merge-btn').addEventListener('click', async function () {
    var st = $('merge-status');
    try {
      setStatus(st, 'Merging…');
      var buffers = [];
      for (var i = 0; i < mergeFiles.length; i++) buffers.push(await mergeFiles[i].arrayBuffer());
      var bytes = await mergePdfs(buffers);
      var n = await countPages(bytes);
      makeDownload($('merge-download'), bytes, 'merged.pdf');
      setStatus(st, 'Done — merged.pdf has ' + n + ' pages.');
    } catch (err) { setStatus(st, 'Error: ' + err.message, true); }
  });

  /* Split */
  var splitFile = null;
  $('split-input').addEventListener('change', async function (e) {
    splitFile = e.target.files[0] || null;
    $('split-name').textContent = splitFile ? splitFile.name : '';
    $('split-pages').textContent = '';
    $('split-btn').disabled = !splitFile;
    if (splitFile) {
      try {
        var n = await countPages(await splitFile.arrayBuffer());
        $('split-pages').textContent = 'This PDF has ' + n + ' pages.';
      } catch (err) { setStatus($('split-status'), 'Error reading PDF: ' + err.message, true); }
    }
  });
  $('split-btn').addEventListener('click', async function () {
    var st = $('split-status');
    try {
      setStatus(st, 'Extracting…');
      var res = await extractPages(await splitFile.arrayBuffer(), $('split-ranges').value);
      makeDownload($('split-download'), res.bytes, 'extracted.pdf');
      setStatus(st, 'Done — extracted page(s) ' + res.pages.join(', ') + ' into extracted.pdf (' + res.pages.length + ' pages).');
    } catch (err) { setStatus(st, 'Error: ' + err.message, true); }
  });

  /* Images */
  var imageFiles = [];
  var renderImages = fileListUI($('images-list'), imageFiles, function () {
    $('images-btn').disabled = imageFiles.length < 1;
  });
  $('images-input').addEventListener('change', function (e) {
    Array.prototype.forEach.call(e.target.files, function (f) { imageFiles.push(f); });
    e.target.value = '';
    renderImages();
    $('images-btn').disabled = imageFiles.length < 1;
    setStatus($('images-status'), imageFiles.length ? imageFiles.length + ' image(s) ready. Use ↑ ↓ to reorder.' : '');
  });
  $('images-btn').addEventListener('click', async function () {
    var st = $('images-status');
    try {
      setStatus(st, 'Creating PDF…');
      var images = [];
      for (var i = 0; i < imageFiles.length; i++) {
        var f = imageFiles[i];
        var type = (f.type === 'image/png' || /\.png$/i.test(f.name)) ? 'png' : 'jpg';
        images.push({ buffer: await f.arrayBuffer(), type: type });
      }
      var bytes = await imagesToPdf(images);
      makeDownload($('images-download'), bytes, 'images.pdf');
      setStatus(st, 'Done — images.pdf has ' + images.length + ' page(s).');
    } catch (err) { setStatus(st, 'Error: ' + err.message, true); }
  });

  /* Rotate */
  var rotateFile = null;
  $('rotate-input').addEventListener('change', async function (e) {
    rotateFile = e.target.files[0] || null;
    $('rotate-name').textContent = rotateFile ? rotateFile.name : '';
    $('rotate-pages').textContent = '';
    $('rotate-btn').disabled = !rotateFile;
    if (rotateFile) {
      try {
        var n = await countPages(await rotateFile.arrayBuffer());
        $('rotate-pages').textContent = 'This PDF has ' + n + ' pages.';
      } catch (err) { setStatus($('rotate-status'), 'Error reading PDF: ' + err.message, true); }
    }
  });
  $('rotate-btn').addEventListener('click', async function () {
    var st = $('rotate-status');
    try {
      setStatus(st, 'Rotating…');
      var angle = parseInt($('rotate-angle').value, 10);
      var res = await rotatePdf(await rotateFile.arrayBuffer(), $('rotate-ranges').value, angle);
      makeDownload($('rotate-download'), res.bytes, 'rotated.pdf');
      setStatus(st, 'Done — rotated page(s) ' + res.pages.join(', ') + ' by ' + angle + '° into rotated.pdf.');
    } catch (err) { setStatus(st, 'Error: ' + err.message, true); }
  });
})();
