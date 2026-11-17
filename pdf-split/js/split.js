// split.js — PDF Split (pdf-split): range parsing + mode helpers.
// Pure logic, no DOM: turns the user's mode + text into the page-index
// groups that core.js splitPdfs() consumes.
// Environment-agnostic: attaches window.PdfSplit in the browser,
// module.exports in Node.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PdfSplit = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Parse a range spec like "1-3, 5, 7-9" into an array of groups;
   * each group is an array of 0-based page indexes, one group per
   * comma segment, ranges expanded in order. Throws Error with a
   * user-facing message on bad input.
   */
  function parseRanges(spec, pageCount) {
    if (typeof spec !== 'string' || !spec.trim()) {
      throw new Error('type the pages to split, e.g. 1-3, 5, 7-9');
    }
    const groups = [];
    const segments = spec.split(',');
    for (let s = 0; s < segments.length; s++) {
      const seg = segments[s].trim();
      if (!seg) {
        throw new Error('empty page range near comma #' + (s + 1) +
          ' — check for a double comma or a trailing comma');
      }
      const m = /^(\d+)\s*-\s*(\d+)$/.exec(seg) || /^(\d+)$/.exec(seg);
      if (!m) {
        throw new Error('could not read "' + seg +
          '" — use page numbers and ranges like 1-3, 5');
      }
      let lo, hi;
      if (m[2] !== undefined) { lo = parseInt(m[1], 10); hi = parseInt(m[2], 10); }
      else { lo = hi = parseInt(m[1], 10); }
      if (lo < 1 || hi < 1) {
        throw new Error('page numbers start at 1 — "' + seg + '" has a 0 or negative page');
      }
      if (lo > hi) {
        throw new Error('range "' + seg + '" runs backwards — put the smaller page first');
      }
      if (hi > pageCount) {
        throw new Error('page ' + hi + ' is past the end — this PDF has ' + pageCount +
          ' page' + (pageCount === 1 ? '' : 's'));
      }
      const group = [];
      for (let p = lo; p <= hi; p++) group.push(p - 1);
      groups.push(group);
    }
    return groups;
  }

  /**
   * "Split every N pages": groups of N consecutive pages.
   * N must be a positive integer smaller than the page count
   * (N >= pageCount would just hand back the whole file).
   */
  function everyNGroups(n, pageCount) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('split-every-N needs a whole number of 1 or more');
    }
    if (n >= pageCount) {
      throw new Error('every ' + n + ' pages would leave the file whole — this PDF has only ' +
        pageCount + ' page' + (pageCount === 1 ? '' : 's') + ', pick a smaller number');
    }
    const groups = [];
    for (let start = 0; start < pageCount; start += n) {
      const group = [];
      for (let p = start; p < Math.min(start + n, pageCount); p++) group.push(p);
      groups.push(group);
    }
    return groups;
  }

  /**
   * "Extract single pages": same text as parseRanges, but every
   * listed page becomes its own one-page group.
   */
  function singlePageGroups(spec, pageCount) {
    const groups = parseRanges(spec, pageCount);
    const out = [];
    for (const g of groups) for (const p of g) out.push([p]);
    return out;
  }

  /** Human label for a group: "page 5" / "pages 1–3" / "pages 1, 3". */
  function groupLabel(group) {
    if (group.length === 1) return 'page ' + (group[0] + 1);
    let contiguous = true;
    for (let i = 1; i < group.length; i++) {
      if (group[i] !== group[i - 1] + 1) { contiguous = false; break; }
    }
    if (contiguous) return 'pages ' + (group[0] + 1) + '–' + (group[group.length - 1] + 1);
    return 'pages ' + group.map((p) => p + 1).join(', ');
  }

  return { parseRanges, everyNGroups, singlePageGroups, groupLabel };
});
