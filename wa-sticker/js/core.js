// core.js — WhatsApp Sticker Maker: pure logic (size fitting, STORE zip).
// Environment-agnostic: attaches window.WAStickerCore in the browser,
// module.exports in Node (same pattern as cpns-kit/js/core.js).
//
// The size-fitting core follows photo-tools/js/jpeg-size.js behaviour:
// binary-search quality at fixed pixel dimensions, honest `over` flag.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.WAStickerCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;

  // WhatsApp's published sticker requirements (official sticker app spec):
  // sticker 512x512 WebP, <= 100 KB each; tray icon 96x96 PNG, <= 50 KB.
  const SPECS = {
    sticker: { px: 512, capBytes: 100 * KB, format: 'image/webp', label: 'Sticker 512x512 WebP <= 100 KB' },
    tray: { px: 96, capBytes: 50 * KB, format: 'image/png', label: 'Tray icon 96x96 PNG <= 50 KB' },
  };

  async function byteLen(encoded) {
    if (encoded == null) throw new Error('encoder returned nothing');
    if (typeof encoded.byteLength === 'number') return encoded.byteLength;
    if (typeof encoded.size === 'number') return encoded.size; // Blob
    if (typeof encoded.length === 'number') return encoded.length;
    throw new Error('cannot determine encoded size');
  }

  /**
   * Quality-only fit at FIXED pixel dimensions (a sticker canvas must stay
   * exactly 512x512). encodeAtQuality(q) returns bytes/Blob.
   * Returns the highest quality whose size <= capBytes; over=true when even
   * the lowest quality overflows (caller must say so honestly).
   */
  async function encodeUnderCapFixedDims(encodeAtQuality, capBytes) {
    const Q_LO = 0.02, Q_HI = 1.0;
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

  /* ---------------- CRC32 + minimal ZIP (STORE, no compression) --------
     Stickers (WebP) and tray icons (PNG) are already compressed formats,
     so entries are stored verbatim — a plain STORE zip is the right tool
     and needs no compression library. */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(d) {
    const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
    return { time, date };
  }

  /**
   * Build a ZIP archive (STORE method) from [{name, bytes:Uint8Array}].
   * Returns a Uint8Array. Names are written as UTF-8 (flag bit 11).
   */
  function createZipStore(entries, when) {
    const enc = new TextEncoder();
    const dt = dosDateTime(when || new Date());
    const chunks = [];
    const centrals = [];
    let offset = 0;

    function u16(v) { return [v & 0xFF, (v >>> 8) & 0xFF]; }
    function u32(v) { return [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF]; }
    function push(arr) { const b = new Uint8Array(arr); chunks.push(b); offset += b.length; }

    for (const entry of entries) {
      const nameBytes = enc.encode(entry.name);
      const data = entry.bytes;
      const crc = crc32(data);
      const localOffset = offset;
      push([
        ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(dt.time), ...u16(dt.date),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0),
      ]);
      chunks.push(nameBytes); offset += nameBytes.length;
      chunks.push(data); offset += data.length;

      centrals.push(new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
        ...u16(dt.time), ...u16(dt.date),
        ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
        ...u32(0), ...u32(localOffset),
      ]));
      centrals.push(nameBytes);
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const c of centrals) { chunks.push(c); cdSize += c.length; offset += c.length; }
    push([
      ...u32(0x06054b50), ...u16(0), ...u16(0),
      ...u16(entries.length), ...u16(entries.length),
      ...u32(cdSize), ...u32(cdStart), ...u16(0),
    ]);

    const out = new Uint8Array(offset);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  }

  /** 'My Photo (1).JPG' -> 'my-photo-1' (safe base name for downloads). */
  function sanitizeBaseName(name) {
    const base = String(name || 'sticker').replace(/\.[^.]*$/, '');
    const clean = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return clean || 'sticker';
  }

  return { KB, SPECS, byteLen, encodeUnderCapFixedDims, crc32, createZipStore, sanitizeBaseName };
});
