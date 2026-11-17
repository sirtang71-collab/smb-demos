// core.js — Malaysia ID Photo Maker (id-photo-my): pure logic
// (presets, KB-range fitting at FIXED pixel dimensions, JPEG padding,
// 10x15 cm print-sheet layout).
// Environment-agnostic: attaches window.MyPhotoCore in the browser,
// module.exports in Node. The range engine is the same one proven in
// portal-photo / id-photo-vn / id-photo-ph (same origin code); the
// sheet layout is the same one proven in id-photo (same origin code).
// Spec sources (checked 2026-11-17, see QC.md for the full list):
//   * Malaysian passport 35x50 mm: 413x591 px @300 DPI, plain white
//     background, head 25-30 mm chin to crown (Jabatan Imigresen
//     Malaysia spec via photogov.net, idphotodiy.com — checked
//     2026-11-03 — malaysianpasportrnew.com, examidphoto.com).
//     Digital upload window 100 KB-1 MB per the MyOnline Pasport
//     portal (examidphoto.com, cross-checked from the portal); a
//     2023 JIM guide said 100-300 KB, so the fields stay editable.
//   * MyKad (national ID) uses the SAME 35x50 mm format as the
//     passport (passportphotomaker.app, 2026-05-01): same 413x591 px,
//     blue background still the norm at JPN counters although white
//     is accepted at most counters now. No published KB cap —
//     neutral 500 KB default, editable.
//   * Domestic passport applicants bring NO printed photo: JIM
//     captures the portrait on site (Facial Live Capture). A printed
//     35x50 mm photo is only specified for children under 4 and for
//     overseas / mission applications. MyKad photos are likewise
//     captured on site at JPN offices. The page says so (same
//     pattern as the ph tool's DFA note).
//   * Background is NOT blue for the passport: the current JIM /
//     MyOnline Pasport spec is plain white; older photo-shop practice
//     used blue, and some embassies abroad still accept blue. Light
//     blue is offered as the MyKad default only — the page says the
//     exact shade is not specified by JPN.
// How the KB window is reached (same engine as id-photo-ph):
//   1. JPEG quality: binary-search the highest quality that stays
//      under the maximum (best-looking result that fits).
//   2. If even max quality lands below the minimum, grow the file with
//      standard JPEG COM (comment) segments inserted after the SOI
//      marker. Decoders ignore them; the pixels are byte-identical.
//      The UI discloses when padding was used.
//   3. If the padding needed would exceed PAD_RATIO_LIMIT x the real
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
  if (root) root.MyPhotoCore = api;
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

  // Presets (sizes from the public sources in the header, checked
  // 2026-11-17). 35x50 mm = 413x591 px @300 DPI for BOTH the
  // passport and MyKad — they share the frame and differ in
  // background colour and KB window. bg is the preset's default
  // canvas-fill colour (white for passport, light blue for MyKad).
  const PRESETS = [
    {
      id: 'passport-35x50',
      name: 'Malaysian Passport 35×50 mm · 413×591 px · 100–1000 KB',
      wPx: 413, hPx: 591, minKB: 100, maxKB: 1000, bg: '#ffffff',
      note: 'Malaysian passport 35×50 mm (413×591 px @300 DPI), plain white background, head 25–30 mm chin to crown, taken within the last 6 months. Only for children under 4 and overseas / mission applications that still ask for a printed photo — inside Malaysia JIM captures your photo on site and you bring none. File window 100 KB–1 MB follows the MyOnline Pasport portal upload limit; a 2023 JIM guide said 100–300 KB, so the fields stay editable — check your portal notice.',
    },
    {
      id: 'mykad-35x50',
      name: 'MyKad / IC 35×50 mm · 413×591 px · light-blue background',
      wPx: 413, hPx: 591, minKB: null, maxKB: 500, bg: '#a9c8ec',
      note: 'MyKad (national identity card) uses the same 35×50 mm frame as the passport (413×591 px @300 DPI), head 25–30 mm. Blue background is still the norm for MyKad, although JPN accepts white at most counters now; the exact blue shade is not specified by JPN. For new ICs and renewals JPN takes the photo on site — this preset is for replacement / printed use where a photo is still asked for. No official KB cap is published for this size; the 500 KB default is editable.',
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

  return { KB, DPI, MM_PER_INCH, mmToPx, PRESETS, SHEET, layoutSheet, PAD_RATIO_LIMIT, rangeBytes, validateSpec, isJpeg, padJpegBytes, encodeToRangeFixedDims, evaluateSize };
});
