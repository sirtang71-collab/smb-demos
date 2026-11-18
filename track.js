/* Atang Lab first-touch source tracker — Scheme A (2026-11-18).
   Convention: money-scan/tracking-src-convention.md
   - Reads ?src= from the landing URL; stores it in localStorage for 30 days
     (first-touch: an unexpired record is never overwritten).
   - Appends the stored src to outbound links to gumroad.com / payhip.com /
     fiverr.com (unless the link already carries a src).
   - Zero dependencies, no network calls, no PII. Any failure is silent and
     must never affect page functionality. */
(function () {
  'use strict';
  var KEY = 'atang_ft_src';
  var TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
  var HOSTS = ['gumroad.com', 'payhip.com', 'fiverr.com'];

  var store = null;
  try {
    var probe = '__atang_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    store = localStorage;
  } catch (e) {
    store = null;
  }

  function readStored() {
    if (!store) return null;
    try {
      var raw = store.getItem(KEY);
      if (!raw) return null;
      var rec = JSON.parse(raw);
      if (!rec || typeof rec.src !== 'string' || typeof rec.ts !== 'number') return null;
      if (Date.now() - rec.ts > TTL) {
        try { store.removeItem(KEY); } catch (e) {}
        return null;
      }
      return rec;
    } catch (e) {
      return null;
    }
  }

  function isValidSrc(s) {
    return typeof s === 'string' && /^[a-z0-9][a-z0-9\-]{0,63}$/i.test(s);
  }

  var ft = readStored();

  try {
    var incoming = new URLSearchParams(window.location.search).get('src');
    if (incoming) incoming = incoming.trim();
    if (isValidSrc(incoming) && store && !ft) {
      var rec = { src: incoming, ts: Date.now() };
      try {
        store.setItem(KEY, JSON.stringify(rec));
        ft = rec;
      } catch (e) { /* storage full/blocked: continue without it */ }
    }
  } catch (e) {}

  if (!ft || !isValidSrc(ft.src)) return;

  function decorate(a) {
    try {
      var u = new URL(a.href, window.location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      var h = u.hostname.toLowerCase();
      var match = false;
      for (var i = 0; i < HOSTS.length; i++) {
        var d = HOSTS[i];
        if (h === d || h.slice(-(d.length + 1)) === '.' + d) { match = true; break; }
      }
      if (!match) return;
      if (u.searchParams.has('src')) return; // link's own tag wins
      u.searchParams.set('src', ft.src);
      a.href = u.toString();
    } catch (e) {}
  }

  function run() {
    try {
      var links = document.querySelectorAll('a[href]');
      for (var i = 0; i < links.length; i++) decorate(links[i]);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
