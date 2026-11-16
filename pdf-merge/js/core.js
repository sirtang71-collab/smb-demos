// core.js — PDF Merge (pdf-merge): pure logic.
// Hand-written PDF merger, no libraries, no CDN: parses each input
// PDF (classic xref tables, PDF 1.5 xref streams, object streams,
// FlateDecode streams), collects the page tree, copies every object
// reachable from the pages with renumbered references, and writes a
// fresh PDF 1.4 with a rebuilt xref table.
// Environment-agnostic: attaches window.PdfToolCore in the browser,
// module.exports in Node. No DOM anywhere in this file.
//
// What is supported / rejected:
//   - classic xref tables (incl. /Prev incremental chains, /XRefStm)
//   - xref streams (PDF 1.5+), object streams (/ObjStm)
//   - FlateDecode streams (content streams pass through untouched;
//     object streams and xref streams are inflated with the
//     hand-written inflate() below)
//   - REJECTED with a clear error: encrypted PDFs (/Encrypt),
//     non-PDF input, PDFs with no pages, streams using a filter
//     other than FlateDecode, object/xref streams using a DecodeParms
//     predictor other than 1 (none).
// Page /MediaBox and /Rotate are inherited down the page tree and
// materialised onto each output page. /Parent is stripped (the
// output page tree is rebuilt). Unreachable objects (old catalog,
// old Pages nodes, metadata) are dropped; missing references resolve
// to a shared null object instead of producing a corrupt file.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PdfToolCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITS = {
    MAX_FILES: 20,
    MAX_PAGES_TOTAL: 200,
    MAX_FILE_BYTES: 20 * 1024 * 1024,   // per file
    MAX_TOTAL_BYTES: 50 * 1024 * 1024,  // all files together
  };

  /* ================= byte helpers ================= */

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
    const arr = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
    return arr;
  }

  /** 1 char = 1 byte, so string indexes ARE byte offsets. */
  function latin1(buf) {
    let s = '';
    const CHUNK = 8192;
    for (let i = 0; i < buf.length; i += CHUNK) {
      s += String.fromCharCode.apply(null, buf.subarray(i, Math.min(i + CHUNK, buf.length)));
    }
    return s;
  }

  /** Two decimals max, no trailing noise: 595.28 stays "595.28". */
  function fmt(n) {
    const r = Math.round(n * 100) / 100;
    return String(r);
  }

  /* ================= DEFLATE (RFC 1951) ================= */
  // Hand-written inflate. Only used for object streams and xref
  // streams (small); content/image streams pass through untouched.

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
    3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
    16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
    8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  function buildHuffman(lengths) {
    let maxLen = 0;
    for (const l of lengths) if (l > maxLen) maxLen = l;
    const counts = new Array(maxLen + 1).fill(0);
    for (const l of lengths) if (l) counts[l]++;
    const offs = new Array(maxLen + 1).fill(0);
    for (let i = 1; i <= maxLen; i++) offs[i] = offs[i - 1] + counts[i - 1];
    const symbols = new Array(lengths.filter((l) => l).length);
    for (let sym = 0; sym < lengths.length; sym++) {
      if (lengths[sym]) symbols[offs[lengths[sym]]++] = sym;
    }
    return { counts, symbols, maxLen };
  }

  /** Inflate a zlib-wrapped or raw DEFLATE stream. Returns Uint8Array. */
  function inflate(data) {
    if (!(data instanceof Uint8Array)) throw new Error('inflate: not bytes');
    if (data.length < 2) throw new Error('inflate: stream too short');
    // zlib wrapper? CMF/FLG checksum + compression method 8.
    let pos = 0;
    if (data.length >= 2 && (data[0] * 256 + data[1]) % 31 === 0 && (data[0] & 0x0f) === 8) {
      pos = 2;
    }
    let bitBuf = 0, bitCnt = 0;
    function needBits(n) {
      while (bitCnt < n) {
        if (pos >= data.length) throw new Error('inflate: truncated stream');
        bitBuf |= data[pos++] << bitCnt;
        bitCnt += 8;
      }
    }
    function getBits(n) {
      if (n === 0) return 0;
      needBits(n);
      const v = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return v;
    }
    function getBit() { return getBits(1); }
    function decode(table) {
      let code = 0, first = 0, index = 0;
      for (let len = 1; len <= table.maxLen; len++) {
        code |= getBit();
        const count = table.counts[len];
        if (code - first < count) return table.symbols[index + (code - first)];
        index += count;
        first = (first + count) << 1;
        code <<= 1;
      }
      throw new Error('inflate: bad Huffman code');
    }

    const out = [];
    let finalBlock = false;
    while (!finalBlock) {
      finalBlock = getBits(1) === 1;
      const btype = getBits(2);
      if (btype === 0) {
        // stored
        bitBuf = 0; bitCnt = 0;
        if (pos + 4 > data.length) throw new Error('inflate: truncated stored block');
        const len = data[pos] | (data[pos + 1] << 8);
        const nlen = data[pos + 2] | (data[pos + 3] << 8);
        if (len !== (nlen ^ 0xffff)) throw new Error('inflate: stored block length check failed');
        pos += 4;
        if (pos + len > data.length) throw new Error('inflate: truncated stored block data');
        for (let i = 0; i < len; i++) out.push(data[pos++]);
      } else {
        let litTable, distTable;
        if (btype === 1) {
          const litLen = new Array(288);
          for (let i = 0; i < 144; i++) litLen[i] = 8;
          for (let i = 144; i < 256; i++) litLen[i] = 9;
          for (let i = 256; i < 280; i++) litLen[i] = 7;
          for (let i = 280; i < 288; i++) litLen[i] = 8;
          litTable = buildHuffman(litLen);
          distTable = buildHuffman(new Array(30).fill(5));
        } else if (btype === 2) {
          const hlit = getBits(5) + 257;
          const hdist = getBits(5) + 1;
          const hclen = getBits(4) + 4;
          const clen = new Array(19).fill(0);
          for (let i = 0; i < hclen; i++) clen[CLEN_ORDER[i]] = getBits(3);
          const clenTable = buildHuffman(clen);
          const lengths = new Array(hlit + hdist).fill(0);
          let i = 0;
          while (i < hlit + hdist) {
            const sym = decode(clenTable);
            if (sym < 16) {
              lengths[i++] = sym;
            } else if (sym === 16) {
              if (i === 0) throw new Error('inflate: repeat with no previous length');
              const prev = lengths[i - 1];
              const rep = 3 + getBits(2);
              for (let j = 0; j < rep; j++) lengths[i++] = prev;
            } else if (sym === 17) {
              i += 3 + getBits(3);
            } else {
              i += 11 + getBits(7);
            }
          }
          litTable = buildHuffman(lengths.slice(0, hlit));
          distTable = buildHuffman(lengths.slice(hlit));
        } else {
          throw new Error('inflate: bad block type');
        }
        for (;;) {
          const sym = decode(litTable);
          if (sym < 256) {
            out.push(sym);
          } else if (sym === 256) {
            break;
          } else {
            const li = sym - 257;
            if (li >= LEN_BASE.length) throw new Error('inflate: bad length symbol');
            const len = LEN_BASE[li] + getBits(LEN_EXTRA[li]);
            const dsym = decode(distTable);
            if (dsym >= DIST_BASE.length) throw new Error('inflate: bad distance symbol');
            const dist = DIST_BASE[dsym] + getBits(DIST_EXTRA[dsym]);
            if (dist > out.length) throw new Error('inflate: distance too far back');
            for (let j = 0; j < len; j++) out.push(out[out.length - dist]);
          }
        }
      }
    }
    return new Uint8Array(out);
  }

  /* ================= PDF value parser ================= */
  // Values: number | string (latin1) | boolean | null
  //         | { name: 'Foo' } | { ref: N, gen: G }
  //         | Array | dict (Object.create(null), keys without '/')

  const WS = ' \t\n\f\r ';
  function isWs(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\f' || ch === '\r' || ch === '\0'; }
  function isDelim(ch) {
    return ch === '(' || ch === ')' || ch === '<' || ch === '>' || ch === '[' ||
      ch === ']' || ch === '{' || ch === '}' || ch === '/' || ch === '%';
  }

  function skipWs(s, i) {
    for (;;) {
      while (i < s.length && isWs(s[i])) i++;
      if (s[i] === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      return i;
    }
  }

  /** Parse one PDF value at s[i]; returns [value, nextIndex]. */
  function parseValue(s, i) {
    i = skipWs(s, i);
    const ch = s[i];
    if (ch === undefined) throw new Error('parse: unexpected end of object');
    if (ch === '<') {
      if (s[i + 1] === '<') {
        // dict
        i += 2;
        const dict = Object.create(null);
        for (;;) {
          i = skipWs(s, i);
          if (s[i] === '>' && s[i + 1] === '>') return [dict, i + 2];
          if (i >= s.length) throw new Error('parse: unterminated dict');
          if (s[i] !== '/') throw new Error('parse: dict key is not a name at offset ' + i);
          const nameParsed = parseName(s, i);
          const key = nameParsed[0].name;
          i = nameParsed[1];
          const val = parseValue(s, i);
          dict[key] = val[0];
          i = val[1];
        }
      }
      // hex string
      let j = i + 1, hex = '';
      while (j < s.length && s[j] !== '>') { if (!isWs(s[j])) hex += s[j]; j++; }
      if (j >= s.length) throw new Error('parse: unterminated hex string');
      if (hex.length % 2) hex += '0';
      let out = '';
      for (let k = 0; k < hex.length; k += 2) out += String.fromCharCode(parseInt(hex.substr(k, 2), 16));
      return [out, j + 1];
    }
    if (ch === '(') {
      let depth = 0, out = '', j = i;
      j++;
      while (j < s.length) {
        const c = s[j];
        if (c === '\\') {
          const n = s[j + 1];
          if (n === 'n') { out += '\n'; j += 2; }
          else if (n === 'r') { out += '\r'; j += 2; }
          else if (n === 't') { out += '\t'; j += 2; }
          else if (n === 'b') { out += '\b'; j += 2; }
          else if (n === 'f') { out += '\f'; j += 2; }
          else if (n === '(' || n === ')' || n === '\\') { out += n; j += 2; }
          else if (n >= '0' && n <= '7') {
            let oct = '', k = j + 1;
            while (k < j + 4 && s[k] >= '0' && s[k] <= '7') { oct += s[k]; k++; }
            out += String.fromCharCode(parseInt(oct, 8) & 0xff);
            j = k;
          } else if (n === '\r' || n === '\n') {
            // line continuation: skip EOL
            j += 2;
            if (n === '\r' && s[j] === '\n') j++;
          } else { out += n; j += 2; }
        } else if (c === '(') { depth++; out += c; j++; }
        else if (c === ')') {
          if (depth === 0) return [out, j + 1];
          depth--; out += c; j++;
        } else { out += c; j++; }
      }
      throw new Error('parse: unterminated literal string');
    }
    if (ch === '[') {
      i++;
      const arr = [];
      for (;;) {
        i = skipWs(s, i);
        if (s[i] === ']') return [arr, i + 1];
        if (i >= s.length) throw new Error('parse: unterminated array');
        const val = parseValue(s, i);
        arr.push(val[0]);
        i = val[1];
      }
    }
    if (ch === '/') return parseName(s, i);
    // number / keyword / indirect reference
    const numRe = /^[+-]?(?:\d+\.?\d*|\.\d+)/;
    const m = numRe.exec(s.slice(i, i + 32));
    if (m) {
      const first = m[0];
      let j = i + first.length;
      const saveJ = j;
      j = skipWs(s, j);
      const m2 = numRe.exec(s.slice(j, j + 32));
      if (m2) {
        let k = j + m2[0].length;
        k = skipWs(s, k);
        if (s[k] === 'R') {
          return [{ ref: parseInt(first, 10), gen: parseInt(m2[0], 10) }, k + 1];
        }
      }
      return [parseFloat(first), saveJ];
    }
    if (s.slice(i, i + 4) === 'true') return [true, i + 4];
    if (s.slice(i, i + 5) === 'false') return [false, i + 5];
    if (s.slice(i, i + 4) === 'null') return [null, i + 4];
    // bare keyword (e.g. obj/endobj markers leak in) — treat as name-ish
    let j = i;
    while (j < s.length && !isWs(s[j]) && !isDelim(s[j])) j++;
    if (j === i) throw new Error('parse: bad token at offset ' + i);
    return [{ keyword: s.slice(i, j) }, j];
  }

  function parseName(s, i) {
    // s[i] === '/'
    let j = i + 1, name = '';
    while (j < s.length && !isWs(s[j]) && !isDelim(s[j])) {
      if (s[j] === '#' && j + 2 < s.length) {
        name += String.fromCharCode(parseInt(s.substr(j + 1, 2), 16));
        j += 3;
      } else {
        name += s[j];
        j++;
      }
    }
    return [{ name }, j];
  }

  function isRef(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.ref === 'number'; }
  function isName(v, n) { return v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.name === 'string' && (n === undefined || v.name === n); }
  function isDict(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && v.ref === undefined && v.name === undefined && v.keyword === undefined; }

  /** Serialise a parsed value back to PDF syntax (used only to
   *  materialise an inline inherited /Resources dict). Refs come out
   *  as "N 0 R" and are fixed by the normal remap pass. */
  function serializeValue(v) {
    if (v === null) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (typeof v === 'number') return fmt(v);
    if (typeof v === 'string') {
      return '(' + v.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)') + ')';
    }
    if (Array.isArray(v)) return '[' + v.map(serializeValue).join(' ') + ']';
    if (isRef(v)) return v.ref + ' 0 R';
    if (isName(v)) return '/' + v.name;
    if (isDict(v)) {
      return '<< ' + Object.keys(v).map((k) => '/' + k + ' ' + serializeValue(v[k])).join(' ') + ' >>';
    }
    throw new Error('serialize: unsupported value');
  }

  /* ================= PDF document ================= */

  function decodeStreamData(dict, raw) {
    const filter = dict.Filter;
    const parms = dict.DecodeParms;
    let predictor = 1;
    if (parms) {
      const p = Array.isArray(parms) ? parms[0] : parms;
      if (isDict(p) && typeof p.Predictor === 'number') predictor = p.Predictor;
    }
    if (predictor !== 1) {
      throw new Error('unsupported DecodeParms predictor ' + predictor +
        ' — this PDF uses PNG-predictor compression the merger cannot decode yet');
    }
    const filters = filter === undefined ? [] : (Array.isArray(filter) ? filter : [filter]);
    let data = raw;
    for (const f of filters) {
      if (isName(f, 'FlateDecode') || isName(f, 'Fl')) {
        data = inflate(data);
      } else {
        throw new Error('unsupported stream filter /' + (isName(f) ? f.name : String(f)) +
          ' — this PDF uses compression the merger cannot decode yet');
      }
    }
    return data;
  }

  class PdfDoc {
    constructor(data) {
      if (!(data instanceof Uint8Array)) throw new Error('parsePdf: input is not bytes');
      if (data.length < 8 || latin1(data.subarray(0, 5)) !== '%PDF-') {
        throw new Error('not a PDF file (missing %PDF- header)');
      }
      this.data = data;
      this.text = latin1(data);
      this.xref = new Map(); // num -> {type:1, offset, gen} | {type:2, objStm, index}
      this.objCache = new Map();
      this.objStmCache = new Map();
      this.rootRef = null;
      this.encrypted = false;
      this._readXref();
      if (this.encrypted) {
        throw new Error('encrypted PDF (password-protected) — remove the password and try again');
      }
      if (!this.rootRef) throw new Error('could not find the document catalog (/Root)');
    }

    _readXref() {
      const text = this.text;
      const tail = text.slice(Math.max(0, text.length - 2048));
      const m = /startxref\s*(\d+)/.exec(tail);
      if (m) {
        try {
          this._readXrefChain(parseInt(m[1], 10));
          return;
        } catch (e) {
          // fall through to the scan fallback below
          this.xref.clear();
          this.rootRef = null;
          this.encrypted = false;
        }
      }
      this._scanFallback();
    }

    _scanFallback() {
      // No usable startxref: index every "N G obj" in the file and
      // find the catalog by scanning object dicts. (Last occurrence
      // of a number wins, matching incremental-update order.)
      const re = /(\d+)\s+(\d+)\s+obj\b/g;
      let m;
      while ((m = re.exec(this.text)) !== null) {
        this.xref.set(parseInt(m[1], 10), { type: 1, offset: m.index, gen: parseInt(m[2], 10) });
      }
      if (this.xref.size === 0) throw new Error('could not read this PDF (no objects found)');
      if (/\/Encrypt\s+\d+\s+\d+\s+R/.test(this.text)) this.encrypted = true;
      for (const num of this.xref.keys()) {
        try {
          const obj = this.getObject(num);
          if (obj && isDict(obj.value) && isName(obj.value.Type, 'Catalog')) {
            this.rootRef = { ref: num, gen: 0 };
            return;
          }
        } catch (e) { /* keep scanning */ }
      }
      throw new Error('could not read this PDF (no catalog found)');
    }

    _readXrefChain(startOffset) {
      const seenOffsets = new Set();
      let offset = startOffset;
      let guard = 0;
      while (offset !== null && offset !== undefined && guard++ < 50) {
        if (seenOffsets.has(offset)) break;
        seenOffsets.add(offset);
        if (offset < 0 || offset >= this.text.length) {
          throw new Error('bad startxref offset ' + offset);
        }
        let i = skipWs(this.text, offset);
        if (this.text.slice(i, i + 4) === 'xref') {
          const next = this._readXrefTable(i + 4);
          offset = next;
        } else {
          const obj = this._parseObjectAt(offset);
          if (!obj || !isDict(obj.value)) throw new Error('xref stream is not a dict object');
          const dict = obj.value;
          this._readXrefStreamEntries(dict, obj.stream);
          if (dict.Root) this.rootRef = isRef(dict.Root) ? dict.Root : this.rootRef;
          if (dict.Encrypt) this.encrypted = true;
          offset = (typeof dict.Prev === 'number') ? dict.Prev : null;
          if (dict.XRefStm !== undefined && typeof dict.XRefStm === 'number') {
            // hybrid file: also read the xref stream it points at
            try { this._readXrefChain(dict.XRefStm); } catch (e) { /* best effort */ }
          }
        }
      }
      if (guard >= 50) throw new Error('xref /Prev chain too long (loop?)');
      if (!this.rootRef) throw new Error('could not find the document catalog (/Root)');
    }

    _readXrefTable(pos) {
      // pos is just past "xref". Sections: "first count" then lines.
      const text = this.text;
      let prev = null;
      for (;;) {
        pos = skipWs(text, pos);
        const secM = /^(\d+)\s+(\d+)/.exec(text.slice(pos, pos + 40));
        if (!secM) break;
        const first = parseInt(secM[1], 10);
        const count = parseInt(secM[2], 10);
        pos += secM[0].length;
        // EOL after the "first count" header is not an entry.
        if (text[pos] === '\r' && text[pos + 1] === '\n') pos += 2;
        else if (text[pos] === '\n' || text[pos] === '\r') pos += 1;
        for (let k = 0; k < count; k++) {
          // one entry line, 20 bytes incl. EOL — read line-wise
          let eol = text.indexOf('\n', pos);
          if (eol === -1) eol = text.length;
          const line = text.slice(pos, eol);
          pos = eol + 1;
          const em = /^(\d{10}) (\d{5}) ([nf])/.exec(line);
          if (!em) throw new Error('bad xref table entry: ' + JSON.stringify(line));
          const num = first + k;
          if (em[3] === 'n' && !this.xref.has(num)) {
            this.xref.set(num, { type: 1, offset: parseInt(em[1], 10), gen: parseInt(em[2], 10) });
          }
        }
      }
      pos = skipWs(text, pos);
      if (text.slice(pos, pos + 7) !== 'trailer') throw new Error('xref table without trailer');
      const trailer = parseValue(text, pos + 7);
      if (!isDict(trailer[0])) throw new Error('trailer is not a dict');
      const t = trailer[0];
      if (t.Root) this.rootRef = isRef(t.Root) ? t.Root : this.rootRef;
      if (t.Encrypt) this.encrypted = true;
      if (typeof t.Prev === 'number') prev = t.Prev;
      if (typeof t.XRefStm === 'number') {
        try { this._readXrefChain(t.XRefStm); } catch (e) { /* best effort */ }
      }
      return prev;
    }

    _readXrefStreamEntries(dict, stream) {
      if (!stream) throw new Error('xref stream has no data');
      const data = decodeStreamData(dict, stream);
      const w = dict.W;
      if (!Array.isArray(w) || w.length !== 3) throw new Error('xref stream /W is not [a b c]');
      const w0 = w[0], w1 = w[1], w2 = w[2];
      const recLen = w0 + w1 + w2;
      if (recLen === 0) throw new Error('xref stream /W sums to zero');
      const index = Array.isArray(dict.Index) ? dict.Index : [0, typeof dict.Size === 'number' ? dict.Size : 0];
      let p = 0;
      function readField(nbytes) {
        let v = 0;
        for (let k = 0; k < nbytes; k++) v = v * 256 + (data[p++] || 0);
        return v;
      }
      for (let s = 0; s + 1 < index.length; s += 2) {
        const first = index[s], count = index[s + 1];
        for (let k = 0; k < count; k++) {
          if (p + recLen > data.length) throw new Error('xref stream truncated');
          const type = w0 === 0 ? 1 : readField(w0);
          const f1 = readField(w1);
          const f2 = readField(w2);
          const num = first + k;
          if (this.xref.has(num)) continue;
          if (type === 1) this.xref.set(num, { type: 1, offset: f1, gen: f2 });
          else if (type === 2) this.xref.set(num, { type: 2, objStm: f1, index: f2 });
          // type 0 = free: leave absent
        }
      }
    }

    _parseObjectAt(offset) {
      const text = this.text;
      const m = /^(\d+)\s+(\d+)\s+obj\b/.exec(text.slice(offset, offset + 48));
      if (!m) throw new Error('expected "N G obj" at offset ' + offset);
      const num = parseInt(m[1], 10);
      const gen = parseInt(m[2], 10);
      let pos = offset + m[0].length;
      const parsed = parseValue(text, pos);
      const value = parsed[0];
      let dictText = text.slice(pos, parsed[1]);
      pos = skipWs(text, parsed[1]);
      let stream = null;
      if (text.slice(pos, pos + 6) === 'stream') {
        if (!isDict(value)) throw new Error('stream object ' + num + ' has no dict');
        pos += 6;
        // EOL after "stream" is not part of the data.
        if (text[pos] === '\r' && text[pos + 1] === '\n') pos += 2;
        else if (text[pos] === '\n' || text[pos] === '\r') pos += 1;
        const length = this._streamLength(value);
        stream = this.data.subarray(pos, pos + length);
      }
      return { num, gen, value, dictText, stream };
    }

    _streamLength(dict) {
      const len = dict.Length;
      if (typeof len === 'number') return len;
      if (isRef(len)) {
        const obj = this.getObject(len.ref);
        if (obj && typeof obj.value === 'number') return obj.value;
        throw new Error('stream /Length reference ' + len.ref + ' does not resolve to a number');
      }
      throw new Error('stream object has no usable /Length');
    }

    /** Raw object: { num, value (parsed), dictText, stream|null }. */
    getObject(num) {
      if (this.objCache.has(num)) return this.objCache.get(num);
      const entry = this.xref.get(num);
      if (!entry) return null;
      let obj = null;
      if (entry.type === 1) {
        obj = this._parseObjectAt(entry.offset);
      } else {
        obj = this._getCompressedObject(entry.objStm, entry.index, num);
      }
      if (obj) this.objCache.set(num, obj);
      return obj;
    }

    _getCompressedObject(objStmNum, index, wantNum) {
      if (!this.objStmCache.has(objStmNum)) {
        const stm = this.getObject(objStmNum);
        if (!stm || !stm.stream) throw new Error('object stream ' + objStmNum + ' has no data');
        if (!isDict(stm.value) || !isName(stm.value.Type, 'ObjStm')) {
          throw new Error('object ' + objStmNum + ' is not an object stream');
        }
        const decoded = decodeStreamData(stm.value, stm.stream);
        const n = stm.value.N, first = stm.value.First;
        if (typeof n !== 'number' || typeof first !== 'number') {
          throw new Error('object stream ' + objStmNum + ' has no /N or /First');
        }
        const header = latin1(decoded.subarray(0, Math.min(first, decoded.length)));
        const nums = header.trim().split(/\s+/).map(Number);
        if (nums.length < n * 2) throw new Error('object stream ' + objStmNum + ' header is short');
        const map = new Map();
        for (let i = 0; i < n; i++) {
          const onum = nums[i * 2], off = nums[i * 2 + 1];
          const start = first + off;
          const end = (i + 1 < n) ? first + nums[(i + 1) * 2 + 1] : decoded.length;
          const rawText = latin1(decoded.subarray(start, end));
          const parsed = parseValue(rawText, 0);
          map.set(onum, { num: onum, gen: 0, value: parsed[0], dictText: rawText.slice(0, parsed[1]).trim(), stream: null });
        }
        this.objStmCache.set(objStmNum, map);
      }
      return this.objStmCache.get(objStmNum).get(wantNum) || null;
    }

    resolve(v) {
      if (isRef(v)) {
        const obj = this.getObject(v.ref);
        return obj ? obj.value : null;
      }
      return v;
    }

    /** Ordered pages: [{ objNum, dict, mediaBox:[x0 y0 x1 y1], rotate, resources }]. */
    collectPages() {
      const root = this.resolve(this.rootRef);
      if (!isDict(root)) throw new Error('document catalog is not a dict');
      const pagesNode = this.resolve(root.Pages);
      if (!isDict(pagesNode)) throw new Error('document has no page tree (/Pages)');
      const pages = [];
      const walk = (node, inherited) => {
        if (!isDict(node)) throw new Error('page tree node is not a dict');
        const inh = {
          mediaBox: node.MediaBox !== undefined ? node.MediaBox : inherited.mediaBox,
          rotate: node.Rotate !== undefined ? node.Rotate : inherited.rotate,
          resources: node.Resources !== undefined ? node.Resources : inherited.resources,
        };
        if (isName(node.Type, 'Page')) {
          if (!inh.mediaBox) throw new Error('page object has no /MediaBox (not even inherited)');
          pages.push({ node, mediaBox: inh.mediaBox, rotate: inh.rotate || 0, resources: inh.resources });
          return;
        }
        const kids = node.Kids;
        if (!Array.isArray(kids)) throw new Error('page tree node has no /Kids array');
        for (const kid of kids) {
          const child = this.resolve(kid);
          if (!child) throw new Error('page tree references missing object ' + (isRef(kid) ? kid.ref : '?'));
          walk(child, inh);
        }
      };
      walk(pagesNode, { mediaBox: undefined, rotate: 0, resources: undefined });
      if (pages.length === 0) throw new Error('no pages found in this PDF');
      return pages;
    }
  }

  /** All indirect references inside a parsed value. */
  function collectRefs(value, out, skipLength) {
    if (isRef(value)) { out.add(value.ref); return; }
    if (Array.isArray(value)) { for (const v of value) collectRefs(v, out, skipLength); return; }
    if (isDict(value)) {
      for (const k of Object.keys(value)) {
        if (skipLength && k === 'Length') continue;
        collectRefs(value[k], out, skipLength);
      }
    }
  }

  /* ================= merge ================= */

  /**
   * Merge PDFs.
   * buffers: Uint8Array[] — one per input file, in output order.
   * Returns Uint8Array of the merged PDF.
   * Throws Error with a user-facing message on any unsupported input.
   */
  function mergePdfs(buffers) {
    if (!Array.isArray(buffers) || buffers.length === 0) {
      throw new Error('mergePdfs: need at least one PDF');
    }
    if (buffers.length > LIMITS.MAX_FILES) {
      throw new Error('too many files: at most ' + LIMITS.MAX_FILES + ' PDFs per merge');
    }
    const docs = [];
    let totalPages = 0;
    for (let i = 0; i < buffers.length; i++) {
      const b = buffers[i];
      if (!(b instanceof Uint8Array)) throw new Error('PDF #' + (i + 1) + ' is not bytes');
      let doc;
      try {
        doc = new PdfDoc(b);
      } catch (e) {
        throw new Error('PDF #' + (i + 1) + ': ' + e.message);
      }
      let pages;
      try {
        pages = doc.collectPages();
      } catch (e) {
        throw new Error('PDF #' + (i + 1) + ': ' + e.message);
      }
      totalPages += pages.length;
      if (totalPages > LIMITS.MAX_PAGES_TOTAL) {
        throw new Error('too many pages: at most ' + LIMITS.MAX_PAGES_TOTAL + ' pages per merge');
      }
      docs.push({ doc, pages });
    }

    // Per input doc: page object numbers + everything reachable from them.
    const perDoc = docs.map(({ doc, pages }) => {
      const needed = new Set();
      const pageInfo = [];
      const root = doc.resolve(doc.rootRef);
      const pagesNode = doc.resolve(root.Pages);
      const withNums = [];
      const walkNums = (node, nodeRef, inherited) => {
        const inh = {
          mediaBox: node.MediaBox !== undefined ? node.MediaBox : inherited.mediaBox,
          rotate: node.Rotate !== undefined ? node.Rotate : inherited.rotate,
          resources: node.Resources !== undefined ? node.Resources : inherited.resources,
        };
        if (isName(node.Type, 'Page')) {
          withNums.push({ num: nodeRef.ref, mediaBox: inh.mediaBox, rotate: inh.rotate || 0, resources: inh.resources });
          return;
        }
        for (const kid of node.Kids) {
          walkNums(doc.resolve(kid), kid, inh);
        }
      };
      walkNums(pagesNode, root.Pages, { mediaBox: undefined, rotate: 0, resources: undefined });

      for (const pg of withNums) {
        const obj = doc.getObject(pg.num);
        if (!obj) throw new Error('page object ' + pg.num + ' is missing');
        // reachability from the page dict (skip /Parent: the output
        // page tree is rebuilt; skip /Length: stream lengths become literal)
        const refs = new Set();
        const dictCopy = Object.create(null);
        for (const k of Object.keys(obj.value)) {
          if (k === 'Parent') continue;
          dictCopy[k] = obj.value[k];
        }
        collectRefs(dictCopy, refs, true);
        const queue = [...refs];
        needed.add(pg.num);
        while (queue.length) {
          const n = queue.pop();
          if (n === 0 || needed.has(n)) continue;
          const o = doc.getObject(n);
          if (!o) continue; // missing ref: resolved to the null object below
          needed.add(n);
          const sub = new Set();
          collectRefs(o.value, sub, !!o.stream);
          for (const r of sub) if (!needed.has(r)) queue.push(r);
        }
        pageInfo.push({ num: pg.num, mediaBox: pg.mediaBox, rotate: pg.rotate, resources: pg.resources });
      }
      return { doc, needed, pageInfo };
    });

    // Any reference that points nowhere becomes the shared null object.
    let needsNull = false;
    for (const { doc, needed } of perDoc) {
      for (const n of needed) {
        const obj = doc.getObject(n);
        if (!obj) continue;
        const refs = new Set();
        collectRefs(obj.value, refs, !!obj.stream);
        for (const r of refs) {
          if (r !== 0 && !needed.has(r) && !doc.getObject(r)) needsNull = true;
        }
      }
    }

    // Assign new numbers: 1 catalog, 2 pages, 3 null object (if needed),
    // then every needed object per input doc, in ascending old order.
    let nextNum = 3;
    let nullObjNum = 0;
    if (needsNull) { nullObjNum = nextNum++; }
    const remap = []; // per doc: Map old -> new
    const newPageNums = []; // in output order
    const pageMeta = []; // { mediaBox, rotate, resources, docIdx, oldNum }
    for (let d = 0; d < perDoc.length; d++) {
      const map = new Map();
      const sorted = [...perDoc[d].needed].sort((a, b) => a - b);
      for (const old of sorted) map.set(old, nextNum++);
      remap.push(map);
      for (const pg of perDoc[d].pageInfo) {
        newPageNums.push(map.get(pg.num));
        pageMeta.push({ ...pg, docIdx: d });
      }
    }
    const totalObjects = nextNum - 1;

    function remapText(text, docIdx) {
      const map = remap[docIdx];
      return text.replace(/(\d+)\s+(\d+)\s+R/g, (m, num, gen) => {
        const n = parseInt(num, 10);
        if (n === 0) return '0 0 R';
        if (map.has(n)) return map.get(n) + ' 0 R';
        if (nullObjNum) return nullObjNum + ' 0 R';
        return '0 0 R';
      });
    }

    const objects = new Array(totalObjects + 1); // 1-based
    objects[1] = bytes('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
    objects[2] = bytes('2 0 obj\n<< /Type /Pages /Kids [' +
      newPageNums.map((n) => n + ' 0 R').join(' ') +
      '] /Count ' + newPageNums.length + ' >>\nendobj\n');
    if (nullObjNum) objects[nullObjNum] = bytes(nullObjNum + ' 0 obj\nnull\nendobj\n');

    for (let d = 0; d < perDoc.length; d++) {
      const { doc, needed, pageInfo } = perDoc[d];
      const map = remap[d];
      const pageNums = new Set(pageInfo.map((p) => p.num));
      for (const old of [...needed].sort((a, b) => a - b)) {
        const obj = doc.getObject(old);
        if (!obj) continue; // missing: references to it already point at the null object
        const newNum = map.get(old);
        let dictText = obj.dictText;
        if (obj.stream) {
          // stream dict: /Length becomes a literal byte count.
          dictText = dictText.replace(/\/Length\s+(\d+\s+\d+\s+R|\d+)/,
            '/Length ' + obj.stream.length);
        }
        if (pageNums.has(old)) {
          // materialise inherited MediaBox / Rotate / Resources,
          // drop the stale /Parent link.
          dictText = dictText.replace(/\/Parent\s+\d+\s+\d+\s+R\s*/g, '');
          const pg = pageInfo.find((p) => p.num === old);
          const hasKey = (k) => new RegExp('/' + k + '\\b').test(dictText);
          let patch = '';
          if (!hasKey('MediaBox')) {
            const mb = pg.mediaBox;
            patch += ' /MediaBox [' + mb.map((v) => fmt(v)).join(' ') + ']';
          }
          if (pg.rotate && !hasKey('Rotate')) patch += ' /Rotate ' + pg.rotate;
          if (pg.resources !== undefined && !hasKey('Resources')) {
            if (isRef(pg.resources)) patch += ' /Resources ' + pg.resources.ref + ' 0 R';
            else patch += ' /Resources ' + serializeValue(pg.resources);
          }
          if (patch) dictText = dictText.replace(/\s*>>\s*$/, patch + ' >>');
        }
        dictText = remapText(dictText, d);
        if (obj.stream) {
          objects[newNum] = concat([
            bytes(newNum + ' 0 obj\n' + dictText + '\nstream\n'),
            obj.stream,
            bytes('\nendstream\nendobj\n'),
          ]);
        } else {
          objects[newNum] = bytes(newNum + ' 0 obj\n' + dictText + '\nendobj\n');
        }
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
    parts.push(bytes(xref));
    return concat(parts);
  }

  /**
   * Inspect one PDF without merging: { pageCount, pages: [{ mediaBox, rotate }] }.
   * Throws the same user-facing errors as mergePdfs.
   */
  function inspectPdf(buf) {
    const doc = new PdfDoc(buf);
    const pages = doc.collectPages();
    return {
      pageCount: pages.length,
      pages: pages.map((p) => ({
        mediaBox: p.mediaBox.map((v) => (typeof v === 'number' ? v : 0)),
        rotate: p.rotate || 0,
      })),
    };
  }

  return { LIMITS, inflate, mergePdfs, inspectPdf, parsePdf: (b) => new PdfDoc(b) };
});
