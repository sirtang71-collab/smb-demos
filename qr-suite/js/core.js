/* QR Suite — pure logic core (browser + Node, no DOM).
   Payload builders only: Link/Text, WiFi, vCard.
   Exposed as window.QRSuiteCore in the browser and module.exports in Node. */
(function (global) {
  "use strict";

  /* Escape one WiFi field value. Per the WiFi QR spec the characters
     \ ; , : " are escaped with a backslash. Backslash goes first so an
     already-escaped char is never double-escaped. */
  function escapeWifi(value) {
    return String(value == null ? "" : value).replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;").replace(/,/g, "\\,")
      .replace(/:/g, "\\:").replace(/"/g, '\\"');
  }

  /* Escape one vCard value: backslash, comma, semicolon, newline. */
  function escapeVCard(value) {
    return String(value == null ? "" : value).replace(/\\/g, "\\\\")
      .replace(/,/g, "\\,").replace(/;/g, "\\;")
      .replace(/\r\n|\r|\n/g, "\\n");
  }

  /* opts: { ssid, password, encryption: "WPA"|"WEP"|"nopass", hidden: bool }
     Returns { ok: true, payload } or { ok: false, error }.
     Open network (nopass) carries no P field. */
  function buildWifi(opts) {
    var o = opts || {};
    var ssid = String(o.ssid == null ? "" : o.ssid).trim();
    if (!ssid) return { ok: false, error: "empty-ssid" };
    var enc = o.encryption === "WEP" ? "WEP" : o.encryption === "nopass" ? "nopass" : "WPA";
    var parts = ["WIFI:T:" + enc, "S:" + escapeWifi(ssid)];
    if (enc !== "nopass") parts.push("P:" + escapeWifi(o.password == null ? "" : o.password));
    if (o.hidden) parts.push("H:true");
    return { ok: true, payload: parts.join(";") + ";;" };
  }

  /* opts: { name, phone, email, org }
     Returns { ok: true, payload } or { ok: false, error }.
     CRLF line endings per vCard 3.0. Empty optional fields are omitted. */
  function buildVCard(opts) {
    var o = opts || {};
    var name = String(o.name == null ? "" : o.name).trim();
    if (!name) return { ok: false, error: "empty-name" };
    var lines = ["BEGIN:VCARD", "VERSION:3.0"];
    lines.push("N:" + escapeVCard(name));
    lines.push("FN:" + escapeVCard(name));
    if (String(o.phone == null ? "" : o.phone).trim())
      lines.push("TEL;TYPE=CELL:" + escapeVCard(String(o.phone).trim()));
    if (String(o.email == null ? "" : o.email).trim())
      lines.push("EMAIL:" + escapeVCard(String(o.email).trim()));
    if (String(o.org == null ? "" : o.org).trim())
      lines.push("ORG:" + escapeVCard(String(o.org).trim()));
    lines.push("END:VCARD");
    return { ok: true, payload: lines.join("\r\n") };
  }

  /* Any URL or plain text. Whitespace-only input is rejected. */
  function buildText(text) {
    var s = String(text == null ? "" : text).trim();
    if (!s) return { ok: false, error: "empty-text" };
    return { ok: true, payload: s };
  }

  /* Split a batch textarea into link lines: trim, drop empties, cap 12. */
  function parseBatch(text) {
    var lines = String(text == null ? "" : text).split(/\r\n|\r|\n/)
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });
    if (!lines.length) return { ok: false, error: "empty-batch" };
    if (lines.length > 12) return { ok: false, error: "too-many", count: lines.length };
    return { ok: true, items: lines };
  }

  var api = {
    escapeWifi: escapeWifi,
    escapeVCard: escapeVCard,
    buildWifi: buildWifi,
    buildVCard: buildVCard,
    buildText: buildText,
    parseBatch: parseBatch,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.QRSuiteCore = api;
})(typeof window !== "undefined" ? window : globalThis);
