/* QR Order — merchant view (merchant.html). Reads the same localStorage
   order store the customer page writes (QROrderCore). English UI; item
   names are shown in English with the customer's language alongside. */
(function () {
  "use strict";
  var C = window.QROrderCore;
  var root = document.getElementById("ordersRoot");
  var emptyNote = document.getElementById("emptyNote");
  var summary = document.getElementById("summary");

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }

  function render() {
    var orders = C.loadOrders(localStorage).slice().reverse(); /* newest first */
    root.innerHTML = "";
    emptyNote.style.display = orders.length ? "none" : "";
    var open = 0, revenue = 0;
    orders.forEach(function (o) {
      if (o.status === "new") open++;
      revenue += o.total;
      var card = document.createElement("div");
      card.className = "order-card" + (o.status === "done" ? " done" : "");
      var head = document.createElement("div");
      head.className = "order-head";
      head.innerHTML = '<span class="no"></span><span class="badge ' + o.status + '">' + (o.status === "new" ? "New" : "Done") + '</span><span class="tbl"></span><span class="tm"></span>';
      head.querySelector(".no").textContent = o.no;
      head.querySelector(".tbl").textContent = "Table " + o.table;
      head.querySelector(".tm").textContent = fmtTime(o.ts);
      card.appendChild(head);
      var ul = document.createElement("ul");
      o.lines.forEach(function (l) {
        var li = document.createElement("li");
        var left = document.createElement("span");
        left.textContent = l.qty + " × " + l.names.en;
        var right = document.createElement("span");
        right.textContent = C.formatTHB(l.lineTotal);
        li.appendChild(left); li.appendChild(right);
        ul.appendChild(li);
      });
      card.appendChild(ul);
      var tot = document.createElement("div");
      tot.className = "order-total";
      tot.innerHTML = "<span>Total</span><span>" + C.formatTHB(o.total) + "</span>";
      card.appendChild(tot);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "status-btn" + (o.status === "done" ? " reopen" : "");
      btn.textContent = o.status === "new" ? "Mark done" : "Reopen";
      btn.addEventListener("click", function () {
        C.setOrderStatus(localStorage, o.no, o.status === "new" ? "done" : "new");
        render();
      });
      card.appendChild(btn);
      root.appendChild(card);
    });
    summary.textContent = orders.length
      ? open + " open · " + orders.length + " orders · " + C.formatTHB(revenue) + " total"
      : "";
  }

  document.getElementById("refreshBtn").addEventListener("click", render);
  document.getElementById("clearBtn").addEventListener("click", function () {
    localStorage.removeItem(C.ORDER_KEY);
    render();
  });
  window.addEventListener("storage", function (e) {
    if (e.key === C.ORDER_KEY) render();
  });
  render();
})();
