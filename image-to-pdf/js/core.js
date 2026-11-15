// core.js — Image to PDF (image-to-pdf): pure logic.
// Minimal PDF writer, hand-rolled, no libraries: embeds each image as
// a DCTDecode (JPEG) image XObject, one image per A4 page.
// Environment-agnostic: attaches window.PdfToolCore in the browser,
// module.exports in Node. No DOM anywhere in this file.
//
// PDF structure per document:
//   1 Catalog, 2 Pages, then per image i (0-based):
//     page obj 3+i*3, content-stream obj 4+i*3, image XObject 5+i*3,
//   plus one Helvetica Type1 font object at the end when page numbers
//   are on (standard 14 font — no embedding, no external file).
//
// Layout (points; 1 pt = 1/72 in; A4 = 595.28 x 841.89 pt):
//   fit  — whole image visible, 36 pt (0.5 in) margin on all sides.
//   fill — image covers the whole page; overflow is cropped by the
//          page edge (drawn rect extends past the MediaBox).
// Page numbers, when on, sit 20 pt above the bottom edge, centred,
// in 10 pt Helvetica. Off by default.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PdfToolCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const A4_W = 595.28;
  const A4_H = 841.89;
  const MARGIN_PT = 36;      // fit-mode margin, all sides
  const PAGE_NUM_Y = 20;     // page-number baseline above bottom edge
  const PAGE_NUM_SIZE = 10;  // Helvetica pt size for page numbers

  /** Two decimals max, no trailing noise: 595.28 stays "595.28", 900 stays "900". */
  function fmt(n) {
    const r = Math.round(n * 100) / 100;
    return String(r);
  }

  /** Page size in points for an orientation. */
  function pageSize(orientation) {
    if (orientation === 'landscape') return { w: A4_H, h: A4_W };
    return { w: A4_W, h: A4_H };
  }

  /**
   * Where one image lands on its page (PDF coords, origin bottom-left).
   * Returns { pageW, pageH, x, y, w, h } — all in points.
   */
  function layoutImage(imgW, imgH, orientation, fitMode) {
    if (!(imgW > 0) || !(imgH > 0)) throw new Error('layoutImage: bad image size ' + imgW + 'x' + imgH);
    const { w: pageW, h: pageH } = pageSize(orientation);
    let w, h;
    if (fitMode === 'fill') {
      const s = Math.max(pageW / imgW, pageH / imgH);
      w = imgW * s;
      h = imgH * s;
    } else {
      const s = Math.min((pageW - 2 * MARGIN_PT) / imgW, (pageH - 2 * MARGIN_PT) / imgH);
      w = imgW * s;
      h = imgH * s;
    }
    return { pageW, pageH, x: (pageW - w) / 2, y: (pageH - h) / 2, w, h };
  }

  /** Concatenate Uint8Arrays. */
  function concat(parts) {
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  const enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  function bytes(str) {
    if (enc) return enc.encode(str);
    // Node fallback (TextEncoder exists in Node 11+, this is belt & braces).
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
    return arr;
  }

  /** Escape PDF literal-string bytes: ( ) \ — page numbers are digits only. */
  function pdfString(s) {
    return '(' + String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
  }

  /**
   * Build a PDF.
   * images: [{ jpegBytes: Uint8Array, width: number, height: number }, ...]
   * options: { orientation: 'portrait'|'landscape', fitMode: 'fit'|'fill',
   *            pageNumbers: boolean }
   * Returns Uint8Array of the complete PDF file.
   */
  function buildPdf(images, options) {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error('buildPdf: need at least one image');
    }
    options = options || {};
    const orientation = options.orientation === 'landscape' ? 'landscape' : 'portrait';
    const fitMode = options.fitMode === 'fill' ? 'fill' : 'fit';
    const pageNumbers = !!options.pageNumbers;
    const n = images.length;

    for (let i = 0; i < n; i++) {
      const im = images[i];
      if (!(im.jpegBytes instanceof Uint8Array) || im.jpegBytes.length < 4) {
        throw new Error('buildPdf: image ' + i + ' has no JPEG bytes');
      }
      if (im.jpegBytes[0] !== 0xff || im.jpegBytes[1] !== 0xd8) {
        throw new Error('buildPdf: image ' + i + ' is not a JPEG (no SOI marker)');
      }
      if (!(im.width > 0) || !(im.height > 0)) {
        throw new Error('buildPdf: image ' + i + ' has no dimensions');
      }
    }

    const fontObj = pageNumbers ? 3 + n * 3 : 0;
    const totalObjects = 2 + n * 3 + (pageNumbers ? 1 : 0);
    const objects = new Array(totalObjects + 1); // 1-based

    // 1 — Catalog
    objects[1] = bytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    // 2 — Pages
    const kids = [];
    for (let i = 0; i < n; i++) kids.push((3 + i * 3) + ' 0 R');
    objects[2] = bytes('2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>\nendobj\n');

    const { w: pageW, h: pageH } = pageSize(orientation);

    for (let i = 0; i < n; i++) {
      const im = images[i];
      const pageObj = 3 + i * 3;
      const contentsObj = 4 + i * 3;
      const imgObj = 5 + i * 3;
      const lay = layoutImage(im.width, im.height, orientation, fitMode);

      // Page dict
      let res = '<< /XObject << /Im1 ' + imgObj + ' 0 R >>';
      if (pageNumbers) res += ' /Font << /F1 ' + fontObj + ' 0 R >>';
      res += ' >>';
      objects[pageObj] = bytes(
        pageObj + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
        fmt(pageW) + ' ' + fmt(pageH) + '] /Resources ' + res +
        ' /Contents ' + contentsObj + ' 0 R >>\nendobj\n'
      );

      // Content stream: draw the image, then (optionally) the page number.
      let content = 'q ' + fmt(lay.w) + ' 0 0 ' + fmt(lay.h) + ' ' + fmt(lay.x) + ' ' + fmt(lay.y) +
        ' cm /Im1 Do Q\n';
      if (pageNumbers) {
        const label = String(i + 1);
        // Helvetica digit advance ~0.556 em at 10 pt -> 5.56 pt per digit.
        const tw = label.length * PAGE_NUM_SIZE * 0.556;
        const tx = (pageW - tw) / 2;
        content += 'BT /F1 ' + PAGE_NUM_SIZE + ' Tf 1 0 0 1 ' + fmt(tx) + ' ' + PAGE_NUM_Y +
          ' Tm ' + pdfString(label) + ' Tj ET\n';
      }
      const contentBytes = bytes(content);
      objects[contentsObj] = concat([
        bytes(contentsObj + ' 0 obj\n<< /Length ' + contentBytes.length + ' >>\nstream\n'),
        contentBytes,
        bytes('\nendstream\nendobj\n'),
      ]);

      // Image XObject: raw JPEG bytes as a DCTDecode stream.
      objects[imgObj] = concat([
        bytes(imgObj + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + im.width +
          ' /Height ' + im.height + ' /ColorSpace /DeviceRGB /BitsPerComponent 8' +
          ' /Filter /DCTDecode /Length ' + im.jpegBytes.length + ' >>\nstream\n'),
        im.jpegBytes,
        bytes('\nendstream\nendobj\n'),
      ]);
    }

    if (pageNumbers) {
      objects[fontObj] = bytes(
        fontObj + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n'
      );
    }

    // Assemble: header + objects + xref + trailer.
    const header = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, // %PDF-1.4\n
      0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,                   // %<binary>\n
    ]);
    const parts = [header];
    const offsets = new Array(totalObjects + 1);
    let pos = header.length;
    for (let i = 1; i <= totalObjects; i++) {
      offsets[i] = pos;
      parts.push(objects[i]);
      pos += objects[i].length;
    }
    const xrefPos = pos;
    let xref = 'xref\n0 ' + (totalObjects + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= totalObjects; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    xref += 'trailer\n<< /Size ' + (totalObjects + 1) + ' /Root 1 0 R >>\n' +
      'startxref\n' + xrefPos + '\n%%EOF\n';
    parts.push(bytes(xref));
    return concat(parts);
  }

  return {
    A4_W, A4_H, MARGIN_PT, PAGE_NUM_Y, PAGE_NUM_SIZE,
    pageSize, layoutImage, buildPdf,
  };
});
