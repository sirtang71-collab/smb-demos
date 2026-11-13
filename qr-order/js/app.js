/* QR Order — customer app (index.html). Uses QROrderCore for all logic. */
(function () {
  "use strict";
  var C = window.QROrderCore;
  var LS_LANG = "qrorder.lang", LS_TABLE = "qrorder.table", LS_CART = "qrorder.cart";
  var TABLES = 12;

  var lang = localStorage.getItem(LS_LANG) || "en";
  if (C.LANGS.indexOf(lang) < 0) lang = "en";

  function qs(name) {
    var m = new RegExp("[?&]" + name + "=(\\d+)").exec(location.search);
    return m ? parseInt(m[1], 10) : 0;
  }
  var table = qs("table") || parseInt(localStorage.getItem(LS_TABLE) || "0", 10) || 0;

  var cart = {};
  try { cart = JSON.parse(localStorage.getItem(LS_CART) || "{}") || {}; } catch (e) { cart = {}; }
  /* drop stale ids defensively */
  for (var k in cart) if (!C.itemById(k)) delete cart[k];

  function S() { return C.STR[lang]; }
  function saveCart() { localStorage.setItem(LS_CART, JSON.stringify(cart)); }

  /* ---------- table selector ---------- */
  var sel = document.getElementById("tableSel");
  function buildTableOptions() {
    var s = S();
    sel.innerHTML = "";
    var o0 = document.createElement("option");
    o0.value = "0"; o0.textContent = s.selectTable;
    sel.appendChild(o0);
    for (var i = 1; i <= TABLES; i++) {
      var o = document.createElement("option");
      o.value = String(i); o.textContent = s.tableN + i;
      sel.appendChild(o);
    }
    sel.value = String(table || 0);
  }
  sel.addEventListener("change", function () {
    table = parseInt(sel.value, 10) || 0;
    localStorage.setItem(LS_TABLE, String(table));
    document.getElementById("panelTable").textContent = table ? (S().tableN + table) : S().selectTable;
    drawQr();
  });

  /* ---------- menu render ---------- */
  var root = document.getElementById("menuRoot");
  var syncers = [];
  function renderMenu() {
    root.innerHTML = "";
    syncers = [];
    C.MENU.forEach(function (cat) {
      var sec = document.createElement("section");
      sec.className = "cat";
      var h = document.createElement("h2");
      h.textContent = cat.names[lang];
      sec.appendChild(h);
      var grid = document.createElement("div");
      grid.className = "menu-grid";
      cat.items.forEach(function (it) {
        var card = document.createElement("div");
        card.className = "dish";
        var first = (it.names.en || "?").charAt(0);
        card.innerHTML =
          '<div class="ph" style="background:linear-gradient(140deg,hsl(' + it.hue + ',52%,46%),hsl(' + ((it.hue + 40) % 360) + ',55%,30%))">' + first + "</div>" +
          '<div class="body"><h3></h3><p></p><div class="row"><span class="price">' + C.formatTHB(it.price) + "</span>" +
          '<span><button type="button" class="add-btn"></button>' +
          '<span class="stepper"><button type="button" class="minus" aria-label="−">−</button><span class="q">0</span><button type="button" class="plus" aria-label="+">+</button></span></span></div></div>';
        card.querySelector("h3").textContent = it.names[lang];
        card.querySelector("p").textContent = it.desc[lang];
        card.querySelector(".add-btn").textContent = S().add;
        var addBtn = card.querySelector(".add-btn"), stepper = card.querySelector(".stepper");
        var qEl = card.querySelector(".q");
        function sync() {
          var q = cart[it.id] || 0;
          qEl.textContent = q;
          stepper.classList.toggle("on", q > 0);
          addBtn.style.display = q > 0 ? "none" : "";
        }
        addBtn.addEventListener("click", function () { cart = C.cartAdd(cart, it.id); saveCart(); sync(); renderCartBar(); });
        card.querySelector(".plus").addEventListener("click", function () { cart = C.cartAdd(cart, it.id); saveCart(); sync(); renderCartBar(); });
        card.querySelector(".minus").addEventListener("click", function () { cart = C.cartSetQty(cart, it.id, (cart[it.id] || 0) - 1); saveCart(); sync(); renderCartBar(); });
        syncers.push(sync);
        grid.appendChild(card);
      });
      sec.appendChild(grid);
      root.appendChild(sec);
    });
    for (var i = 0; i < syncers.length; i++) syncers[i]();
  }

  /* ---------- cart bar + panel ---------- */
  var viewBtn = document.getElementById("viewCartBtn");
  var panel = document.getElementById("panel");
  function renderCartBar() {
    var lines = C.cartLines(cart);
    document.getElementById("cartCount").textContent = C.cartCount(lines);
    document.getElementById("cartTotal").textContent = C.formatTHB(C.cartTotal(lines));
    viewBtn.disabled = lines.length === 0;
    viewBtn.textContent = S().cart;
  }
  function renderPanel() {
    var s = S();
    document.getElementById("panelTitle").textContent = s.cart;
    document.getElementById("panelTable").textContent = table ? (s.table + ": " + s.tableN + table) : s.selectTable;
    document.getElementById("panelTotalLabel").textContent = s.total;
    var box = document.getElementById("panelLines");
    var lines = C.cartLines(cart);
    box.innerHTML = "";
    if (!lines.length) {
      var p = document.createElement("p");
      p.className = "empty-note"; p.textContent = s.empty;
      box.appendChild(p);
    }
    lines.forEach(function (l) {
      var row = document.createElement("div");
      row.className = "cline";
      row.innerHTML = '<span class="nm"></span><span class="stepper on"><button type="button" class="m">−</button><span class="q"></span><button type="button" class="p">+</button></span><span class="lt"></span>';
      row.querySelector(".nm").innerHTML = "";
      row.querySelector(".nm").textContent = l.names[lang];
      var small = document.createElement("small");
      small.textContent = C.formatTHB(l.unitPrice) + " × " + l.qty;
      row.querySelector(".nm").appendChild(small);
      row.querySelector(".q").textContent = l.qty;
      row.querySelector(".lt").textContent = C.formatTHB(l.lineTotal);
      row.querySelector(".m").addEventListener("click", function () { cart = C.cartSetQty(cart, l.id, l.qty - 1); saveCart(); refreshAll(); });
      row.querySelector(".p").addEventListener("click", function () { cart = C.cartAdd(cart, l.id); saveCart(); refreshAll(); });
      box.appendChild(row);
    });
    document.getElementById("panelTotal").textContent = C.formatTHB(C.cartTotal(lines));
    var place = document.getElementById("placeBtn");
    place.textContent = s.place;
    place.disabled = !lines.length || !(table > 0);
  }
  function refreshAll() { renderMenu(); renderCartBar(); if (panel.classList.contains("open")) renderPanel(); }

  viewBtn.addEventListener("click", function () { renderPanel(); panel.classList.add("open"); });
  document.getElementById("closePanelBtn").addEventListener("click", function () { panel.classList.remove("open"); });
  panel.addEventListener("click", function (e) { if (e.target === panel) panel.classList.remove("open"); });

  document.getElementById("placeBtn").addEventListener("click", function () {
    var res = C.submitOrder(localStorage, cart, table, Date.now());
    if (!res.ok) { renderPanel(); return; }
    cart = {}; saveCart();
    panel.classList.remove("open");
    document.getElementById("orderNo").textContent = res.order.no;
    document.getElementById("successBox").classList.add("show");
    document.getElementById("successBox").scrollIntoView({ behavior: "smooth", block: "center" });
    refreshAll();
  });
  document.getElementById("againBtn").addEventListener("click", function () {
    document.getElementById("successBox").classList.remove("show");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ---------- language ---------- */
  function applyLang() {
    var s = S();
    document.documentElement.lang = lang === "tzh" ? "zh-Hant" : lang === "szh" ? "zh-Hans" : lang === "th" ? "th" : "en";
    document.getElementById("tagline").textContent = s.tag;
    document.getElementById("merchantLink").textContent = s.merchant;
    document.getElementById("tableLabel").textContent = s.table;
    document.getElementById("placedH").textContent = s.placed;
    document.getElementById("orderNoLabel").textContent = s.orderNo;
    document.getElementById("kitchenNote").textContent = s.kitchen;
    document.getElementById("againBtn").textContent = s.newOrder;
    document.getElementById("qrTitle").textContent = s.qrTitle;
    document.getElementById("qrNote").textContent = s.qrNote;
    document.getElementById("footerNote").textContent = s.footer;
    document.getElementById("cartItemsLabel").textContent = s.items;
    var btns = document.querySelectorAll(".lang-switch button");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i].getAttribute("data-lang") === lang);
    buildTableOptions();
    refreshAll();
  }
  var langBtns = document.querySelectorAll(".lang-switch button");
  for (var i = 0; i < langBtns.length; i++)
    langBtns[i].addEventListener("click", function () {
      lang = this.getAttribute("data-lang");
      localStorage.setItem(LS_LANG, lang);
      applyLang();
    });

  /* ---------- printable table QR (real QR, vendored qrcode-generator) ---------- */
  function drawQr() {
    var base = location.href.split("?")[0].split("#")[0];
    var url = base + "?table=" + (table > 0 ? table : 1);
    document.getElementById("qrUrl").textContent = url;
    var canvas = document.getElementById("qrCanvas");
    var ctx = canvas.getContext("2d");
    try {
      var qr = qrcode(0, "M");
      qr.addData(url);
      qr.make();
      var count = qr.getModuleCount();
      var size = 220, cell = Math.floor(size / (count + 2)), off = Math.floor((size - cell * count) / 2);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#221c15";
      for (var r = 0; r < count; r++)
        for (var c = 0; c < count; c++)
          if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
    } catch (e) {
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 220, 220);
      ctx.fillStyle = "#7d6f5f"; ctx.font = "14px sans-serif";
      ctx.fillText("QR unavailable", 60, 110);
    }
  }

  applyLang();
  drawQr();
})();
