/* AI 단톡방 v1.1 — 화면·상태 */
(function () {
  "use strict";

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var LS = {
    nick: "aichat.nick.v1",
    ai: function (room) { return "aichat.ai.v1." + room; },
    log: function (room) { return "aichat.log.v1." + room; }
  };

  var S = {
    room: "",
    nick: "",
    msgs: [],
    index: {},
    active: { kimchi: true, dorati: true, ttok: false },
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
  var EXT_PRESETS = ["자비스", "부이", "메타 AI", "챗GPT", "제미나이", "그록"];

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
    "자비스": "#3f6fd8", "부이": "#8a6cf0",
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
      if (runEnd) {
        var n = me ? actives.length : 1;
        if (n > 0) out.push('<span class="meta__unread">' + n + '</span>');
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

    log.innerHTML = out.join("");
    if (atBottom) scrollBottom();
    renderStatus();
    $("#btn-all").disabled = !lastUserMsg() || !actives.length;
  }

  function scrollBottom() {
    var c = $("#chat");
    c.scrollTop = c.scrollHeight;
  }

  function renderStatus() {
    var parts = [];
    activeIds().forEach(function (id) {
      var p = AI.get(id);
      var last = lastFrom(id);
      parts.push("<b>" + esc(p.name) + "</b> " + (last ? ago(last.ts) : "대기"));
    });
    var extLast = lastFromExt();
    if (extLast) parts.push("<b>" + esc(extLast.name) + "</b> " + ago(extLast.ts));
    $("#status-strip").innerHTML = (S.link === "live" ? "" : "연결 중 · ") + (parts.join(" · ") || "AI를 켜 주세요");
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

  function oneReply(who, trigger) {
    var p = AI.get(who);
    if (!p) return Promise.resolve();
    return sleep(650 + Math.random() * 350).then(function () {
      if (hasReply(who, trigger.mid)) return;       /* 다른 기기·창이 먼저 답했으면 건너뛴다 */
      S.typing[who] = 1;
      render();
      return AI.reply(p, { text: trigger.text, nick: S.nick, history: buildHistory(trigger.mid) })
        .then(function (txt) {
          delete S.typing[who];
          if (!txt) { render(); return; }
          var item = { mid: uid(), who: who, name: p.name, text: txt, replyTo: trigger.mid, ts: Date.now() };
          if (addMsg(item)) { render(); }
          return publish(item).then(function (ev) {
            if (ev && ev.time) {
              for (var i = 0; i < S.msgs.length; i++) {
                if (S.msgs[i].mid === item.mid) { S.msgs[i].ts = ev.time * 1000; break; }
              }
              saveLog(); render();
            }
          }).catch(function (e) {
            if (e && e.message === "limit") toast("오늘 보낼 수 있는 양을 넘었어요. 내일 다시 이어 주세요");
          });
        })
        .catch(function () {
          delete S.typing[who];
          render();
          toast(p.name + "가 잠시 답을 못 했어요. 다시 불러 주세요");
        });
    });
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
    var mid = uid();
    var item = { mid: mid, who: "u", name: S.nick, text: text.slice(0, 1000), ts: Date.now() };
    input.value = "";
    autosize();
    addMsg(item);
    render();
    scrollBottom();

    Room.send(S.room, { v: 1, t: "msg", who: "u", name: S.nick, text: item.text, mid: mid, ts: Date.now() })
      .then(function (ev) {
        if (ev && ev.time) {
          for (var i = 0; i < S.msgs.length; i++) {
            if (S.msgs[i].mid === mid) { S.msgs[i].ts = ev.time * 1000; break; }
          }
          saveLog(); render();
        }
      })
      .catch(function (e) {
        toast(e && e.message === "limit"
          ? "오늘 보낼 수 있는 양을 넘었어요. 잠시 뒤 다시 시도해 주세요"
          : "전송이 안 됐어요. 연결을 확인해 주세요");
      });

    var ids = targetsFor(text);
    if (ids.length) replyFlow({ mid: mid, text: item.text }, ids);
    else if (!activeIds().length) toast("답할 AI가 꺼져 있어요. 참여 AI에서 켜 주세요");
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
      return '<li>' + avatarHTML({ who: p.id }, false) +
        '<div class="people__txt"><div class="people__name">' + esc(p.name) + "</div>" +
        '<div class="people__desc">' + esc(p.desc) + "</div></div>" +
        '<label class="switch"><input type="checkbox" data-ai="' + p.id + '"' + (S.active[p.id] ? " checked" : "") + "><span></span></label></li>";
    }).join("");
    ul.querySelectorAll("input[data-ai]").forEach(function (el) {
      el.addEventListener("change", function () {
        S.active[el.getAttribute("data-ai")] = el.checked;
        saveAi();
        render();
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
      : '<li><div class="people__txt"><div class="people__desc">아직 없어요. “외부 AI 답 올리기”로 부이·챗GPT 답을 붙여넣어 보세요.</div></div></li>';
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
    var t = Room.topic(S.room);
    return [
      "방 #" + codeLabel(),
      "",
      "# 지난 대화 (서버 12시간 보관)",
      "GET " + Room.host + "/" + t + "/json?poll=1&since=all",
      "",
      "# 실시간 수신 (SSE)",
      "GET " + Room.host + "/" + t + "/sse",
      "",
      "# 말 올리기 (POST, 본문은 JSON)",
      "POST " + Room.host + "/" + t,
      '{"v":1,"t":"msg","who":"ext","name":"자비스","text":"안녕하세요","mid":"j-001"}',
      "",
      "# 받는 본문(message 필드) 형식",
      '{"v":1,"t":"msg","who":"u|kimchi|dorati|ttok|ext","name":"김치","text":"...","mid":"m-001","replyTo":""}'
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
      if (ev && ev.time) {
        for (var i = 0; i < S.msgs.length; i++) if (S.msgs[i].mid === item.mid) { S.msgs[i].ts = ev.time * 1000; break; }
        saveLog(); render();
      }
    }).catch(function (e) {
      $("#ext-post").disabled = false;
      toast(e && e.message === "limit" ? "오늘 보낼 수 있는 양을 넘었어요" : "올리지 못했어요. 연결을 확인해 주세요");
    });
  }

  /* ── 방 열기 ── */
  function openRoom(roomId) {
    Room.close();
    S.room = roomId;
    S.msgs = []; S.index = {}; S.typing = {}; S.chain = Promise.resolve();
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
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
