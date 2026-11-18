// compress.js — PDF Compress to KB (pdf-compress-kb): pure logic.
// Reuses the hand-written PDF parser / rebuilder from js/core.js
// (pdf-split core: classic xref tables, xref streams, object streams,
// FlateDecode) and adds image extraction + recompression:
//   - finds embedded image XObjects on every page
//   - DCTDecode (JPEG) images: decoded by the injected codec, re-encoded
//     at a lower quality / DPI
//   - FlateDecode images: inflated with the core's hand-written
//     inflate, PNG/TIFF predictors undone, palette/grey expanded to
//     RGB, then JPEG-encoded by the codec
//   - rebuilds the whole PDF (page count and page sizes unchanged)
//     with the recompressed images, walking a DPI ladder
//     (300 → 50) with a quality bisection inside each rung until the
//     rebuilt file fits the byte budget.
// Environment-agnostic: attaches window.PdfCompress in the browser,
// module.exports in Node. No DOM anywhere in this file. The JPEG
// codec is injected (browser: canvas in js/jpeg.js; Node tests: a
// PIL-backed codec) because neither environment ships a JPEG
// encoder/decoder in plain JS:
//   codec.decodeJpeg(bytes) -> Promise<{ width, height, data: Uint8Array(RGB) }>
//   codec.encodeJpeg({ width, height, data }, targetW, targetH, quality)
//       -> Promise<Uint8Array>  (baseline JPEG, quality 1..100)
//
// Rejected with a clear message instead of producing a bad file:
// encrypted PDF, non-PDF, no embedded images (text/vector-only PDF),
// image using a filter other than DCTDecode/FlateDecode, CMYK or
// ICC-based images, images with a transparency mask (/SMask) or
// stencil mask (/ImageMask), FlateDecode images that are not 8-bit,
// over the limits (>20 MB, >200 pages), and a target that cannot be
// reached even at the lowest rung.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PdfCompress = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // core.js is loaded first in the browser; required in Node.
  const Core = (typeof window !== 'undefined' && window.PdfToolCore) ||
    (typeof self !== 'undefined' && self.PdfToolCore) ||
    (typeof require === 'function' ? require('./core.js') : null);
  if (!Core) throw new Error('compress.js: js/core.js must load first');

  const L = Core.LIMITS;
  const DPI_RUNGS = [300, 200, 150, 100, 72, 50];
  const Q_MAX = 92, Q_MIN = 10;
  const MIN_TARGET_BYTES = 10 * 1024;

  /* ================= small helpers ================= */

  function filterNames(dict) {
    const f = dict.Filter;
    if (f === undefined) return [];
    const list = Array.isArray(f) ? f : [f];
    return list.map((v) => (Core.isName(v) ? v.name : String(v)));
  }

  function decodeParms(dict) {
    const p = dict.DecodeParms;
    if (!p) return null;
    const first = Array.isArray(p) ? p[0] : p;
    return Core.isDict(first) ? first : null;
  }

  /* ================= page walk (same as splitPdfs) ================= */

  function walkPageNums(doc) {
    const root = doc.resolve(doc.rootRef);
    const pagesNode = doc.resolve(root.Pages);
    const withNums = [];
    const walk = (node, nodeRef, inherited) => {
      const inh = {
        mediaBox: node.MediaBox !== undefined ? node.MediaBox : inherited.mediaBox,
        rotate: node.Rotate !== undefined ? node.Rotate : inherited.rotate,
        resources: node.Resources !== undefined ? node.Resources : inherited.resources,
      };
      if (Core.isName(node.Type, 'Page')) {
        withNums.push({ num: nodeRef.ref, mediaBox: inh.mediaBox, rotate: inh.rotate || 0, resources: inh.resources });
        return;
      }
      for (const kid of node.Kids) walk(doc.resolve(kid), kid, inh);
    };
    walk(pagesNode, root.Pages, { mediaBox: undefined, rotate: 0, resources: undefined });
    return withNums;
  }

  /* ================= image discovery ================= */

  // One record per embedded image XObject usage (same object on two
  // pages appears twice; decoding/encoding is deduped by objNum).
  function findImages(doc, withNums) {
    const images = [];
    const seen = new Set();
    for (let pi = 0; pi < withNums.length; pi++) {
      const pg = withNums[pi];
      const res = doc.resolve(pg.resources);
      if (!Core.isDict(res)) continue;
      const xo = doc.resolve(res.XObject);
      if (!Core.isDict(xo)) continue;
      for (const name of Object.keys(xo)) {
        const ref = xo[name];
        if (!Core.isRef(ref)) continue;
        const obj = doc.getObject(ref.ref);
        if (!obj || !Core.isDict(obj.value)) continue;
        const d = obj.value;
        if (!Core.isName(d.Subtype, 'Image')) continue;
        if (d.SMask !== undefined) {
          throw new Error('image "' + name + '" on page ' + (pi + 1) +
            ' uses a transparency mask (/SMask) — this compressor cannot rebuild masked images');
        }
        if (d.ImageMask === true) {
          throw new Error('image "' + name + '" on page ' + (pi + 1) +
            ' is a stencil mask (/ImageMask) — this compressor only handles full-colour scans');
        }
        if (typeof d.Width !== 'number' || typeof d.Height !== 'number' ||
            d.Width < 1 || d.Height < 1) {
          throw new Error('image "' + name + '" on page ' + (pi + 1) + ' has no usable /Width or /Height');
        }
        const filters = filterNames(d);
        if (filters.length !== 1 || (filters[0] !== 'DCTDecode' && filters[0] !== 'DCT' &&
            filters[0] !== 'FlateDecode' && filters[0] !== 'Fl')) {
          throw new Error('image "' + name + '" on page ' + (pi + 1) +
            ' uses the filter /' + (filters[0] || 'none') +
            ' — only DCTDecode (JPEG) and FlateDecode images can be recompressed');
        }
        const cs = d.ColorSpace;
        let csKind = 'unknown';
        if (Core.isName(cs, 'DeviceRGB')) csKind = 'rgb';
        else if (Core.isName(cs, 'DeviceGray')) csKind = 'gray';
        else if (Array.isArray(cs) && Core.isName(cs[0], 'Indexed')) csKind = 'indexed';
        else {
          throw new Error('image "' + name + '" on page ' + (pi + 1) +
            ' uses a colour space this compressor cannot handle (' +
            (Core.isName(cs) ? '/' + cs.name : 'array') +
            ') — only DeviceRGB, DeviceGray and Indexed are supported');
        }
        const bpc = d.BitsPerComponent;
        if (filters[0] === 'FlateDecode' || filters[0] === 'Fl') {
          if (bpc !== 8) {
            throw new Error('image "' + name + '" on page ' + (pi + 1) +
              ' is a FlateDecode image with ' + bpc +
              ' bits per component — only 8-bit FlateDecode images are supported');
          }
        }
        if (!obj.stream) {
          throw new Error('image "' + name + '" on page ' + (pi + 1) + ' has no image data');
        }
        const key = ref.ref;
        const rec = {
          objNum: ref.ref, pageIndex: pi, name,
          width: d.Width, height: d.Height,
          filter: filters[0] === 'Fl' ? 'FlateDecode' : (filters[0] === 'DCT' ? 'DCTDecode' : filters[0]),
          colorSpace: csKind, csRaw: cs, bpc: bpc === undefined ? 8 : bpc,
          decodeParms: decodeParms(d), stream: obj.stream,
          origBytes: obj.stream.length,
        };
        images.push(rec);
        seen.add(key);
      }
    }
    return { images, uniqueCount: seen.size };
  }

  /* ================= FlateDecode image -> RGB ================= */

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  // Undo PDF predictor on inflated image data (8-bit only).
  // predictor: 1 none, 2 TIFF, 10-15 PNG (filter byte per row).
  function unPredict(data, width, height, components, predictor) {
    const rowBytes = width * components; // 8-bit samples
    if (predictor === 1 || predictor === undefined) {
      if (data.length < rowBytes * height) throw new Error('FlateDecode image data is truncated');
      return data.subarray(0, rowBytes * height);
    }
    if (predictor === 2) {
      if (data.length < rowBytes * height) throw new Error('FlateDecode image data is truncated');
      const out = new Uint8Array(rowBytes * height);
      for (let y = 0; y < height; y++) {
        const src = y * rowBytes;
        for (let x = 0; x < rowBytes; x++) {
          const left = x >= components ? out[src + x - components] : 0;
          out[src + x] = (data[src + x] + left) & 0xff;
        }
      }
      return out;
    }
    if (predictor >= 10 && predictor <= 15) {
      const stride = rowBytes + 1;
      if (data.length < stride * height) throw new Error('FlateDecode image data is truncated');
      const out = new Uint8Array(rowBytes * height);
      const bpp = Math.max(1, components);
      for (let y = 0; y < height; y++) {
        const src = y * stride;
        const filter = data[src];
        const dst = y * rowBytes;
        const prev = y > 0 ? out.subarray(dst - rowBytes, dst) : null;
        for (let x = 0; x < rowBytes; x++) {
          const raw = data[src + 1 + x];
          const a = x >= bpp ? out[dst + x - bpp] : 0;
          const b = prev ? prev[x] : 0;
          const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
          let v;
          if (filter === 0) v = raw;
          else if (filter === 1) v = raw + a;
          else if (filter === 2) v = raw + b;
          else if (filter === 3) v = raw + ((a + b) >> 1);
          else if (filter === 4) v = raw + paeth(a, b, c);
          else throw new Error('FlateDecode image uses unknown PNG predictor filter ' + filter);
          out[dst + x] = v & 0xff;
        }
      }
      return out;
    }
    throw new Error('FlateDecode image uses unsupported predictor ' + predictor);
  }

  function expandToRgb(raw, width, height, rec) {
    const px = width * height;
    const out = new Uint8Array(px * 3);
    if (rec.colorSpace === 'rgb') {
      if (raw.length < px * 3) throw new Error('FlateDecode image data is truncated');
      out.set(raw.subarray(0, px * 3));
      return out;
    }
    if (rec.colorSpace === 'gray') {
      if (raw.length < px) throw new Error('FlateDecode image data is truncated');
      for (let i = 0; i < px; i++) {
        const g = raw[i];
        out[i * 3] = g; out[i * 3 + 1] = g; out[i * 3 + 2] = g;
      }
      return out;
    }
    // Indexed: csRaw = [/Indexed base hival lookup]
    const cs = rec.csRaw;
    const base = cs[1];
    const hival = cs[2];
    const lookup = cs[3];
    if (typeof lookup !== 'string') {
      throw new Error('Indexed image "' + rec.name + '" has a lookup table this compressor cannot read');
    }
    const baseComps = Core.isName(base, 'DeviceGray') ? 1 : 3;
    if (raw.length < px) throw new Error('FlateDecode image data is truncated');
    for (let i = 0; i < px; i++) {
      const idx = raw[i];
      if (idx > hival) throw new Error('Indexed image "' + rec.name + '" has a palette index past the end');
      if (baseComps === 1) {
        const g = lookup.charCodeAt(idx) & 0xff;
        out[i * 3] = g; out[i * 3 + 1] = g; out[i * 3 + 2] = g;
      } else {
        const o = idx * 3;
        out[i * 3] = lookup.charCodeAt(o) & 0xff;
        out[i * 3 + 1] = lookup.charCodeAt(o + 1) & 0xff;
        out[i * 3 + 2] = lookup.charCodeAt(o + 2) & 0xff;
      }
    }
    return out;
  }

  async function decodeImageToRgb(rec, codec) {
    if (rec.filter === 'DCTDecode') {
      const px = await codec.decodeJpeg(rec.stream);
      if (!px || typeof px.width !== 'number' || !(px.data instanceof Uint8Array)) {
        throw new Error('could not decode the JPEG image "' + rec.name + '" on page ' + (rec.pageIndex + 1));
      }
      return px;
    }
    // FlateDecode
    const inflated = Core.inflate(rec.stream);
    const parms = rec.decodeParms || {};
    const predictor = typeof parms.Predictor === 'number' ? parms.Predictor : 1;
    const components = rec.colorSpace === 'rgb' ? 3 : 1;
    const raw = unPredict(inflated, rec.width, rec.height, components, predictor);
    const rgb = expandToRgb(raw, rec.width, rec.height, rec);
    return { width: rec.width, height: rec.height, data: rgb };
  }

  /* ================= placement: how big is the image on the page? ================= */

  // Tokenise a content stream, skipping literal/hex strings and
  // inline-image (BI…EI) data. Returns tokens: numbers, {name}, 'cm', 'Do', …
  function contentTokens(text) {
    const toks = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\0') { i++; continue; }
      if (ch === '%') { while (i < n && text[i] !== '\n' && text[i] !== '\r') i++; continue; }
      if (ch === '(') {
        let depth = 1; i++;
        while (i < n && depth > 0) {
          if (text[i] === '\\') { i += 2; continue; }
          if (text[i] === '(') depth++;
          else if (text[i] === ')') depth--;
          i++;
        }
        continue;
      }
      if (ch === '<' && text[i + 1] !== '<') {
        i++;
        while (i < n && text[i] !== '>') i++;
        i++;
        continue;
      }
      if (ch === '/') {
        let j = i + 1;
        while (j < n && !/[\s\[\]()<>/%]/.test(text[j])) j++;
        toks.push({ name: text.slice(i + 1, j) });
        i = j;
        continue;
      }
      let j = i;
      while (j < n && !/[\s\[\]()<>/%]/.test(text[j])) j++;
      if (j === i) { i++; continue; }
      const word = text.slice(i, j);
      const num = Number(word);
      toks.push(Number.isFinite(num) && /^-?\d*\.?\d+$/.test(word) ? num : word);
      i = j;
    }
    return toks;
  }

  // Map image name -> { wPt, hPt } for one page; empty map = unknown.
  function placementsForPage(doc, pageObjNum) {
    const out = new Map();
    try {
      const obj = doc.getObject(pageObjNum);
      if (!obj || !Core.isDict(obj.value)) return out;
      const contents = obj.value.Contents;
      const refs = [];
      if (Core.isRef(contents)) refs.push(contents.ref);
      else if (Array.isArray(contents)) {
        for (const c of contents) if (Core.isRef(c)) refs.push(c.ref);
      }
      let cm = null;
      for (const refNum of refs) {
        const cobj = doc.getObject(refNum);
        if (!cobj || !cobj.stream) continue;
        let bytes;
        try { bytes = Core.decodeStreamData(cobj.value, cobj.stream); }
        catch (e) { continue; }
        const toks = contentTokens(Core.latin1(bytes));
        for (let t = 0; t < toks.length; t++) {
          const tok = toks[t];
          if (tok === 'cm' && t >= 6 && toks.slice(t - 6, t).every((v) => typeof v === 'number')) {
            cm = toks.slice(t - 6, t);
          } else if (tok === 'Do' && t >= 1 && toks[t - 1] && typeof toks[t - 1] === 'object' && toks[t - 1].name) {
            if (cm) {
              const wPt = Math.hypot(cm[0], cm[1]);
              const hPt = Math.hypot(cm[2], cm[3]);
              if (wPt > 0 && hPt > 0) out.set(toks[t - 1].name, { wPt, hPt });
            }
          } else if (tok === 'BI') {
            // skip inline image data up to EI
            while (t < toks.length && toks[t] !== 'EI') t++;
          }
        }
      }
    } catch (e) { /* placement is best-effort; fall back to full page */ }
    return out;
  }

  /* ================= rebuild with replaced images ================= */

  // Rebuild the whole document (all pages), replacing the image
  // streams in `replacements` (Map oldNum -> { width, height, bytes }).
  // Same emit rules as splitPdfs: fresh catalog + page tree, every
  // object reachable from the kept pages copied with renumbered
  // references, missing references pointed at a shared null object,
  // xref rebuilt. Page count, MediaBox and Rotate are preserved.
  function buildOutput(doc, withNums, replacements) {
    const needed = new Set();
    for (const pg of withNums) {
      const obj = doc.getObject(pg.num);
      if (!obj) throw new Error('page object ' + pg.num + ' is missing');
      const refs = new Set();
      const dictCopy = Object.create(null);
      for (const k of Object.keys(obj.value)) {
        if (k === 'Parent') continue;
        dictCopy[k] = obj.value[k];
      }
      Core.collectRefs(dictCopy, refs, true);
      const queue = [...refs];
      needed.add(pg.num);
      while (queue.length) {
        const n = queue.pop();
        if (n === 0 || needed.has(n)) continue;
        const o = doc.getObject(n);
        if (!o) continue;
        needed.add(n);
        const sub = new Set();
        Core.collectRefs(o.value, sub, !!o.stream);
        for (const r of sub) if (!needed.has(r)) queue.push(r);
      }
    }
    let needsNull = false;
    for (const n of needed) {
      const obj = doc.getObject(n);
      if (!obj) continue;
      const refs = new Set();
      Core.collectRefs(obj.value, refs, !!obj.stream);
      for (const r of refs) {
        if (r !== 0 && !needed.has(r) && !doc.getObject(r)) needsNull = true;
      }
    }

    let nextNum = 3;
    let nullObjNum = 0;
    if (needsNull) { nullObjNum = nextNum++; }
    const map = new Map();
    const sorted = [...needed].sort((a, b) => a - b);
    for (const old of sorted) map.set(old, nextNum++);
    const newPageNums = withNums.map((pg) => map.get(pg.num));
    const totalObjects = nextNum - 1;

    function remapText(text) {
      return text.replace(/(\d+)\s+(\d+)\s+R/g, (m, num) => {
        const n = parseInt(num, 10);
        if (n === 0) return '0 0 R';
        if (map.has(n)) return map.get(n) + ' 0 R';
        if (nullObjNum) return nullObjNum + ' 0 R';
        return '0 0 R';
      });
    }

    const objects = new Array(totalObjects + 1);
    objects[1] = Core.bytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objects[2] = Core.bytes('2 0 obj\n<< /Type /Pages /Kids [' +
      newPageNums.map((nn) => nn + ' 0 R').join(' ') +
      '] /Count ' + newPageNums.length + ' >>\nendobj\n');
    if (nullObjNum) objects[nullObjNum] = Core.bytes(nullObjNum + ' 0 obj\nnull\nendobj\n');

    const pageNums = new Set(withNums.map((p) => p.num));
    const pageByNum = new Map(withNums.map((p) => [p.num, p]));
    for (const old of sorted) {
      const obj = doc.getObject(old);
      if (!obj) continue;
      const newNum = map.get(old);
      const repl = replacements.get(old);
      if (repl) {
        const dictText = '<< /Type /XObject /Subtype /Image' +
          ' /Width ' + repl.width + ' /Height ' + repl.height +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8' +
          ' /Filter /DCTDecode /Length ' + repl.bytes.length + ' >>';
        objects[newNum] = Core.concat([
          Core.bytes(newNum + ' 0 obj\n' + dictText + '\nstream\n'),
          repl.bytes,
          Core.bytes('\nendstream\nendobj\n'),
        ]);
        continue;
      }
      let dictText = obj.dictText;
      if (obj.stream) {
        dictText = dictText.replace(/\/Length\s+(\d+\s+\d+\s+R|\d+)/,
          '/Length ' + obj.stream.length);
      }
      if (pageNums.has(old)) {
        dictText = dictText.replace(/\/Parent\s+\d+\s+\d+\s+R\s*/g, '');
        const pg = pageByNum.get(old);
        const hasKey = (k) => new RegExp('/' + k + '\\b').test(dictText);
        let patch = '';
        if (!hasKey('MediaBox')) {
          patch += ' /MediaBox [' + pg.mediaBox.map((v) => Core.fmt(v)).join(' ') + ']';
        }
        if (pg.rotate && !hasKey('Rotate')) patch += ' /Rotate ' + pg.rotate;
        if (pg.resources !== undefined && !hasKey('Resources')) {
          if (Core.isRef(pg.resources)) patch += ' /Resources ' + pg.resources.ref + ' 0 R';
          else patch += ' /Resources ' + Core.serializeValue(pg.resources);
        }
        if (patch) dictText = dictText.replace(/\s*>>\s*$/, patch + ' >>');
      }
      dictText = remapText(dictText);
      if (obj.stream) {
        objects[newNum] = Core.concat([
          Core.bytes(newNum + ' 0 obj\n' + dictText + '\nstream\n'),
          obj.stream,
          Core.bytes('\nendstream\nendobj\n'),
        ]);
      } else {
        objects[newNum] = Core.bytes(newNum + ' 0 obj\n' + dictText + '\nendobj\n');
      }
    }

    const header = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
      0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
    ]);
    const parts = [header];
    const offsets = new Array(totalObjects + 1);
    let pos = header.length;
    for (let i = 1; i <= totalObjects; i++) {
      if (!objects[i]) throw new Error('internal: object ' + i + ' was not emitted');
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
    parts.push(Core.bytes(xref));
    return Core.concat(parts);
  }

  /* ================= public API ================= */

  function parseDoc(buffer) {
    if (!(buffer instanceof Uint8Array)) throw new Error('compressPdf: input is not bytes');
    if (buffer.length > L.MAX_FILE_BYTES) {
      throw new Error('file is ' + (buffer.length / (1024 * 1024)).toFixed(1) +
        ' MB — over the ' + (L.MAX_FILE_BYTES / (1024 * 1024)) + ' MB per-file limit');
    }
    let doc;
    try {
      doc = new Core.PdfDoc(buffer);
    } catch (e) {
      throw new Error(e.message);
    }
    let pages;
    try {
      pages = doc.collectPages();
    } catch (e) {
      throw new Error(e.message);
    }
    if (pages.length > L.MAX_PAGES_TOTAL) {
      throw new Error('too many pages: at most ' + L.MAX_PAGES_TOTAL + ' pages per file');
    }
    return { doc, pages };
  }

  /**
   * Inspect one PDF for compression: page count, page sizes and the
   * embedded images (count, per-image size/filter/dimensions, total
   * image bytes). Throws the same user-facing errors as compressPdf.
   */
  function inspectForCompress(buffer) {
    const { doc, pages } = parseDoc(buffer);
    const withNums = walkPageNums(doc);
    const { images, uniqueCount } = findImages(doc, withNums);
    if (images.length === 0) {
      throw new Error('this PDF has no embedded images — it is text or vector-only, ' +
        'so there is nothing to recompress. Only scanned / image PDFs can be shrunk this way.');
    }
    return {
      pageCount: pages.length,
      pages: pages.map((p) => ({
        mediaBox: p.mediaBox.map((v) => (typeof v === 'number' ? v : 0)),
        rotate: p.rotate || 0,
      })),
      imageCount: images.length,
      uniqueImageCount: uniqueCount,
      totalImageBytes: images.reduce((s, im) => s + im.origBytes, 0),
      images: images.map((im) => ({
        page: im.pageIndex + 1, name: im.name, objNum: im.objNum,
        width: im.width, height: im.height, filter: im.filter,
        colorSpace: im.colorSpace, origBytes: im.origBytes,
      })),
    };
  }

  /**
   * Compress one scanned/image PDF to at most targetBytes.
   * buffer: Uint8Array of the input PDF.
   * targetBytes: integer byte budget (e.g. 200*1024 for 200 KB).
   * codec: { decodeJpeg, encodeJpeg } — see header.
   * Returns a Promise of:
   *   { bytes, pageCount, origBytes, outBytes, targetBytes,
   *     ratio, dpi, quality, alreadyFits, attempts,
   *     images: [{ page, name, origW, origH, origBytes,
   *                 outW, outH, outBytes, filter }] }
   * The returned bytes are ALWAYS <= targetBytes (or the call
   * throws instead of handing back an over-target file).
   */
  async function compressPdf(buffer, targetBytes, codec) {
    if (!Number.isInteger(targetBytes) || targetBytes < MIN_TARGET_BYTES) {
      throw new Error('target size must be at least 10 KB');
    }
    if (!codec || typeof codec.decodeJpeg !== 'function' || typeof codec.encodeJpeg !== 'function') {
      throw new Error('compressPdf: a JPEG codec (decodeJpeg/encodeJpeg) is required');
    }
    const origBytes = buffer.length;
    const { doc, pages } = parseDoc(buffer);
    const withNums = walkPageNums(doc);
    const { images } = findImages(doc, withNums);
    if (images.length === 0) {
      throw new Error('this PDF has no embedded images — it is text or vector-only, ' +
        'so there is nothing to recompress. Only scanned / image PDFs can be shrunk this way.');
    }
    if (origBytes <= targetBytes) {
      return {
        bytes: buffer, pageCount: pages.length, origBytes, outBytes: origBytes,
        targetBytes, ratio: 1, dpi: null, quality: null, alreadyFits: true,
        attempts: 0,
        images: images.map((im) => ({
          page: im.pageIndex + 1, name: im.name,
          origW: im.width, origH: im.height, origBytes: im.origBytes,
          outW: im.width, outH: im.height, outBytes: im.origBytes, filter: im.filter,
        })),
      };
    }

    // Decode each unique image once to RGB pixels.
    const pixelsByObj = new Map();
    for (const im of images) {
      if (!pixelsByObj.has(im.objNum)) {
        pixelsByObj.set(im.objNum, await decodeImageToRgb(im, codec));
      }
    }

    // Displayed size per image usage (points) — best effort, falls
    // back to the full page box when the content stream cannot be read.
    const placements = new Map(); // objNum -> { wPt, hPt }
    for (const im of images) {
      if (placements.has(im.objNum)) continue;
      const place = placementsForPage(doc, withNums[im.pageIndex].num).get(im.name);
      if (place) {
        placements.set(im.objNum, place);
      } else {
        const mb = withNums[im.pageIndex].mediaBox;
        placements.set(im.objNum, { wPt: mb[2] - mb[0], hPt: mb[3] - mb[1] });
      }
    }

    let attempts = 0;
    let smallest = null; // { bytes, dpi, quality, replacements, report }

    // One probe: encode every image at (dpi, quality), rebuild, measure.
    async function probe(dpi, quality) {
      attempts++;
      const replacements = new Map();
      const report = new Map(); // objNum -> { outW, outH, outBytes }
      for (const im of images) {
        if (replacements.has(im.objNum)) continue;
        const px = pixelsByObj.get(im.objNum);
        const place = placements.get(im.objNum);
        const tw = Math.max(8, Math.min(px.width,
          Math.round((place.wPt / 72) * dpi)));
        const th = Math.max(8, Math.min(px.height,
          Math.round((place.hPt / 72) * dpi)));
        const encoded = await codec.encodeJpeg(px, tw, th, quality);
        replacements.set(im.objNum, { width: tw, height: th, bytes: encoded });
        report.set(im.objNum, { outW: tw, outH: th, outBytes: encoded.length });
      }
      const out = buildOutput(doc, withNums, replacements);
      return { out, report };
    }

    for (const dpi of DPI_RUNGS) {
      // Highest quality first: if it fits, this rung is the answer.
      let r = await probe(dpi, Q_MAX);
      if (r.out.length <= targetBytes) {
        return finish(r, dpi, Q_MAX);
      }
      if (!smallest || r.out.length < smallest.out.length) {
        smallest = { out: r.out, dpi, quality: Q_MAX, report: r.report };
      }
      // Lowest quality at this rung: if even that is over budget,
      // drop to the next (lower DPI) rung.
      r = await probe(dpi, Q_MIN);
      if (r.out.length > targetBytes) {
        if (r.out.length < smallest.out.length) {
          smallest = { out: r.out, dpi, quality: Q_MIN, report: r.report };
        }
        continue;
      }
      // Bisect for the highest quality that still fits.
      let lo = Q_MIN, hi = Q_MAX, best = r; // r (Q_MIN) fits
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const m = await probe(dpi, mid);
        if (m.out.length <= targetBytes) { best = m; lo = mid; }
        else {
          hi = mid;
          if (m.out.length < smallest.out.length) {
            smallest = { out: m.out, dpi, quality: mid, report: m.report };
          }
        }
      }
      return finish(best, dpi, lo);
    }

    // No rung reached the budget.
    throw new Error('even at the lowest setting (50 DPI, quality ' + Q_MIN + ') ' +
      'the smallest this PDF can be is ' + Math.round(smallest.out.length / 1024) +
      ' KB — over your ' + Math.round(targetBytes / 1024) +
      ' KB target. Pick a larger target or remove pages.');

    function finish(r, dpi, quality) {
      return {
        bytes: r.out, pageCount: pages.length, origBytes,
        outBytes: r.out.length, targetBytes,
        ratio: origBytes / r.out.length, dpi, quality,
        alreadyFits: false, attempts,
        images: images.map((im) => {
          const rep = r.report.get(im.objNum);
          return {
            page: im.pageIndex + 1, name: im.name,
            origW: im.width, origH: im.height, origBytes: im.origBytes,
            outW: rep.outW, outH: rep.outH, outBytes: rep.outBytes,
            filter: im.filter,
          };
        }),
      };
    }
  }

  return { LIMITS: L, DPI_RUNGS, Q_MAX, Q_MIN, inspectForCompress, compressPdf };
});
