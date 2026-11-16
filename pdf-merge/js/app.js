// app.js — PDF Merge (pdf-merge): UI wiring.
// core.js (window.PdfToolCore) owns the PDF parser + merger;
// this file only moves files in and out of it. Every file is read
// with inspectPdf first (page count, page sizes, encrypted check);
// the merge itself is one Core.mergePdfs call over the raw bytes.
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

  const L = Core.LIMITS;
  let items = []; // { id, name, sizeBytes, pageCount, pages, bytes: Uint8Array }
  let nextId = 1;

  const state = { lastResult: null, lastError: null };
  window.PdfTool = state;
  // Harness handle: the live item list (names + page counts only, no bytes).
  Object.defineProperty(state, 'items', {
    get: () => items.map((it) => ({
      id: it.id, name: it.name, sizeBytes: it.sizeBytes,
      pageCount: it.pageCount,
      mediaBoxes: it.pages.map((p) => p.mediaBox),
      rotates: it.pages.map((p) => p.rotate),
    })),
  });

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function totalPages() { return items.reduce((s, it) => s + it.pageCount, 0); }
  function totalBytes() { return items.reduce((s, it) => s + it.sizeBytes, 0); }

  function boxLabel(mb) {
    return mb[2] + ' × ' + mb[3] + ' pt';
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setStatus('Reading ' + files.length + ' PDF(s)…');
    let added = 0;
    for (const file of files) {
      if (items.length >= L.MAX_FILES) {
        setStatus('Limit reached: at most ' + L.MAX_FILES + ' files per merge.', 'error');
        break;
      }
      if (file.size > L.MAX_FILE_BYTES) {
        setStatus(file.name + ' is ' + fmtBytes(file.size) + ' — over the ' +
          fmtBytes(L.MAX_FILE_BYTES) + ' per-file limit, skipped.', 'error');
        continue;
      }
      if (totalBytes() + file.size > L.MAX_TOTAL_BYTES) {
        setStatus('Total size would pass ' + fmtBytes(L.MAX_TOTAL_BYTES) + ' — ' +
          file.name + ' skipped.', 'error');
        continue;
      }
      try {
        const ab = await file.arrayBuffer();
        const raw = new Uint8Array(ab);
        const info = Core.inspectPdf(raw);
        if (totalPages() + info.pageCount > L.MAX_PAGES_TOTAL) {
          setStatus(file.name + ' has ' + info.pageCount + ' page(s) — that would pass the ' +
            L.MAX_PAGES_TOTAL + '-page total limit, skipped.', 'error');
          continue;
        }
        items.push({
          id: nextId++, name: file.name, sizeBytes: file.size,
          pageCount: info.pageCount, pages: info.pages, bytes: raw,
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
      const icon = document.createElement('span');
      icon.className = 'thumb pdf-icon';
      icon.textContent = 'PDF';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = (idx + 1) + '. ' + it.name;
      const dims = document.createElement('div');
      dims.className = 'dims';
      const firstBox = it.pages.length ? boxLabel(it.pages[0].mediaBox) : '';
      const mixed = it.pages.some((p) => boxLabel(p.mediaBox) !== firstBox);
      dims.textContent = it.pageCount + (it.pageCount === 1 ? ' page' : ' pages') +
        ' · ' + firstBox + (mixed ? ' (mixed sizes)' : '') +
        ' · ' + fmtBytes(it.sizeBytes);
      meta.appendChild(name);
      meta.appendChild(dims);
      li.appendChild(icon);
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
      ? items.length + ' file(s) — ' + totalPages() + ' page(s) in the merged PDF, in this order.'
      : 'No PDFs yet — add at least one to merge.';
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
    items.splice(idx, 1);
    renderList();
  }

  function buildAndOffer() {
    state.lastResult = null;
    state.lastError = null;
    try {
      const t0 = performance.now();
      const pdfBytes = Core.mergePdfs(items.map((it) => it.bytes));
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      downloadEl.href = url;
      downloadEl.download = 'merged.pdf';
      resultWrap.hidden = false;
      const kb = (pdfBytes.length / 1024).toFixed(1);
      resultInfo.textContent = 'Ready: ' + totalPages() + ' page(s) from ' + items.length +
        ' file(s) — ' + pdfBytes.length.toLocaleString('en-US') + ' bytes (' + kb +
        ' KB), merged in ' + Math.round(performance.now() - t0) + ' ms.';
      setStatus('Merged PDF ready — ' + totalPages() + ' page(s).', 'ok');
      state.lastResult = {
        ok: true, pages: totalPages(), files: items.length, sizeBytes: pdfBytes.length,
        names: items.map((it) => it.name),
        pageCounts: items.map((it) => it.pageCount),
        mediaBoxes: items.map((it) => it.pages.map((p) => p.mediaBox)),
        rotates: items.map((it) => it.pages.map((p) => p.rotate)),
      };
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus('Could not merge: ' + msg, 'error');
      state.lastError = { reason: msg };
    }
  }

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
