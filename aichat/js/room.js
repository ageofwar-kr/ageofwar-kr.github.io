/* AI 단톡방 v1.2 — 방 전송 계층 (Firebase Realtime Database)
   방 하나 = 실시간 DB 의 `rooms/<방 코드>` 한 칸.
   · 방 코드 8자 = /rooms/<코드>/messages
   · 쓰기: POST <base>/rooms/<코드>/messages.json  (본문 = 메시지 JSON 한 건, 서버가 키를 매긴다)
   · 지난 대화: GET <base>/rooms/<코드>/messages.json  (영구 보관, {키: 메시지} 객체)
   · 실시간: GET <base>/rooms/<코드>/messages.json  (Accept: text/event-stream → put·patch)
   실시간이 끊기면(모바일·프록시) 5초 폴링으로 되찾고, 붙어 있으면 45초에 한 번만 확인한다.
   개인정보·키는 없다. 방 코드만 알면 누구나 읽고 쓸 수 있는 공개 방이다. */
window.Room = (function () {
  "use strict";
  var BASE = "https://dorati-99953-default-rtdb.asia-southeast1.firebasedatabase.app";
  var ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
  var WINDOW = 300;        /* 한 번에 받는 최근 메시지 수 — 서버에는 전부 남는다 */
  var POLL_MS = 5000;      /* 실시간이 끊겼을 때 되찾는 주기 */
  var SAFETY_MS = 45000;   /* 실시간이 붙어 있어도 놓친 말이 없는지 한 번씩 확인 */
  var SEEN_MAX = 4000;

  var es = null;
  var esOpen = false;
  var seen = {};           /* 서버 키 */
  var seenMid = {};        /* 메시지 mid */
  var pollTimer = null;
  var safetyTimer = null;
  var onMsg = null;
  var onState = null;
  var curRoom = "";

  function roomKey(id) { return String(id || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function msgsUrl(id) { return BASE + "/rooms/" + roomKey(id) + "/messages.json"; }
  /* 최근 WINDOW 개만 받는 주소 — 오래된 대화는 DB 에 그대로 있고 화면만 가볍게 유지한다 */
  function feedUrl(id) {
    return msgsUrl(id) + "?orderBy=" + encodeURIComponent('"$key"') + "&limitToLast=" + WINDOW;
  }

  function newRoomId() {
    var out = "";
    try {
      var buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      for (var i = 0; i < 8; i++) out += ALPHA.charAt(buf[i] % ALPHA.length);
    } catch (e) {
      for (var j = 0; j < 8; j++) out += ALPHA.charAt(Math.floor(Math.random() * ALPHA.length));
    }
    return out;
  }

  function cleanRoom(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  }

  function state(s) { if (onState) { try { onState(s); } catch (e) {} } }

  /* ── 메시지 모양 맞추기 ── */
  function norm(key, o) {
    if (!o || typeof o !== "object") return null;
    if (o.t && o.t !== "msg") return null;
    if (o.v && Number(o.v) !== 1) return null;
    var text = String(o.text == null ? "" : o.text).slice(0, 2000);
    if (!text.trim()) return null;
    return {
      key: String(key || ""),
      mid: String(o.mid || key || ""),
      who: String(o.who || "ext"),
      name: String(o.name || "").slice(0, 16),
      text: text,
      replyTo: String(o.replyTo || ""),
      ts: Number(o.ts) || 0,
      via: "rtdb"
    };
  }

  function cmp(a, b) {
    if (a.ts && b.ts && a.ts !== b.ts) return a.ts - b.ts;
    if (!a.ts && b.ts) return -1;
    if (a.ts && !b.ts) return 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  }

  /* {키: 메시지} → 시간 순 목록 */
  function collect(obj) {
    var out = [];
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var it = norm(k, obj[k]);
      if (it) out.push(it);
    });
    out.sort(cmp);
    return out;
  }

  function remember(it) {
    if (it.key) seen[it.key] = 1;
    seenMid[it.mid] = 1;
    if (Object.keys(seen).length > SEEN_MAX) { seen = {}; seenMid = {}; }
  }

  function fresh(it) {
    if (!it) return false;
    if (it.key && seen[it.key]) return false;
    if (it.mid && seenMid[it.mid]) { if (it.key) seen[it.key] = 1; return false; }
    remember(it);
    return true;
  }

  function push(it) {
    if (!fresh(it) || !onMsg) return;
    try { onMsg(it); } catch (e) {}
  }
  function pushList(list) { (list || []).forEach(push); }

  /* ── 보내기 — 한 건 POST, 성공하면 서버 키를 돌려준다 ── */
  function send(roomId, payload) {
    var body = {}, k;
    for (k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k];
    if (!body.v) body.v = 1;
    if (!body.t) body.t = "msg";
    if (!body.ts) body.ts = Date.now();
    return fetch(msgsUrl(roomId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 401 || r.status === 403) throw new Error("denied");
      if (r.status === 429) throw new Error("limit");
      if (!r.ok) throw new Error("http_" + r.status);
      return r.json().then(function (j) {
        var key = (j && j.name) || "";
        if (key) remember({ key: key, mid: String(body.mid || key) });
        return { id: key, key: key, ts: body.ts };
      }, function () { return { id: "", key: "", ts: body.ts }; });
    });
  }

  /* ── 지난 대화 (영구 보관) ── */
  function history(roomId) {
    return fetch(feedUrl(roomId), { cache: "no-store" })
      .then(function (r) {
        if (r.status === 401 || r.status === 403) throw new Error("denied");
        if (!r.ok) throw new Error("http_" + r.status);
        return r.json();
      })
      .then(function (obj) { return collect(obj); });
  }

  function refresh(roomId) {
    return history(roomId).then(function (list) { pushList(list); return list.length; });
  }

  /* ── 실시간 수신 (Firebase REST 스트림) ── */
  function apply(raw) {
    var ev;
    try { ev = JSON.parse(raw); } catch (e) { return; }
    if (!ev) return;
    var path = String(ev.path || "/");
    var data = ev.data;
    if (!data) return;
    if (path === "/" || path === "") { pushList(collect(data)); return; }
    var key = path.replace(/^\/+/, "").split("/")[0];
    var it = norm(key, data);
    if (it) push(it);
  }

  function openFeed(id) {
    if (typeof EventSource === "undefined") { esOpen = false; state("retry"); return; }
    try { es = new EventSource(feedUrl(id)); } catch (e) { es = null; esOpen = false; state("offline"); return; }
    es.onopen = function () { esOpen = true; state("live"); };
    es.onerror = function () { esOpen = false; state("retry"); };   /* EventSource 가 스스로 다시 붙는다 */
    es.addEventListener("put", function (e) { esOpen = true; apply(e.data); });
    es.addEventListener("patch", function (e) { esOpen = true; apply(e.data); });
    es.addEventListener("keep-alive", function () { esOpen = true; });
    es.addEventListener("cancel", function () { esOpen = false; state("retry"); });
    es.addEventListener("auth_revoked", function () { esOpen = false; state("retry"); });
  }

  /* ── 연결 ── */
  function connect(roomId, handle, handleState) {
    close();
    curRoom = roomKey(roomId);
    onMsg = handle;
    onState = handleState || null;

    refresh(curRoom).then(function () { state("live"); })
      .catch(function () { state("retry"); });

    openFeed(curRoom);

    pollTimer = setInterval(function () {
      if (esOpen) return;                                  /* 실시간이 붙어 있으면 당기지 않는다 */
      refresh(curRoom).then(function () { state("live"); }).catch(function () {});
    }, POLL_MS);

    safetyTimer = setInterval(function () {
      refresh(curRoom).catch(function () {});
    }, SAFETY_MS);
  }

  function close() {
    if (es) { try { es.close(); } catch (e) {} es = null; }
    esOpen = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (safetyTimer) { clearInterval(safetyTimer); safetyTimer = null; }
    onMsg = null; onState = null;
    seen = {}; seenMid = {};
  }

  return {
    newRoomId: newRoomId,
    cleanRoom: cleanRoom,
    send: send,
    history: history,
    refresh: refresh,
    connect: connect,
    close: close,
    msgsUrl: msgsUrl,
    feedUrl: feedUrl,
    host: BASE,
    topic: function (id) { return roomKey(id); }
  };
})();
