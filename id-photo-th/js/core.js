// core.js — Thailand ID Photo Maker (id-photo-th): pure logic
// (presets, KB-range fitting at FIXED pixel dimensions, JPEG padding,
// 10x15 cm print-sheet layout).
// Environment-agnostic: attaches window.ThPhotoCore in the browser,
// module.exports in Node. The range engine is the same one proven in
// portal-photo (same origin code); the sheet layout is the same one
// proven in id-photo (same origin code).
// Spec sources (checked 2026-11-15):
//  - "1 นิ้ว / 1.5 นิ้ว / 2 นิ้ว" common sizes: joelin.cc (checked
//    2026-10-26) — 1 นิ้ว 2.5x3 cm (snappyid) or 2.5x3.25 cm
//    (windowssiam); 1.5 นิ้ว 3x4 cm; 2 นิ้ว 4x5.23 cm (windowssiam)
//    or 4x6 cm (snappyid). NO central government standard exists for
//    the inch names — the page says so and tells users to check the
//    form. This tool uses 2.5x3, 3x4 and 4x6 as the common sizes.
//  - Work permit: Department of Employment (doe.go.th) — "รูปถ่าย
//    คนต่างด้าว ขนาด 3x4 ซม. (1 นิ้วครึ่ง) จำนวน 2 รูป" (3x4 cm,
//    1.5 inch, 2 photos).
//  - Passport / visa 35x45 mm (ICAO): visagrade.com, resizo.in,
//    passport-size-photo.com, idphotodiy.com (checked 2026-11-03).
//    Thai e-Passport and national ID photos are captured ON SITE by
//    officers in Thailand — no self-supplied photo; the 35x45 preset
//    is for e-Visa / embassy applications from abroad.
//  - Visa on Arrival print: 4x6 cm (idphotodiy.com, wego.com).
//  - US 2x2 in (51x51 mm): Thai consulates in the US (e.g. Los
//    Angeles) ask for 2x2 in photos (idphotodiy.com).
//  - e-Visa KB limits CONFLICT across published sources (120 KB,
//    500 KB, 1 MB, 2 MB, 3 MB, 5 MB) — no KB window is claimed for
//    any preset; all presets use the editable neutral 500 KB default.
//   1. JPEG quality: binary-search the highest quality that stays
//      under the maximum (best-looking result that fits).
//   2. If even max quality lands below the minimum, grow the file with
//      standard JPEG COM (comment) segments inserted after the SOI
//      marker. Decoders ignore them; the pixels are byte-identical.
//      The UI discloses when padding was used.
//   3. If the padding needed would exceed PAD_RATIO_LIMIT × the real
//      image data, refuse: the "photo" would be an almost-empty
//      container, and any portal that re-encodes would drop it under
//      the floor again. The user is told to use a larger/original photo.
//
// KB interpretation guard: portals are sloppy about whether "KB" means
// 1000 or 1024 bytes, so the effective window is tightened on both
// ends — floor computed at 1024 B/KB, ceiling at 1000 B/KB — and an
// exported file therefore satisfies either reading.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ThPhotoCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KB = 1024;
  const PAD_RATIO_LIMIT = 20;
  const PAD_CUSHION_BYTES = 512;

  // Presets (sizes from the public sources in the header, checked
  // 2026-11-15). 1 นิ้ว = 2.5x3 cm (NOT 2.5x3.5 — that is the Chinese
  // 1-inch size); 1.5 นิ้ว = 3x4 cm (work permit, DOE-verified);
  // 2 นิ้ว = 4x6 cm (common size; some sources publish 4x5.23);
  // 35x45 mm is the ICAO passport/visa size, NOT the Thai national
  // ID card — ID-card and passport photos are captured on site, so
  // there is deliberately NO บัตรประชาชน preset.
  // KB caps are neutral editable defaults (500 KB) — no official cap
  // is published for these sizes, and e-Visa sources conflict.
  const PRESETS = [
    {
      id: 'one-inch',
      name: 'รูป 1 นิ้ว — ใบสมัครงาน / บัตรนักเรียน',
      wPx: 295, hPx: 354, minKB: null, maxKB: 500,
      note: 'รูป 1 นิ้ว ขนาด 2.5×3 ซม. (295×354 px @300 DPI) — ขนาดที่ใช้กันทั่วไปสำหรับใบสมัครงานและบัตรนักเรียน ไม่มีมาตรฐานกลางของทางการ แหล่งข้อมูลบางแห่งระบุ 2.5×3.25 ซม. ตรวจสอบช่องติดรูปในแบบฟอร์มก่อนใช้ ไม่มีขีดจำกัด KB ทางการสำหรับขนาดนี้ ค่าเริ่มต้น 500 KB ปรับได้',
    },
    {
      id: 'work-permit',
      name: 'รูป 1.5 นิ้ว — ใบอนุญาตทำงาน',
      wPx: 354, hPx: 472, minKB: null, maxKB: 500,
      note: 'รูป 1.5 นิ้ว ขนาด 3×4 ซม. (354×472 px @300 DPI) — กรมการจัดหางานกำหนดรูปถ่ายคนต่างด้าวขนาด 3×4 ซม. (1 นิ้วครึ่ง) จำนวน 2 รูป สำหรับใบอนุญาตทำงาน และเป็นขนาดที่โรงเรียนส่วนมากต้องการสำหรับบัตรนักเรียน ไม่มีขีดจำกัด KB ทางการสำหรับขนาดนี้ ค่าเริ่มต้น 500 KB ปรับได้',
    },
    {
      id: 'two-inch',
      name: 'รูป 2 นิ้ว — 4×6 ซม.',
      wPx: 472, hPx: 709, minKB: null, maxKB: 500,
      note: 'รูป 2 นิ้ว ขนาด 4×6 ซม. (472×709 px @300 DPI) — ขนาดที่ใช้กันทั่วไป และเป็นขนาดรูปพิมพ์สำหรับวีซ่าเมื่อเดินทางถึง (Visa on Arrival) แหล่งข้อมูลบางแห่งระบุ 4×5.23 ซม. ตรวจสอบแบบฟอร์มก่อนใช้ ไม่มีขีดจำกัด KB ทางการสำหรับขนาดนี้ ค่าเริ่มต้น 500 KB ปรับได้',
    },
    {
      id: 'passport-visa',
      name: 'หนังสือเดินทาง / วีซ่า — 3.5×4.5 ซม.',
      wPx: 413, hPx: 531, minKB: null, maxKB: 500,
      note: 'หนังสือเดินทาง / วีซ่า ขนาด 3.5×4.5 ซม. (413×531 px @300 DPI) ตามมาตรฐาน ICAO — ในประเทศไทย เจ้าหน้าที่ถ่ายรูปหนังสือเดินทางและบัตรประชาชนที่สำนักงาน ไม่ต้องเตรียมรูปไปเอง ขนาดนี้ใช้สำหรับยื่นวีซ่าออนไลน์ (e-Visa) และยื่นที่สถานทูตจากต่างประเทศ ขีดจำกัด KB ของ e-Visa แตกต่างกันตามแหล่งข้อมูล (120 KB ถึง 3 MB) ตรวจสอบหน้าอัปโหลดของสถานทูต ค่าเริ่มต้น 500 KB ปรับได้',
    },
    {
      id: 'us-2x2',
      name: 'วีซ่าไทย (สถานกงสุลสหรัฐฯ) — 2×2 นิ้ว',
      wPx: 600, hPx: 600, minKB: null, maxKB: 500,
      note: 'วีซ่าไทยขนาด 2×2 นิ้ว (51×51 มม., 600×600 px @300 DPI) — สถานกงสุลไทยบางแห่งในสหรัฐฯ (เช่น ลอสแอนเจลิส) กำหนดขนาดนี้ ใช้เฉพาะเมื่อสถานทูตที่คุณยื่นระบุ 2×2 นิ้วเท่านั้น ไม่มีขีดจำกัด KB ทางการสำหรับขนาดนี้ ค่าเริ่มต้น 500 KB ปรับได้',
    },
  ];

  // 10 x 15 cm photo paper at 300 DPI (portrait).
  const SHEET = { wPx: 1181, hPx: 1772, label: '10 × 15 cm @ 300 DPI', margin: 36, gap: 24 };

  /**
   * Tile a photo of (photoW x photoH) px onto the sheet.
   * Returns { cols, rows, count, positions: [{x, y}] } — positions are top-left
   * corners, tiles centred on the sheet as a block. Same origin as id-photo.
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

  /** Effective byte window for a preset/custom spec (see header note). */
  function rangeBytes(spec) {
    const minBytes = spec.minKB ? Math.round(spec.minKB * KB) : 0;
    const maxBytes = Math.round(spec.maxKB * 1000);
    return { minBytes, maxBytes };
  }

  function validateSpec(spec) {
    if (!spec || !Number.isFinite(spec.wPx) || !Number.isFinite(spec.hPx)) return 'Missing pixel dimensions.';
    if (spec.wPx < 10 || spec.wPx > 4000 || spec.hPx < 10 || spec.hPx > 4000) return 'Pixel dimensions must be between 10 and 4000.';
    if (!Number.isFinite(spec.maxKB) || spec.maxKB <= 0) return 'A maximum KB is required.';
    if (spec.maxKB > 10240) return 'Maximum KB must be 10240 or less.';
    if (spec.minKB != null && (!Number.isFinite(spec.minKB) || spec.minKB < 0)) return 'Minimum KB must be 0 or more.';
    if (spec.minKB != null && spec.minKB >= spec.maxKB) return 'Minimum KB must be smaller than maximum KB.';
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
      // 1–3 byte remainder, which no segment can express.
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
   * Fit a fixed-dimensions JPEG into [minBytes, maxBytes].
   * encodeAtQuality(q) -> Promise<Uint8Array> at the preset's exact
   * pixel size. Resolves to one of:
   *   { ok:true, withinRange:true, bytes, quality, sizeBytes, paddedBytes, note }
   *   { ok:false, reason:'over-max'|'below-min', sizeBytes, quality, note }
   * Never returns an out-of-range file as ok — failures carry no bytes.
   */
  async function encodeToRangeFixedDims(encodeAtQuality, spec) {
    const { minBytes, maxBytes } = rangeBytes(spec);
    const Q_LO = 0.02, Q_HI = 1.0;

    let bestBytes = await encodeAtQuality(Q_HI);
    let bestQuality = Q_HI;
    let bestSize = bestBytes.length;

    if (bestSize > maxBytes) {
      // Binary-search quality down for the largest size <= maxBytes.
      const loBytes = await encodeAtQuality(Q_LO);
      if (loBytes.length > maxBytes) {
        return {
          ok: false, reason: 'over-max', quality: Q_LO, sizeBytes: loBytes.length,
          note: 'Even the lowest JPEG quality is ' + loBytes.length + ' bytes, over the ' + maxBytes + '-byte ceiling at these exact pixel dimensions.',
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
    }

    if (bestSize >= minBytes) {
      return {
        ok: true, withinRange: true, bytes: bestBytes, quality: bestQuality,
        sizeBytes: bestSize, paddedBytes: 0, note: 'fits by quality alone',
      };
    }

    // Below the floor: grow with COM-segment padding (pixels untouched).
    const target = Math.min(minBytes + PAD_CUSHION_BYTES, maxBytes);
    const needed = target - bestSize;
    if (needed > bestSize * PAD_RATIO_LIMIT) {
      return {
        ok: false, reason: 'below-min', quality: bestQuality, sizeBytes: bestSize,
        note: 'Image data is only ' + bestSize + ' bytes; reaching the ' + minBytes + '-byte minimum would need more than ' +
          PAD_RATIO_LIMIT + 'x that in padding, which portals that re-encode would strip away.',
      };
    }
    const padded = padJpegBytes(bestBytes, target);
    return {
      ok: true, withinRange: true, bytes: padded, quality: bestQuality,
      sizeBytes: padded.length, paddedBytes: padded.length - bestSize, note: 'fits after COM padding',
    };
  }

  /** Verdict helper for UI/QC: is this byte count inside the spec window? */
  function evaluateSize(sizeBytes, spec) {
    const { minBytes, maxBytes } = rangeBytes(spec);
    return {
      kb: sizeBytes / KB,
      minBytes, maxBytes,
      inRange: sizeBytes >= minBytes && sizeBytes <= maxBytes,
    };
  }

  return { KB, PRESETS, SHEET, layoutSheet, PAD_RATIO_LIMIT, rangeBytes, validateSpec, isJpeg, padJpegBytes, encodeToRangeFixedDims, evaluateSize };
});
