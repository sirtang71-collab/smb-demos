// jpeg.js — PDF Compress to KB (pdf-compress-kb): browser JPEG codec.
// Implements the { decodeJpeg, encodeJpeg } interface js/compress.js
// needs, using only built-in browser APIs (createImageBitmap /
// canvas.toBlob). No libraries, no network.
//   decodeJpeg(bytes) -> Promise<{ width, height, data: Uint8Array(RGB) }>
//   encodeJpeg({ width, height, data }, targetW, targetH, quality)
//       -> Promise<Uint8Array>  (baseline JPEG, quality 1..100)
(function (root, factory) {
  const api = factory();
  if (root) root.PdfJpegCodec = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function blobToBytes(blob) {
    return blob.arrayBuffer().then((buf) => new Uint8Array(buf));
  }

  function canvasToJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('JPEG encode failed in this browser')); return; }
        blobToBytes(blob).then(resolve, reject);
      }, 'image/jpeg', Math.max(0.01, Math.min(1, quality / 100)));
    });
  }

  async function decodeJpeg(bytes) {
    if (!(bytes instanceof Uint8Array)) throw new Error('decodeJpeg: input is not bytes');
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    let bmp = null;
    try {
      if (typeof createImageBitmap === 'function') {
        bmp = await createImageBitmap(blob);
      }
    } catch (e) {
      bmp = null; // fall through to the <img> path below
    }
    if (!bmp) {
      bmp = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error('could not decode a JPEG image in this PDF ' +
            '(it may be a CMYK JPEG, which browsers cannot decode reliably)'));
        };
        img.src = url;
      });
    }
    const w = bmp.width, h = bmp.height;
    if (!w || !h) throw new Error('decoded JPEG image has no size');
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) { try { bmp.close(); } catch (e) {} }
    const imgData = ctx.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0, j = 0; i < imgData.length; i += 4, j += 3) {
      rgb[j] = imgData[i]; rgb[j + 1] = imgData[i + 1]; rgb[j + 2] = imgData[i + 2];
    }
    return { width: w, height: h, data: rgb };
  }

  async function encodeJpeg(px, targetW, targetH, quality) {
    if (!px || typeof px.width !== 'number' || !(px.data instanceof Uint8Array)) {
      throw new Error('encodeJpeg: bad pixels');
    }
    const tw = Math.max(1, Math.round(targetW));
    const th = Math.max(1, Math.round(targetH));
    // Source canvas holds the full-size pixels; drawImage scales.
    const src = document.createElement('canvas');
    src.width = px.width; src.height = px.height;
    const sctx = src.getContext('2d');
    const imgData = sctx.createImageData(px.width, px.height);
    const dst = imgData.data;
    for (let i = 0, j = 0; i < dst.length; i += 4, j += 3) {
      dst[i] = px.data[j]; dst[i + 1] = px.data[j + 1]; dst[i + 2] = px.data[j + 2];
      dst[i + 3] = 255;
    }
    sctx.putImageData(imgData, 0, 0);
    const out = document.createElement('canvas');
    out.width = tw; out.height = th;
    const octx = out.getContext('2d');
    // White behind: JPEG has no transparency; source is opaque RGB anyway.
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, tw, th);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(src, 0, 0, tw, th);
    return canvasToJpeg(out, quality);
  }

  return { decodeJpeg, encodeJpeg };
});
