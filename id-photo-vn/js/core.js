// core.js — Vietnam ID Photo Maker (id-photo-vn): pure logic
// (presets, KB-range fitting at FIXED pixel dimensions, JPEG padding,
// 10x15 cm print-sheet layout).
// Environment-agnostic: attaches window.VnPhotoCore in the browser,
// module.exports in Node. The range engine is the same one proven in
// portal-photo (same origin code); the sheet layout is the same one
// proven in id-photo (same origin code).
// Spec source: money-scan/vn-th-pipeline/entry-pack.md §4 (2026-11-14).
// Preset sizes follow the public sources listed there; the online
// 10–200 KB window is the IIG Vietnam exam-registration instance
// (354x472 px), NOT a nationwide standard — the page says so.
//   1. JPEG quality: binary-search the highest quality that stays
//      under the maximum (best-looking result that fits).
//   2. If even max quality lands below the minimum, grow the file with
//      standard JPEG COM (comment) segments inserted after the SOI
//      marker. Decoders ignore them; the pixels are byte-identical.
//      The UI discloses when padding was used.
//   3. If the padding needed would exceed PAD_RATIO_LIMIT × the real
//      image data, refuse: the "photo" would be an almost-empty
//      container, and any portal that re-encodes would drop it under
//      the floor again. The user is told to use a larger/original photo.
//
// KB interpretation guard: portals are sloppy about whether "KB" means
// 1000 or 1024 bytes, so the effective window is tightened on both
// ends — floor computed at 1024 B/KB, ceiling at 1000 B/KB — and an
// exported file therefore satisfies either reading.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VnPhotoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;
  const PAD_RATIO_LIMIT = 20;
  const PAD_CUSHION_BYTES = 512;

  // Presets per entry-pack §4.2 (sizes from the public sources in
  // §4.1, checked 2026-11-14). 3x4 = 30x40 mm (NOT 35x45 — that is
  // the separate Visa EU preset). CCCD is deliberately NOT a preset:
  // the police capture the portrait on site, no self-supplied photo.
  // KB caps other than the Online preset are neutral editable
  // defaults (500 KB) — no official cap is published for those sizes.
  const PRESETS = [
    {
      id: 'hs-3x4',
      name: 'Ảnh thẻ 3×4 — Hồ sơ xin việc',
      wPx: 354, hPx: 472, minKB: null, maxKB: 500,
      note: 'Ảnh thẻ 3×4 cm (354×472 px @300 DPI) — the most common size for hồ sơ xin việc / sơ yếu lý lịch. White or light-blue background. No official KB cap is published for this size; the 500 KB default is editable.',
    },
    {
      id: 'hs-4x6',
      name: 'Ảnh thẻ 4×6 — Hồ sơ / Hộ chiếu',
      wPx: 472, hPx: 709, minKB: null, maxKB: 500,
      note: 'Ảnh thẻ 4×6 cm (472×709 px @300 DPI) — required for giấy khám sức khỏe and the Vietnamese passport (40×60 mm). White background by default. No official KB cap is published for this size; the 500 KB default is editable.',
    },
    {
      id: 'online',
      name: 'Online 3×4 — 354×472 px · 10–200 KB',
      wPx: 354, hPx: 472, minKB: 10, maxKB: 200,
      note: 'For online exam registration: 354×472 px JPG, 10–200 KB (IIG Vietnam registration instance, 2026-08 — a single published example, not a nationwide standard). The tool lands the file inside the window.',
    },
    {
      id: 'small-2x3',
      name: 'Ảnh thẻ 2×3',
      wPx: 236, hPx: 354, minKB: null, maxKB: 500,
      note: 'Ảnh thẻ 2×3 cm (236×354 px @300 DPI) for student cards and small-form photos. No official KB cap is published for this size; the 500 KB default is editable.',
    },
    {
      id: 'visa-eu',
      name: 'Visa EU 3.5×4.5 cm',
      wPx: 413, hPx: 531, minKB: null, maxKB: 500,
      note: 'Visa EU 3.5×4.5 cm (413×531 px @300 DPI), white background. Kept separate from 3×4 — some sites wrongly label 35×45 mm as "3x4". No official KB cap is published for this size; the 500 KB default is editable.',
    },
  ];

  // 10 x 15 cm photo paper at 300 DPI (portrait).
  const SHEET = { wPx: 1181, hPx: 1772, label: '10 × 15 cm @ 300 DPI', margin: 36, gap: 24 };

  /**
   * Tile a photo of (photoW x photoH) px onto the sheet.
   * Returns { cols, rows, count, positions: [{x, y}] } — positions are top-left
   * corners, tiles centred on the sheet as a block. Same origin as id-photo.
   */
  function layoutSheet(photoW, photoH, sheet = SHEET) {
    const availW = sheet.wPx - sheet.margin * 2;
    const availH = sheet.hPx - sheet.margin * 2;
    const cols = Math.max(0, Math.floor((availW + sheet.gap) / (photoW + sheet.gap)));
    const rows = Math.max(0, Math.floor((availH + sheet.gap) / (photoH + sheet.gap)));
    const blockW = cols > 0 ? cols * photoW + (cols - 1) * sheet.gap : 0;
    const blockH = rows > 0 ? rows * photoH + (rows - 1) * sheet.gap : 0;
    const x0 = Math.round((sheet.wPx - blockW) / 2);
    const y0 = Math.round((sheet.hPx - blockH) / 2);
    const positions = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        positions.push({ x: x0 + c * (photoW + sheet.gap), y: y0 + r * (photoH + sheet.gap) });
      }
    }
    return { cols, rows, count: cols * rows, positions };
  }

  /** Effective byte window for a preset/custom spec (see header note). */
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
   * encodeAtQuality(q) -> Promise<Uint8Array> at the preset's exact
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

  return { KB, PRESETS, SHEET, layoutSheet, PAD_RATIO_LIMIT, rangeBytes, validateSpec, isJpeg, padJpegBytes, encodeToRangeFixedDims, evaluateSize };
});
