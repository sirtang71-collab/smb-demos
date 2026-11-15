// core.js — Philippines ID Photo Maker (id-photo-ph): pure logic
// (presets, KB-range fitting at FIXED pixel dimensions, JPEG padding,
// 10x15 cm print-sheet layout).
// Environment-agnostic: attaches window.PhPhotoCore in the browser,
// module.exports in Node. The range engine is the same one proven in
// portal-photo / id-photo-vn (same origin code); the sheet layout is
// the same one proven in id-photo (same origin code).
// Spec sources (checked 2026-11-15, see QC.md for the full list):
//   * 2x2 in (51x51 mm) e-Visa / visa: DFA eVisaPH photo rules via
//     idphotodiy.com (checked 2026-11-01) and passport-size-photo.com;
//     600x600 px @300 DPI. KB window 0-240 KB per Visafoto's published
//     Philippines visa 2x2 spec — the e-Visa portal itself publishes
//     no KB limit, so the page says so. The same 240 KB cap also fits
//     NBI clearance, which allows up to 2 MB.
//   * 1x1 in (25.4x25.4 mm): 300x300 px @300 DPI; used for PhilHealth,
//     PWD and senior-citizen IDs and licences (photogov.net, checked
//     Oct 2026). No published KB cap — neutral 500 KB default.
//   * Philippine passport 35x45 mm: 413x531 px @300 DPI, plain white
//     background under the current DFA ePassport spec (pixid.studio,
//     verified Aug 2026; pixlready.com). Older DFA guides asked for
//     royal blue — that spec is superseded; the page says so and the
//     royal-blue fill is offered only for consulates that still ask.
//   * Deliberately NO separate work-permit preset: no distinct
//     published work-permit photo size was found — notices ask for
//     2x2 or passport size, so the page says to use those.
//   * Domestic DFA passport applicants bring NO photo: the DFA data
//     encoder captures the portrait on site. The passport preset is
//     for overseas / consulate applications that still ask for
//     printed photos. The page says so (same pattern as the vn
//     tool's CCCD note).
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
  if (root) root.PhPhotoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;
  const PAD_RATIO_LIMIT = 20;
  const PAD_CUSHION_BYTES = 512;

  // Presets (sizes from the public sources in the header, checked
  // 2026-11-15). 2x2 in = 51x51 mm = 600x600 px @300 DPI (NOT the
  // passport size — the DFA passport is 35x45 mm, a separate preset).
  // KB caps other than the visa 2x2 preset are neutral editable
  // defaults (500 KB) — no official cap is published for those sizes.
  const PRESETS = [
    {
      id: 'visa-2x2',
      name: '2×2 in — e-Visa / Visa · 600×600 px · ≤240 KB',
      wPx: 600, hPx: 600, minKB: null, maxKB: 240,
      note: '2×2 in (51×51 mm, 600×600 px @300 DPI) for the Philippine e-Visa upload and visa applications at embassies/consulates. Plain white background, head 25–35 mm chin to crown (70–80% of the frame), taken within the last 6 months. KB cap 240 KB per Visafoto’s published Philippines visa 2×2 spec (0–240 KB); the e-Visa portal itself publishes no KB limit. The same file also fits NBI clearance, which allows up to 2 MB.',
    },
    {
      id: 'id-2x2',
      name: '2×2 in — NBI / Job & School Forms · 600×600 px',
      wPx: 600, hPx: 600, minKB: null, maxKB: 500,
      note: '2×2 in (51×51 mm, 600×600 px @300 DPI) for NBI clearance, job applications and school forms — the most common ID size in the Philippines. Plain white background. NBI allows up to 2 MB; no official KB cap is published for this size, so the 500 KB default is editable.',
    },
    {
      id: 'id-1x1',
      name: '1×1 in — PhilHealth / PWD / Senior Citizen · 300×300 px',
      wPx: 300, hPx: 300, minKB: null, maxKB: 500,
      note: '1×1 in (25.4×25.4 mm, 300×300 px @300 DPI) for PhilHealth, PWD and senior-citizen IDs and licences. Plain white background. No official KB cap is published for this size; the 500 KB default is editable.',
    },
    {
      id: 'passport-35x45',
      name: 'Philippine Passport 3.5×4.5 cm · 413×531 px',
      wPx: 413, hPx: 531, minKB: null, maxKB: 500,
      note: 'Philippine passport 35×45 mm (413×531 px @300 DPI), plain white background under the current DFA ePassport spec; head 32–36 mm chin to crown. Only for overseas / consulate applications that still ask for printed photos — in the Philippines the DFA captures your photo on site and you bring none. Older DFA guides asked for royal blue; that spec is superseded. No official KB cap is published for this size; the 500 KB default is editable.',
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
