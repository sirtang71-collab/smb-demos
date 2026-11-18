// app.js — PDF Compress to KB (pdf-compress-kb): UI wiring.
// core.js (window.PdfToolCore) owns the PDF parser, compress.js
// (window.PdfCompress) owns image extraction + recompression, jpeg.js
// (window.PdfJpegCodec) is the canvas JPEG codec; this file only
// moves files in and out of them. The file is inspected first
// (page count, image count, encrypted check); compression is one
// async Core.compressPdf call over the raw bytes, and the result
// gets a download link plus a per-image before/after table.
(function () {
  'use strict';

  const Core = window.PdfToolCore;
  const Compress = window.PdfCompress;
  const Codec = window.PdfJpegCodec;
  const $ = (id) => document.getElementById(id);

  const fileInput = $('pdf-file');
  const dropZone = $('drop-zone');
  const infoEl = $('pdf-info');
  const listEl = $('pdf-list');
  const btn = $('pdf-btn');
  const statusEl = $('pdf-status');
  const resultWrap = $('pdf-result-wrap');
  const resultInfo = $('pdf-result-info');
  const resultBody = $('pdf-result-body');
  const downloadEl = $('pdf-download');
  const customRow = $('custom-row');
  const customKbInput = $('pdf-custom-kb');

  const L = Core.LIMITS;
  let item = null; // { name, sizeBytes, pageCount, pages, images, imageCount, totalImageBytes, bytes }
  let outUrl = null;

  const state = { lastResult: null, lastError: null };
  window.PdfTool = state;
  // Harness handle: the loaded file (name + page/image counts only, no bytes).
  Object.defineProperty(state, 'item', {
    get: () => item ? {
      name: item.name, sizeBytes: item.sizeBytes,
      pageCount: item.pageCount,
      mediaBoxes: item.pages.map((p) => p.mediaBox),
      imageCount: item.imageCount,
      totalImageBytes: item.totalImageBytes,
    } : null,
  });

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function boxLabel(mb) {
    return mb[2] + ' × ' + mb[3] + ' pt';
  }

  function currentTargetKb() {
    const checked = document.querySelector('input[name="target-preset"]:checked');
    const v = checked ? checked.value : '200';
    if (v === 'custom') {
      const n = Number(customKbInput.value);
      return Number.isFinite(n) ? Math.round(n) : NaN;
    }
    return Number(v);
  }

  function showCustomRow() {
    const checked = document.querySelector('input[name="target-preset"]:checked');
    customRow.hidden = !checked || checked.value !== 'custom';
    document.querySelectorAll('input[name="target-preset"]').forEach((r) => {
      r.closest('label').classList.toggle('selected', r.checked);
    });
  }

  async function addFile(file) {
    if (!file) return;
    setStatus('Reading ' + file.name + '…');
    if (file.size > L.MAX_FILE_BYTES) {
      setStatus(file.name + ' is ' + fmtBytes(file.size) + ' — over the ' +
        fmtBytes(L.MAX_FILE_BYTES) + ' per-file limit.', 'error');
      return;
    }
    try {
      const ab = await file.arrayBuffer();
      const raw = new Uint8Array(ab);
      const info = Compress.inspectForCompress(raw);
      if (info.pageCount > L.MAX_PAGES_TOTAL) {
        setStatus(file.name + ' has ' + info.pageCount + ' page(s) — over the ' +
          L.MAX_PAGES_TOTAL + '-page limit.', 'error');
        return;
      }
      item = {
        name: file.name, sizeBytes: file.size,
        pageCount: info.pageCount, pages: info.pages,
        images: info.images, imageCount: info.imageCount,
        totalImageBytes: info.totalImageBytes, bytes: raw,
      };
      setStatus('');
    } catch (e) {
      setStatus('Could not open ' + file.name + ': ' + (e && e.message ? e.message : e), 'error');
    }
    renderState();
  }

  function renderState() {
    listEl.innerHTML = '';
    if (item) {
      const li = document.createElement('li');
      const icon = document.createElement('span');
      icon.className = 'thumb pdf-icon';
      icon.textContent = 'PDF';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = item.name;
      const dims = document.createElement('div');
      dims.className = 'dims';
      const firstBox = item.pages.length ? boxLabel(item.pages[0].mediaBox) : '';
      const mixed = item.pages.some((p) => boxLabel(p.mediaBox) !== firstBox);
      dims.textContent = item.pageCount + (item.pageCount === 1 ? ' page' : ' pages') +
        ' · ' + firstBox + (mixed ? ' (mixed sizes)' : '') +
        ' · ' + fmtBytes(item.sizeBytes) +
        ' · ' + item.imageCount + ' embedded image' + (item.imageCount === 1 ? '' : 's') +
        ' (' + fmtBytes(item.totalImageBytes) + ')';
      meta.appendChild(name);
      meta.appendChild(dims);
      li.appendChild(icon);
      li.appendChild(meta);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'mini remove';
      rm.textContent = '✕';
      rm.title = 'Remove';
      rm.addEventListener('click', () => { item = null; renderState(); });
      li.appendChild(rm);
      listEl.appendChild(li);
      infoEl.textContent = item.pageCount + ' page(s), ' + item.imageCount +
        ' image(s) — pick a target size below.';
    } else {
      infoEl.textContent = 'No PDF yet — add one scanned (image) PDF to compress.';
    }
    btn.disabled = !item;
    resultWrap.hidden = true;
  }

  async function compressAndOffer() {
    state.lastResult = null;
    state.lastError = null;
    if (!item) return;
    const targetKb = currentTargetKb();
    if (!Number.isFinite(targetKb) || targetKb < 10 || targetKb > 10240) {
      const msg = 'target size must be between 10 KB and 10240 KB';
      setStatus(msg, 'error');
      state.lastError = { reason: msg };
      return;
    }
    const targetBytes = targetKb * 1024;
    btn.disabled = true;
    setStatus('Compressing to ' + targetKb + ' KB… (re-encoding ' +
      item.imageCount + ' image' + (item.imageCount === 1 ? '' : 's') + ')');
    try {
      const t0 = performance.now();
      const res = await Compress.compressPdf(item.bytes, targetBytes, Codec);
      if (outUrl) URL.revokeObjectURL(outUrl);
      const blob = new Blob([res.bytes], { type: 'application/pdf' });
      outUrl = URL.createObjectURL(blob);
      const base = item.name.replace(/\.[^.]+$/, '') || 'document';
      const outName = base + '-' + targetKb + 'kb.pdf';
      downloadEl.href = outUrl;
      downloadEl.download = outName;
      downloadEl.textContent = '⬇ Download ' + outName;
      resultBody.innerHTML = '';
      for (const im of res.images) {
        const tr = document.createElement('tr');
        const tdPage = document.createElement('td');
        tdPage.textContent = 'Page ' + im.page;
        const tdName = document.createElement('td');
        tdName.textContent = im.name + ' (' + im.filter + ')';
        const tdBefore = document.createElement('td');
        tdBefore.textContent = im.origW + '×' + im.origH + ' px · ' + fmtBytes(im.origBytes);
        const tdAfter = document.createElement('td');
        tdAfter.textContent = im.outW + '×' + im.outH + ' px · ' + fmtBytes(im.outBytes);
        tr.appendChild(tdPage);
        tr.appendChild(tdName);
        tr.appendChild(tdBefore);
        tr.appendChild(tdAfter);
        resultBody.appendChild(tr);
      }
      resultWrap.hidden = false;
      const ratio = (res.origBytes / res.outBytes).toFixed(1);
      resultInfo.textContent = res.alreadyFits
        ? 'Already under target: ' + fmtBytes(res.origBytes) + ' ≤ ' + targetKb +
          ' KB — no changes needed, the original file is offered for download.'
        : 'Compressed: ' + fmtBytes(res.origBytes) + ' → ' + fmtBytes(res.outBytes) +
          ' (' + ratio + '× smaller, ' +
          Math.round((1 - res.outBytes / res.origBytes) * 100) + '% off) — ' +
          res.dpi + ' DPI, JPEG quality ' + res.quality + ', ' +
          res.pageCount + ' page(s) kept, done in ' +
          Math.round(performance.now() - t0) + ' ms.';
      setStatus('Done — ' + fmtBytes(res.outBytes) + ' (target ' + targetKb + ' KB).', 'ok');
      state.lastResult = {
        ok: true, file: item.name, outName,
        origBytes: res.origBytes, outBytes: res.outBytes,
        targetBytes: res.targetBytes, pageCount: res.pageCount,
        dpi: res.dpi, quality: res.quality, alreadyFits: res.alreadyFits,
        attempts: res.attempts, images: res.images,
      };
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus('Could not compress: ' + msg, 'error');
      state.lastError = { reason: msg };
    } finally {
      btn.disabled = !item;
    }
  }

  fileInput.addEventListener('change', () => {
    addFile(fileInput.files[0]);
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
  dropZone.addEventListener('drop', (e) => addFile(e.dataTransfer.files[0]));
  document.querySelectorAll('input[name="target-preset"]').forEach((r) =>
    r.addEventListener('change', showCustomRow));
  btn.addEventListener('click', compressAndOffer);

  showCustomRow();
})();
