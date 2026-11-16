// app.js — Photo Background Colour Changer (photo-bg-color): UI wiring.
// core.js (window.BgToolCore) owns the segmentation + colour swap;
// this file only moves images in and out of it. Everything runs on
// canvas ImageData in the browser; nothing is uploaded.
(function () {
  'use strict';

  const Core = window.BgToolCore;
  const $ = (id) => document.getElementById(id);

  const fileInput = $('bg-file');
  const dropZone = $('drop-zone');
  const infoEl = $('bg-info');
  const previewGrid = $('preview-grid');
  const canvasBefore = $('canvas-before');
  const canvasAfter = $('canvas-after');
  const capBefore = $('cap-before');
  const capAfter = $('cap-after');
  const statusEl = $('bg-status');
  const resultWrap = $('bg-result-wrap');
  const resultInfo = $('bg-result-info');
  const dlPng = $('bg-download-png');
  const dlJpg = $('bg-download-jpg');
  const tolInput = $('bg-tolerance');
  const tolOut = $('bg-tolerance-out');
  const colourBtns = Array.from(document.querySelectorAll('.colour-btn'));

  let srcImageData = null; // ImageData of the uploaded photo
  let srcName = '';
  let selectedColour = null; // 'white' | 'blue' | 'red'
  let lastOut = null; // { data, width, height, target, bgColour, bgPixels, bgRatio, ms }
  let pngUrl = null, jpgUrl = null;

  const state = { lastResult: null, lastError: null };
  window.BgTool = state;
  // Harness handles (no pixel bytes, just facts).
  Object.defineProperty(state, 'hasImage', { get: () => !!srcImageData });
  Object.defineProperty(state, 'selectedColour', { get: () => selectedColour });
  Object.defineProperty(state, 'dims', {
    get: () => (srcImageData ? [srcImageData.width, srcImageData.height] : null),
  });

  function setStatus(msg, kind) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function drawImageData(canvas, imageData) {
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }

  function loadImageData(blobUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
          resolve(ctx.getImageData(0, 0, c.width, c.height));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('could not decode image'));
      img.src = blobUrl;
    });
  }

  function revokeUrls() {
    if (pngUrl) URL.revokeObjectURL(pngUrl);
    if (jpgUrl) URL.revokeObjectURL(jpgUrl);
    pngUrl = jpgUrl = null;
  }

  async function addFile(file) {
    if (!file) return;
    setStatus('Loading ' + file.name + '…');
    try {
      const url = URL.createObjectURL(file);
      srcImageData = await loadImageData(url);
      URL.revokeObjectURL(url);
      srcName = file.name;
      selectedColour = null;
      lastOut = null;
      state.lastResult = null;
      state.lastError = null;
      revokeUrls();
      resultWrap.hidden = true;
      colourBtns.forEach((b) => {
        b.disabled = false;
        b.classList.remove('selected');
      });
      previewGrid.hidden = false;
      drawImageData(canvasBefore, srcImageData);
      canvasAfter.width = srcImageData.width;
      canvasAfter.height = srcImageData.height;
      canvasAfter.getContext('2d').clearRect(0, 0, canvasAfter.width, canvasAfter.height);
      capBefore.textContent = srcImageData.width + ' × ' + srcImageData.height + ' px · original';
      capAfter.textContent = 'Pick a background colour below.';
      infoEl.textContent = file.name + ' — ' + srcImageData.width + ' × ' + srcImageData.height + ' px.';
      setStatus('Photo loaded. Pick white, blue or red.', 'ok');
    } catch (e) {
      setStatus('Could not load ' + file.name + ': ' + (e && e.message ? e.message : e), 'error');
      state.lastError = { reason: (e && e.message) || String(e) };
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error(type + ' encode failed'));
        resolve(blob);
      }, type, quality);
    });
  }

  async function applyColour(colour) {
    if (!srcImageData) return;
    selectedColour = colour;
    colourBtns.forEach((b) => b.classList.toggle('selected', b.dataset.colour === colour));
    setStatus('Changing background to ' + colour + '…');
    state.lastResult = null;
    state.lastError = null;
    // Let the status paint before the (possibly seconds-long) flood fill.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const t0 = performance.now();
      const out = Core.changeBackground(
        srcImageData.data, srcImageData.width, srcImageData.height,
        colour, { tolerance: Number(tolInput.value), feather: true }
      );
      const ms = Math.round(performance.now() - t0);
      const imageData = new ImageData(out.data, out.width, out.height);
      drawImageData(canvasAfter, imageData);
      const target = Core.TARGETS[colour];
      capAfter.textContent = out.width + ' × ' + out.height + ' px · background ' + colour +
        ' ' + target.hex + ' · ' + (out.bgRatio * 100).toFixed(1) + '% of pixels replaced';
      lastOut = { out, imageData, ms };
      revokeUrls();
      const pngBlob = await canvasToBlob(canvasAfter, 'image/png');
      pngUrl = URL.createObjectURL(pngBlob);
      dlPng.href = pngUrl;
      dlPng.download = 'photo-bg-' + colour + '.png';
      dlPng.textContent = '⬇ Download PNG';
      const jpgBlob = await canvasToBlob(canvasAfter, 'image/jpeg', 0.92);
      jpgUrl = URL.createObjectURL(jpgBlob);
      dlJpg.href = jpgUrl;
      dlJpg.download = 'photo-bg-' + colour + '.jpg';
      dlJpg.textContent = '⬇ Download JPG';
      resultWrap.hidden = false;
      resultInfo.textContent = 'Done in ' + ms + ' ms — detected background ' +
        'rgb(' + out.bgColour.r + ', ' + out.bgColour.g + ', ' + out.bgColour.b + '), ' +
        out.bgPixels.toLocaleString('en-US') + ' pixels (' + (out.bgRatio * 100).toFixed(1) +
        '%) changed to ' + colour + ' ' + target.hex + '. PNG ' +
        (pngBlob.size / 1024).toFixed(1) + ' KB · JPG ' + (jpgBlob.size / 1024).toFixed(1) + ' KB.';
      if (out.bgRatio < 0.05) {
        setStatus('Background changed, but only ' + (out.bgRatio * 100).toFixed(1) +
          '% of pixels matched — the background may be busy or the photo may touch the edges. Try raising the tolerance.', 'error');
      } else if (out.bgRatio > 0.95) {
        setStatus('Background changed, but ' + (out.bgRatio * 100).toFixed(1) +
          '% of pixels matched — the subject may have been swallowed. Try lowering the tolerance.', 'error');
      } else {
        setStatus('Background is now ' + colour + ' ' + target.hex + '.', 'ok');
      }
      state.lastResult = {
        ok: true, colour, hex: target.hex, ms,
        width: out.width, height: out.height,
        bgColour: [out.bgColour.r, out.bgColour.g, out.bgColour.b],
        bgPixels: out.bgPixels, bgRatio: out.bgRatio,
        tolerance: out.tolerance, pngBytes: pngBlob.size, jpgBytes: jpgBlob.size,
      };
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      setStatus('Could not change the background: ' + msg, 'error');
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
  colourBtns.forEach((b) => b.addEventListener('click', () => applyColour(b.dataset.colour)));
  tolInput.addEventListener('input', () => {
    tolOut.textContent = tolInput.value;
  });
  tolInput.addEventListener('change', () => {
    if (selectedColour && srcImageData) applyColour(selectedColour);
  });
})();
