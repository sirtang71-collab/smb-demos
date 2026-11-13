/* QR Order (Demo Bistro) — pure logic core (browser + Node, no DOM).
   Menu data (THB, names in EN / 繁中 / 简中 / ไทย), UI strings, cart math
   and the localStorage order store shared by index.html (customer) and
   merchant.html (merchant). Exposed as window.QROrderCore in the browser
   and module.exports in Node.

   Self-built lightweight demo. See QC.md for the open-source selection
   review that led to this fallback (every license-clean candidate needed
   a self-hosted server + database; this demo must run on static hosting). */
(function (global) {
  "use strict";

  var LANGS = ["en", "tzh", "szh", "th"];

  /* ---------------- Menu (prices in THB, integer baht) ---------------- */
  var MENU = [
    { id: "mains", names: { en: "Mains", tzh: "主菜", szh: "主菜", th: "อาหารจานหลัก" }, items: [
      { id: "green-curry", price: 180, hue: 145, names: { en: "Green Curry with Chicken", tzh: "綠咖哩雞", szh: "绿咖喱鸡", th: "แกงเขียวหวานไก่" },
        desc: { en: "Coconut green curry, Thai basil, jasmine rice", tzh: "椰奶綠咖哩、泰國羅勒、茉莉香米", szh: "椰奶绿咖喱、泰国罗勒、茉莉香米", th: "แกงกะทิ โหระพา เสิร์ฟพร้อมข้าวหอมมะลิ" } },
      { id: "basil-pork", price: 120, hue: 20, names: { en: "Basil Pork Rice (Pad Kra Pao)", tzh: "打拋豬肉飯", szh: "打抛猪肉饭", th: "ผัดกะเพราหมูราดข้าว" },
        desc: { en: "Holy basil, chilli, minced pork, fried egg on top", tzh: "聖羅勒、辣椒、豬肉末、煎蛋", szh: "圣罗勒、辣椒、猪肉末、煎蛋", th: "กะเพรา พริก หมูสับ ไข่ดาว" } },
      { id: "river-prawns", price: 320, hue: 200, names: { en: "Grilled River Prawns", tzh: "烤河蝦", szh: "烤河虾", th: "กุ้งแม่น้ำย่าง" },
        desc: { en: "Charcoal-grilled, seafood chilli dip", tzh: "炭烤、配海鮮辣椒蘸醬", szh: "炭烤、配海鲜辣椒蘸酱", th: "ย่างเตาถ่าน น้ำจิ้มซีฟู้ด" } }
    ]},
    { id: "noodles", names: { en: "Noodles & Rice", tzh: "麵食與飯類", szh: "面食与饭类", th: "ก๋วยเตี๋ยวและข้าว" }, items: [
      { id: "pad-thai", price: 140, hue: 35, names: { en: "Pad Thai", tzh: "泰式炒河粉", szh: "泰式炒河粉", th: "ผัดไทย" },
        desc: { en: "Rice noodles, tamarind, prawns, crushed peanut", tzh: "河粉、羅望子、鮮蝦、花生碎", szh: "河粉、罗望子、鲜虾、花生碎", th: "เส้นจันท์ มะขาม กุ้ง ถั่วลิสง" } },
      { id: "tomyum-rice", price: 150, hue: 5, names: { en: "Tom Yum Fried Rice", tzh: "冬蔭功炒飯", szh: "冬阴功炒饭", th: "ข้าวผัดต้มยำ" },
        desc: { en: "Lemongrass, galangal, prawns, lime leaf", tzh: "香茅、南薑、鮮蝦、檸檬葉", szh: "香茅、南姜、鲜虾、柠檬叶", th: "ตะไคร้ ข่า กุ้ง ใบมะกรูด" } },
      { id: "boat-noodles", price: 90, hue: 260, names: { en: "Boat Noodles", tzh: "船麵", szh: "船面", th: "ก๋วยเตี๋ยวเรือ" },
        desc: { en: "Dark aromatic broth, beef slices, bean sprouts", tzh: "濃香湯底、牛肉片、豆芽", szh: "浓香汤底、牛肉片、豆芽", th: "น้ำซุปเข้มข้น เนื้อวัว ถั่วงอก" } }
    ]},
    { id: "small", names: { en: "Small Plates", tzh: "小菜", szh: "小菜", th: "ของทานเล่น" }, items: [
      { id: "som-tam", price: 110, hue: 90, names: { en: "Papaya Salad (Som Tam)", tzh: "青木瓜沙拉", szh: "青木瓜沙拉", th: "ส้มตำ" },
        desc: { en: "Green papaya, lime, peanuts — spicy, tell us your level", tzh: "青木瓜、青檸、花生——辣度可選", szh: "青木瓜、青柠、花生——辣度可选", th: "มะละกอ มะนาว ถั่วลิสง เผ็ดตามสั่ง" } },
      { id: "satay", price: 130, hue: 45, names: { en: "Chicken Satay (4 skewers)", tzh: "雞肉沙嗲(4串)", szh: "鸡肉沙爹(4串)", th: "สะเต๊ะไก่ (4 ไม้)" },
        desc: { en: "Turmeric marinade, peanut sauce, cucumber relish", tzh: "薑黃醃製、花生醬、小黃瓜酸辣醬", szh: "姜黄腌制、花生酱、黄瓜酸辣酱", th: "หมักขมิ้น น้ำจิ้มถั่ว อาจาด" } },
      { id: "spring-rolls", price: 100, hue: 55, names: { en: "Spring Rolls (4 pcs)", tzh: "炸春捲(4件)", szh: "炸春卷(4件)", th: "ปอเปี๊ยะทอด (4 ชิ้น)" },
        desc: { en: "Crisp vegetable rolls, sweet chilli sauce", tzh: "酥脆蔬菜捲、甜辣醬", szh: "酥脆蔬菜卷、甜辣酱", th: "ไส้ผักกรอบ น้ำจิ้มหวาน" } }
    ]},
    { id: "drinks", names: { en: "Drinks & Desserts", tzh: "飲品與甜點", szh: "饮品与甜点", th: "เครื่องดื่มและของหวาน" }, items: [
      { id: "thai-tea", price: 60, hue: 30, names: { en: "Thai Iced Tea", tzh: "泰式冰茶", szh: "泰式冰茶", th: "ชาไทยเย็น" },
        desc: { en: "Spiced black tea, condensed milk, crushed ice", tzh: "香料紅茶、煉乳、碎冰", szh: "香料红茶、炼乳、碎冰", th: "ชาดำเครื่องเทศ นมข้น น้ำแข็ง" } },
      { id: "mango-rice", price: 120, hue: 50, names: { en: "Mango Sticky Rice", tzh: "芒果糯米飯", szh: "芒果糯米饭", th: "ข้าวเหนียวมะม่วง" },
        desc: { en: "Ripe mango, coconut sticky rice, sesame", tzh: "熟芒果、椰漿糯米飯、芝麻", szh: "熟芒果、椰浆糯米饭、芝麻", th: "มะม่วงสุก ข้าวเหนียวมูน งา" } },
      { id: "coconut-ice", price: 80, hue: 180, names: { en: "Coconut Ice Cream", tzh: "椰子冰淇淋", szh: "椰子冰淇淋", th: "ไอศกรีมกะทิ" },
        desc: { en: "Young coconut, roasted peanuts", tzh: "嫩椰肉、烤花生", szh: "嫩椰肉、烤花生", th: "มะพร้าวอ่อน ถั่วลิสงคั่ว" } }
    ]}
  ];

  function itemById(id) {
    for (var c = 0; c < MENU.length; c++)
      for (var i = 0; i < MENU[c].items.length; i++)
        if (MENU[c].items[i].id === id) return MENU[c].items[i];
    return null;
  }

  /* ---------------- UI strings ---------------- */
  var STR = {
    en: { tag: "Scan · Order · We cook", table: "Your table", selectTable: "Choose table", tableN: "Table ",
      add: "Add", cart: "Your order", empty: "Your cart is empty — add something tasty.", total: "Total",
      place: "Place order", placed: "Order placed!", orderNo: "Order number", kitchen: "Sent to the kitchen (demo). Pay at the counter after your meal.",
      newOrder: "Start a new order", merchant: "Merchant view", items: "items",
      qrTitle: "Print this QR for your tables", qrNote: "One QR per table: print it, set the table number in the link (?table=3), and guests order from their own phone.",
      footer: "Demo by Atang Lab — Demo Bistro is a fictional restaurant; prices in THB are illustrative. Demo orders stay in this browser (localStorage)." },
    tzh: { tag: "掃碼 · 點餐 · 我們現做", table: "您的桌號", selectTable: "請選桌號", tableN: "桌 ",
      add: "加入", cart: "您的訂單", empty: "購物車是空的——加點好吃的吧。", total: "合計",
      place: "送出訂單", placed: "訂單已送出!", orderNo: "訂單編號", kitchen: "已送到廚房(演示)。用餐後到櫃檯付款即可。",
      newOrder: "開始新訂單", merchant: "商家接單頁", items: "件",
      qrTitle: "列印這張 QR 放在桌上", qrNote: "每桌一張 QR:列印後在連結裡設定桌號(?table=3),客人用自己的手機點餐。",
      footer: "Demo by Atang Lab — Demo Bistro 為虛構餐廳;泰銖價格僅供示範。演示訂單只保存在此瀏覽器(localStorage)。" },
    szh: { tag: "扫码 · 点餐 · 我们现做", table: "您的桌号", selectTable: "请选择桌号", tableN: "桌 ",
      add: "加入", cart: "您的订单", empty: "购物车是空的——加点好吃的吧。", total: "合计",
      place: "提交订单", placed: "订单已提交!", orderNo: "订单编号", kitchen: "已送到厨房(演示)。用餐后到柜台付款即可。",
      newOrder: "开始新订单", merchant: "商家接单页", items: "件",
      qrTitle: "打印这张 QR 放在桌上", qrNote: "每桌一张 QR:打印后在链接里设置桌号(?table=3),客人用自己的手机点餐。",
      footer: "Demo by Atang Lab — Demo Bistro 为虚构餐厅;泰铢价格仅供示范。演示订单只保存在此浏览器(localStorage)。" },
    th: { tag: "สแกน · สั่ง · เราปรุงสด", table: "โต๊ะของคุณ", selectTable: "เลือกโต๊ะ", tableN: "โต๊ะ ",
      add: "เพิ่ม", cart: "รายการสั่งซื้อ", empty: "ตะกร้าว่างอยู่ — เลือกเมนูอร่อย ๆ ได้เลย", total: "ยอดรวม",
      place: "ยืนยันการสั่ง", placed: "ส่งออเดอร์แล้ว!", orderNo: "หมายเลขออเดอร์", kitchen: "ส่งเข้าครัวแล้ว (เดโม) ชำระเงินที่เคาน์เตอร์หลังอาหาร",
      newOrder: "เริ่มออเดอร์ใหม่", merchant: "หน้ารับออเดอร์ร้านค้า", items: "รายการ",
      qrTitle: "พิมพ์ QR นี้วางบนโต๊ะ", qrNote: "หนึ่ง QR ต่อโต๊ะ: พิมพ์แล้วตั้งหมายเลขโต๊ะในลิงก์ (?table=3) ลูกค้าสั่งจากมือถือของตัวเอง",
      footer: "Demo by Atang Lab — Demo Bistro เป็นร้านสมมติ ราคาเป็นเงินบาทเพื่อการสาธิต ออเดอร์เดโมเก็บในเบราว์เซอร์นี้เท่านั้น (localStorage)" }
  };

  /* ---------------- Money ---------------- */
  function formatTHB(n) {
    var s = String(Math.round(n));
    return "฿" + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* ---------------- Cart (pure) ----------------
     Cart shape: { itemId: qty } — plain object, insertion-ordered by MENU. */
  function cartAdd(cart, id) {
    if (!itemById(id)) return cart;
    var c = {}; for (var k in cart) c[k] = cart[k];
    c[id] = (c[id] || 0) + 1;
    return c;
  }
  function cartSetQty(cart, id, qty) {
    var c = {}; for (var k in cart) c[k] = cart[k];
    qty = Math.floor(qty);
    if (!itemById(id) || !(qty > 0)) delete c[id]; else c[id] = qty;
    return c;
  }
  /* Lines follow MENU order so customer and merchant always agree. */
  function cartLines(cart) {
    var lines = [];
    for (var c = 0; c < MENU.length; c++)
      for (var i = 0; i < MENU[c].items.length; i++) {
        var it = MENU[c].items[i], q = cart[it.id] || 0;
        if (q > 0) lines.push({ id: it.id, names: it.names, qty: q, unitPrice: it.price, lineTotal: q * it.price });
      }
    return lines;
  }
  function cartTotal(lines) {
    var t = 0; for (var i = 0; i < lines.length; i++) t += lines[i].lineTotal;
    return t;
  }
  function cartCount(lines) {
    var n = 0; for (var i = 0; i < lines.length; i++) n += lines[i].qty;
    return n;
  }

  /* ---------------- Order store ----------------
     Storage = any object with getItem/setItem (localStorage or a shim). */
  var ORDER_KEY = "qrorder.orders.v1";

  function loadOrders(storage) {
    try {
      var raw = storage.getItem(ORDER_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveOrders(storage, orders) {
    storage.setItem(ORDER_KEY, JSON.stringify(orders));
  }
  /* Order numbers: DB-001, DB-002, … sequential per store, never reused. */
  function nextOrderNo(orders) {
    var max = 0;
    for (var i = 0; i < orders.length; i++) {
      var m = /^DB-(\d+)$/.exec(orders[i].no || "");
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    var n = String(max + 1);
    while (n.length < 3) n = "0" + n;
    return "DB-" + n;
  }
  function makeOrder(cart, table, now) {
    var lines = cartLines(cart);
    if (!lines.length) return { ok: false, error: "empty-cart" };
    if (!(table > 0)) return { ok: false, error: "no-table" };
    return { ok: true, order: {
      no: null, /* assigned by submitOrder */
      table: Math.floor(table),
      lines: lines.map(function (l) { return { id: l.id, names: l.names, qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal }; }),
      total: cartTotal(lines),
      ts: now,
      status: "new"
    }};
  }
  function submitOrder(storage, cart, table, now) {
    var made = makeOrder(cart, table, now);
    if (!made.ok) return made;
    var orders = loadOrders(storage);
    made.order.no = nextOrderNo(orders);
    orders.push(made.order);
    saveOrders(storage, orders);
    return { ok: true, order: made.order };
  }
  function setOrderStatus(storage, no, status) {
    if (status !== "new" && status !== "done") return { ok: false, error: "bad-status" };
    var orders = loadOrders(storage);
    for (var i = 0; i < orders.length; i++)
      if (orders[i].no === no) {
        orders[i].status = status;
        saveOrders(storage, orders);
        return { ok: true, order: orders[i] };
      }
    return { ok: false, error: "not-found" };
  }

  var api = {
    LANGS: LANGS, MENU: MENU, STR: STR, ORDER_KEY: ORDER_KEY,
    itemById: itemById, formatTHB: formatTHB,
    cartAdd: cartAdd, cartSetQty: cartSetQty, cartLines: cartLines,
    cartTotal: cartTotal, cartCount: cartCount,
    loadOrders: loadOrders, saveOrders: saveOrders, nextOrderNo: nextOrderNo,
    makeOrder: makeOrder, submitOrder: submitOrder, setOrderStatus: setOrderStatus
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.QROrderCore = api;
})(typeof window !== "undefined" ? window : globalThis);
