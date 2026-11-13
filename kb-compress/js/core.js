// core.js — Compress Images to a Target KB: pure logic (target-size
// window, JPEG COM padding, quality binary-search fitting).
// Environment-agnostic: attaches window.KbCompressCore in the browser,
// module.exports in Node (same pattern as exam-sign/js/core.js).
//
// Target window: a compressed file "hits" its target when its byte size
// lands in [target x 0.85, target x 1.10], with KB = 1024 bytes.
//   1. JPEG quality: binary-search the highest quality that stays at or
//      under the target (start 0.92, ~7 encode steps), so the result
//      looks as good as possible for its size.
//   2. If even the best quality lands below the window floor, grow the
//      file with standard JPEG COM (comment) segments inserted after
//      the SOI marker — the same proven helper as exam-sign. Decoders
//      ignore them; the pixels are byte-identical. The UI discloses
//      when padding was used.
//   3. If the padding needed would exceed PAD_RATIO_LIMIT x the real
//      image data, refuse the padding and return the smaller file
//      as-is (under target is still a valid compression, just below
//      the ideal window) rather than handing over an almost-empty file.
//   4. If even the lowest quality is over the window ceiling, the
//      caller (app.js) downscales the image 0.9x and retries; this
//      module reports that as 'over-max' with no bytes.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.KbCompressCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;
  const Q_START = 0.92;
  const Q_LO = 0.02;
  const Q_HI = 1.0;
  const SEARCH_STEPS = 6;
  const PAD_RATIO_LIMIT = 20;
  const MIN_TARGET_KB = 10;
  const MAX_TARGET_KB = 2000;
  const WINDOW_LO = 0.85;
  const WINDOW_HI = 1.10;

  /** Target size in bytes for a KB target (KB = 1024 bytes). */
  function targetBytesFor(targetKB) {
    return Math.round(targetKB * KB);
  }

  /** Effective byte window for a target: [target*0.85, target*1.10]. */
  function windowFor(targetKB) {
    const targetBytes = targetBytesFor(targetKB);
    return {
      targetBytes,
      minBytes: Math.round(targetBytes * WINDOW_LO),
      maxBytes: Math.round(targetBytes * WINDOW_HI),
    };
  }

  function validateTarget(targetKB) {
    if (!Number.isFinite(targetKB)) return 'Enter a target size in KB.';
    if (targetKB < MIN_TARGET_KB || targetKB > MAX_TARGET_KB) {
      return 'Target size must be between ' + MIN_TARGET_KB + ' and ' + MAX_TARGET_KB + ' KB.';
    }
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
      // 1-3 byte remainder, which no segment can express.
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
   * Fit one JPEG encode into the target window at FIXED pixel dims.
   * encodeAtQuality(q) -> Promise<Uint8Array> at those dimensions.
   * Resolves to one of:
   *   { ok:true, withinWindow:true|false, bytes, quality, sizeBytes,
   *     paddedBytes, note }
   *   { ok:false, reason:'over-max', sizeBytes, quality, note }
   * Never returns an out-of-window file as ok:true+withinWindow:true.
   * An ok:true with withinWindow:false is a real, smaller-than-target
   * file (padding refused) — still downloadable, disclosed in the UI.
   */
  async function encodeToTarget(encodeAtQuality, targetKB) {
    const { targetBytes, minBytes, maxBytes } = windowFor(targetKB);

    async function enc(q) {
      const b = await encodeAtQuality(q);
      return { bytes: b, quality: q, size: b.length };
    }

    const start = await enc(Q_START);
    let best;
    if (start.size <= targetBytes) {
      // Try higher quality (0.92 -> 1.0) for the best-looking fit.
      best = start;
      let lo = Q_START, hi = Q_HI;
      for (let i = 0; i < SEARCH_STEPS; i += 1) {
        const mid = (lo + hi) / 2;
        const b = await enc(mid);
        if (b.size <= targetBytes) {
          if (b.size > best.size) best = b;
          lo = mid;
        } else { hi = mid; }
      }
    } else {
      // Binary-search quality down for the largest size <= target.
      const low = await enc(Q_LO);
      if (low.size > maxBytes) {
        return {
          ok: false, reason: 'over-max', quality: Q_LO, sizeBytes: low.size,
          note: 'Even the lowest JPEG quality is ' + low.size + ' bytes, over the ' +
            maxBytes + '-byte window ceiling at these pixel dimensions — downscale and retry.',
        };
      }
      best = low;
      let lo = Q_LO, hi = Q_START;
      for (let i = 0; i < SEARCH_STEPS; i += 1) {
        const mid = (lo + hi) / 2;
        const b = await enc(mid);
        if (b.size <= targetBytes) {
          if (b.size > best.size) best = b;
          lo = mid;
        } else { hi = mid; }
      }
    }

    if (best.size >= minBytes) {
      return {
        ok: true, withinWindow: true, bytes: best.bytes, quality: best.quality,
        sizeBytes: best.size, paddedBytes: 0, note: 'fits by quality alone',
      };
    }

    // Below the floor: grow with COM-segment padding (pixels untouched).
    const needed = minBytes - best.size;
    if (needed <= best.size * PAD_RATIO_LIMIT) {
      const padded = padJpegBytes(best.bytes, minBytes);
      return {
        ok: true, withinWindow: true, bytes: padded, quality: best.quality,
        sizeBytes: padded.length, paddedBytes: padded.length - best.size,
        note: 'fits after COM padding to window floor',
      };
    }
    return {
      ok: true, withinWindow: false, bytes: best.bytes, quality: best.quality,
      sizeBytes: best.size, paddedBytes: 0,
      note: 'under the window floor; padding refused (would need more than ' +
        PAD_RATIO_LIMIT + 'x the image data)',
    };
  }

  /** Verdict helper for UI/QC: is this byte count inside the window? */
  function evaluateSize(sizeBytes, targetKB) {
    const { targetBytes, minBytes, maxBytes } = windowFor(targetKB);
    return {
      targetBytes, minBytes, maxBytes,
      inWindow: sizeBytes >= minBytes && sizeBytes <= maxBytes,
    };
  }

  return {
    KB, Q_START, Q_LO, Q_HI, PAD_RATIO_LIMIT,
    MIN_TARGET_KB, MAX_TARGET_KB, WINDOW_LO, WINDOW_HI,
    targetBytesFor, windowFor, validateTarget, isJpeg, padJpegBytes,
    encodeToTarget, evaluateSize,
  };
});
