// app.js — ID Photo Maker UI. All processing is local (canvas), nothing is uploaded.
(function () {
  'use strict';
  const { PRESETS, GUIDE, SHEET, layoutSheet } = window.IDCore;

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const ctx = stage.getContext('2d');

  const state = {
    preset: PRESETS[0],
    img: null,          // HTMLImageElement
    zoom: 1,            // >= 1, relative to cover fit
    ox: 0, oy: 0,       // pan offset in stage px (image centre displacement)
    brightness: 1,
    contrast: 1,
  };

  // ---------- preset UI ----------
  const grid = $('presetGrid');
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-btn' + (p.id === state.preset.id ? ' active' : '');
    b.dataset.presetId = p.id;
    b.innerHTML = `<span class="p-country"></span><span class="p-name"></span><span class="p-size"></span>`;
    b.querySelector('.p-country').textContent = p.country;
    b.querySelector('.p-name').textContent = p.name;
    b.querySelector('.p-size').textContent = `${p.spec} · ${p.wPx}×${p.hPx}px`;
    b.addEventListener('click', () => selectPreset(p.id));
    grid.appendChild(b);
  });

  function selectPreset(id) {
    state.preset = PRESETS.find((p) => p.id === id) || PRESETS[0];
    document.querySelectorAll('.preset-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.presetId === state.preset.id));
    const p = state.preset;
    $('presetDetail').textContent =
      `${p.country} ${p.name}: ${p.spec} = ${p.wPx}×${p.hPx} px at 300 DPI. Background: ${p.bgNote}`;
    // Stage aspect follows the preset.
    const VW = 720;
    stage.width = VW;
    stage.height = Math.round(VW * (p.hPx / p.wPx));
    resetView();
    updateSheetInfo();
    render();
  }

  function updateSheetInfo() {
    if (!state.img) { $('sheetInfo').textContent = ''; return; }
    const lay = layoutSheet(state.preset.wPx, state.preset.hPx);
    $('sheetInfo').textContent =
      `Print sheet: ${lay.count} copies (${lay.cols} × ${lay.rows}) of ${state.preset.wPx}×${state.preset.hPx}px on one ${SHEET.label} sheet (${SHEET.wPx}×${SHEET.hPx}px).`;
  }

  // ---------- image loading ----------
  function setImage(img) {
    state.img = img;
    $('stageEmpty').style.display = 'none';
    $('downloadSingle').disabled = false;
    $('downloadSheet').disabled = false;
    resetView();
    updateSheetInfo();
    render();
  }

  function loadFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setImage(img); };
    img.onerror = () => { $('exportMsg').textContent = 'Could not read that file — try another image.'; };
    img.src = url;
  }

  $('fileInput').addEventListener('change', (e) => loadFile(e.target.files[0]));
  const dz = $('dropZone');
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragging'); }));
  dz.addEventListener('drop', (e) => loadFile(e.dataTransfer.files && e.dataTransfer.files[0]));

  // ---------- view transform ----------
  function resetView() { state.zoom = 1; state.ox = 0; state.oy = 0; $('zoomRange').value = '1'; }

  // Cover-fit scale from source px to stage px.
  function baseScale() {
    if (!state.img) return 1;
    return Math.max(stage.width / state.img.naturalWidth, stage.height / state.img.naturalHeight);
  }
  // Source rect (in image px) currently shown in the stage.
  function sourceRect() {
    const s = baseScale() * state.zoom;
    const w = stage.width / s;
    const h = stage.height / s;
    const cx = state.img.naturalWidth / 2 - state.ox / s;
    const cy = state.img.naturalHeight / 2 - state.oy / s;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  function clampPan() {
    if (!state.img) return;
    const s = baseScale() * state.zoom;
    const maxOx = Math.max(0, (state.img.naturalWidth * s - stage.width) / 2);
    const maxOy = Math.max(0, (state.img.naturalHeight * s - stage.height) / 2);
    state.ox = Math.min(maxOx, Math.max(-maxOx, state.ox));
    state.oy = Math.min(maxOy, Math.max(-maxOy, state.oy));
  }

  function render() {
    ctx.filter = 'none';
    ctx.clearRect(0, 0, stage.width, stage.height);
    if (!state.img) { $('stageCaption').textContent = ''; return; }
    clampPan();
    const r = sourceRect();
    ctx.save();
    ctx.filter = `brightness(${state.brightness}) contrast(${state.contrast})`;
    ctx.drawImage(state.img, r.x, r.y, r.w, r.h, 0, 0, stage.width, stage.height);
    ctx.restore();
    drawGuides();
    $('stageCaption').textContent =
      `Export size: ${state.preset.wPx} × ${state.preset.hPx} px (${state.preset.spec}, 300 DPI)`;
  }

  function drawGuides() {
    const W = stage.width, H = stage.height;
    ctx.save();
    ctx.filter = 'none';
    // Face oval
    const ow = W * GUIDE.ovalWidthPct;
    const crownY = H * GUIDE.crownPct, chinY = H * GUIDE.chinPct;
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.beginPath();
    ctx.ellipse(W / 2, (crownY + chinY) / 2, ow / 2, (chinY - crownY) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // Crown / chin lines
    guideLine(crownY, '#ffcf3f', 'top of head');
    guideLine(chinY, '#ffcf3f', 'chin');
    // Eye line (midway guide)
    ctx.restore();
  }
  function guideLine(y, color, label) {
    const W = stage.width;
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = color; ctx.font = '600 17px sans-serif';
    ctx.fillText(label, 10, y - 8);
  }

  // ---------- pan / zoom ----------
  const pointers = new Map();
  let pinchDist = 0;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !state.img) return;
    const prev = pointers.get(e.pointerId);
    const rect = stage.getBoundingClientRect();
    const sx = stage.width / rect.width, sy = stage.height / rect.height;
    const nx = e.offsetX, ny = e.offsetY;
    pointers.set(e.pointerId, { x: nx, y: ny });
    if (pointers.size === 1) {
      state.ox += (nx - prev.x) * sx;
      state.oy += (ny - prev.y) * sy;
      render();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) setZoom(state.zoom * (d / pinchDist));
      pinchDist = d;
    }
  });
  ['pointerup', 'pointercancel'].forEach((ev) =>
    stage.addEventListener(ev, (e) => { pointers.delete(e.pointerId); }));
  stage.addEventListener('wheel', (e) => {
    if (!state.img) return;
    e.preventDefault();
    setZoom(state.zoom * (e.deltaY < 0 ? 1.06 : 0.94));
  }, { passive: false });

  function setZoom(z) {
    state.zoom = Math.min(3.5, Math.max(1, z));
    $('zoomRange').value = String(state.zoom);
    render();
  }
  $('zoomRange').addEventListener('input', (e) => setZoom(parseFloat(e.target.value)));
  $('brightRange').addEventListener('input', (e) => { state.brightness = parseFloat(e.target.value); render(); });
  $('contrastRange').addEventListener('input', (e) => { state.contrast = parseFloat(e.target.value); render(); });

  // ---------- export ----------
  // Renders the export canvas at the preset's EXACT pixel size (no guides).
  function renderExportCanvas() {
    const p = state.preset;
    const c = document.createElement('canvas');
    c.width = p.wPx; c.height = p.hPx;
    const cctx = c.getContext('2d');
    const r = sourceRect();
    cctx.filter = `brightness(${state.brightness}) contrast(${state.contrast})`;
    cctx.drawImage(state.img, r.x, r.y, r.w, r.h, 0, 0, p.wPx, p.hPx);
    return c;
  }

  const encodeJPEG = (canvas, q) =>
    new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

  // Binary-search JPEG quality so the file fits under maxBytes.
  // The pixel size NEVER changes (ID photos must stay exact) — quality only.
  // Same approach as the exam-photo tool's size-fitting search.
  async function fitToMaxKB(canvas, maxBytes) {
    if (!maxBytes || maxBytes <= 0) {
      return { blob: await encodeJPEG(canvas, 0.92), quality: 0.92, over: false };
    }
    const loBlob = await encodeJPEG(canvas, 0.05);
    if (loBlob.size > maxBytes) return { blob: loBlob, quality: 0.05, over: true };
    const hiBlob = await encodeJPEG(canvas, 0.98);
    if (hiBlob.size <= maxBytes) return { blob: hiBlob, quality: 0.98, over: false };
    let lo = 0.05, hi = 0.98, best = { blob: loBlob, quality: lo };
    for (let i = 0; i < 7; i += 1) {
      const mid = (lo + hi) / 2;
      const b = await encodeJPEG(canvas, mid);
      if (b.size <= maxBytes) { best = { blob: b, quality: mid }; lo = mid; } else { hi = mid; }
    }
    return { ...best, over: false };
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function buildSheetCanvas() {
    const p = state.preset;
    const single = renderExportCanvas();
    const sheet = document.createElement('canvas');
    sheet.width = SHEET.wPx; sheet.height = SHEET.hPx;
    const sctx = sheet.getContext('2d');
    sctx.fillStyle = '#ffffff';
    sctx.fillRect(0, 0, sheet.width, sheet.height);
    const lay = layoutSheet(p.wPx, p.hPx);
    lay.positions.forEach((pos) => {
      sctx.drawImage(single, pos.x, pos.y);
      sctx.strokeStyle = '#c8c8c8';
      sctx.lineWidth = 1;
      sctx.setLineDash([6, 4]);
      sctx.strokeRect(pos.x + 0.5, pos.y + 0.5, p.wPx - 1, p.hPx - 1);
      sctx.setLineDash([]);
    });
    return { sheet, count: lay.count };
  }

  $('downloadSingle').addEventListener('click', async () => {
    if (!state.img) return;
    const maxKb = parseFloat($('maxKbInput').value);
    const maxBytes = Number.isFinite(maxKb) && maxKb > 0 ? Math.round(maxKb * 1024) : 0;
    const c = renderExportCanvas();
    const r = await fitToMaxKB(c, maxBytes);
    saveBlob(r.blob, `id-photo-${state.preset.id}-${state.preset.wPx}x${state.preset.hPx}.jpg`);
    const kb = (r.blob.size / 1024).toFixed(1);
    $('exportMsg').textContent = r.over
      ? `Saved at ${kb} KB — even the lowest quality exceeds your cap; try a plainer background or a larger cap.`
      : `Saved: ${state.preset.wPx}×${state.preset.hPx}px JPG, ${kb} KB.`;
  });

  $('downloadSheet').addEventListener('click', async () => {
    if (!state.img) return;
    const { sheet, count } = buildSheetCanvas();
    const blob = await encodeJPEG(sheet, 0.95);
    saveBlob(blob, `id-photo-${state.preset.id}-sheet-4x6.jpg`);
    $('exportMsg').textContent =
      `Saved print sheet: ${SHEET.wPx}×${SHEET.hPx}px with ${count} copies. Print at 100% scale (no fit-to-page).`;
  });

  // ---------- init ----------
  selectPreset(state.preset.id);

  // ---------- demo / autotest hooks (used by QC only) ----------
  const params = new URLSearchParams(location.search);
  function loadSample() {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = 'test/sample-portrait.jpg';
    });
  }
  const blobDims = async (blob) => {
    const bmp = await createImageBitmap(blob);
    const d = { w: bmp.width, h: bmp.height };
    bmp.close();
    return d;
  };

  if (params.has('demo')) {
    loadSample().then((img) => { selectPreset('uk'); setImage(img); }).catch(() => {});
  }

  if (params.has('autotest')) {
    const pre = document.getElementById('autotest-results');
    window.addEventListener('error', (e) => { pre.textContent = 'WINDOW-ERROR: ' + e.message; });
    (async () => {
      const out = { presets: [], prints: [], errors: [] };
      try {
        pre.textContent = 'stage:loading-sample';
        const img = await loadSample();
        pre.textContent = 'stage:sample-loaded';
        setImage(img);
        for (const p of PRESETS) {
          selectPreset(p.id);
          pre.textContent = 'stage:preset-' + p.id;
          const c = renderExportCanvas();
          pre.textContent = 'stage:export-rendered-' + p.id;
          const blob = await encodeJPEG(c, 0.92);
          pre.textContent = 'stage:encoded-' + p.id;
          const dims = await blobDims(blob);
          pre.textContent = 'stage:dims-' + p.id;
          const fit = await fitToMaxKB(c, 50 * 1024);
          pre.textContent = 'stage:fit-' + p.id;
          const fitDims = await blobDims(fit.blob);
          out.presets.push({
            id: p.id, expect: [p.wPx, p.hPx], got: [dims.w, dims.h],
            sizeKB: +(blob.size / 1024).toFixed(1),
            kbCap50: { bytes: fit.blob.size, dims: [fitDims.w, fitDims.h], over: fit.over },
          });
        }
        for (const pid of ['us', 'uk', 'cn1', 'id']) {
          selectPreset(pid);
          const p = state.preset;
          const { sheet, count } = buildSheetCanvas();
          // Count tiles actually drawn: sample the centre pixel of every
          // layout position — a drawn tile shows photo content, blank paper is white.
          const sctx = sheet.getContext('2d');
          let drawn = 0;
          layoutSheet(p.wPx, p.hPx).positions.forEach((pos) => {
            const px = sctx.getImageData(pos.x + (p.wPx >> 1), pos.y + (p.hPx >> 1), 1, 1).data;
            if (!(px[0] > 250 && px[1] > 250 && px[2] > 250)) drawn += 1;
          });
          const blob = await encodeJPEG(sheet, 0.95);
          const dims = await blobDims(blob);
          out.prints.push({ id: pid, sheetDims: [dims.w, dims.h], layoutCount: count, drawnTiles: drawn });
        }
        selectPreset('uk');
      } catch (err) {
        out.errors.push(String(err && err.message ? err.message : err));
      }
      document.getElementById('autotest-results').textContent = JSON.stringify(out);
      document.title = 'AUTOTEST-DONE';
    })();
  }
})();
