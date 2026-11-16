/* wa-business-card — pure logic core (browser + Node, no DOM).
   vCard 3.0 builder, phone normaliser, wa.me link builder.
   QR encoding itself is NOT reimplemented here: the tool reuses the
   vendored qrcode-generator library already shipped by qr-suite
   (assets/vendor/qrcode.min.js, MIT, byte-identical copy) — see QC.md.
   Exposed as window.WaCardCore in the browser and module.exports in Node. */
(function (global) {
  "use strict";

  /* Escape one vCard value: backslash, comma, semicolon, newline.
     Same rule as qr-suite's core (kept identical on purpose). */
  function escapeVCard(value) {
    return String(value == null ? "" : value).replace(/\\/g, "\\\\")
      .replace(/,/g, "\\,").replace(/;/g, "\\;")
      .replace(/\r\n|\r|\n/g, "\\n");
  }

  /* Normalise a phone number to bare digits.
     Strips spaces, dashes, parentheses and dots; an optional leading +
     is dropped (it is re-added for TEL, never for wa.me).
     Returns { ok: true, digits } or { ok: false, error }.
     Digits must be 7–15 long (E.164 range); anything else is rejected,
     including letters and a second + sign. */
  function normalizePhone(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return { ok: false, error: "empty-phone" };
    var hadPlus = s.charAt(0) === "+";
    var body = hadPlus ? s.slice(1) : s;
    if (/\+/.test(body)) return { ok: false, error: "bad-phone" };
    var digits = body.replace(/[\s\-().]/g, "");
    if (!/^\d+$/.test(digits)) return { ok: false, error: "bad-phone" };
    if (digits.length < 7 || digits.length > 15) return { ok: false, error: "bad-phone" };
    return { ok: true, digits: digits };
  }

  /* opts: { name, phone, intro, org }
     phone may be raw (spaces/+/dashes allowed) — it is normalised here.
     Returns { ok: true, payload, digits, waLink } or { ok: false, error }.
     CRLF line endings per vCard 3.0. Empty optional fields are omitted.
     TEL carries the E.164 form (+digits); NOTE carries the intro. */
  function buildVCard(opts) {
    var o = opts || {};
    var name = String(o.name == null ? "" : o.name).trim();
    if (!name) return { ok: false, error: "empty-name" };
    var ph = normalizePhone(o.phone);
    if (!ph.ok) return { ok: false, error: ph.error };
    var lines = ["BEGIN:VCARD", "VERSION:3.0"];
    lines.push("N:" + escapeVCard(name));
    lines.push("FN:" + escapeVCard(name));
    lines.push("TEL;TYPE=CELL:+" + ph.digits);
    var intro = String(o.intro == null ? "" : o.intro).trim();
    if (intro) lines.push("NOTE:" + escapeVCard(intro));
    var org = String(o.org == null ? "" : o.org).trim();
    if (org) lines.push("ORG:" + escapeVCard(org));
    lines.push("END:VCARD");
    return {
      ok: true,
      payload: lines.join("\r\n"),
      digits: ph.digits,
      waLink: buildWaLink(ph.digits).link,
    };
  }

  /* wa.me direct-chat link. digits must already be normalised. */
  function buildWaLink(digits) {
    var d = String(digits == null ? "" : digits).trim();
    if (!/^\d{7,15}$/.test(d)) return { ok: false, error: "bad-phone" };
    return { ok: true, link: "https://wa.me/" + d };
  }

  /* File-safe slug for the .vcf download name, from the contact name. */
  function slugifyName(name) {
    var s = String(name == null ? "" : name).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "contact";
  }

  var api = {
    escapeVCard: escapeVCard,
    normalizePhone: normalizePhone,
    buildVCard: buildVCard,
    buildWaLink: buildWaLink,
    slugifyName: slugifyName,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.WaCardCore = api;
})(typeof window !== "undefined" ? window : globalThis);
