/* AI 단톡방 — 방 전송 계층
   공용 실시간 채널(ntfy.sh)을 방 하나로 쓴다.
   · 방 코드 8자 = 채널 이름(aichat-<코드>)
   · 쓰기: POST /<채널>  (본문 = JSON 한 건)
   · 실시간: GET /<채널>/sse
   · 지난 대화: GET /<채널>/json?poll=1&since=all  (서버 보관 12시간)
   개인정보·키는 없다. 방 코드만 알면 누구나 읽고 쓸 수 있는 공개 방이다. */
window.Room = (function () {
  "use strict";
  var HOST = "https://ntfy.sh";
  var ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";

  var es = null;
  var curRoom = "";
  var seen = {};
  var lastId = "";
  var pollTimer = null;
  var onMsg = null;
  var onState = null;

  function topic(id) { return "aichat-" + String(id || "").toLowerCase(); }
  function url(id) { return HOST + "/" + topic(id); }

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

  function state(s) { if (onState) try { onState(s); } catch (e) {} }

  /* 한 건 보내기 — 성공하면 서버가 준 {id, time} 을 돌려준다 */
  function send(roomId, payload) {
    return fetch(url(roomId), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (r.status === 429) throw new Error("limit");
      if (!r.ok) throw new Error("http_" + r.status);
      return r.json();
    });
  }

  function parseLine(line) {
    var ev;
    try { ev = JSON.parse(line); } catch (e) { return null; }
    if (!ev || ev.event !== "message" || !ev.message) return null;
    var body;
    try { body = JSON.parse(ev.message); } catch (e) { return null; }
    if (!body || body.v !== 1 || body.t !== "msg") return null;
    if (body.mid && seen[body.mid]) return null;
    if (body.mid) seen[body.mid] = 1;
    if (ev.id) lastId = ev.id;
    return {
      mid: String(body.mid || ev.id),
      who: String(body.who || "ext"),
      name: String(body.name || "").slice(0, 16),
      text: String(body.text || "").slice(0, 2000),
      replyTo: String(body.replyTo || ""),
      srv: Number(ev.time) || 0,
      ts: (Number(ev.time) || 0) * 1000,
      via: "wire"
    };
  }

  function deliver(item) {
    if (!item || !onMsg) return;
    try { onMsg(item); } catch (e) {}
  }

  /* 지난 대화 받아오기 */
  function history(roomId) {
    var u = url(roomId) + "/json?poll=1&since=" + (lastId || "all");
    return fetch(u, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("http_" + r.status);
        return r.text();
      })
      .then(function (txt) {
        var out = [];
        txt.split("\n").forEach(function (line) {
          if (!line.trim()) return;
          var item = parseLine(line);
          if (item) out.push(item);
        });
        return out;
      });
  }

  /* 실시간 연결 + 백업 폴링 */
  function connect(roomId, handle, handleState) {
    close();
    curRoom = roomId;
    onMsg = handle;
    onState = handleState || null;
    seen = {};
    lastId = "";

    history(roomId).then(function (list) {
      list.forEach(deliver);
      state("live");
    }).catch(function () { state("retry"); });

    try {
      es = new EventSource(url(roomId) + "/sse");
      es.onopen = function () { state("live"); };
      es.onmessage = function (e) {
        var item = parseLine(e.data);
        if (item) deliver(item);
      };
      es.onerror = function () { state("retry"); };
    } catch (e) {
      state("offline");
    }

    /* SSE가 끊겨도 대화가 비지 않도록 가볍게 한 번씩 당겨온다 */
    pollTimer = setInterval(function () {
      history(roomId).then(function (list) {
        list.forEach(deliver);
        state("live");
      }).catch(function () {});
    }, 45000);
  }

  function close() {
    if (es) { try { es.close(); } catch (e) {} es = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    onMsg = null; onState = null;
  }

  return {
    newRoomId: newRoomId,
    cleanRoom: cleanRoom,
    send: send,
    history: history,
    connect: connect,
    close: close,
    topic: topic,
    host: HOST
  };
})();
