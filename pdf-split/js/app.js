// app.js — PDF Split (pdf-split): UI wiring.
// core.js (window.PdfToolCore) owns the PDF parser + splitter;
// split.js (window.PdfSplit) turns the mode + text into page groups;
// this file only moves files in and out of them. The file is read
// with inspectPdf first (page count, page sizes, encrypted check);
// the split itself is one Core.splitPdfs call over the raw bytes,
// and each returned part gets its own download link.
(function () {
  'use strict';

  const Core = window.PdfToolCore;
  const Split = window.PdfSplit;
  const $ = (id) => document.getElementById(id);

  const fileInput = $('pdf-file');
  const dropZone = $('drop-zone');
  const infoEl = $('pdf-info');
  const listEl = $('pdf-list');
  const btn = $('pdf-btn');
  const statusEl = $('pdf-status');
  const resultWrap = $('pdf-result-wrap');
  const resultInfo = $('pdf-result-info');
  const resultList = $('pdf-result-list');
  const downloadAllBtn = $('pdf-download-all');
  const rangesInput = $('pdf-ranges');
  const everyNInput = $('pdf-every-n');
  const singleInput = $('pdf-single');
  const modeRows = {
    ranges: $('mode-ranges-row'),
    everyn: $('mode-everyn-row'),
    single: $('mode-single-row'),
  };

  const L = Core.LIMITS;
  let item = null; // { name, sizeBytes, pageCount, pages, bytes: Uint8Array }
  let partUrls = [];

  const state = { lastResult: null, lastError: null };
  window.PdfTool = state;
  // Harness handle: the loaded file (name + page counts only, no bytes).
  Object.defineProperty(state, 'item', {
    get: () => item ? {
      name: item.name, sizeBytes: item.sizeBytes,
      pageCount: item.pageCount,
      mediaBoxes: item.pages.map((p) => p.mediaBox),
      rotates: item.pages.map((p) => p.rotate),
    } : null,
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

  function boxLabel(mb) {
    return mb[2] + ' × ' + mb[3] + ' pt';
  }

  function currentMode() {
    const checked = document.querySelector('input[name="split-mode"]:checked');
    return checked ? checked.value : 'ranges';
  }

  function showModeRow() {
    const mode = currentMode();
    for (const key of Object.keys(modeRows)) {
      modeRows[key].hidden = key !== mode;
    }
    document.querySelectorAll('input[name="split-mode"]').forEach((r) => {
      r.closest('label').classList.toggle('selected', r.checked);
    });
    renderState();
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
      const info = Core.inspectPdf(raw);
      if (info.pageCount > L.MAX_PAGES_TOTAL) {
        setStatus(file.name + ' has ' + info.pageCount + ' page(s) — over the ' +
          L.MAX_PAGES_TOTAL + '-page limit.', 'error');
        return;
      }
      item = {
        name: file.name, sizeBytes: file.size,
        pageCount: info.pageCount, pages: info.pages, bytes: raw,
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
        ' · ' + fmtBytes(item.sizeBytes);
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
      infoEl.textContent = item.pageCount + ' page(s) — pick how to split below.';
    } else {
      infoEl.textContent = 'No PDF yet — add one PDF to split.';
    }
    btn.disabled = !item;
    resultWrap.hidden = true;
  }

  function buildGroups() {
    const mode = currentMode();
    if (!item) throw new Error('add a PDF first');
    if (mode === 'ranges') return Split.parseRanges(rangesInput.value, item.pageCount);
    if (mode === 'everyn') {
      const n = Number(everyNInput.value);
      return Split.everyNGroups(n, item.pageCount);
    }
    return Split.singlePageGroups(singleInput.value, item.pageCount);
  }

  function partName(mode, group, partIdx) {
    if (mode === 'single') return 'split-page-' + (group[0] + 1) + '.pdf';
    return 'split-part-' + (partIdx + 1) + '.pdf';
  }

  function buildAndOffer() {
    state.lastResult = null;
    state.lastError = null;
    let groups;
    try {
      groups = buildGroups();
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus(msg, 'error');
      state.lastError = { reason: msg };
      return;
    }
    try {
      const t0 = performance.now();
      const mode = currentMode();
      const parts = Core.splitPdfs(item.bytes, groups);
      for (const url of partUrls) URL.revokeObjectURL(url);
      partUrls = [];
      resultList.innerHTML = '';
      const partMeta = [];
      parts.forEach((partBytes, i) => {
        const name = partName(mode, groups[i], i);
        const blob = new Blob([partBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        partUrls.push(url);
        const li = document.createElement('li');
        const icon = document.createElement('span');
        icon.className = 'thumb pdf-icon';
        icon.textContent = 'PDF';
        const meta = document.createElement('div');
        meta.className = 'meta';
        const nm = document.createElement('div');
        nm.className = 'name';
        nm.textContent = name;
        const dm = document.createElement('div');
        dm.className = 'dims';
        dm.textContent = Split.groupLabel(groups[i]) + ' · ' + groups[i].length +
          (groups[i].length === 1 ? ' page' : ' pages') + ' · ' + fmtBytes(partBytes.length);
        meta.appendChild(nm);
        meta.appendChild(dm);
        li.appendChild(icon);
        li.appendChild(meta);
        const a = document.createElement('a');
        a.className = 'download small';
        a.href = url;
        a.download = name;
        a.textContent = '⬇ Download';
        li.appendChild(a);
        resultList.appendChild(li);
        partMeta.push({
          name, label: Split.groupLabel(groups[i]),
          pages: groups[i].length, sizeBytes: partBytes.length,
        });
      });
      resultWrap.hidden = false;
      const totalBytes = parts.reduce((s, p) => s + p.length, 0);
      resultInfo.textContent = 'Ready: ' + parts.length + ' part(s) from ' +
        item.pageCount + ' page(s) — ' + totalBytes.toLocaleString('en-US') +
        ' bytes total, split in ' + Math.round(performance.now() - t0) + ' ms.';
      setStatus('Split ready — ' + parts.length + ' part(s), ' +
        parts.reduce((s, p, i) => s + groups[i].length, 0) + ' page(s) in all.', 'ok');
      state.lastResult = {
        ok: true, parts: partMeta, file: item.name,
        pageCount: item.pageCount, totalBytes,
      };
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus('Could not split: ' + msg, 'error');
      state.lastError = { reason: msg };
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
  document.querySelectorAll('input[name="split-mode"]').forEach((r) =>
    r.addEventListener('change', showModeRow));
  btn.addEventListener('click', buildAndOffer);
  downloadAllBtn.addEventListener('click', () => {
    const links = resultList.querySelectorAll('a.download');
    links.forEach((a, i) => setTimeout(() => a.click(), i * 400));
  });

  showModeRow();
})();
