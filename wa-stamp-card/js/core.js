// wa-stamp-card — pure geometry / text helpers (no DOM).
// Exposed as window.StampCore in the browser and module.exports in Node
// (same pattern as receipt-maker/js/core.js).
//
// Card geometry (single source of truth — the canvas renderer in app.js
// and the PIL verifier both read these numbers, via window.StampCore
// in the browser and the layout JSON the harness dumps):
//   canvas 1080x1080, white background (#FFFFFF)
//   header band: accent colour, y 0..300
//   stamp grid area: y 360..860
//   footer: reward line ~y 920, instruction line ~y 985
// Filled stamp: solid accent disc + white star glyph centred on it.
// Empty stamp: dashed accent outline, centre left as plain card white.
// The star glyph occupies the centre of a filled stamp, so a pixel
// probe for "filled" must NOT sit at the centre: probePoint() sits at
// +0.75*r on the x-axis — inside the disc, clear of the star (star is
// drawn at 64px bold, half-width ~35px, while 0.75*r >= 55px for every
// total). Empty stamps are probed at their exact centre (plain white).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.StampCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CARD_W = 1080;
  const CARD_H = 1080;
  const BG_HEX = '#ffffff';
  const HEADER_H = 300;
  const GRID_TOP = 360;
  const GRID_BOTTOM = 860;
  const GRID_MARGIN_X = 60;

  const ACCENTS = [
    { id: 'blue',   hex: '#1450a0', name: 'Blue' },
    { id: 'green',  hex: '#177245', name: 'Green' },
    { id: 'purple', hex: '#6d28d9', name: 'Purple' },
    { id: 'red',    hex: '#b3122e', name: 'Red' },
  ];

  const TOTALS = [6, 8, 10, 12];

  // Columns x rows per total. Kept small and even so the grid always
  // looks like a card, not a spreadsheet.
  const GRID_MAP = { 6: [3, 2], 8: [4, 2], 10: [5, 2], 12: [4, 3] };

  function accentById(id) {
    return ACCENTS.find((a) => a.id === id) || ACCENTS[0];
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || '').trim());
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
  }

  /** Stamp grid geometry for a given total. Centres are integers. */
  function stampLayout(total) {
    const t = GRID_MAP[total] ? total : 10;
    const cols = GRID_MAP[t][0], rows = GRID_MAP[t][1];
    const gridW = CARD_W - GRID_MARGIN_X * 2;
    const gridH = GRID_BOTTOM - GRID_TOP;
    const cellW = gridW / cols, cellH = gridH / rows;
    const r = Math.min(Math.floor(Math.min(cellW, cellH) / 2) - 14, 88);
    const centers = [];
    for (let i = 0; i < t; i++) {
      const c = i % cols, row = Math.floor(i / cols);
      centers.push({
        x: Math.round(GRID_MARGIN_X + cellW * (c + 0.5)),
        y: Math.round(GRID_TOP + cellH * (row + 0.5)),
      });
    }
    return { total: t, cols, rows, r, centers, cardW: CARD_W, cardH: CARD_H, bgHex: BG_HEX };
  }

  /** Pixel probe for a filled stamp: inside the disc, clear of the star. */
  function filledProbe(center, r) {
    return { x: Math.round(center.x + r * 0.75), y: center.y };
  }

  function clampEarned(earned, total) {
    const t = GRID_MAP[total] ? total : 10;
    let e = Math.floor(Number(earned));
    if (!Number.isFinite(e)) e = 0;
    if (e < 0) e = 0;
    if (e > t) e = t;
    return e;
  }

  function slugifyShop(shop) {
    const s = String(shop || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return s || 'shop';
  }

  /** WhatsApp number normalisation: keep digits only; a leading 0
   *  (Indonesian-style local number) becomes country code 62. */
  function normalizePhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.charAt(0) === '0') return '62' + digits.slice(1);
    return digits;
  }

  function buildWaText(doc) {
    const shop = (doc.shop || 'our shop').trim() || 'our shop';
    const reward = (doc.reward || '').trim();
    const earned = clampEarned(doc.earned, doc.total);
    const total = GRID_MAP[doc.total] ? doc.total : 10;
    let text = 'Hi ' + shop + '! I have ' + earned + ' of ' + total +
      ' stamps on my loyalty card.';
    if (reward) text += ' My reward: ' + reward + '.';
    return text;
  }

  function waLink(doc) {
    const phone = normalizePhone(doc.wa || '');
    const text = encodeURIComponent(buildWaText(doc));
    return 'https://wa.me/' + (phone || '') + '?text=' + text;
  }

  return {
    CARD_W, CARD_H, BG_HEX, HEADER_H, GRID_TOP, GRID_BOTTOM,
    ACCENTS, TOTALS, GRID_MAP,
    accentById, hexToRgb, stampLayout, filledProbe,
    clampEarned, slugifyShop, normalizePhone, buildWaText, waLink,
  };
});
