// app.js — Image to PDF (image-to-pdf): UI wiring.
// core.js (window.PdfToolCore) owns the PDF writer + layout math;
// this file only moves files in and out of it. JPEGs are embedded
// byte-for-byte; PNGs and other formats are drawn onto a white canvas
// and re-encoded as JPEG (quality 0.92) so transparency becomes white.
(function () {
  'use strict';

  const Core = window.PdfToolCore;
  const $ = (id) => document.getElementById(id);

  const fileInput = $('pdf-files');
  const dropZone = $('drop-zone');
  const infoEl = $('pdf-info');
  const listEl = $('pdf-list');
  const btn = $('pdf-btn');
  const statusEl = $('pdf-status');
  const resultWrap = $('pdf-result-wrap');
  const resultInfo = $('pdf-result-info');
  const downloadEl = $('pdf-download');

  let items = []; // { id, name, width, height, jpegBytes: Uint8Array, thumbUrl, reencoded: bool }
  let nextId = 1;

  const state = { lastResult: null, lastError: null };
  window.PdfTool = state;
  // Harness handle: the live item list (names + dims only, no bytes).
  Object.defineProperty(state, 'items', {
    get: () => items.map((it) => ({ id: it.id, name: it.name, width: it.width, height: it.height, reencoded: it.reencoded })),
  });

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function loadImageDims(blobUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, img });
      img.onerror = () => reject(new Error('could not decode image'));
      img.src = blobUrl;
    });
  }

  function canvasToJpeg(img, width, height) {
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      c.toBlob((blob) => {
        if (!blob) return reject(new Error('JPEG re-encode failed'));
        blob.arrayBuffer().then((ab) => resolve(new Uint8Array(ab))).catch(reject);
      }, 'image/jpeg', 0.92);
    });
  }

  function isJpegBytes(buf) {
    return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus('Adding ' + files.length + ' image(s)…');
    let added = 0;
    for (const file of files) {
      try {
        const ab = await file.arrayBuffer();
        const raw = new Uint8Array(ab);
        const url = URL.createObjectURL(file);
        const { width, height, img } = await loadImageDims(url);
        let jpegBytes = raw;
        let reencoded = false;
        if (!isJpegBytes(raw)) {
          jpegBytes = await canvasToJpeg(img, width, height);
          reencoded = true;
        }
        items.push({
          id: nextId++, name: file.name, width, height,
          jpegBytes, thumbUrl: url, reencoded,
        });
        added++;
      } catch (e) {
        setStatus('Could not add ' + file.name + ': ' + (e && e.message ? e.message : e), 'error');
      }
    }
    renderList();
    if (added) setStatus('');
  }

  function renderList() {
    listEl.innerHTML = '';
    items.forEach((it, idx) => {
      const li = document.createElement('li');
      const thumb = document.createElement('img');
      thumb.className = 'thumb';
      thumb.src = it.thumbUrl;
      thumb.alt = '';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = (idx + 1) + '. ' + it.name;
      const dims = document.createElement('div');
      dims.className = 'dims';
      dims.textContent = it.width + ' × ' + it.height + ' px · page ' + (idx + 1) +
        (it.reencoded ? ' · PNG re-encoded as JPEG (white background)' : ' · JPEG embedded as-is');
      meta.appendChild(name);
      meta.appendChild(dims);
      li.appendChild(thumb);
      li.appendChild(meta);

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'mini';
      up.textContent = '↑';
      up.title = 'Move up';
      up.disabled = idx === 0;
      up.addEventListener('click', () => moveItem(idx, -1));
      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'mini';
      down.textContent = '↓';
      down.title = 'Move down';
      down.disabled = idx === items.length - 1;
      down.addEventListener('click', () => moveItem(idx, 1));
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'mini remove';
      rm.textContent = '✕';
      rm.title = 'Remove';
      rm.addEventListener('click', () => removeItem(idx));
      li.appendChild(up);
      li.appendChild(down);
      li.appendChild(rm);
      listEl.appendChild(li);
    });
    infoEl.textContent = items.length
      ? items.length + ' image(s) — ' + items.length + ' page(s) in the PDF, in this order.'
      : 'No images yet — add at least one to build your PDF.';
    btn.disabled = items.length === 0;
    resultWrap.hidden = true;
  }

  function moveItem(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const tmp = items[idx];
    items[idx] = items[j];
    items[j] = tmp;
    renderList();
  }

  function removeItem(idx) {
    const it = items[idx];
    if (it && it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    items.splice(idx, 1);
    renderList();
  }

  function currentOptions() {
    const orientation = (document.querySelector('input[name="pdf-orient"]:checked') || {}).value || 'portrait';
    const fitMode = (document.querySelector('input[name="pdf-fit"]:checked') || {}).value || 'fit';
    const pageNumbers = $('pdf-numbers').checked;
    return { orientation, fitMode, pageNumbers };
  }

  function buildAndOffer() {
    state.lastResult = null;
    state.lastError = null;
    try {
      const opts = currentOptions();
      const t0 = performance.now();
      const pdfBytes = Core.buildPdf(
        items.map((it) => ({ jpegBytes: it.jpegBytes, width: it.width, height: it.height })),
        opts
      );
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      downloadEl.href = url;
      downloadEl.download = 'images-to-pdf.pdf';
      resultWrap.hidden = false;
      const kb = (pdfBytes.length / 1024).toFixed(1);
      resultInfo.textContent = 'Ready: ' + items.length + ' page(s), A4 ' + opts.orientation +
        ', ' + opts.fitMode + ' mode' + (opts.pageNumbers ? ', page numbers on' : ', no page numbers') +
        ' — ' + pdfBytes.length.toLocaleString('en-US') + ' bytes (' + kb + ' KB), built in ' +
        Math.round(performance.now() - t0) + ' ms.';
      setStatus('PDF ready — ' + items.length + ' page(s).', 'ok');
      state.lastResult = {
        ok: true, pages: items.length, sizeBytes: pdfBytes.length,
        orientation: opts.orientation, fitMode: opts.fitMode, pageNumbers: opts.pageNumbers,
        dims: items.map((it) => [it.width, it.height]),
        reencoded: items.map((it) => it.reencoded),
      };
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus('Could not build the PDF: ' + msg, 'error');
      state.lastError = { reason: msg };
    }
  }

  // Radio chip selection highlight.
  document.querySelectorAll('.bg-chip input[type="radio"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('input[name="' + radio.name + '"]').forEach((r) => {
        r.closest('.bg-chip').classList.toggle('selected', r.checked);
      });
    });
  });

  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });
  ['dragover', 'dragenter'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  btn.addEventListener('click', buildAndOffer);

  renderList();
})();
