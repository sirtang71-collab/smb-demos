// core.js — US DV Lottery Photo Maker (dv-photo): pure logic
// (DV spec, head/eye ratio math, corner-whiteness sampling,
// JPEG quality fitting down to a byte ceiling at FIXED pixel size).
// Environment-agnostic: attaches window.DVPhotoCore in the browser,
// module.exports in Node.
//
// Spec sources (checked 2026-11-18, see QC.md for the full list):
//   * U.S. Department of State, Diversity Visa instructions (via
//     examidphoto.com, verified against the official instructions
//     2026-10-26; idphotodiy.com, checked 2026-11-01; toolsfa.com,
//     reviewed 2026-11-12): digital photo exactly 600 x 600 px,
//     square, colour JPEG, 240 KB or less; head 50-69% of the image
//     height (chin to crown, hair included); eyes 56-69% of the
//     image height measured up from the bottom; plain white or
//     off-white background; taken within the last 6 months; no
//     glasses; neutral expression, both eyes open.
//   * No manipulation: the DV instructions warn that a photo
//     manipulated in any way may make the entrant ineligible.
//     Since 1 January 2026 the State Department does not accept
//     photos altered with computer software, phone apps, filters or
//     AI — including background editing, skin smoothing and lighting
//     adjustment (resizerelay.com, rule read from the official
//     requirements 2026-09-19; sentruefile.com, updated 2026-10-19).
//     The Department's own free photo tool only rotates, resizes
//     and crops — this tool does the same three things and nothing
//     else. It does NOT change the background or retouch the face.
//   * Byte ceiling: the task's conservative reading is 240,000
//     bytes (240 x 1000). Portals are sloppy about KB = 1000 vs
//     1024, so 240,000 bytes satisfies either reading (240 x 1024
//     = 245,760 would also pass a 240 KB = 1000-byte reading only
//     if the portal uses 1024 — 240,000 is safe under both).
//   * DV-2027 registration had not opened as of early November
//     2026 (State Department notice 2025-11-05; court order paused
//     2026-10-29). The page tells users to check the instructions
//     for their own entry year; nothing here promises a date.
//
// How the byte ceiling is reached (same binary-search engine as
// id-photo-my, minus the minimum/padding half — DV has no floor):
//   1. Encode at JPEG quality 1.0. If it already fits, ship it.
//   2. Otherwise binary-search quality down for the largest size
//      that stays under 240,000 bytes (best-looking result that fits).
//   3. If even quality 0.02 is over the ceiling, refuse with a
//      clear message instead of handing over a file the entry
//      system would reject.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.DVPhotoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The one and only DV spec. No presets, no custom sizes: the
  // entry system accepts exactly this.
  const DV_SPEC = {
    wPx: 600,
    hPx: 600,
    maxKB: 240,
    maxBytes: 240000, // 240 x 1000: safe under both KB readings
    headMin: 0.50,    // head height as a fraction of frame height
    headMax: 0.69,
    eyeMin: 0.56,     // eye height measured up from the bottom
    eyeMax: 0.69,
  };

  // Head-guide overlay geometry, in output (600 x 600) coordinates.
  // Max head box: 414 px tall (69%), min head box: 300 px tall (50%),
  // both centred. The crown must fall in the top band (y 93-150) and
  // the chin in the bottom band (y 450-507) for a centred head.
  // Eye band: eyes 56-69% up from the bottom -> y 186-264.
  function headGuideBoxes(frameH) {
    const h = frameH || DV_SPEC.hPx;
    const maxH = Math.round(h * DV_SPEC.headMax); // 414
    const minH = Math.round(h * DV_SPEC.headMin); // 300
    const maxW = Math.round(h * 0.50);
    const minW = Math.round(h * 0.40);
    return {
      maxBox: { x: Math.round((h - maxW) / 2), y: Math.round((h - maxH) / 2), w: maxW, h: maxH },
      minBox: { x: Math.round((h - minW) / 2), y: Math.round((h - minH) / 2), w: minW, h: minH },
      eyeBand: { y0: Math.round(h * (1 - DV_SPEC.eyeMax)), y1: Math.round(h * (1 - DV_SPEC.eyeMin)) },
      crownBand: { y0: Math.round((h - maxH) / 2), y1: Math.round((h - minH) / 2) },
      chinBand: { y0: Math.round(h - (h - minH) / 2), y1: Math.round(h - (h - maxH) / 2) },
    };
  }

  /** Head height as a percentage of frame height. crownY/chinY in px. */
  function headRatioPercent(crownY, chinY, frameH) {
    const h = frameH || DV_SPEC.hPx;
    if (!Number.isFinite(crownY) || !Number.isFinite(chinY) || !Number.isFinite(h) || h <= 0) return null;
    if (chinY <= crownY) return null;
    return ((chinY - crownY) / h) * 100;
  }

  /** Verdict for a measured head box. Returns { ratioPct, inRange, message }. */
  function checkHead(crownY, chinY, frameH) {
    const ratio = headRatioPercent(crownY, chinY, frameH);
    if (ratio === null) {
      return { ratioPct: null, inRange: false, message: 'Enter the top of the head (crown) and the chin, in pixels from the top of the 600 px frame.' };
    }
    const inRange = ratio >= DV_SPEC.headMin * 100 && ratio <= DV_SPEC.headMax * 100;
    return {
      ratioPct: ratio,
      inRange,
      message: inRange
        ? 'Head is ' + ratio.toFixed(1) + '% of the frame height — inside the required 50–69%.'
        : 'Head is ' + ratio.toFixed(1) + '% of the frame height — outside the required 50–69%. Zoom or drag so the crown and chin sit inside the dashed guide bands.',
    };
  }

  /** Eye height as a percentage of frame height, measured up from the bottom. */
  function eyeHeightPercent(eyeY, frameH) {
    const h = frameH || DV_SPEC.hPx;
    if (!Number.isFinite(eyeY) || !Number.isFinite(h) || h <= 0) return null;
    if (eyeY < 0 || eyeY > h) return null;
    return ((h - eyeY) / h) * 100;
  }

  /** Verdict for a measured eye line. Returns { eyePct, inRange, message }. */
  function checkEyes(eyeY, frameH) {
    const pct = eyeHeightPercent(eyeY, frameH);
    if (pct === null) {
      return { eyePct: null, inRange: false, message: 'Enter the eye line, in pixels from the top of the 600 px frame.' };
    }
    const inRange = pct >= DV_SPEC.eyeMin * 100 && pct <= DV_SPEC.eyeMax * 100;
    return {
      eyePct: pct,
      inRange,
      message: inRange
        ? 'Eyes are ' + pct.toFixed(1) + '% up from the bottom — inside the required 56–69%.'
        : 'Eyes are ' + pct.toFixed(1) + '% up from the bottom — outside the required 56–69%. Reposition so the eyes fall inside the dashed eye band.',
    };
  }

  /**
   * Corner whiteness: sample a block of block x block pixels at each
   * corner of an image. getPixel(x, y) -> [r, g, b]. Returns
   * { cornerMeans: [[r,g,b] x4], minMean, isWhite } where minMean is
   * the lowest per-corner luminance mean (0-255). A plain white or
   * off-white DV background reads ~255; WHITE_THRESHOLD 240 still
   * accepts a light off-white while rejecting grey, coloured or
   * busy backgrounds. This is a hint, not a verdict: the user still
   * checks the background by eye (see the checklist).
   */
  const WHITE_THRESHOLD = 240;
  function cornerWhiteness(getPixel, w, h, block) {
    const b = block || 10;
    const corners = [[0, 0], [w - b, 0], [0, h - b], [w - b, h - b]];
    const means = corners.map(function (c0) {
      let sum = 0, n = 0;
      for (let dy = 0; dy < b; dy += 1) {
        for (let dx = 0; dx < b; dx += 1) {
          const px = getPixel(c0[0] + dx, c0[1] + dy);
          sum += (px[0] + px[1] + px[2]) / 3;
          n += 1;
        }
      }
      return sum / n;
    });
    const minMean = Math.min.apply(null, means);
    return { cornerMeans: means, minMean, isWhite: minMean >= WHITE_THRESHOLD };
  }

  function isJpeg(bytes) {
    return bytes && bytes.length > 4 && bytes[0] === 0xFF && bytes[1] === 0xD8;
  }

  /**
   * Fit a fixed-dimensions JPEG under spec.maxBytes.
   * encodeAtQuality(q) -> Promise<Uint8Array> at exactly 600 x 600.
   * Resolves to one of:
   *   { ok:true, bytes, quality, sizeBytes, note }
   *   { ok:false, reason:'over-max', sizeBytes, quality, note }
   * Never returns an over-ceiling file as ok.
   */
  async function encodeToMaxBytes(encodeAtQuality, spec) {
    const maxBytes = (spec && spec.maxBytes) || DV_SPEC.maxBytes;
    const Q_LO = 0.02, Q_HI = 1.0;

    let bestBytes = await encodeAtQuality(Q_HI);
    let bestQuality = Q_HI;
    let bestSize = bestBytes.length;

    if (bestSize <= maxBytes) {
      return {
        ok: true, bytes: bestBytes, quality: bestQuality, sizeBytes: bestSize,
        note: 'fits at full quality',
      };
    }

    const loBytes = await encodeAtQuality(Q_LO);
    if (loBytes.length > maxBytes) {
      return {
        ok: false, reason: 'over-max', quality: Q_LO, sizeBytes: loBytes.length,
        note: 'Even the lowest JPEG quality is ' + loBytes.length + ' bytes, over the ' + maxBytes + '-byte ceiling at 600 x 600 px.',
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
    return {
      ok: true, bytes: bestBytes, quality: bestQuality, sizeBytes: bestSize,
      note: 'fits by lowering JPEG quality',
    };
  }

  /** Verdict helper for UI/QC: is this byte count inside the spec? */
  function evaluateSize(sizeBytes, spec) {
    const maxBytes = (spec && spec.maxBytes) || DV_SPEC.maxBytes;
    return { maxBytes, inRange: sizeBytes <= maxBytes };
  }

  function validateSpec(spec) {
    if (!spec || !Number.isFinite(spec.wPx) || !Number.isFinite(spec.hPx)) return 'Missing pixel dimensions.';
    if (spec.wPx !== 600 || spec.hPx !== 600) return 'DV photos must be exactly 600 x 600 px.';
    if (!Number.isFinite(spec.maxBytes) || spec.maxBytes <= 0) return 'A maximum byte size is required.';
    if (spec.maxBytes > 240000) return 'The DV ceiling is 240,000 bytes — a larger limit would produce a file the entry system rejects.';
    return null;
  }

  return {
    DV_SPEC, WHITE_THRESHOLD, headGuideBoxes,
    headRatioPercent, checkHead, eyeHeightPercent, checkEyes,
    cornerWhiteness, isJpeg, encodeToMaxBytes, evaluateSize, validateSpec,
  };
});
