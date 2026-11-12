// core.js — Exam Photo + Signature Studio: pure logic (presets, KB-range
// fitting at FIXED pixel dimensions, JPEG padding, signature cleanup,
// combined-sheet geometry).
// Environment-agnostic: attaches window.ExamSignCore in the browser,
// module.exports in Node (same pattern as portal-photo/js/core.js).
//
// The KB-range engine is the same one proven in portal-photo:
//   1. JPEG quality: binary-search the highest quality that stays under
//      the maximum (best-looking result that fits).
//   2. If even max quality lands below the minimum, grow the file with
//      standard JPEG COM (comment) segments inserted after the SOI
//      marker. Decoders ignore them; the pixels are byte-identical.
//      The UI discloses when padding was used.
//   3. If the padding needed would exceed PAD_RATIO_LIMIT × the real
//      image data, refuse rather than hand over an almost-empty file.
//
// KB interpretation guard: portals are sloppy about whether "KB" means
// 1000 or 1024 bytes, so the effective window is tightened on both
// ends — floor computed at 1024 B/KB, ceiling at 1000 B/KB — and an
// exported file therefore satisfies either reading.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ExamSignCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;
  const PAD_RATIO_LIMIT = 20;
  const PAD_CUSHION_BYTES = 512;
  const COMBINED_GAP_PX = 16;

  // Photo presets. Pixel sizes follow the dimensions published in the
  // exam notifications / portal guidance (cm sizes converted at
  // 200 DPI, the convention Indian exam-photo tools use); KB windows
  // are the commonly published ones and stay editable in the UI —
  // always confirm against the current official notice.
  const PHOTO_PRESETS = [
    {
      id: 'ssc-photo',
      name: 'SSC — Photo (3.5 × 4.5 cm)',
      wPx: 276, hPx: 354, minKB: 20, maxKB: 50,
      note: 'SSC (CGL/CHSL/GD etc.) photo: 3.5 × 4.5 cm, 20–50 KB, recent colour photo on a light background.',
    },
    {
      id: 'upsc-photo',
      name: 'UPSC — Photo',
      wPx: 300, hPx: 300, minKB: 20, maxKB: 300,
      note: 'UPSC photo: 300 × 300 px, 20–300 KB, taken within the period stated in the notification.',
    },
    {
      id: 'ibps-photo',
      name: 'IBPS / Bank — Photo (200 × 230 px)',
      wPx: 200, hPx: 230, minKB: 20, maxKB: 50,
      note: 'IBPS & bank exams photo: 200 × 230 px, 20–50 KB, recent passport-style colour photo.',
    },
    {
      id: 'psc-photo',
      name: 'State PSC — Photo (3.5 × 4.5 cm)',
      wPx: 276, hPx: 354, minKB: 10, maxKB: 100,
      note: 'State PSC photo: commonly 3.5 × 4.5 cm, 10–100 KB. Check your state notice — windows vary by state.',
    },
    {
      id: 'passport-photo',
      name: 'Passport — 2 × 2 inch',
      wPx: 600, hPx: 600, minKB: 50, maxKB: 200,
      note: '2 × 2 inch photo at 300 DPI (600 × 600 px), plain white background, 50–200 KB default window.',
    },
  ];

  // Signature presets (same sourcing rule as the photo presets).
  const SIG_PRESETS = [
    {
      id: 'ssc-signature',
      name: 'SSC — Signature (4.0 × 2.0 cm)',
      wPx: 315, hPx: 157, minKB: 10, maxKB: 20,
      note: 'SSC signature: 4.0 × 2.0 cm, 10–20 KB. Sign with a black pen on plain white paper — not in capital letters.',
    },
    {
      id: 'ibps-signature',
      name: 'IBPS / Bank — Signature (140 × 60 px)',
      wPx: 140, hPx: 60, minKB: 10, maxKB: 20,
      note: 'IBPS & bank exams signature: 140 × 60 px, 10–20 KB, black ink on white paper.',
    },
    {
      id: 'wide-signature',
      name: 'Generic — Wide signature (6.0 × 2.0 cm)',
      wPx: 472, hPx: 157, minKB: 10, maxKB: 50,
      note: 'Wide signature strip used by many state and university forms: 6.0 × 2.0 cm, 10–50 KB default window.',
    },
  ];

  /** Effective byte window for a spec (see header note). */
  function rangeBytes(spec) {
    const minBytes = spec.minKB ? Math.round(spec.minKB * KB) : 0;
    const maxBytes = Math.round(spec.maxKB * 1000);
    return { minBytes, maxBytes };
  }

  function validateSpec(spec) {
    if (!spec || !Number.isFinite(spec.wPx) || !Number.isFinite(spec.hPx)) return 'Missing pixel dimensions.';
    if (spec.wPx < 10 || spec.wPx > 4000 || spec.hPx < 10 || spec.hPx > 4000) return 'Pixel dimensions must be between 10 and 4000.';
    if (!Number.isFinite(spec.maxKB) || spec.maxKB <= 0) return 'A maximum KB is required.';
    if (spec.maxKB > 10240) return 'Maximum KB must be 10240 or less.';
    if (spec.minKB != null && (!Number.isFinite(spec.minKB) || spec.minKB < 0)) return 'Minimum KB must be 0 or more.';
    if (spec.minKB != null && spec.minKB >= spec.maxKB) return 'Minimum KB must be smaller than maximum KB.';
    return null;
  }

  function isJpeg(bytes) {
    return bytes && bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8;
  }

  /**
   * Grow a JPEG to exactly targetBytes by inserting COM segments right
   * after the SOI marker. Returns a new Uint8Array; if the input is
   * already >= targetBytes it is returned unchanged. Throws on non-JPEG.
   */
  function padJpegBytes(bytes, targetBytes) {
    if (!isJpeg(bytes)) throw new Error('padJpegBytes: input is not a JPEG');
    if (bytes.length >= targetBytes) return bytes;
    let remaining = targetBytes - bytes.length;
    const segments = [];
    while (remaining > 0) {
      // One COM segment adds 4 + payload bytes (marker 2 + length 2,
      // length counts itself, so payload <= 65533). Avoid leaving a
      // 1–3 byte remainder, which no segment can express.
      let segTotal = Math.min(remaining, 65537);
      const leftover = remaining - segTotal;
      if (leftover >= 1 && leftover <= 3) segTotal -= (4 - leftover);
      const payload = segTotal - 4;
      const seg = new Uint8Array(segTotal);
      seg[0] = 0xFF; seg[1] = 0xFE;
      seg[2] = (payload + 2) >> 8; seg[3] = (payload + 2) & 0xFF;
      segments.push(seg);
      remaining -= segTotal;
    }
    const out = new Uint8Array(targetBytes);
    out.set(bytes.subarray(0, 2), 0);
    let off = 2;
    for (const seg of segments) { out.set(seg, off); off += seg.length; }
    out.set(bytes.subarray(2), off);
    return out;
  }

  /**
   * Fit a fixed-dimensions JPEG into [minBytes, maxBytes].
   * encodeAtQuality(q) -> Promise<Uint8Array> at the spec's exact
   * pixel size. Resolves to one of:
   *   { ok:true, withinRange:true, bytes, quality, sizeBytes, paddedBytes, note }
   *   { ok:false, reason:'over-max'|'below-min', sizeBytes, quality, note }
   * Never returns an out-of-range file as ok — failures carry no bytes.
   */
  async function encodeToRangeFixedDims(encodeAtQuality, spec) {
    const { minBytes, maxBytes } = rangeBytes(spec);
    const Q_LO = 0.02, Q_HI = 1.0;

    let bestBytes = await encodeAtQuality(Q_HI);
    let bestQuality = Q_HI;
    let bestSize = bestBytes.length;

    if (bestSize > maxBytes) {
      // Binary-search quality down for the largest size <= maxBytes.
      const loBytes = await encodeAtQuality(Q_LO);
      if (loBytes.length > maxBytes) {
        return {
          ok: false, reason: 'over-max', quality: Q_LO, sizeBytes: loBytes.length,
          note: 'Even the lowest JPEG quality is ' + loBytes.length + ' bytes, over the ' + maxBytes + '-byte ceiling at these exact pixel dimensions.',
        };
      }
      bestBytes = loBytes; bestQuality = Q_LO; bestSize = loBytes.length;
      let lo = Q_LO, hi = Q_HI;
      for (let i = 0; i < 10; i += 1) {
        const mid = (lo + hi) / 2;
        const b = await encodeAtQuality(mid);
        if (b.length <= maxBytes) {
          if (b.length > bestSize) { bestBytes = b; bestQuality = mid; bestSize = b.length; }
          lo = mid;
        } else { hi = mid; }
      }
    }

    if (bestSize >= minBytes) {
      return {
        ok: true, withinRange: true, bytes: bestBytes, quality: bestQuality,
        sizeBytes: bestSize, paddedBytes: 0, note: 'fits by quality alone',
      };
    }

    // Below the floor: grow with COM-segment padding (pixels untouched).
    const target = Math.min(minBytes + PAD_CUSHION_BYTES, maxBytes);
    const needed = target - bestSize;
    if (needed > bestSize * PAD_RATIO_LIMIT) {
      return {
        ok: false, reason: 'below-min', quality: bestQuality, sizeBytes: bestSize,
        note: 'Image data is only ' + bestSize + ' bytes; reaching the ' + minBytes + '-byte minimum would need more than ' +
          PAD_RATIO_LIMIT + 'x that in padding, which portals that re-encode would strip away.',
      };
    }
    const padded = padJpegBytes(bestBytes, target);
    return {
      ok: true, withinRange: true, bytes: padded, quality: bestQuality,
      sizeBytes: padded.length, paddedBytes: padded.length - bestSize, note: 'fits after COM padding',
    };
  }

  /** Verdict helper for UI/QC: is this byte count inside the spec window? */
  function evaluateSize(sizeBytes, spec) {
    const { minBytes, maxBytes } = rangeBytes(spec);
    return {
      kb: sizeBytes / KB,
      minBytes, maxBytes,
      inRange: sizeBytes >= minBytes && sizeBytes <= maxBytes,
    };
  }

  /**
   * Signature cleanup on raw RGBA pixels (mutates and returns the same
   * { data, width, height } object). Steps:
   *   1. Convert to luminance.
   *   2. Estimate the LOCAL paper level on a coarse block grid (block
   *      90th percentile, bilinearly interpolated) — this follows the
   *      paper through vignetting and shadows instead of assuming one
   *      global brightness.
   *   3. Normalise: out = lum * 255 / localPaper, so paper everywhere
   *      becomes white while dark ink stays dark. Near-white values
   *      (>= SNAP) snap to pure 255.
   * Output is greyscale (R=G=B), alpha forced opaque.
   */
  const SIG_SNAP = 216;
  const SIG_BLOCK = 32;
  function enhanceSignature(imageData) {
    const w = imageData.width, h = imageData.height;
    const data = imageData.data;
    const n = w * h;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
    // Global paper level (90th percentile) as a floor reference: the
    // local paper estimate is never allowed far below it, so a block
    // completely covered in ink cannot brighten its own strokes.
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i += 1) hist[Math.max(0, Math.min(255, Math.round(lum[i])))] += 1;
    let acc = 0, globalPaper = 255;
    for (let v = 0; v < 256; v += 1) {
      acc += hist[v];
      if (acc >= n * 0.90) { globalPaper = v; break; }
    }
    const paperFloor = globalPaper * 0.72;
    // Block paper grid.
    const gw = Math.max(1, Math.ceil(w / SIG_BLOCK));
    const gh = Math.max(1, Math.ceil(h / SIG_BLOCK));
    const grid = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy += 1) {
      for (let gx = 0; gx < gw; gx += 1) {
        const vals = [];
        const x1 = Math.min(w, (gx + 1) * SIG_BLOCK), y1 = Math.min(h, (gy + 1) * SIG_BLOCK);
        for (let y = gy * SIG_BLOCK; y < y1; y += 2) {
          for (let x = gx * SIG_BLOCK; x < x1; x += 2) vals.push(lum[y * w + x]);
        }
        vals.sort((a, b) => a - b);
        const p90 = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.90))] : 255;
        grid[gy * gw + gx] = Math.max(paperFloor, p90);
      }
    }
    function localPaper(x, y) {
      // Bilinear interpolation over block centres.
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / SIG_BLOCK - 0.5));
      const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / SIG_BLOCK - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
      const tx = fx - x0, ty = fy - y0;
      const a = grid[y0 * gw + x0], b = grid[y0 * gw + x1];
      const c = grid[y1 * gw + x0], d = grid[y1 * gw + x1];
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        const paper = Math.max(40, localPaper(x, y));
        let v = Math.round(lum[i] * 255 / paper);
        if (v > SIG_SNAP) v = 255;
        if (v < 0) v = 0; else if (v > 255) v = 255;
        const o = i * 4;
        data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
      }
    }
    return imageData;
  }

  /** Combined sheet geometry: photo on top, signature below, stacked
   *  vertically on a canvas as wide as the wider of the two. */
  function combinedLayout(photoSpec, sigSpec) {
    return {
      wPx: Math.max(photoSpec.wPx, sigSpec.wPx),
      hPx: photoSpec.hPx + COMBINED_GAP_PX + sigSpec.hPx,
      photoX: Math.round((Math.max(photoSpec.wPx, sigSpec.wPx) - photoSpec.wPx) / 2),
      sigX: Math.round((Math.max(photoSpec.wPx, sigSpec.wPx) - sigSpec.wPx) / 2),
      sigY: photoSpec.hPx + COMBINED_GAP_PX,
    };
  }

  return {
    KB, PHOTO_PRESETS, SIG_PRESETS, PAD_RATIO_LIMIT, COMBINED_GAP_PX,
    rangeBytes, validateSpec, isJpeg, padJpegBytes,
    encodeToRangeFixedDims, evaluateSize, enhanceSignature, combinedLayout,
  };
});
