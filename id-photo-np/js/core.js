// core.js — Nepal Lok Sewa Photo & Signature Maker (id-photo-np): pure logic
// (presets, KB-range fitting at FIXED pixel dimensions, JPEG padding).
// Environment-agnostic: attaches window.NpPhotoCore in the browser,
// module.exports in Node. The range engine is the same one proven in
// portal-photo / id-photo-vn / id-photo-ph / id-photo-my (same origin
// code): binary-search JPEG quality down to the ceiling, then grow the
// file with standard JPEG COM segments to reach the floor.
// Spec sources (checked 2026-11-18, see QC.md for the full list):
//   * Lok Sewa (PSC Nepal) online form photo: passport proportions,
//     around 350x450 px, JPG, about 10-50 KB most often (sundargautam.
//     com.np, Lok Sewa photo & signature size guide); other notices
//     ask up to 200 KB, so the fields stay editable and the strictest
//     common window (20-50 KB) is the default. Nepal printed passport
//     photo is 35x45 mm = 413x531 px @300 DPI (tikajoshi.com.np).
//   * Lok Sewa signature: wide strip, around 350x150 px, JPG, about
//     5-50 KB most often (same guide). Default here is 350x100 px,
//     10-50 KB — the height is editable, the notice is final.
//   * A signature CAN be too small in KB: clean white paper with a
//     thin ink line compresses to 2-3 KB, below a 5-10 KB minimum, and
//     the portal rejects it. That is why this tool pads the signature
//     file up to its minimum with COM segments (pixels untouched) and
//     says so on the page — instead of handing you a file that would
//     be rejected for being too small.
// How the KB window is reached (same engine as id-photo-my):
//   1. JPEG quality: binary-search the highest quality that stays
//      under the maximum (best-looking result that fits).
//   2. If even max quality lands below the minimum, grow the file with
//      standard JPEG COM (comment) segments inserted after the SOI
//      marker. Decoders ignore them; the pixels are byte-identical.
//      The UI discloses when padding was used.
//   3. If the padding needed would exceed PAD_RATIO_LIMIT x the real
//      image data, refuse: the "photo" would be an almost-empty
//      container, and any portal that re-encodes would drop it under
//      the floor again. The user is told to use a larger/original image.
//
// KB interpretation guard: portals are sloppy about whether "KB" means
// 1000 or 1024 bytes, so the effective window is tightened on both
// ends — floor computed at 1024 B/KB, ceiling at 1000 B/KB — and an
// exported file therefore satisfies either reading.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NpPhotoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;
  const PAD_RATIO_LIMIT = 20;
  const PAD_CUSHION_BYTES = 512;
  const DPI = 300;
  const MM_PER_INCH = 25.4;

  /** Millimetres -> pixels at the tool's DPI (rounded to whole px). */
  function mmToPx(mm, dpi = DPI) {
    return Math.round((mm / MM_PER_INCH) * dpi);
  }

  // Photo presets (sizes from the public sources in the header, checked
  // 2026-11-18). The Lok Sewa online-form photo is the main preset:
  // 350x450 px, 20-50 KB. The Nepal passport preset is the printed
  // 35x45 mm frame (413x531 px @300 DPI) with the commonly quoted
  // 200 KB ceiling as an editable default.
  const PRESETS = [
    {
      id: 'loksewa-photo',
      name: 'Lok Sewa (PSC) online form photo · 350×450 px · 20–50 KB',
      wPx: 350, hPx: 450, minKB: 20, maxKB: 50, bg: '#ffffff',
      note: 'Lok Sewa Aayog (Public Service Commission) online form photo: passport proportions, around 350×450 px, JPG, about 10–50 KB in the guides that come up most often. The default window here is 20–50 KB — the strictest common reading — and both fields stay editable: if your vacancy notice says a different limit (some say up to 200 KB), type its numbers in. Recent colour photo, front view, plain white background, no cap or dark glasses.',
    },
    {
      id: 'passport-35x45',
      name: 'Nepal passport photo 35×45 mm · 413×531 px · ≤200 KB',
      wPx: 413, hPx: 531, minKB: null, maxKB: 200, bg: '#ffffff',
      note: 'Nepal printed passport photo: 35×45 mm (413×531 px @300 DPI), plain white background. The 200 KB ceiling is the limit quoted most often for the online passport / Lok Sewa photo upload; no official minimum is published for this size, so the minimum is left blank (editable).',
    },
  ];

  // Signature strip spec. Default 350x100 px, 10-50 KB: the width is
  // what the portal checks most often, the height follows the crop the
  // user makes (editable), and the 10 KB floor is what the padding
  // mechanism guarantees — a thin signature on clean white paper would
  // otherwise compress to 2-3 KB and be rejected for being too small.
  const SIGNATURE = {
    id: 'loksewa-signature',
    name: 'Lok Sewa signature strip',
    wPx: 350, hPx: 100, minKB: 10, maxKB: 50, bg: '#ffffff',
    note: 'Sign on white paper with a black ink pen — not in capital letters. Crop tight around the signature, keep the strip wide and short (around 350×100 px). Signatures compress to almost nothing: a clean scan can be 2–3 KB, below the portal minimum. This tool raises the file to the 10 KB minimum with standard JPEG padding that does not change a single pixel, and tells you when it did.',
  };

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

  return { KB, DPI, MM_PER_INCH, mmToPx, PRESETS, SIGNATURE, PAD_RATIO_LIMIT, rangeBytes, validateSpec, isJpeg, padJpegBytes, encodeToRangeFixedDims, evaluateSize };
});
