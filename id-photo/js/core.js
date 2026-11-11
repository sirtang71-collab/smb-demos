// core.js — ID / passport photo maker: pure logic (presets, print layout).
// Environment-agnostic: attaches window.IDCore in the browser, module.exports in Node.
// All presets are specified at 300 DPI; pixel size = round(mm / 25.4 * 300).

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.IDCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DPI = 300;
  const mmToPx = (mm) => Math.round((mm / 25.4) * DPI);

  // bgNote = background guidance only (this tool does NOT replace backgrounds).
  // guide: generic framing aid — crown line / chin line as fractions of photo height.
  const PRESETS = [
    {
      id: 'us', country: 'United States', name: 'Passport / Visa',
      spec: '2 × 2 in', wMm: 50.8, hMm: 50.8,
      bgNote: 'Plain white background, no shadows. Head must fill 50–69% of the height.',
    },
    {
      id: 'uk', country: 'United Kingdom', name: 'Passport',
      spec: '35 × 45 mm', wMm: 35, hMm: 45,
      bgNote: 'Plain light grey or cream background, no shadows.',
    },
    {
      id: 'eu', country: 'European Union', name: 'Passport / Schengen visa',
      spec: '35 × 45 mm', wMm: 35, hMm: 45,
      bgNote: 'Plain light grey or white background, face clearly lit.',
    },
    {
      id: 'in', country: 'India', name: 'Passport',
      spec: '2 × 2 in', wMm: 50.8, hMm: 50.8,
      bgNote: 'Plain white background, both ears visible where possible.',
    },
    {
      id: 'pk', country: 'Pakistan', name: 'Passport / CNIC',
      spec: '2 × 2 in', wMm: 50.8, hMm: 50.8,
      bgNote: 'Plain white background, taken within the last 6 months.',
    },
    {
      id: 'id', country: 'Indonesia', name: 'Pas foto',
      spec: '4 × 6 cm', wMm: 40, hMm: 60,
      bgNote: 'Traditional pas foto uses a red background (blue for some KTP cases); passport applications ask for white.',
    },
    {
      id: 'my', country: 'Malaysia', name: 'Passport',
      spec: '35 × 50 mm', wMm: 35, hMm: 50,
      bgNote: 'Plain white background, no head covering except for religious reasons.',
    },
    {
      id: 'sg', country: 'Singapore', name: 'Passport / IC',
      spec: '35 × 45 mm', wMm: 35, hMm: 45,
      bgNote: 'Plain white background, taken within the last 3 months.',
    },
    {
      id: 'cn1', country: 'China', name: '一寸 (1-inch)',
      spec: '25 × 35 mm', wMm: 25, hMm: 35,
      bgNote: 'White, blue or red background are all common; white is the safest default.',
    },
    {
      id: 'cn2', country: 'China', name: '二寸 (2-inch)',
      spec: '35 × 49 mm', wMm: 35, hMm: 49,
      bgNote: 'White, blue or red background are all common; white is the safest default.',
    },
  ].map((p) => ({ ...p, wPx: mmToPx(p.wMm), hPx: mmToPx(p.hMm), dpi: DPI }));

  const GUIDE = { crownPct: 0.10, chinPct: 0.72, ovalWidthPct: 0.62 };

  // 4in x 6in photo paper at 300 DPI.
  const SHEET = { wPx: 1800, hPx: 1200, label: '4 × 6 in @ 300 DPI', margin: 36, gap: 24 };

  /**
   * Tile a photo of (photoW x photoH) px onto the sheet.
   * Returns { cols, rows, count, positions: [{x, y}] } — positions are top-left
   * corners, tiles centred on the sheet as a block.
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

  return { DPI, mmToPx, PRESETS, GUIDE, SHEET, layoutSheet };
});
