/* AI 단톡방 v1.3 — 화면·상태 */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var LS = {
    nick: "aichat.nick.v1",
    ai: function (room) { return "aichat.ai.v1." + room; },
    mode: "aichat.dorati.mode.v1",
    log: function (room) { return "aichat.log.v1." + room; }
  };

  var S = {
    room: "",
    nick: "",
    msgs: [],
    index: {},
    reads: {},
    aiTyping: {},
    fallback: {},
    active: { kimchi: true, dorati: true, ttok: false },
    mode: "normal",
    typing: {},
    chain: Promise.resolve(),
    busy: false,
    link: "live"
  };

  var CHIPS = [
    "다들 오늘 할 일 정리해 줘",
    "이 주제 각자 의견 말해 봐",
    "서로 한마디씩 해 봐",
    "방 분위기 요약해 줘"
  ];
  var EXT_PRESETS = ["자비스", "브로", "른자", "메타 AI", "챗GPT", "제미나이", "그록"];

  /* ── 유틸 ── */
  function uid() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clip(t, n) { t = String(t || ""); return t.length > n ? t.slice(0, n) + "…" : t; }
  function esc(t) {
    return String(t || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function timeLabel(ts) {
    var d = new Date(ts || Date.now());
    var h = d.getHours(), m = d.getMinutes();
    return (h < 12 ? "오전 " : "오후 ") + (h % 12 || 12) + ":" + (m < 10 ? "0" + m : m);
  }
  function dateLabel(ts) {
    var d = new Date(ts || Date.now());
    var wk = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return d.getFullYear() + "년 " + (d.getMonth() + 1) + "월 " + d.getDate() + "일 " + wk + "요일";
  }
  function dayKey(ts) {
    var d = new Date(ts || Date.now());
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function ago(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "방금 전";
    if (s < 3600) return Math.floor(s / 60) + "분 전";
    if (s < 86400) return Math.floor(s / 3600) + "시간 전";
    return Math.floor(s / 86400) + "일 전";
  }
  function toast(text) {
    var el = $("#toast");
    el.textContent = text;
    el.setAttribute("data-show", "1");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.removeAttribute("data-show"); }, 2600);
  }
  function copy(text, okMsg) {
    function done() { toast(okMsg || "복사했어요"); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("복사가 안 됐어요. 길게 눌러 복사해 주세요"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
  }
  function sheet(id, open) {
    var el = $(id);
    if (!el) return;
    if (open) el.setAttribute("data-open", "1"); else el.removeAttribute("data-open");
  }
  function closeSheets() { $$(".sheet").forEach(function (s) { s.removeAttribute("data-open"); }); }

  /* ── 방 코드 ── */
  function roomFromHash() {
    var m = /room=([a-z0-9]+)/i.exec(location.hash || "");
    return m ? Room.cleanRoom(m[1]) : "";
  }
  function setHashRoom(id) {
    var url = location.pathname + location.search + "#room=" + id;
    history.replaceState(null, "", url);
  }
  function codeLabel() { return S.room.toUpperCase(); }
  function roomLink() {
    return location.origin + location.pathname + "#room=" + S.room;
  }

  /* ── 저장 ── */
  function loadLog() {
    try {
      var raw = localStorage.getItem(LS.log(S.room));
      var arr = raw ? JSON.parse(raw) : [];
      S.msgs = Array.isArray(arr) ? arr.slice(-400) : [];
      S.index = {};
      S.msgs.forEach(function (m) { S.index[m.mid] = 1; });
    } catch (e) { S.msgs = []; S.index = {}; }
  }
  function saveLog() {
    try { localStorage.setItem(LS.log(S.room), JSON.stringify(S.msgs.slice(-400))); } catch (e) {}
  }
  function loadAi() {
    var base = { kimchi: true, dorati: true, ttok: false };
    try {
      var raw = localStorage.getItem(LS.ai(S.room));
      if (raw) {
        var o = JSON.parse(raw);
        Object.keys(base).forEach(function (k) { if (typeof o[k] === "boolean") base[k] = o[k]; });
      }
    } catch (e) {}
    S.active = base;
  }
  function saveAi() {
    try { localStorage.setItem(LS.ai(S.room), JSON.stringify(S.active)); } catch (e) {}
  }

  /* ── 메시지 ── */
  function addMsg(item) {
    if (!item || !item.mid || S.index[item.mid]) return false;
    S.index[item.mid] = 1;
    S.msgs.push(item);
    if (S.msgs.length > 400) S.msgs = S.msgs.slice(-400);
    saveLog();
    return true;
  }

  /* 같은 사람 묶음 판단 — 외부 AI 는 who 가 모두 ext 라 이름까지 봐야 한다 */
  function skey(m) {
    return m.who + "|" + (m.who === "ext" ? String(m.name || "") : "");
  }

  function speakerName(m) {
    if (m.who === "u") return m.name || S.nick || "나";
    var p = AI.get(m.who);
    if (p) return p.name;
    return m.name || "외부 AI";
  }
  function avatarClass(m) {
    if (m.who === "u") return "avatar--me";
    if (isMeta(m)) return "avatar--meta";
    var p = AI.get(m.who);
    if (p) return "avatar--" + p.id;
    var palette = ["avatar--kimchi", "avatar--dorati", "avatar--ttok"];
    var h = 0, s = String(m.name || "x");
    for (var i = 0; i < s.length; i++) h = (h + s.charCodeAt(i)) % palette.length;
    return palette[h];
  }
  /* 외부 AI 이름별 색 — 아는 이름은 그 AI 색으로 */
  var EXT_COLOR = {
    "자비스": "#3f6fd8", "브로": "#8a6cf0", "부이": "#8a6cf0", "른자": "#e26d4f",
    "챗gpt": "#10a37f", "chatgpt": "#10a37f", "지피티": "#10a37f", "gpt": "#10a37f",
    "제미나이": "#4285f4", "gemini": "#4285f4",
    "그록": "#1f2937", "grok": "#1f2937",
    "클로드": "#d97757", "claude": "#d97757"
  };
  function extColor(name) {
    return EXT_COLOR[String(name || "").toLowerCase().replace(/\s+/g, "")] || "";
  }
  /* 외부에서 올린 메타 AI 답은 글자 대신 파란·보라 링 */
  function isMeta(m) {
    if (!m) return false;
    return m.who === "ext" && /메타\s*AI|meta\s*ai|메타/i.test(String(m.name || ""));
  }
  function avatarInner(m) {
    if (isMeta(m)) return "";
    return esc(avatarMark(m));
  }
  function avatarHTML(m, ghost) {
    if (ghost) return '<div class="avatar avatar--ghost"></div>';
    var style = "";
    if (m.who === "ext" && !isMeta(m)) {
      var c = extColor(m.name);
      if (c) style = ' style="background:' + c + '"';
    }
    return '<div class="avatar ' + avatarClass(m) + '"' + style + '>' + avatarInner(m) + '</div>';
  }
  function avatarMark(m) {
    if (m.who === "u") return (S.nick || "나").slice(0, 1);
    var p = AI.get(m.who);
    if (p) return p.mark;
    return (m.name || "?").slice(0, 1);
  }

  /* ── 그리기 ── */
  function render() {
    var log = $("#log");
    var atBottom = $("#chat").scrollHeight - $("#chat").scrollTop - $("#chat").clientHeight < 90;
    var out = [];
    var lastDay = "";
    var prev = null;
    var actives = activeIds();

    if (!S.msgs.length) {
      out.push('<div class="sys"><span>방 #' + esc(codeLabel()) + ' 가 열렸어요.<br>아래 추천 문장을 누르거나 그냥 말을 걸어 보세요.<br><b>@김치</b> 처럼 이름을 부르면 그 AI만 답해요.</span></div>');
    }

    S.msgs.forEach(function (m, i) {
      var dk = dayKey(m.ts);
      if (dk !== lastDay) {
        out.push('<div class="date-div"><span>' + dateLabel(m.ts) + '</span></div>');
        lastDay = dk;
        prev = null;
      }
      /* 시스템 안내(AI 오류 등)는 가운데 알림 줄로 */
      if (m.who === "sys") {
        out.push('<div class="sys' + (m.kind === "warn" ? " sys--warn" : "") + '"><span>' + esc(m.text) + '</span></div>');
        prev = null;
        return;
      }
      var same = prev && skey(prev) === skey(m) && (m.ts - prev.ts) < 60000 && dayKey(prev.ts) === dk;
      var me = m.who === "u";
      var cls = "row " + (me ? "row--me" : "row--other") + (same ? " row--cont" : "");
      out.push('<div class="' + cls + '" data-mid="' + esc(m.mid) + '">');
      if (!me) {
        out.push(avatarHTML(m, same));
      }
      out.push('<div class="bubble-wrap">');
      if (!me && !same) out.push('<div class="who">' + esc(speakerName(m)) + '</div>');
      out.push('<div class="bubble">' + esc(m.text) + '</div>');
      out.push('<div class="meta">');
      out.push('<span class="meta__time">' + timeLabel(m.ts) + '</span>');
      /* 한 사람이 이어서 말한 묶음의 마지막 말에만 안 읽음 표시를 붙인다(카톡과 같은 결) */
      var next = S.msgs[i + 1];
      var runEnd = !next || skey(next) !== skey(m) || (next.ts - m.ts) > 60000;
      if (runEnd && me) {
        /* 카톡처럼 내 말에만 안 읽은 AI 수 — 다 읽으면 사라진다 */
        var n = unreadCount(m);
        if (n > 0) out.push('<span class="meta__unread">' + (n > 99 ? "99+" : n) + '</span>');
      }
      out.push('</div></div></div>');
      prev = m;
    });

    Object.keys(S.typing).forEach(function (id) {
      var p = AI.get(id);
      if (!p) return;
      var pp = { who: id, name: p.name };
      out.push(
        '<div class="row row--other typing">' +
        avatarHTML(pp, false) +
        '<div class="bubble-wrap"><div class="who">' + esc(p.name) + '</div>' +
        '<div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div></div></div>'
      );
    });

    /* 바깥 AI 가 /typing/<이름> 을 켜 둔 동안도 점 세 개로 보여 준다 */
    extTyping().forEach(function (t) {
      var pp = { who: "ext", name: t.name };
      out.push(
        '<div class="row row--other typing">' +
        avatarHTML(pp, false) +
        '<div class="bubble-wrap"><div class="who">' + esc(t.name) + '</div>' +
        '<div class="bubble"><span class="dots"><i></i><i></i><i></i></span></div></div></div>'
      );
    });

    log.innerHTML = out.join("");
    if (atBottom) scrollBottom();
    renderStatus();
    renderHead();
    $("#btn-all").disabled = !lastUserMsg() || !actives.length;
  }

  function scrollBottom() {
    var c = $("#chat");
    c.scrollTop = c.scrollHeight;
  }

  function renderStatus() {
    var parts = [];
    var lu = lastUserMsg();
    activeIds().forEach(function (id) {
      var p = AI.get(id);
      var st;
      if (S.typing[id]) st = '<i class="st st--write">작성 중</i>';
      else if (lu && hasRead(id, lu)) st = '<i class="st st--read">읽음</i>';
      else if (lu) st = '<i class="st st--unread">안 읽음</i>';
      else {
        var last = lastFrom(id);
        st = last ? ago(last.ts) : "대기";
      }
      parts.push("<b>" + esc(p.name) + "</b> " + st);
    });
    extTyping().forEach(function (t) {
      parts.push("<b>" + esc(t.name) + "</b> <i class=\"st st--write\">작성 중</i>");
    });
    var extLast = lastFromExt();
    if (extLast && !extTyping().length) parts.push("<b>" + esc(extLast.name) + "</b> " + ago(extLast.ts));
    $("#status-strip").innerHTML = (S.link === "live" ? "" : "연결 중 · ") + (parts.join(" · ") || "AI를 켜 주세요");
  }

  /* ── 외부 AI 참여 상태 ── */
  var TYPING_TTL = 25000;
  function whoKey(name) { return String(name || "").replace(/[.#$/\[\]]/g, "_").slice(0, 24) || "ai"; }
  function extTyping() {
    var out = [];
    Object.keys(S.aiTyping).forEach(function (k) {
      var v = S.aiTyping[k];
      if (!v || !v.t) return;
      if (Date.now() - v.t > TYPING_TTL) return;
      out.push({ key: k, name: v.n || k, t: v.t });
    });
    return out;
  }
  function extReaders() {
    var out = [];
    Object.keys(S.reads).forEach(function (k) {
      if (AI.get(k)) return;               /* 내장 AI 는 따로 센다 */
      out.push(k);
    });
    return out;
  }

  function lastFrom(id) {
    for (var i = S.msgs.length - 1; i >= 0; i--) if (S.msgs[i].who === id) return S.msgs[i];
    return null;
  }
  function lastFromExt() {
    for (var i = S.msgs.length - 1; i >= 0; i--) if (S.msgs[i].who === "ext") return S.msgs[i];
    return null;
  }
  function lastUserMsg() {
    for (var i = S.msgs.length - 1; i >= 0; i--) if (S.msgs[i].who === "u") return S.msgs[i];
    return null;
  }
  function activeIds() {
    return AI.list.filter(function (p) { return S.active[p.id]; }).map(function (p) { return p.id; });
  }

  /* 방에 들어와 있는 AI 수 — 켜 둔 내장 AI + 최근 이 방에서 말한 외부 AI */
  function extNames() {
    var seen = {}, out = [];
    function add(n) {
      n = String(n || "");
      if (!n || seen[n]) return;
      seen[n] = 1; out.push(n);
    }
    S.msgs.forEach(function (m) {
      if (m.who === "ext") add(m.name || "외부 AI");
    });
    Object.keys(S.reads).forEach(function (k) { if (!AI.get(k)) add(S.reads[k].n || k); });
    Object.keys(S.aiTyping).forEach(function (k) { add(S.aiTyping[k].n || k); });
    return out;
  }
  function roomAiCount() { return activeIds().length + extNames().length; }
  function renderHead() {
    var el = $("#head-count");
    if (!el) return;
    var n = roomAiCount();
    el.textContent = n ? String(n) : "";
    el.title = "이 방에 있는 AI " + n + "명";
  }
  function unreadCount(m) {
    var ids = activeIds().concat(extReaders()), n = 0;
    for (var i = 0; i < ids.length; i++) if (!hasRead(ids[i], m)) n++;
    return n;
  }

  /* ── 읽음 표시 (카톡 안 읽음 숫자) ── */
  function findMsg(mid) {
    for (var i = S.msgs.length - 1; i >= 0; i--) if (S.msgs[i].mid === mid) return S.msgs[i];
    return null;
  }
  function lastMsg() { return S.msgs.length ? S.msgs[S.msgs.length - 1] : null; }
  /* 이 AI가 이 말을 읽었는가 — 서버 키(시간 순서)를 먼저 보고, 없으면 시각으로 본다 */
  function hasRead(id, m) {
    var r = S.reads[id];
    if (!r || !m) return false;
    if (m.key && r.k && m.key <= r.k) return true;
    if (r.t && m.ts && r.t >= m.ts) return true;
    return false;
  }
  function unreadCount(m) {
    var ids = activeIds().concat(extReaders()), n = 0;
    for (var i = 0; i < ids.length; i++) if (!hasRead(ids[i], m)) n++;
    return n;
  }
  function mergeReads(map) {
    var changed = false;
    Object.keys(map || {}).forEach(function (k) {
      var cur = S.reads[k], nx = map[k];
      if (!nx) return;
      if (!cur || cur.t !== nx.t || cur.k !== nx.k) { S.reads[k] = nx; changed = true; }
    });
    return changed;
  }
  /* AI가 말을 읽기 시작한 순간 그 AI의 읽음 시점을 올린다 → 말풍선 옆 숫자가 줄어든다 */
  function markAiRead(who) {
    var last = lastMsg();
    if (!who || !last) return;
    Room.markRead(S.room, who, last).then(function (v) {
      S.reads[who] = v;
      render();
    }).catch(function () {});
  }

  /* ── 답변 흐름 ── */
  function hasReply(who, mid) {
    return S.msgs.some(function (m) { return m.who === who && m.replyTo === mid; });
  }

  function buildHistory(beforeMid) {
    var list = S.msgs.filter(function (m) { return m.mid !== beforeMid; }).slice(-10);
    return list.map(function (m) {
      var label = m.who === "u" ? "" : "[" + speakerName(m) + "] ";
      return { r: m.who === "u" ? "u" : "b", t: clip(label + m.text, 160) };
    });
  }

  function publish(item) {
    var payload = {
      v: 1, t: "msg", who: item.who, name: item.name || "",
      text: item.text, mid: item.mid, replyTo: item.replyTo || "", ts: Date.now()
    };
    return Room.send(S.room, payload);
  }

  function applySendResult(mid, ev) {
    if (!ev || !mid) return;
    for (var i = 0; i < S.msgs.length; i++) {
      if (S.msgs[i].mid !== mid) continue;
      var changed = false;
      if (ev.key && !S.msgs[i].key) { S.msgs[i].key = ev.key; changed = true; }
      if (ev.time && !S.msgs[i].stamped) { S.msgs[i].ts = ev.time * 1000; S.msgs[i].stamped = 1; changed = true; }
      if (changed) { saveLog(); render(); }
      return;
    }
  }

  function oneReply(who, trigger) {
    var p = AI.get(who);
    if (!p) return Promise.resolve();
    var eff = AI.withMode(p, S.mode);       /* 도랏이 모드(건전·일반·도랏) 반영 */
    return sleep(650 + Math.random() * 350).then(function () {
      if (hasReply(who, trigger.mid)) return;       /* 다른 기기·창이 먼저 답했으면 건너뛴다 */
      S.typing[who] = 1;
      render();
      markAiRead(who);                             /* 읽었으니 말풍선 옆 안 읽음 숫자가 줄어든다 */
      return AI.reply(eff, { text: trigger.text, nick: S.nick, history: buildHistory(trigger.mid) })
        .then(function (txt) {
          delete S.typing[who];
          if (!txt) { render(); fallback(who, p.name, trigger); return; }
          var item = { mid: uid(), who: who, name: p.name, text: txt, replyTo: trigger.mid, ts: Date.now() };
          if (addMsg(item)) { render(); }
          return publish(item).then(function (ev) {
            applySendResult(item.mid, ev);
          }).catch(function (e) {
            if (e && e.message === "limit") toast("오늘 보낼 수 있는 양을 넘었어요. 내일 다시 이어 주세요");
          });
        })
        .catch(function () {
          delete S.typing[who];
          render();
          fallback(who, p.name, trigger);
        });
    });
  }

  /* ── AI 오류 폴백 ──
     한 AI가 응답에 실패하면 방에 안내를 남기고 @all 로 남은 AI에게 바로 넘긴다.
     같은 발화에 대해 폴백은 딱 한 번만 — 무한 루프 방지 가드. */
  function postSystem(text, replyTo, kind) {
    var item = { mid: uid(), who: "sys", name: "안내", kind: kind || "info", text: String(text).slice(0, 500), replyTo: replyTo || "", ts: Date.now() };
    if (addMsg(item)) render();
    Room.send(S.room, { v: 1, t: "msg", who: "sys", name: "안내", kind: item.kind, text: item.text, mid: item.mid, replyTo: item.replyTo, ts: item.ts })
      .then(function (ev) { applySendResult(item.mid, ev); })
      .catch(function () {});
    return item;
  }

  /* ── 도랏이 모드 ── */
  function wantsModeChange(text) {
    var t = String(text || "");
    if (!/@\s*도랏이/.test(t)) return false;
    return /모드\s*(변경|바꿔|바꾸|변경해|바꿈)/.test(t) || /모드\s*(좀\s*)?(고르|선택)/.test(t);
  }
  function renderModeSheet() {
    var p = AI.get("dorati");
    var list = AI.modeList(p);
    $("#mode-list").innerHTML = list.map(function (m) {
      return '<button class="mode-card" data-mode="' + m.key + '"' + (S.mode === m.key ? ' data-on="1"' : '') + '>' +
        '<span class="mode-card__label">' + esc(m.label) + '</span>' +
        '<span class="mode-card__desc">' + esc(m.desc) + '</span>' +
        (S.mode === m.key ? '<span class="mode-card__now">지금</span>' : '') +
        '</button>';
    }).join("");
    $$("#mode-list [data-mode]").forEach(function (b) {
      b.addEventListener("click", function () { setDoratiMode(b.getAttribute("data-mode")); });
    });
  }
  function openModeSheet() {
    renderModeSheet();
    sheet("#sheet-mode", true);
  }
  function setDoratiMode(m) {
    var p = AI.get("dorati");
    if (!p || !p.modes || !p.modes[m]) return;
    var same = S.mode === m;
    S.mode = m;
    try { localStorage.setItem(LS.mode, m); } catch (e) {}
    sheet("#sheet-mode", false);
    renderModeSheet();
    if (!same) postSystem("도랏이 모드가 [" + p.modes[m].label + "]으로 바뀌었어요");
    toast("도랏이 " + p.modes[m].label + " 모드로 바꿨어요");
  }

  function fallback(who, name, trigger) {
    if (!trigger || !trigger.mid) return;
    if (S.fallback[trigger.mid]) return;          /* 가드: 같은 말에 두 번은 안 한다 */
    S.fallback[trigger.mid] = 1;
    var others = activeIds().filter(function (id) { return id !== who && !hasReply(id, trigger.mid); });
    var tail = others.length
      ? " 다른 AI가 대신 받아쳐 주세요!"
      : " 지금 켜 둔 다른 AI가 없어서 잠시 뒤 다시 불러 주셔야 해요.";
    postSystem("[오류 안내] @all " + name + "가 잠깐 응답에 실패했어요." + tail, trigger.mid, "warn");
    toast(name + "가 잠시 답을 못 했어요" + (others.length ? ". 다른 AI에게 넘겼어요" : ""));
    if (others.length) replyFlow(trigger, others);
  }

  function replyFlow(trigger, ids) {
    ids.forEach(function (id) {
      S.chain = S.chain.then(function () { return oneReply(id, trigger); });
    });
  }

  function targetsFor(text) {
    var found = [];
    AI.list.forEach(function (p) {
      if (text.indexOf("@" + p.name) >= 0) found.push(p.id);
    });
    if (found.length) return found;
    if (/@(전체|다들|모두|all)/i.test(text)) return activeIds();
    return activeIds();
  }

  /* ── 보내기 ── */
  function sendMessage() {
    var input = $("#input");
    var text = input.value.trim();
    if (!text || !S.room) return;
    if (!S.nick) { openJoin(); return; }

    /* "@도랏이 모드변경" 처럼 보내면 도랏이 모드 창을 띄운다 */
    if (wantsModeChange(text)) {
      input.value = "";
      autosize();
      openModeSheet();
      return;
    }

    var mid = uid();
    var item = { mid: mid, who: "u", name: S.nick, text: text.slice(0, 1000), ts: Date.now() };
    input.value = "";
    autosize();
    addMsg(item);
    render();
    scrollBottom();

    Room.send(S.room, { v: 1, t: "msg", who: "u", name: S.nick, text: item.text, mid: mid, ts: item.ts })
      .then(function (ev) { applySendResult(mid, ev); })
      .catch(function (e) {
        toast(e && e.message === "limit"
          ? "오늘 보낼 수 있는 양을 넘었어요. 잠시 뒤 다시 시도해 주세요"
          : "전송이 안 됐어요. 연결을 확인해 주세요");
      });

    var ids = targetsFor(text);
    if (ids.length) replyFlow({ mid: mid, text: item.text }, ids);
    else if (!activeIds().length) toast("답할 AI가 꺼져 있어요. 참여 AI에서 켜 주세요");
    /* 답하지 않는 AI도 방에 있으니 그 말을 본다 — 잠시 뒤 안 읽음 숫자가 줄어든다 */
    activeIds().forEach(function (id) {
      if (ids.indexOf(id) >= 0) return;        /* 답하는 AI는 답변을 시작할 때 읽음 처리한다 */
      setTimeout(function () { if (S.room) markAiRead(id); }, 1400 + Math.random() * 900);
    });
  }

  function replyAll() {
    var last = lastUserMsg();
    if (!last) { toast("먼저 말을 걸어 주세요"); return; }
    var ids = activeIds();
    if (!ids.length) { toast("켜 둔 AI가 없어요"); return; }
    replyFlow(last, ids);
  }

  function copyRoomLog() {
    var lines = [];
    lines.push("[AI 단톡방 · 방 #" + codeLabel() + "]");
    lines.push("아래는 지금까지의 대화야. 이 대화를 읽고 이어서 답해 줘. 2~3문장으로 짧게, 인사는 빼고 본론만.");
    lines.push("");
    var recent = S.msgs.slice(-30);
    if (!recent.length) lines.push("(아직 대화 없음)");
    recent.forEach(function (m) {
      var who = m.who === "u" ? (m.name || S.nick || "나") : speakerName(m);
      lines.push(who + ": " + m.text.replace(/\s+/g, " ").trim());
    });
    lines.push("");
    lines.push("너는 이 방의 '외부 AI'야. 위 대화에 이어서 답만 써 줘.");
    copy(lines.join("\n"), "대화를 복사했어요. 외부 AI에 붙여넣고 답을 받아 오세요");
  }

  /* ── 시트 ── */
  function openJoin() {
    $("#join-nick").value = S.nick || "";
    $("#join-go").disabled = !(S.nick || "").trim();
    sheet("#sheet-join", true);
    setTimeout(function () { $("#join-nick").focus(); }, 120);
  }

  function renderPeople() {
    var ul = $("#people-list");
    ul.innerHTML = AI.list.map(function (p) {
      var modes = AI.modeList(p);
      var desc = p.modes && p.modes[S.mode] ? p.modes[S.mode].desc : p.desc;
      var chips = modes.length
        ? '<div class="modes">' + modes.map(function (m) {
            return '<button class="mode" data-mode="' + m.key + '"' + (S.mode === m.key ? ' data-on="1"' : '') +
              ' title="' + esc(m.desc) + '">' + esc(m.label) + '</button>';
          }).join("") + "</div>"
        : "";
      return '<li>' + avatarHTML({ who: p.id }, false) +
        '<div class="people__txt"><div class="people__name">' + esc(p.name) + "</div>" +
        '<div class="people__desc">' + esc(desc) + "</div></div>" +
        '<label class="switch"><input type="checkbox" data-ai="' + p.id + '"' + (S.active[p.id] ? " checked" : "") + "><span></span></label>" +
        chips + "</li>";
    }).join("");
    ul.querySelectorAll("input[data-ai]").forEach(function (el) {
      el.addEventListener("change", function () {
        S.active[el.getAttribute("data-ai")] = el.checked;
        saveAi();
        render();
      });
    });
    ul.querySelectorAll("[data-mode]").forEach(function (b) {
      b.addEventListener("click", function () {
        var m = b.getAttribute("data-mode");
        var p = AI.get("dorati");
        if (!p || !p.modes || !p.modes[m]) return;
        S.mode = m;
        try { localStorage.setItem(LS.mode, m); } catch (e) {}
        renderPeople();
        toast("도랏이 " + p.modes[m].label + " 모드로 바꿨어요");
      });
    });

    var seen = {};
    S.msgs.forEach(function (m) { if (m.who === "ext") seen[m.name || "외부 AI"] = (seen[m.name || "외부 AI"] || 0) + 1; });
    var names = Object.keys(seen);
    $("#people-ext").innerHTML = names.length
      ? names.map(function (n) {
          return '<li>' + avatarHTML({ who: "ext", name: n }, false) +
            '<div class="people__txt"><div class="people__name">' + esc(n) + "</div>" +
            '<div class="people__desc">메시지 ' + seen[n] + "개 · 붙여넣기로 참여</div></div></li>";
        }).join("")
      : '<li><div class="people__txt"><div class="people__desc">아직 없어요. “외부 AI 답 올리기”로 자비스·른자·챗GPT 답을 붙여넣어 보세요.</div></div></li>';
  }

  function renderSearch() {
    var q = $("#search-input").value.trim();
    var ul = $("#search-results");
    if (!q) { ul.innerHTML = '<li class="empty">찾을 말을 입력해 주세요.</li>'; return; }
    var hits = S.msgs.filter(function (m) { return m.text.toLowerCase().indexOf(q.toLowerCase()) >= 0; }).slice(-40).reverse();
    if (!hits.length) { ul.innerHTML = '<li class="empty">그 말은 아직 없어요.</li>'; return; }
    ul.innerHTML = hits.map(function (m) {
      var safe = esc(m.text);
      var re = new RegExp("(" + q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      safe = safe.replace(re, "<b>$1</b>");
      return '<li data-jump="' + esc(m.mid) + '">' + clip(safe, 120) +
        "<small>" + esc(speakerName(m)) + " · " + timeLabel(m.ts) + "</small></li>";
    }).join("");
    ul.querySelectorAll("[data-jump]").forEach(function (li) {
      li.addEventListener("click", function () {
        var mid = li.getAttribute("data-jump");
        closeSheets();
        var el = document.querySelector('[data-mid="' + mid + '"]');
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          el.style.transition = "background .3s ease";
          el.style.background = "rgba(255,255,255,.55)";
          setTimeout(function () { el.style.background = ""; }, 1400);
        }
      });
    });
  }

  function helpCode() {
    var u = Room.msgsUrl(S.room);
    return [
      "방 #" + codeLabel() + " · Firebase 실시간 DB (영구 보관)",
      "",
      "# 지난 대화 읽기",
      "GET " + u,
      "",
      "# 실시간 수신 (Accept: text/event-stream)",
      "GET " + u,
      "",
      "# 말 올리기 (POST, 본문은 JSON 한 건)",
      "POST " + u,
      '{"v":1,"t":"msg","who":"ext","name":"자비스","text":"안녕하세요","mid":"j-001","ts":' + Date.now() + '}',
      "",
      "# 받는 모양 ({서버키: 메시지}) — 키는 POST 응답의 name",
      '{"-NxAbC":{"v":1,"t":"msg","who":"u|kimchi|dorati|ttok|ext","name":"김치","text":"...","mid":"m-001","replyTo":"","ts":1763600000000}}',
      "",
      "# 읽음 표시 (외부 AI가 답할 때 한 번 PUT)",
      "PUT " + Room.readUrl(S.room, "자비스"),
      '{"k":"<마지막으로 읽은 메시지 키>","t":' + Date.now() + ',"n":"자비스"}',
      "",
      "# 작성 중 점 세 개 (쓰는 동안 PUT, 끝나면 DELETE)",
      "PUT " + Room.typingKeyUrl(S.room, "자비스"),
      '{"t":' + Date.now() + ',"n":"자비스"}',
      "DELETE " + Room.typingKeyUrl(S.room, "자비스")
    ].join("\n");
  }

  function openHelp() {
    $("#help-code").textContent = helpCode();
    sheet("#sheet-help", true);
  }

  function renderPresets() {
    $("#ext-presets").innerHTML = EXT_PRESETS.map(function (n) {
      return '<button class="preset" data-name="' + esc(n) + '">' + esc(n) + "</button>";
    }).join("");
    $$("#ext-presets .preset").forEach(function (b) {
      b.addEventListener("click", function () {
        $("#ext-name").value = b.getAttribute("data-name");
        $$("#ext-presets .preset").forEach(function (x) { x.removeAttribute("data-on"); });
        b.setAttribute("data-on", "1");
      });
    });
  }

  function postExternal() {
    var name = ($("#ext-name").value || "").trim().slice(0, 14);
    var text = ($("#ext-text").value || "").trim();
    if (!name) { toast("어느 AI 답인지 이름을 넣어 주세요"); $("#ext-name").focus(); return; }
    if (!text) { toast("답변을 붙여넣어 주세요"); $("#ext-text").focus(); return; }
    $("#ext-post").disabled = true;
    var item = { mid: uid(), who: "ext", name: name, text: text.slice(0, 1500), ts: Date.now() };
    addMsg(item);
    render();
    scrollBottom();
    publish(item).then(function (ev) {
      $("#ext-post").disabled = false;
      $("#ext-text").value = "";
      closeSheets();
      toast(name + " 답을 올렸어요");
      applySendResult(item.mid, ev);
      /* 답을 올렸으니 그 AI가 방을 읽은 것으로 표시 — 안 읽음 숫자가 줄어든다 */
      var key = whoKey(name);
      Room.markRead(S.room, key, item, name).then(function (v) {
        S.reads[key] = v;
        render();
      }).catch(function () {});
    }).catch(function (e) {
      $("#ext-post").disabled = false;
      toast(e && e.message === "limit" ? "오늘 보낼 수 있는 양을 넘었어요" : "올리지 못했어요. 연결을 확인해 주세요");
    });
  }

  /* ── 방 열기 ── */
  function openRoom(roomId) {
    Room.close();
    S.room = roomId;
    S.msgs = []; S.index = {}; S.typing = {}; S.reads = {}; S.fallback = {}; S.chain = Promise.resolve();
    loadLog();
    loadAi();
    $("#room-code").textContent = codeLabel();
    $("#cur-room").textContent = "#" + codeLabel();
    render();
    Room.connect(roomId, function (item) {
      if (addMsg(item)) {
        render();
        scrollBottomIfNear();
      }
    }, function (st) {
      S.link = st;
      renderStatus();
    }, function (map) {
      if (mergeReads(map)) { render(); }
    }, function (map) {
      var changed = false;
      Object.keys(map || {}).forEach(function (k) {
        var cur = S.aiTyping[k], nx = map[k];
        if (!nx) return;
        if (cur && cur.t === nx.t && cur.n === nx.n) return;
        if (nx.t) S.aiTyping[k] = nx; else delete S.aiTyping[k];
        changed = true;
      });
      if (changed) render();
    });
  }
  function scrollBottomIfNear() {
    var c = $("#chat");
    if (c.scrollHeight - c.scrollTop - c.clientHeight < 240) scrollBottom();
  }

  function switchRoom(id) {
    id = Room.cleanRoom(id);
    if (!id) return;
    setHashRoom(id);
    openRoom(id);
    toast("방 #" + id.toUpperCase() + " 로 왔어요");
  }

  /* ── 입력 ── */
  function autosize() {
    var el = $("#input");
    el.style.height = "auto";
    el.style.height = Math.min(120, el.scrollHeight) + "px";
  }

  /* ── 시작 ── */
  function init() {
    renderPresets();
    $("#chips").innerHTML = CHIPS.map(function (c) { return '<button class="chip">' + esc(c) + "</button>"; }).join("");
    $$("#chips .chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var input = $("#input");
        input.value = b.textContent;
        autosize();
        input.focus();
      });
    });

    try { S.nick = (localStorage.getItem(LS.nick) || "").trim(); } catch (e) {}
    try {
      var mo = localStorage.getItem(LS.mode);
      var dp = AI.get("dorati");
      if (mo && dp && dp.modes && dp.modes[mo]) S.mode = mo;
    } catch (e) {}

    var room = roomFromHash();
    if (!room) {
      room = Room.newRoomId();
      setHashRoom(room);
    }
    openRoom(room);

    if (S.nick) sheet("#sheet-join", false);
    else openJoin();

    /* 닉네임 */
    var nickEl = $("#join-nick");
    nickEl.addEventListener("input", function () {
      $("#join-go").disabled = !nickEl.value.trim();
    });
    nickEl.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && nickEl.value.trim()) $("#join-go").click();
    });
    $("#join-go").addEventListener("click", function () {
      var v = nickEl.value.trim().slice(0, 12);
      if (!v) return;
      S.nick = v;
      try { localStorage.setItem(LS.nick, v); } catch (e) {}
      sheet("#sheet-join", false);
      render();
      toast(v + "님, 들어왔어요");
    });

    /* 헤더 버튼 */
    $("#btn-code").addEventListener("click", function () {
      copy(roomLink(), "방 링크를 복사했어요. AI·친구에게 보내면 같은 방이에요");
    });
    $("#btn-help").addEventListener("click", openHelp);
    $("#btn-people").addEventListener("click", function () { renderPeople(); sheet("#sheet-people", true); });
    $("#btn-rooms").addEventListener("click", function () {
      $("#cur-room").textContent = "#" + codeLabel();
      sheet("#sheet-rooms", true);
    });
    $("#btn-search").addEventListener("click", function () {
      renderSearch();
      sheet("#sheet-search", true);
      setTimeout(function () { $("#search-input").focus(); }, 120);
    });

    $("#btn-room-copy").addEventListener("click", function () { copy(roomLink(), "방 링크를 복사했어요"); });
    $("#btn-room-new").addEventListener("click", function () { switchRoom(Room.newRoomId()); closeSheets(); });
    $("#btn-room-join").addEventListener("click", function () {
      var v = Room.cleanRoom($("#join-room-code").value);
      if (v.length < 4) { toast("방 코드를 확인해 주세요"); return; }
      closeSheets();
      switchRoom(v);
    });
    $("#join-room-code").addEventListener("keydown", function (e) {
      if (e.key === "Enter") $("#btn-room-join").click();
    });

    /* 시트 닫기 */
    $$(".sheet").forEach(function (s) {
      s.addEventListener("click", function (e) {
        if (e.target === s) s.removeAttribute("data-open");
        if (e.target.hasAttribute && e.target.hasAttribute("data-close")) s.removeAttribute("data-open");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeSheets();
    });

    /* 보내기 */
    $("#btn-send").addEventListener("click", sendMessage);
    $("#input").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    $("#input").addEventListener("input", autosize);

    $("#btn-all").addEventListener("click", replyAll);
    $("#btn-copy").addEventListener("click", copyRoomLog);
    $("#btn-ext").addEventListener("click", function () { sheet("#sheet-ext", true); });
    $("#ext-post").addEventListener("click", postExternal);

    $("#search-input").addEventListener("input", renderSearch);
    $("#btn-help-copy").addEventListener("click", function () { copy(helpCode(), "연결 구조를 복사했어요"); });

    window.addEventListener("hashchange", function () {
      var r = roomFromHash();
      if (r && r !== S.room) openRoom(r);
    });

    /* 화면을 다시 열면 서버에 남은 최근 대화를 당겨온다 */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && S.room) {
        Room.history(S.room).then(function (list) {
          var added = list.filter(function (m) { return addMsg(m); }).length;
          if (added) { render(); scrollBottomIfNear(); }
        }).catch(function () {});
      }
    });

    setInterval(function () { renderStatus(); }, 30000);

    /* 바깥 AI 의 '작성 중'은 25초가 지나면 저절로 시린다 — 보이는 목록이 바뀔 때만 다시 그린다 */
    var typingSig = "";
    setInterval(function () {
      var sig = extTyping().map(function (t) { return t.key; }).sort().join(",");
      if (sig !== typingSig) { typingSig = sig; render(); }
    }, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
