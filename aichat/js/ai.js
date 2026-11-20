/* AI 단톡방 — 내장 AI 세 명
   답변은 도랏이/김치가 쓰는 기존 Apps Script 중계(공개 주소)로 만든다. 키는 서버에만 있다.
   방 전체 대화는 history 로 넘겨서, 다른 AI가 한 말까지 읽고 이어서 답하게 한다.
   도랏이는 건전·일반·도랏 세 모드를 갖고, 모드마다 tone 과 ctx 가 바뀐다. */
window.AI = (function () {
  "use strict";
  var PROXY = "https://script.google.com/macros/s/AKfycbwnHX4qyLBYiK5Eg4kK6t31n1gZ3a9995VuxufJn3moUz85wZXYZ-SZJh1IuSZtJUG8/exec";
  var MODEL = "gemini-3.5-flash-lite";

  /* 중계 서버가 ctx 를 400자까지만 받는다 — 인물 설명은 짧게 유지한다 */
  var BANTER = "1~3문장으로 짧게, 인사·자기소개 반복 없이 본론부터. 다른 참여자(AI 포함) 말을 읽고 같은 말은 반복하지 않는다. 이모지·마크다운 기호 금지. 모르는 사실은 지어내지 않는다.";

  /* 어떤 모드에서도 지키는 선 */
  var DORATI_SAFE = "자해·범죄·일베·지역/장애 혐오는 절대 받아주지 않고 툭 넘긴다.";

  var DORATI_MODES = {
    mild: {
      label: "건전",
      tone: "formal",
      desc: "예의 바르고 순한 말투",
      ctx: "너는 'AI 단톡방'의 '도랏이'다. 지금은 건전 모드 — 예의 바르고 순한 말투로, 비속어·비꼬기 없이 다정하게 답한다. " + BANTER + " " + DORATI_SAFE
    },
    normal: {
      label: "일반",
      tone: "casual",
      desc: "적당히 깝치고 드립치는 반말",
      ctx: "너는 'AI 단톡방'의 '도랏이'다. 김치가 아니라 도랏이로서 깝치고 드립치는 반말로 답한다. " + BANTER + " 노골적인 욕설·비하는 쓰지 않는다. " + DORATI_SAFE
    },
    dos: {
      label: "도랏",
      tone: "casual",
      desc: "직설적이고 매운맛 반말",
      ctx: "너는 'AI 단톡방'의 '도랏이'다. 지금은 도랏 모드 — 더 직설적이고 매운맛으로 거침없이 받아치는 반말. 사람을 깎아내리지 말고 주장·상황만 받아친다. " + BANTER + " " + DORATI_SAFE
    }
  };

  var LIST = [
    {
      id: "kimchi",
      name: "김치",
      mark: "ㄱ",
      desc: "밝고 유능한 비서 · 존댓말",
      tone: "formal",
      ctx: "너는 지금 'AI 단톡방'에 참여한 비서 '김치'다. " + BANTER + " 개인정보·비밀번호는 다루지 않는다."
    },
    {
      id: "dorati",
      name: "도랏이",
      mark: "도",
      desc: DORATI_MODES.normal.desc,
      tone: DORATI_MODES.normal.tone,
      ctx: DORATI_MODES.normal.ctx,
      modes: DORATI_MODES
    },
    {
      id: "ttok",
      name: "똑똑이",
      mark: "똑",
      desc: "차분한 분석 · 근거 중심",
      tone: "formal",
      ctx: "너는 'AI 단톡방'의 '똑똑이'다. 김치가 아니라 똑똑이로서 차분하고 분석적인 말투로 답한다. " + BANTER
    }
  ];

  function get(id) {
    for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
    return null;
  }

  /* 모드가 있는 인물(도랏이)은 그 모드의 tone·ctx 로 갈아입혀 돌려준다 */
  function withMode(persona, mode) {
    if (!persona || !persona.modes) return persona;
    var m = persona.modes[mode] || persona.modes.normal;
    if (!m) return persona;
    return {
      id: persona.id,
      name: persona.name,
      mark: persona.mark,
      desc: m.desc,
      tone: m.tone,
      ctx: m.ctx,
      modes: persona.modes,
      mode: mode
    };
  }

  function modeList(persona) {
    if (!persona || !persona.modes) return [];
    return Object.keys(persona.modes).map(function (k) {
      return { key: k, label: persona.modes[k].label, desc: persona.modes[k].desc };
    });
  }

  function tidy(txt) {
    return String(txt || "")
      .replace(/\*\*|__|`/g, "")
      .replace(/^#+\s*/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 700);
  }

  /* history: [{r:"u"|"b", t:"..."}] */
  function reply(persona, opts) {
    var body = {
      action: "chat",
      app: "kimchi",
      tone: persona.tone,
      text: String(opts.text || "").slice(0, 500),
      nick: String(opts.nick || "").slice(0, 12),
      history: (opts.history || []).slice(-8),
      ctx: persona.ctx,
      model: MODEL
    };
    var ctrl = null, timer = null, opt = {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow",
      cache: "no-store"
    };
    try {
      ctrl = new AbortController();
      opt.signal = ctrl.signal;
      timer = setTimeout(function () { ctrl.abort(); }, 26000);
    } catch (e) {}

    return fetch(PROXY, opt)
      .then(function (r) {
        if (!r.ok) throw new Error("http_" + r.status);
        return r.text();
      })
      .then(function (txt) {
        if (timer) clearTimeout(timer);
        var j;
        try { j = JSON.parse(txt); } catch (e) { throw new Error("bad_json"); }
        if (!j || !j.ok || !j.reply) throw new Error((j && j.error) || "empty");
        return tidy(j.reply);
      })
      .catch(function (e) {
        if (timer) clearTimeout(timer);
        throw e;
      });
  }

  return { list: LIST, get: get, reply: reply, withMode: withMode, modeList: modeList };
})();
