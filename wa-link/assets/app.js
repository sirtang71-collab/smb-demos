(function () {
  "use strict";

  var ccEl = document.getElementById("countryCode");
  var phoneEl = document.getElementById("phone");
  var msgEl = document.getElementById("message");
  var linkOut = document.getElementById("linkOut");
  var testLink = document.getElementById("testLink");
  var copyBtn = document.getElementById("copyBtn");
  var linkStatus = document.getElementById("linkStatus");
  var charCount = document.getElementById("charCount");
  var qrCanvas = document.getElementById("qrCanvas");
  var qrDownload = document.getElementById("qrDownload");
  var tplGrid = document.getElementById("tplGrid");

  var currentLang = "en";
  var currentLink = "";

  function cleanDigits(s) {
    return (s || "").replace(/\D/g, "");
  }

  /* Build the full international number.
     - User picks the country code; the local field should not repeat it.
     - If the typed number already starts with the selected code, keep as-is.
     - Drop a leading 0 (trunk prefix) when a country code is applied. */
  function fullNumber() {
    var cc = ccEl.value;
    var local = cleanDigits(phoneEl.value);
    if (!local) return "";
    if (local.indexOf(cc) === 0 && local.length > cc.length + 5) {
      return local;
    }
    if (local.charAt(0) === "0") local = local.slice(1);
    return cc + local;
  }

  function buildLink() {
    var num = fullNumber();
    if (!num || num.length < 7) return "";
    var msg = msgEl.value.replace(/\s+$/g, "");
    var link = "https://wa.me/" + num;
    if (msg) link += "?text=" + encodeURIComponent(msg);
    return link;
  }

  function drawQR(link) {
    var ctx = qrCanvas.getContext("2d");
    var size = qrCanvas.width;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    if (!link) {
      ctx.fillStyle = "#9aa3ab";
      ctx.font = "15px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Your QR code", size / 2, size / 2 - 8);
      ctx.fillText("appears here", size / 2, size / 2 + 16);
      return;
    }
    try {
      var qr = qrcode(0, "M");
      qr.addData(link);
      qr.make();
      var count = qr.getModuleCount();
      var margin = 4;
      var cell = Math.floor(size / (count + margin * 2));
      var offset = Math.floor((size - cell * count) / 2);
      ctx.fillStyle = "#111111";
      for (var r = 0; r < count; r++) {
        for (var c = 0; c < count; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect(offset + c * cell, offset + r * cell, cell, cell);
          }
        }
      }
    } catch (e) {
      ctx.fillStyle = "#c0392b";
      ctx.font = "14px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Message too long for a QR code", size / 2, size / 2);
    }
  }

  function render() {
    charCount.textContent = String(msgEl.value.length);
    currentLink = buildLink();
    linkOut.value = currentLink;
    if (currentLink) {
      testLink.href = currentLink;
      testLink.classList.remove("disabled");
      linkStatus.textContent = "Ready — copy it into your bio, shop page or flyer.";
    } else {
      testLink.removeAttribute("href");
      testLink.classList.add("disabled");
      linkStatus.textContent = "Enter your number above — the link updates as you type.";
    }
    drawQR(currentLink);
  }

  function renderTemplates() {
    tplGrid.innerHTML = "";
    window.WA_TEMPLATES[currentLang].forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "tpl-btn";
      b.setAttribute("data-tpl", t.id);
      b.textContent = t.icon + " " + t.label;
      b.addEventListener("click", function () {
        msgEl.value = t.text;
        tplGrid.querySelectorAll(".tpl-btn").forEach(function (x) {
          x.classList.remove("active");
        });
        b.classList.add("active");
        render();
        msgEl.focus();
      });
      tplGrid.appendChild(b);
    });
  }

  document.querySelectorAll(".lang-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".lang-tab").forEach(function (x) {
        x.classList.remove("active");
      });
      tab.classList.add("active");
      currentLang = tab.getAttribute("data-lang");
      renderTemplates();
    });
  });

  copyBtn.addEventListener("click", function () {
    if (!currentLink) {
      linkStatus.textContent = "Add your WhatsApp number first — then the link can be copied.";
      phoneEl.focus();
      return;
    }
    function done() {
      copyBtn.textContent = "✅ Copied!";
      setTimeout(function () { copyBtn.textContent = "📋 Copy link"; }, 1800);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(currentLink).then(done, function () {
        linkOut.select();
        document.execCommand("copy");
        done();
      });
    } else {
      linkOut.select();
      document.execCommand("copy");
      done();
    }
  });

  qrDownload.addEventListener("click", function () {
    if (!currentLink) {
      linkStatus.textContent = "Add your WhatsApp number first — then the QR code can be downloaded.";
      phoneEl.focus();
      return;
    }
    /* Re-render onto a bigger offscreen canvas for a crisp print file. */
    var out = document.createElement("canvas");
    var scale = 4;
    out.width = qrCanvas.width * scale;
    out.height = qrCanvas.height * scale;
    var octx = out.getContext("2d");
    octx.imageSmoothingEnabled = false;
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(qrCanvas, 0, 0, out.width, out.height);
    var a = document.createElement("a");
    a.download = "whatsapp-qr.png";
    a.href = out.toDataURL("image/png");
    a.click();
  });

  [ccEl, phoneEl].forEach(function (el) {
    el.addEventListener("input", render);
    el.addEventListener("change", render);
  });
  msgEl.addEventListener("input", render);

  renderTemplates();
  render();
})();
