// core.js — CPNS/PPPK file kit: pure logic (size fitting, spec constants).
// Environment-agnostic: attaches window.CPNSCore in the browser,
// module.exports in Node (same pattern as id-photo/js/core.js).
//
// The size-fitting core is ported from photo-tools/js/jpeg-size.js — the
// algorithm that forces a JPEG into a portal's KB window by binary-searching
// quality first and pixel scale second.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CPNSCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;

  // SSCASN common requirements (always tell users to check their agency's
  // own announcement — these are the widely used defaults).
  const SPECS = {
    pasFoto: { wPx: 472, hPx: 709, capBytes: 200 * KB, label: 'Pas foto 4x6 (472x709 px @300 DPI), JPG <= 200 KB' },
    ktpCapsKB: [100, 200, 300],
    pdfCapBytes: 800 * KB,
  };

  const BG_COLORS = { red: '#ff0000', blue: '#0000ff' };

  async function byteLen(encoded) {
    if (encoded == null) throw new Error('encoder returned nothing');
    if (typeof encoded.byteLength === 'number') return encoded.byteLength;
    if (typeof encoded.size === 'number') return encoded.size; // Blob
    if (typeof encoded.length === 'number') return encoded.length;
    throw new Error('cannot determine encoded size');
  }

  /**
   * Find (quality, scale) so encoded size lands in [minBytes, maxBytes],
   * preferring the largest size that still fits under maxBytes.
   * encodeAt(quality, scale) must return bytes/Blob. Ported verbatim in
   * behaviour from photo-tools/js/jpeg-size.js (see that file for the
   * full rationale comments).
   */
  async function encodeToTargetSize(encodeAt, opts = {}) {
    const minBytes = opts.minBytes ?? 0;
    const maxBytes = opts.maxBytes ?? Number.POSITIVE_INFINITY;
    const initialScale = opts.initialScale ?? 1;
    const Q_LO = 0.03;
    const Q_HI = 1.0;
    let encodes = 0;

    const sizeAt = async (q, s) => {
      encodes += 1;
      return byteLen(await encodeAt(q, s));
    };

    async function bestAtScale(scale) {
      const loSize = await sizeAt(Q_LO, scale);
      if (loSize > maxBytes) return null;
      const hiSize = await sizeAt(Q_HI, scale);
      if (hiSize <= maxBytes) return { quality: Q_HI, sizeBytes: hiSize };
      let lo = Q_LO, hi = Q_HI, best = { quality: Q_LO, sizeBytes: loSize };
      for (let i = 0; i < 8; i += 1) {
        const mid = (lo + hi) / 2;
        const s = await sizeAt(mid, scale);
        if (s <= maxBytes) { best = { quality: mid, sizeBytes: s }; lo = mid; }
        else { hi = mid; }
      }
      return best;
    }

    let result = await bestAtScale(initialScale);
    if (result && result.sizeBytes >= minBytes) {
      return { ok: true, withinRange: true, scale: initialScale, encodes, note: 'fits at natural scale', ...result };
    }
    if (result) {
      let bestBelow = { ...result, scale: initialScale };
      for (const scale of [1.5, 2, 2.5, 3, 4]) {
        if (scale <= initialScale) continue;
        const r = await bestAtScale(scale);
        if (!r) continue;
        if (r.sizeBytes >= minBytes) {
          return { ok: true, withinRange: true, scale, encodes, note: 'fits after upscale', ...r };
        }
        if (r.sizeBytes > bestBelow.sizeBytes) bestBelow = { ...r, scale };
      }
      return { ok: true, withinRange: false, encodes, note: 'could not reach the minimum KB even upscaled x4', ...bestBelow };
    }
    let last = null;
    for (const scale of [0.75, 0.6, 0.5, 0.4, 0.3, 0.2, 0.12]) {
      if (scale >= initialScale) continue;
      const r = await bestAtScale(scale);
      if (r) { last = { ...r, scale }; break; }
    }
    if (last) {
      return { ok: true, withinRange: last.sizeBytes >= minBytes, scale: last.scale, encodes, note: 'fits after downscale', ...last };
    }
    return { ok: false, withinRange: false, quality: Q_LO, scale: 0.12, sizeBytes: -1, encodes, note: 'could not fit under the maximum KB at any scale' };
  }

  /**
   * Quality-only fit at FIXED pixel dimensions (for pas foto, whose pixel
   * size must stay exactly 472x709). encodeAtQuality(q) returns bytes/Blob.
   * Returns the highest quality whose size <= capBytes; over=true when even
   * the lowest quality overflows (caller must say so honestly).
   */
  async function encodeUnderCapFixedDims(encodeAtQuality, capBytes) {
    const Q_LO = 0.03, Q_HI = 1.0;
    const loBytes = await encodeAtQuality(Q_LO);
    const loSize = await byteLen(loBytes);
    if (loSize > capBytes) return { over: true, quality: Q_LO, sizeBytes: loSize, bytes: loBytes };
    const hiBytes = await encodeAtQuality(Q_HI);
    const hiSize = await byteLen(hiBytes);
    if (hiSize <= capBytes) return { over: false, quality: Q_HI, sizeBytes: hiSize, bytes: hiBytes };
    let lo = Q_LO, hi = Q_HI;
    let best = { quality: Q_LO, sizeBytes: loSize, bytes: loBytes };
    for (let i = 0; i < 9; i += 1) {
      const mid = (lo + hi) / 2;
      const b = await encodeAtQuality(mid);
      const s = await byteLen(b);
      if (s <= capBytes) { best = { quality: mid, sizeBytes: s, bytes: b }; lo = mid; }
      else { hi = mid; }
    }
    return { over: false, ...best };
  }

  /** Merge-size verdict for the 800 KB SSCASN PDF cap. Pure logic. */
  function evaluatePdfSize(totalBytes, capBytes = SPECS.pdfCapBytes) {
    return {
      over: totalBytes > capBytes,
      totalBytes,
      capBytes,
      kb: totalBytes / KB,
      capKB: capBytes / KB,
    };
  }

  return { KB, SPECS, BG_COLORS, encodeToTargetSize, encodeUnderCapFixedDims, evaluatePdfSize };
});
