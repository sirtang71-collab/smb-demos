// core.js — Photo Background Colour Changer (photo-bg-color): pure logic.
// Swaps a solid / near-solid ID-photo background for white, standard ID
// blue or red, entirely in the browser. No libraries, no network.
//
// Method (all on raw RGBA buffers, so it runs identically in Node and
// in the browser):
//   1. estimateBackground — median colour of the outer border frame.
//   2. segmentBackground  — flood-fill (region growing) seeded from every
//      border pixel close to that median. A neighbour joins the
//      background when it is close to the pixel it grew from (so gentle
//      gradients are followed) AND within 2x tolerance of the median
//      (so the fill can never wander into the subject through a slow
//      gradient). 4-connectivity, so a diagonal gap cannot leak.
//   3. changeBackground  — background pixels become the target colour
//      exactly; the 1 px foreground rim next to the background is blended
//      50% toward the target (feather) so there is no hard halo.
//      Pixels with alpha < 128 count as background (transparent PNGs).
//
// Environment-agnostic: attaches window.BgToolCore in the browser,
// module.exports in Node. No DOM anywhere in this file.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BgToolCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Standard ID-photo background colours.
  const TARGETS = {
    white: { name: 'white', hex: '#FFFFFF', rgb: [255, 255, 255] },
    blue: { name: 'blue', hex: '#438EDB', rgb: [67, 142, 219] },
    red: { name: 'red', hex: '#FF0000', rgb: [255, 0, 0] },
  };
  const DEFAULT_TOLERANCE = 32; // RGB euclidean distance
  const MAX_TOLERANCE = 80;

  function clampTol(t) {
    t = Number(t);
    if (!isFinite(t) || t < 0) return DEFAULT_TOLERANCE;
    return Math.min(MAX_TOLERANCE, t);
  }

  /** Squared euclidean distance in RGB space. */
  function distSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return dr * dr + dg * dg + db * db;
  }

  function median(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  /**
   * Median colour of the outer border frame (2 px deep on all sides).
   * data: Uint8ClampedArray / Uint8Array RGBA, length w*h*4.
   * Returns { r, g, b }.
   */
  function estimateBackground(data, w, h) {
    if (!(w > 0) || !(h > 0) || data.length < w * h * 4) {
      throw new Error('estimateBackground: bad image ' + w + 'x' + h);
    }
    const rs = [], gs = [], bs = [];
    const inset = Math.min(2, Math.floor(Math.min(w, h) / 2));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const onBorder = x < inset || x >= w - inset || y < inset || y >= h - inset;
        if (!onBorder) continue;
        const i = (y * w + x) * 4;
        if (data[i + 3] < 128) continue; // transparent border counts as bg, not as a colour
        rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
      }
    }
    if (!rs.length) return { r: 255, g: 255, b: 255 }; // fully transparent image
    return { r: median(rs), g: median(gs), b: median(bs) };
  }

  /**
   * Flood-fill background mask. Returns Uint8Array(w*h), 1 = background.
   * Seeds: border pixels within tolerance of the estimated background
   * colour (or transparent). Growth: neighbour joins when it is within
   * tolerance of the pixel it grew from AND within 2x tolerance of the
   * estimated background colour.
   */
  function segmentBackground(data, w, h, tolerance) {
    tolerance = clampTol(tolerance);
    const tolSq = tolerance * tolerance;
    const tol2Sq = (2 * tolerance) * (2 * tolerance);
    const bg = estimateBackground(data, w, h);
    const mask = new Uint8Array(w * h);
    const queue = new Int32Array(w * h);
    let qh = 0, qt = 0;

    function trySeed(idx) {
      if (mask[idx]) return;
      const i = idx * 4;
      if (data[i + 3] < 128) { mask[idx] = 1; queue[qt++] = idx; return; }
      if (distSq(data[i], data[i + 1], data[i + 2], bg.r, bg.g, bg.b) <= tolSq) {
        mask[idx] = 1;
        queue[qt++] = idx;
      }
    }
    for (let x = 0; x < w; x++) { trySeed(x); trySeed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { trySeed(y * w); trySeed(y * w + w - 1); }

    while (qh < qt) {
      const idx = queue[qh++];
      const x = idx % w, y = (idx / w) | 0;
      const ci = idx * 4;
      const cr = data[ci], cg = data[ci + 1], cb = data[ci + 2];
      // 4 neighbours, inlined for speed.
      if (x > 0) {
        const n = idx - 1;
        if (!mask[n]) {
          const ni = n * 4;
          if (data[ni + 3] < 128 ||
            (distSq(data[ni], data[ni + 1], data[ni + 2], cr, cg, cb) <= tolSq &&
             distSq(data[ni], data[ni + 1], data[ni + 2], bg.r, bg.g, bg.b) <= tol2Sq)) {
            mask[n] = 1; queue[qt++] = n;
          }
        }
      }
      if (x < w - 1) {
        const n = idx + 1;
        if (!mask[n]) {
          const ni = n * 4;
          if (data[ni + 3] < 128 ||
            (distSq(data[ni], data[ni + 1], data[ni + 2], cr, cg, cb) <= tolSq &&
             distSq(data[ni], data[ni + 1], data[ni + 2], bg.r, bg.g, bg.b) <= tol2Sq)) {
            mask[n] = 1; queue[qt++] = n;
          }
        }
      }
      if (y > 0) {
        const n = idx - w;
        if (!mask[n]) {
          const ni = n * 4;
          if (data[ni + 3] < 128 ||
            (distSq(data[ni], data[ni + 1], data[ni + 2], cr, cg, cb) <= tolSq &&
             distSq(data[ni], data[ni + 1], data[ni + 2], bg.r, bg.g, bg.b) <= tol2Sq)) {
            mask[n] = 1; queue[qt++] = n;
          }
        }
      }
      if (y < h - 1) {
        const n = idx + w;
        if (!mask[n]) {
          const ni = n * 4;
          if (data[ni + 3] < 128 ||
            (distSq(data[ni], data[ni + 1], data[ni + 2], cr, cg, cb) <= tolSq &&
             distSq(data[ni], data[ni + 1], data[ni + 2], bg.r, bg.g, bg.b) <= tol2Sq)) {
            mask[n] = 1; queue[qt++] = n;
          }
        }
      }
    }
    return mask;
  }

  /**
   * Swap the background of an RGBA image for a target colour.
   * data: Uint8ClampedArray/Uint8Array RGBA (not mutated; a copy is returned).
   * target: 'white' | 'blue' | 'red' (key of TARGETS) or { r, g, b }.
   * options: { tolerance (default 32), feather (default true) }.
   * Returns { data: Uint8ClampedArray, width, height, target, bgColour,
   *           bgPixels, bgRatio, tolerance }.
   * Background pixels come out EXACTLY the target colour; the 1 px rim
   * of foreground next to the background is blended 50% toward it.
   */
  function changeBackground(data, w, h, target, options) {
    if (!(w > 0) || !(h > 0) || data.length < w * h * 4) {
      throw new Error('changeBackground: bad image ' + w + 'x' + h);
    }
    options = options || {};
    const tolerance = clampTol(options.tolerance === undefined ? DEFAULT_TOLERANCE : options.tolerance);
    const feather = options.feather !== false;
    let t;
    if (typeof target === 'string') {
      t = TARGETS[target];
      if (!t) throw new Error('changeBackground: unknown target ' + target);
      target = t.name;
    } else if (target && typeof target.r === 'number') {
      t = { name: 'custom', hex: null, rgb: [target.r | 0, target.g | 0, target.b | 0] };
      target = 'custom';
    } else {
      throw new Error('changeBackground: bad target');
    }
    const tr = t.rgb[0], tg = t.rgb[1], tb = t.rgb[2];

    const mask = segmentBackground(data, w, h, tolerance);
    const out = new Uint8ClampedArray(data);
    let bgPixels = 0;
    for (let idx = 0; idx < w * h; idx++) {
      if (!mask[idx]) continue;
      bgPixels++;
      const i = idx * 4;
      out[i] = tr; out[i + 1] = tg; out[i + 2] = tb; out[i + 3] = 255;
    }
    // Feather: 1 px foreground rim next to replaced background, 50% blend.
    if (feather) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (mask[idx]) continue;
          const touchesBg =
            (x > 0 && mask[idx - 1]) || (x < w - 1 && mask[idx + 1]) ||
            (y > 0 && mask[idx - w]) || (y < h - 1 && mask[idx + w]);
          if (!touchesBg) continue;
          const i = idx * 4;
          out[i] = Math.round((data[i] + tr) / 2);
          out[i + 1] = Math.round((data[i + 1] + tg) / 2);
          out[i + 2] = Math.round((data[i + 2] + tb) / 2);
          out[i + 3] = 255;
        }
      }
    }
    return {
      data: out, width: w, height: h, target,
      bgColour: estimateBackground(data, w, h),
      bgPixels, bgRatio: bgPixels / (w * h), tolerance,
    };
  }

  return {
    TARGETS, DEFAULT_TOLERANCE, MAX_TOLERANCE,
    distSq, estimateBackground, segmentBackground, changeBackground,
  };
});
