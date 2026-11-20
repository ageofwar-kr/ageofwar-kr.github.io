/* 오피러스 카세트 v1.1 — 후석 7inch LCD MONITOR 감성 카세트 플레이어
   · 테이프(이름·라벨·음원 목록)를 만들어 이 기기(IndexedDB)에 보관하고, 덱에 넣고 꺼낸다.
   · 음원은 파일 하나당 한 번씩 차례로 저장하고 진행률을 보여 준다(대용량·다수 파일에서도 멈추지 않게).
   · 재생은 현재 곡의 Blob만 꺼내 객체 URL로 만든다(목록만 먼저 읽어 메모리를 아낀다).
   · 화면(모니터)·소리(audio)·잠금화면(mediaSession)을 한 상태(S)로 묶어 관리한다. */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ───────── 요소 ───────── */
  var monitor = $('#monitor');
  var audio = $('#audio');
  var fileInput = $('#file');

  var tapeEl = $('#tape');
  var tapeL = $('#tapeL'), tapeR = $('#tapeR'), tapeLE = $('#tapeLe'), tapeRE = $('#tapeRe');
  var elLabelName = $('#label-name');
  var elLabelNum = $('#label-num');
  var mouth = $('#mouth');
  var osdEl = $('#osd');
  var srcTape = $('#src-tape');
  var tapeBadge = $('#tape-badge');

  var elTitle = $('#track-title');
  var elClock = $('#clock');
  var elCur = $('#t-cur');
  var elDur = $('#t-dur');
  var elSeek = $('#seek');
  var elFill = $('#seek-fill');
  var elPlayG = $('#play-g');
  var elPlayT = $('#play-t');
  var elPlay = $('#key-play');
  var elHint = $('#hint');
  var jblPlate = $('#jbl-plate');

  var sheetTapes = $('#sheet-tapes');
  var sheetNew = $('#sheet-new');
  var sheetInfo = $('#sheet-info');
  var elNow = $('#now');
  var elNowName = $('#now-name');
  var elNowSub = $('#now-sub');
  var elNowMini = $('#now-mini');
  var elPl = $('#pl');
  var elShelf = $('#shelf');
  var elTapesCount = $('#tapes-count');
  var elStorageNote = $('#storage-note');

  var elNewName = $('#new-name');
  var elNewStyles = $('#new-styles');
  var elNewCount = $('#new-count');
  var elNewSize = $('#new-size');
  var elNewList = $('#new-list');
  var elNewSave = $('#new-save');

  var saveBar = $('#savebar');
  var saveFill = $('#savebar-fill');
  var saveText = $('#savebar-text');

  /* ───────── 상태 ───────── */
  /* 테이프 라벨 톤 — 색 없이 크림·그레이·차콜 세 가지 단색만 쓴다 */
  var STYLES = {
    cream:    { label: '크림',   bg: '#e7e0cf', ink: '#24211c', line: 'rgba(62,56,46,.45)',  mini: '#e7e0cf' },
    grey:     { label: '그레이', bg: '#b2ada3', ink: '#1b1a17', line: 'rgba(32,30,26,.45)',  mini: '#b2ada3' },
    charcoal: { label: '차콜',   bg: '#211f1c', ink: '#ece6d7', line: 'rgba(236,229,214,.4)', mini: '#211f1c' }
  };

  /* v1.0에 저장된 컬러 라벨 키는 가장 가까운 단색 톤으로 읽는다 */
  var STYLE_ALIAS = { gold: 'cream', red: 'grey', blue: 'charcoal', green: 'grey' };

  function styleOf(key) {
    return STYLES[key] || STYLES[STYLE_ALIAS[key]] || STYLES.cream;
  }

  function styleKey(key) {
    return STYLES[key] ? key : (STYLE_ALIAS[key] || 'cream');
  }

  var DEFAULTS = [
    { name: '클래식 50곡', style: 'cream' },
    { name: '트로트', style: 'grey' },
    { name: '긴 뽕짝', style: 'charcoal' }
  ];

  var S = {
    tapes: [],
    tape: null,
    tracks: [],
    i: -1,
    playing: false,
    off: false,
    click: true,
    dragging: false,
    raf: 0,
    posStamp: 0,
    pending: [],
    newStyle: 'cream',
    idbOk: true,
    busy: false,
    curUrl: null,
    loadToken: 0,
    insertTimer: []
  };

  try { S.click = localStorage.getItem('opirus.click') !== '0'; } catch (e) {}
  try { S.newStyle = localStorage.getItem('opirus.style') || 'cream'; } catch (e) {}

  var HINT_HOME = '테이프 함 → 나만의 테이프를 만들어 넣으세요';

  /* ───────── 작은 도구 ───────── */
  function fmt(t) {
    if (!isFinite(t) || t < 0) return '--:--';
    t = Math.floor(t);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return h > 0 ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  function bytes(n) {
    if (!n) return '0MB';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + 'KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + 'MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + 'GB';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function cleanName(name) {
    return name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim() || name;
  }

  function clip(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function hint(msg, ms) {
    elHint.textContent = msg;
    clearTimeout(hint.t);
    if (ms) hint.t = setTimeout(function () { elHint.textContent = HINT_HOME; }, ms);
  }

  function tickClock() {
    var d = new Date();
    elClock.textContent = d.getHours() + ':' + pad2(d.getMinutes());
  }

  /* ───────── 소리 엔진 (Web Audio) ───────── */
  var ac = null;
  var noiseBuf = null;
  var windSnd = null;

  function canHear() { return S.click && !S.off; }

  function actx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ac = ac || new AC();
      if (ac.state === 'suspended') ac.resume();
    } catch (e) { return null; }
    return ac;
  }

  function noiseData(a) {
    if (!noiseBuf || noiseBuf.sampleRate !== a.sampleRate) {
      var n = Math.floor(a.sampleRate * 2);
      noiseBuf = a.createBuffer(1, n, a.sampleRate);
      var ch = noiseBuf.getChannelData(0);
      for (var i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  /* 버튼 딸깍 */
  function clickSound(soft) {
    if (!canHear()) return;
    var a = actx();
    if (!a) return;
    try {
      var t0 = a.currentTime;
      var n = Math.floor(a.sampleRate * 0.026);
      var buf = a.createBuffer(1, n, a.sampleRate);
      var ch = buf.getChannelData(0);
      for (var i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      var src = a.createBufferSource();
      src.buffer = buf;
      var bp = a.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = soft ? 1650 : 2300;
      bp.Q.value = 1.6;
      var lp = a.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5200;
      lp.Q.value = 0.4;
      var g = a.createGain();
      g.gain.value = soft ? 0.042 : 0.058;
      src.connect(bp).connect(lp).connect(g).connect(a.destination);
      src.start(t0);

      var o = a.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(soft ? 150 : 220, t0);
      o.frequency.exponentialRampToValueAtTime(80, t0 + 0.05);
      var g2 = a.createGain();
      g2.gain.setValueAtTime(soft ? 0.035 : 0.05, t0);
      g2.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.06);
      o.connect(g2).connect(a.destination);
      o.start(t0);
      o.stop(t0 + 0.07);
    } catch (e) {}
  }

  /* 스르륵 — 테이프가 슬롯을 타고 드나드는 마찰음 */
  function sndSlide(t0, dur, peak, outward) {
    var a = actx();
    if (!a) return;
    var src = a.createBufferSource();
    src.buffer = noiseData(a);
    src.loop = true;
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.85;
    bp.frequency.setValueAtTime(outward ? 620 : 1500, t0);
    bp.frequency.linearRampToValueAtTime(outward ? 2100 : 1150, t0 + dur * 0.55);
    bp.frequency.linearRampToValueAtTime(outward ? 900 : 560, t0 + dur);
    var hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 380;
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    lp.Q.value = 0.35;
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak * 0.7, t0 + Math.min(0.2, dur * 0.34));
    g.gain.linearRampToValueAtTime(peak, t0 + dur * 0.6);
    g.gain.linearRampToValueAtTime(peak * 0.62, t0 + dur * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
    src.connect(bp).connect(hp).connect(lp).connect(g).connect(a.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  /* 위잉 — 덱 모터가 돌아가는 소리 */
  function sndMotor(t0, dur, hiF, peak, fast) {
    var a = actx();
    if (!a) return;
    var lo = hiF * 0.5;
    var o = a.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(lo, t0);
    o.frequency.exponentialRampToValueAtTime(hiF, t0 + Math.min(0.22, dur * 0.35));
    o.frequency.setValueAtTime(hiF, t0 + dur * 0.72);
    o.frequency.exponentialRampToValueAtTime(lo * 1.1, t0 + dur);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.9;
    lp.frequency.setValueAtTime(340, t0);
    lp.frequency.linearRampToValueAtTime(720, t0 + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(420, t0 + dur);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + Math.min(0.18, dur * 0.3));
    g.gain.linearRampToValueAtTime(peak * 0.82, t0 + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0004, t0 + dur);
    var lfo = a.createOscillator();
    lfo.frequency.value = fast ? 19 : 26;
    var lg = a.createGain();
    lg.gain.value = hiF * 0.04;
    lfo.connect(lg).connect(o.frequency);
    o.connect(lp).connect(g).connect(a.destination);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + dur + 0.03);
    lfo.stop(t0 + dur + 0.03);
  }

  /* 철컥 / 딸깍 — 래치가 물리는 금속음 */
  function sndClack(t0, peak) {
    var a = actx();
    if (!a) return;
    var src = a.createBufferSource();
    src.buffer = noiseData(a);
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1450;
    bp.Q.value = 1.1;
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3800;
    lp.Q.value = 0.4;
    var g = a.createGain();
    g.gain.setValueAtTime(peak * 0.8, t0);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.05);
    src.connect(bp).connect(lp).connect(g).connect(a.destination);
    src.start(t0);
    src.stop(t0 + 0.06);

    var o = a.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(148, t0);
    o.frequency.exponentialRampToValueAtTime(46, t0 + 0.13);
    var g2 = a.createGain();
    g2.gain.setValueAtTime(peak * 0.95, t0);
    g2.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.17);
    o.connect(g2).connect(a.destination);
    o.start(t0);
    o.stop(t0 + 0.18);

    var o2 = a.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(2350, t0 + 0.008);
    o2.frequency.exponentialRampToValueAtTime(1500, t0 + 0.07);
    var g3 = a.createGain();
    g3.gain.setValueAtTime(peak * 0.22, t0 + 0.008);
    g3.gain.exponentialRampToValueAtTime(0.0004, t0 + 0.1);
    o2.connect(g3).connect(a.destination);
    o2.start(t0 + 0.008);
    o2.stop(t0 + 0.11);
  }

  /* 테이프 장착: 래치 열림 → 스르륵 → 위잉 → 철컥 → 딸깍 */
  function sndLoad() {
    if (!canHear()) return;
    var a = actx();
    if (!a) return;
    var t = a.currentTime + 0.02;
    sndClack(t + 0.10, 0.045);
    sndSlide(t + 0.13, 0.58, 0.048, true);
    sndMotor(t + 0.28, 0.62, 132, 0.026, false);
    sndClack(t + 0.93, 0.075);
    sndClack(t + 1.05, 0.034);
  }

  /* 테이프 배출: 해제 철컥 → 스르륵(바깥으로) → 딸깍 */
  function sndEject() {
    if (!canHear()) return;
    var a = actx();
    if (!a) return;
    var t = a.currentTime + 0.01;
    sndClack(t + 0.05, 0.05);
    sndMotor(t + 0.06, 0.30, 96, 0.016, false);
    sndSlide(t + 0.10, 0.34, 0.04, false);
    sndClack(t + 0.48, 0.028);
  }

  /* 감기 소리 — 누르고 있는 동안만 은은하게 “위이잉~” */
  function sndWind(on, back) {
    if (!on) {
      if (!windSnd) return;
      var w = windSnd, ctx = ac;
      windSnd = null;
      if (!ctx) return;
      var tn = ctx.currentTime;
      try {
        w.g.gain.cancelScheduledValues(tn);
        w.g.gain.setValueAtTime(Math.max(0.0004, w.g.gain.value), tn);
        w.g.gain.exponentialRampToValueAtTime(0.0003, tn + 0.12);
      } catch (e) {}
      try { w.n.stop(tn + 0.18); } catch (e) {}
      try { w.o.stop(tn + 0.18); } catch (e) {}
      return;
    }
    if (!canHear()) return;
    if (windSnd) sndWind(false);
    var a = actx();
    if (!a) return;
    var t = a.currentTime;
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03, t + 0.14);
    g.connect(a.destination);

    var n = a.createBufferSource();
    n.buffer = noiseData(a);
    n.loop = true;
    var bp = a.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(back ? 2200 : 1500, t);
    bp.frequency.linearRampToValueAtTime(back ? 3000 : 3400, t + 0.45);
    var lpN = a.createBiquadFilter();
    lpN.type = 'lowpass';
    lpN.frequency.value = 4600;
    lpN.Q.value = 0.3;
    var hn = a.createGain();
    hn.gain.value = 0.62;
    n.connect(bp).connect(lpN).connect(hn).connect(g);

    var o = a.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(back ? 78 : 62, t);
    o.frequency.exponentialRampToValueAtTime(back ? 190 : 172, t + 0.35);
    var lp = a.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 560;
    lp.Q.value = 2;
    var og = a.createGain();
    og.gain.value = 0.55;
    o.connect(lp).connect(og).connect(g);

    n.start(t);
    o.start(t);
    windSnd = { g: g, n: n, o: o };
  }

  /* ───────── 음질 (항상 JBL 카오디오 EQ) ─────────
     음원(Blob)은 다시 인코딩하거나 깎지 않고 그대로 흘려보낸다.
     그 위에 저음 보강 · 중고음 선명도 · 클리핑 방지 리미터만 더한다. */
  var mctx = null;
  var mg = null;
  var mGraphFail = false;

  function musicCtx() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      mctx = mctx || new AC({ latencyHint: 'playback' });
      if (mctx.state === 'suspended') mctx.resume();
    } catch (e) { return null; }
    return mctx;
  }

  function ensureMusic() {
    if (mg) {
      if (mg.ctx.state === 'suspended') { try { mg.ctx.resume(); } catch (e) {} }
      return mg;
    }
    if (mGraphFail) return null;
    var a = musicCtx();
    if (!a) { mGraphFail = true; return null; }
    try {
      var src = a.createMediaElementSource(audio);
      var sub = a.createBiquadFilter();
      sub.type = 'highpass';
      sub.frequency.value = 28;
      sub.Q.value = 0.6;
      var bass = a.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 95;
      bass.gain.value = 4.5;
      var mud = a.createBiquadFilter();
      mud.type = 'peaking';
      mud.frequency.value = 320;
      mud.Q.value = 1;
      mud.gain.value = -1.8;
      var pres = a.createBiquadFilter();
      pres.type = 'peaking';
      pres.frequency.value = 2800;
      pres.Q.value = 0.9;
      pres.gain.value = 3.2;
      var air = a.createBiquadFilter();
      air.type = 'highshelf';
      air.frequency.value = 9000;
      air.gain.value = 3.4;
      var lim = a.createDynamicsCompressor();
      lim.threshold.value = -4;
      lim.knee.value = 8;
      lim.ratio.value = 4;
      lim.attack.value = 0.003;
      lim.release.value = 0.2;
      src.connect(sub);
      sub.connect(bass);
      bass.connect(mud);
      mud.connect(pres);
      pres.connect(air);
      air.connect(lim);
      lim.connect(a.destination);
      mg = { ctx: a, src: src };
      return mg;
    } catch (e) {
      mGraphFail = true;
      return null;
    }
  }

  /* ───────── 테이프 그림 ───────── */
  function paintTape(p) {
    if (!isFinite(p)) p = 0;
    p = Math.min(1, Math.max(0, p));
    var hi = 36, lo = 8.5;
    var l = (hi - (hi - lo) * p).toFixed(1);
    var r = (lo + (hi - lo) * p).toFixed(1);
    tapeL.setAttribute('r', l); tapeLE.setAttribute('r', l);
    tapeR.setAttribute('r', r); tapeRE.setAttribute('r', r);
  }

  function applyLabel(tape) {
    var st = styleOf(tape && tape.style);
    tapeEl.style.setProperty('--lb-bg', st.bg);
    tapeEl.style.setProperty('--lb-ink', st.ink);
    tapeEl.style.setProperty('--lb-line', st.line);
    elLabelName.textContent = tape ? clip(tape.name, 12) : 'NO TAPE';
    elLabelNum.textContent = '--';
    srcTape.classList.toggle('is-on', !!tape);
  }

  function flap(on) { mouth.classList.toggle('is-open', !!on); }

  function osd(text, ms) {
    osdEl.textContent = text || '';
    osdEl.classList.toggle('is-on', !!text);
    if (text) tapeBadge.classList.add('is-live'); else tapeBadge.classList.remove('is-live');
    clearTimeout(osd.t);
    if (text && ms) osd.t = setTimeout(function () { osd(''); }, ms);
  }

  /* ───────── 저장 진행 표시 ───────── */
  function saveStart(total, label) {
    saveBar.hidden = false;
    saveBar.classList.add('is-on');
    saveSet(0, total, label || '저장 중...');
  }

  function saveSet(done, total, label) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    saveFill.style.width = pct + '%';
    saveText.textContent = (label || '저장 중...') + ' ' + done + '/' + total;
  }

  function saveEnd() {
    saveBar.classList.remove('is-on');
    setTimeout(function () { saveBar.hidden = true; }, 260);
  }

  /* ───────── IndexedDB ───────── */
  var DB_NAME = 'opirus-cassette', DB_VER = 2, _db = null;

  function openDB() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no-idb')); return; }
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains('tapes')) d.createObjectStore('tapes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'key' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-error')); };
    });
  }

  function db() {
    if (_db) return Promise.resolve(_db);
    return openDB().then(function (d) {
      _db = d;
      d.onversionchange = function () { try { d.close(); } catch (e) {} _db = null; };
      return d;
    });
  }

  function req(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(store, mode);
        var r = fn(tx.objectStore(store));
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function tapeAll() { return req('tapes', 'readonly', function (os) { return os.getAll(); }); }
  function tapePut(t) { return req('tapes', 'readwrite', function (os) { return os.put(t); }); }
  function tapeDel(id) { return req('tapes', 'readwrite', function (os) { return os.delete(id); }); }
  function blobPut(key, blob) { return req('blobs', 'readwrite', function (os) { return os.put({ key: key, blob: blob }); }); }
  function blobGet(key) { return req('blobs', 'readonly', function (os) { return os.get(key); }); }

  function blobsDelTape(tapeId) {
    return db().then(function (d) {
      return new Promise(function (resolve) {
        var tx = d.transaction('blobs', 'readwrite');
        var os = tx.objectStore('blobs');
        var range = IDBKeyRange.bound(tapeId + ':', tapeId + ':\uffff');
        var cur = os.openCursor(range);
        cur.onsuccess = function () {
          var c = cur.result;
          if (!c) { resolve(); return; }
          c.delete();
          c.continue();
        };
        cur.onerror = function () { resolve(); };
      });
    });
  }

  function blobKey(tapeId, trackId) { return tapeId + ':' + trackId; }

  function loadTapeList() {
    return tapeAll().then(
      function (all) { S.idbOk = true; return all || []; },
      function () { S.idbOk = false; return S.tapes.slice(); }
    );
  }

  function lastId(v) {
    try {
      if (v === undefined) return localStorage.getItem('opirus.last');
      if (v) localStorage.setItem('opirus.last', v);
      else localStorage.removeItem('opirus.last');
    } catch (e) {}
    return null;
  }

  /* ───────── 재생 ───────── */
  function updateTime() {
    var d = audio.duration, c = audio.currentTime || 0;
    elCur.textContent = fmt(c);

    if (isFinite(d) && d > 0) {
      elDur.textContent = fmt(d);
      if (!S.dragging) {
        var p = c / d;
        elSeek.value = Math.round(p * 1000);
        elFill.style.width = (p * 100).toFixed(2) + '%';
        paintTape(p);
      }
    }

    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(d) && d > 0) {
      var now = Date.now();
      if (now - S.posStamp > 900) {
        S.posStamp = now;
        try {
          navigator.mediaSession.setPositionState({
            duration: d, position: Math.min(c, d), playbackRate: audio.playbackRate || 1
          });
        } catch (e) {}
      }
    }
  }

  function loop() {
    S.raf = requestAnimationFrame(loop);
    updateTime();
  }
  function startLoop() { if (!S.raf) S.raf = requestAnimationFrame(loop); }
  function stopLoop() { if (S.raf) { cancelAnimationFrame(S.raf); S.raf = 0; } }

  function paintPlaying() {
    var on = S.playing;
    monitor.classList.toggle('is-playing', on);
    elPlay.classList.toggle('is-on', on);
    elPlayG.textContent = on ? '❚❚' : '▶';
    elPlayT.textContent = on ? '멈추기' : '재생';
    elPlay.setAttribute('aria-label', on ? '멈추기' : '재생');
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.playbackState = on ? 'playing' : 'paused'; } catch (e) {}
    }
  }

  function resetTimeUI() {
    elCur.textContent = '00:00';
    elDur.textContent = '--:--';
    elSeek.value = 0;
    elFill.style.width = '0%';
    paintTape(0);
  }

  function releaseUrl() {
    if (S.curUrl) {
      try { URL.revokeObjectURL(S.curUrl); } catch (e) {}
      S.curUrl = null;
    }
  }

  function stopAudio() {
    cancelWind();
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (e) {}
    S.playing = false;
    paintPlaying();
    stopLoop();
  }

  function play() {
    if (!S.tracks.length) { openSheet('tapes'); return; }
    if (S.off) powerOn();
    ensureMusic();
    var pr = audio.play();
    if (pr && pr.catch) pr.catch(function () { hint('▶를 눌러 재생하세요', 4000); });
  }

  function togglePlay() {
    if (!S.tracks.length) { openSheet('tapes'); return; }
    if (audio.paused) play(); else audio.pause();
  }

  function setTrack(idx, autoplay) {
    if (idx < 0 || idx >= S.tracks.length) return;
    S.i = idx;
    var t = S.tracks[idx];

    stopAudio();
    releaseUrl();
    S.loadToken++;

    elTitle.textContent = t.name;
    elTitle.title = t.name;
    elLabelNum.textContent = pad2(idx + 1);
    resetTimeUI();
    if (isFinite(t.dur)) elDur.textContent = fmt(t.dur);
    mediaMeta(t);
    renderNowTracks();

    if (t.blob) {
      S.curUrl = URL.createObjectURL(t.blob);
      audio.src = S.curUrl;
      if (autoplay) play();
      return;
    }

    var token = S.loadToken;
    var key = blobKey(S.tape ? S.tape.id : '', t.id);
    blobGet(key).then(function (rec) {
      if (token !== S.loadToken) return;
      if (!rec || !rec.blob) { hint('음원을 찾을 수 없습니다', 4000); return; }
      S.curUrl = URL.createObjectURL(rec.blob);
      audio.src = S.curUrl;
      if (autoplay) play();
    }).catch(function () {
      if (token === S.loadToken) hint('음원을 읽지 못했습니다', 4000);
    });
  }

  function next() {
    if (!S.tracks.length) { openSheet('tapes'); return; }
    setTrack((S.i + 1) % S.tracks.length, true);
  }

  function prev() {
    if (!S.tracks.length) { openSheet('tapes'); return; }
    setTrack((S.i - 1 + S.tracks.length) % S.tracks.length, true);
  }

  /* ───────── 감기 (뚝 끊기지 않는 부드러운 이동) ───────── */
  var W = { raf: 0, hold: null, seek: null, rate: 10 };

  function clampPos(v) {
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return Math.max(0, v);
    return Math.min(d, Math.max(0, v));
  }

  function windSoundOff() { sndWind(false); }

  function cancelWind() {
    W.hold = null;
    W.seek = null;
    if (W.raf) { cancelAnimationFrame(W.raf); W.raf = 0; }
    monitor.classList.remove('is-winding', 'is-rew');
    windSoundOff();
  }

  /* 짧게 탭: 0.55초 동안 목표 지점까지 스르륵 */
  function tapSeek(dir) {
    if (!S.tracks.length) { openSheet('tapes'); return; }
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    if (dir < 0 && audio.currentTime <= 2 && S.tracks.length > 1) { prev(); return; }
    smoothTo(audio.currentTime + dir * 10, 0.55);
  }

  function smoothTo(target, dur) {
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    cancelWind();

    var from = audio.currentTime || 0;
    target = clampPos(target);
    var span = target - from;
    if (Math.abs(span) < 0.02) { audio.currentTime = target; updateTime(); return; }

    var wasPlaying = !audio.paused;
    if (wasPlaying) audio.pause();

    monitor.classList.add('is-winding');
    monitor.classList.toggle('is-rew', span < 0);
    sndWind(true, span < 0);

    W.seek = { from: from, span: span, dur: dur || 0.55, wasPlaying: wasPlaying, t0: 0 };
    W.raf = requestAnimationFrame(seekStep);
  }

  function seekStep(now) {
    var s = W.seek;
    if (!s) return;
    if (!s.t0) s.t0 = now;
    var k = Math.min(1, (now - s.t0) / (s.dur * 1000));
    var e = 1 - Math.pow(1 - k, 3);
    audio.currentTime = clampPos(s.from + s.span * e);
    updateTime();
    if (k >= 1) {
      W.seek = null;
      cancelAnimationFrame(W.raf);
      W.raf = 0;
      monitor.classList.remove('is-winding', 'is-rew');
      windSoundOff();
      if (s.wasPlaying) play();
      return;
    }
    W.raf = requestAnimationFrame(seekStep);
  }

  /* 꾹 누르는 동안: 초당 약 10배속으로 연속 감기 */
  function holdStart(dir) {
    if (!S.tracks.length) return;
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    cancelWind();

    W.hold = { dir: dir, last: 0 };
    if (!audio.paused) audio.pause();
    monitor.classList.add('is-winding');
    monitor.classList.toggle('is-rew', dir < 0);
    sndWind(true, dir < 0);
    W.raf = requestAnimationFrame(holdStep);
  }

  function holdStep(now) {
    if (!W.hold) return;
    if (!W.hold.last) W.hold.last = now;
    var dt = Math.min(0.05, (now - W.hold.last) / 1000);
    W.hold.last = now;
    audio.currentTime = clampPos(audio.currentTime + W.hold.dir * W.rate * dt);
    updateTime();
    W.raf = requestAnimationFrame(holdStep);
  }

  function holdEnd(playFromHere) {
    if (!W.hold) return;
    W.hold = null;
    if (W.raf) { cancelAnimationFrame(W.raf); W.raf = 0; }
    monitor.classList.remove('is-winding', 'is-rew');
    windSoundOff();
    updateTime();
    if (playFromHere && S.tracks.length) play();
  }

  function holdButton(el, dir) {
    var timer = null, holding = false;

    function down(e) {
      if (e && e.button !== undefined && e.button > 0) return;
      holding = false;
      el.classList.add('is-down');
      try { if (e && e.pointerId != null && el.setPointerCapture) el.setPointerCapture(e.pointerId); } catch (err) {}
      clearTimeout(timer);
      timer = setTimeout(function () {
        holding = true;
        holdStart(dir);
        if (navigator.vibrate) { try { navigator.vibrate(6); } catch (err) {} }
      }, 300);
    }

    function up() {
      clearTimeout(timer);
      el.classList.remove('is-down');
      if (holding) { holding = false; holdEnd(true); }
      else { clickSound(); tapSeek(dir); }
    }

    function cancel() {
      clearTimeout(timer);
      el.classList.remove('is-down');
      if (holding) { holding = false; holdEnd(false); }
    }

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    /* 손가락이 버튼 밖에서 떨어져도 감기가 멈추게 */
    window.addEventListener('pointerup', function () {
      if (holding) { holding = false; clearTimeout(timer); el.classList.remove('is-down'); holdEnd(true); }
    });
    window.addEventListener('pointercancel', function () {
      if (holding) { holding = false; clearTimeout(timer); el.classList.remove('is-down'); holdEnd(false); }
    });
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) { clickSound(); tapSeek(dir); } }
    });
  }

  /* ───────── 테이프 넣기 / 꺼내기 ───────── */
  function tracksOf(tape) {
    return (tape.tracks || []).map(function (t) {
      return { id: t.id, name: t.name, dur: t.dur, size: t.size || 0, blob: t.blob || null };
    });
  }

  function insertTape(tape, opts) {
    opts = opts || {};
    var animate = opts.animate !== false && !S.off;

    if (S.tape && S.tape.id === tape.id && !opts.force) {
      renderNow(); renderShelf();
      if (opts.autoplay && S.i >= 0) play();
      return Promise.resolve();
    }

    stopAudio();
    releaseUrl();
    S.tape = tape;
    S.tracks = tracksOf(tape);
    S.i = -1;
    S.insertTimer.forEach(clearTimeout);
    S.insertTimer = [];

    applyLabel(tape);
    elTitle.textContent = S.tracks.length ? '테이프를 거는 중...' : (tape.name + ' · 빈 테이프');
    resetTimeUI();
    lastId(tape.id);
    renderNow(); renderShelf();

    if (!animate) {
      tapeEl.classList.remove('is-ghost', 'tape--out');
      osd('');
      ferry(opts);
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      osd('LOADING TAPE...');
      tapeEl.classList.remove('tape--out');
      tapeEl.classList.add('is-ghost');

      sndLoad();
      S.insertTimer.push(setTimeout(function () { flap(true); }, 120));
      S.insertTimer.push(setTimeout(function () {
        tapeEl.classList.remove('is-ghost');
        tapeEl.classList.remove('tape--in');
        void tapeEl.offsetWidth;
        tapeEl.classList.add('tape--in');
      }, 300));
      S.insertTimer.push(setTimeout(function () {
        flap(false);
        osd('');
        S.insertTimer.push(setTimeout(function () { tapeEl.classList.remove('tape--in'); }, 640));
        ferry(opts);
        resolve();
      }, 940));
    });
  }

  function ferry(opts) {
    if (S.tracks.length) setTrack(0, opts && opts.autoplay !== false);
    else {
      elTitle.textContent = S.tape.name + ' · 빈 테이프';
      hint('빈 테이프입니다 · 곡 넣기로 음원을 담으세요', 4000);
    }
  }

  function ejectTape(opts) {
    opts = opts || {};
    if (!S.tape) return Promise.resolve();

    var animate = opts.animate !== false && !S.off;
    S.insertTimer.forEach(clearTimeout);
    S.insertTimer = [];
    stopAudio();
    releaseUrl();

    S.tape = null;
    S.tracks = [];
    S.i = -1;
    lastId(null);
    resetTimeUI();
    renderNow(); renderShelf();

    if (!animate) {
      tapeEl.classList.remove('tape--in', 'tape--out');
      tapeEl.classList.add('is-ghost');
      applyLabel(null);
      elTitle.textContent = 'NO TAPE - 테이프를 넣으세요';
      return Promise.resolve();
    }

    return new Promise(function (resolve) {
      osd('EJECT');
      tapeEl.classList.remove('tape--in');
      tapeEl.classList.add('tape--out');
      sndEject();
      setTimeout(function () { flap(true); }, 60);
      setTimeout(function () {
        tapeEl.classList.remove('tape--out');
        tapeEl.classList.add('is-ghost');
        applyLabel(null);
        elTitle.textContent = 'NO TAPE - 테이프를 넣으세요';
        flap(false);
        osd('');
        hint('테이프를 꺼냈습니다 · SEL로 테이프 함', 3500);
        resolve();
      }, 520);
    });
  }

  /* ───────── 테이프 함 화면 ───────── */
  function totalDur(tape) {
    return (tape.tracks || []).reduce(function (a, t) { return a + (isFinite(t.dur) ? t.dur : 0); }, 0);
  }

  function totalSize(tape) {
    return (tape.tracks || []).reduce(function (a, t) { return a + (t.size || (t.blob && t.blob.size) || 0); }, 0);
  }

  function tapeMeta(tape) {
    var n = (tape.tracks || []).length;
    if (!n) return '빈 테이프 · 곡을 담아 보세요';
    var d = totalDur(tape);
    return n + '곡' + (d ? ' · ' + fmt(d) : '') + ' · ' + bytes(totalSize(tape));
  }

  function miniEl(styleKeyIn) {
    var st = styleOf(styleKeyIn);
    var s = document.createElement('span');
    s.className = 'mini';
    s.setAttribute('aria-hidden', 'true');
    s.style.setProperty('--m-bg', st.mini);
    return s;
  }

  function renderNow() {
    if (!S.tape) { elNow.hidden = true; elPl.innerHTML = ''; return; }
    elNow.hidden = false;
    elNowName.textContent = S.tape.name;
    elNowSub.textContent = tapeMeta(S.tape);
    elNowMini.innerHTML = '';
    elNowMini.appendChild(miniEl(S.tape.style));
    renderNowTracks();
  }

  function renderNowTracks() {
    if (!S.tape) { elPl.innerHTML = ''; return; }
    elPl.innerHTML = '';
    if (!S.tracks.length) {
      var li = document.createElement('li');
      li.className = 'pl__empty';
      li.textContent = '빈 테이프입니다. ＋ 로 곡을 담으세요.';
      elPl.appendChild(li);
      return;
    }
    S.tracks.forEach(function (t, idx) {
      var item = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'pl__item' + (idx === S.i ? ' is-on' : '');
      b.setAttribute('aria-label', t.name + ' 재생');

      var num = document.createElement('span');
      num.className = 'pl__num';
      num.textContent = pad2(idx + 1);

      var nm = document.createElement('span');
      nm.className = 'pl__name';
      nm.textContent = t.name;

      var du = document.createElement('span');
      du.className = 'pl__dur';
      du.textContent = isFinite(t.dur) ? fmt(t.dur) : '--:--';

      b.appendChild(num); b.appendChild(nm); b.appendChild(du);
      b.addEventListener('click', function () {
        clickSound();
        setTrack(idx, true);
        closeSheets();
      });
      item.appendChild(b);
      elPl.appendChild(item);
    });
  }

  function renderShelf() {
    elShelf.innerHTML = '';
    var others = S.tapes.filter(function (t) { return !S.tape || t.id !== S.tape.id; });
    elTapesCount.textContent = S.tapes.length + '개';

    others.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'tape-row';

      var meta = document.createElement('div');
      meta.className = 'tape-row__meta';
      var nm = document.createElement('b');
      nm.textContent = t.name;
      var sub = document.createElement('span');
      sub.textContent = tapeMeta(t);
      meta.appendChild(nm); meta.appendChild(sub);

      var go = document.createElement('button');
      go.type = 'button';
      go.className = 'tape-row__go';
      if ((t.tracks || []).length) {
        go.textContent = '넣기';
        go.addEventListener('click', function () {
          clickSound();
          insertTape(t, { animate: true, autoplay: true });
        });
      } else {
        go.textContent = '＋ 곡 넣기';
        go.classList.add('is-fill');
        go.addEventListener('click', function () {
          clickSound();
          pickForTape(t);
        });
      }

      var add = document.createElement('button');
      add.type = 'button';
      add.className = 'tape-row__plus';
      add.textContent = '＋';
      add.setAttribute('aria-label', t.name + '에 곡 담기');
      add.addEventListener('click', function () { clickSound(); pickForTape(t); });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'tape-row__del';
      del.textContent = '✕';
      del.setAttribute('aria-label', t.name + ' 테이프 지우기');
      del.addEventListener('click', function () { clickSound(true); armDelete(li, t); });

      li.appendChild(miniEl(t.style));
      li.appendChild(meta);
      if ((t.tracks || []).length) li.appendChild(add);
      li.appendChild(go);
      li.appendChild(del);
      elShelf.appendChild(li);
    });

    var addLi = document.createElement('li');
    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'slot-new';
    var icon = document.createElement('i');
    icon.textContent = '＋';
    var label = document.createElement('span');
    label.textContent = others.length || S.tape ? '새 테이프 만들기 — 이름과 라벨 톤을 정해요' : '첫 테이프 만들기';
    addBtn.appendChild(icon);
    addBtn.appendChild(label);
    addBtn.addEventListener('click', function () { clickSound(); openNew(); });
    addLi.appendChild(addBtn);
    elShelf.appendChild(addLi);

    updateStorageNote();
  }

  function armDelete(li, tape) {
    li.classList.add('is-armed');
    li.innerHTML = '';

    var q = document.createElement('span');
    q.className = 'tape-row__q';
    q.textContent = '\u201C' + clip(tape.name, 10) + '\u201D 지울까요?';

    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'tape-row__yes';
    yes.textContent = '삭제';
    yes.addEventListener('click', function () { removeTape(tape.id); });

    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'tape-row__no';
    no.textContent = '취소';
    no.addEventListener('click', function () { renderShelf(); });

    li.appendChild(q);
    li.appendChild(yes);
    li.appendChild(no);
    yes.focus({ preventScroll: true });
  }

  function updateStorageNote() {
    var used = S.tapes.reduce(function (a, t) { return a + totalSize(t); }, 0);
    var txt = '테이프는 이 기기 브라우저에만 저장됩니다';
    if (used) txt += ' · ' + bytes(used) + ' 사용';
    if (!S.idbOk) txt += ' · 이 브라우저에서는 보관할 수 없습니다(시크릿 모드)';
    elStorageNote.textContent = txt;

    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (q) {
        if (q && q.quota) {
          elStorageNote.textContent = txt + ' · 남은 공간 약 ' + bytes(Math.max(0, q.quota - q.usage));
        }
      }).catch(function () {});
    }
  }

  function removeTape(id) {
    var wasCurrent = S.tape && S.tape.id === id;
    S.tapes = S.tapes.filter(function (t) { return t.id !== id; });
    tapeDel(id).catch(function () { S.idbOk = false; });
    blobsDelTape(id);
    if (wasCurrent) ejectTape({ animate: false });
    renderShelf();
    hint('테이프를 지웠습니다', 2500);
  }

  /* ───────── 음원 담기 (한 파일씩 저장 + 진행률) ───────── */
  var AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|wma|weba|webm|mp4|aif|aiff|mid|midi)$/i;

  function isAudio(f) {
    return (f.type && /^(audio|video)\//.test(f.type)) || AUDIO_EXT.test(f.name || '');
  }

  function probeBlob(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var a = new Audio();
      var done = false;
      function fin(d) {
        if (done) return;
        done = true;
        try { a.removeAttribute('src'); } catch (e) {}
        URL.revokeObjectURL(url);
        resolve(d);
      }
      a.preload = 'metadata';
      a.addEventListener('loadedmetadata', function () { fin(isFinite(a.duration) ? a.duration : NaN); });
      a.addEventListener('error', function () { fin(NaN); });
      setTimeout(function () { fin(NaN); }, 6000);
      a.src = url;
    });
  }

  function addFilesToTape(tape, files) {
    var list = Array.prototype.slice.call(files).filter(isAudio);
    if (!list.length) { hint('음원 파일이 아닙니다', 2800); return Promise.resolve(0); }

    var done = 0, added = 0;
    saveStart(list.length, '저장 중...');

    function step(i) {
      if (i >= list.length) {
        saveEnd();
        return Promise.resolve(added);
      }
      var f = list[i];
      var nm = cleanName(f.name);
      var dup = (tape.tracks || []).some(function (t) {
        return t.name === nm && (t.size || 0) === (f.size || 0);
      });
      if (dup) { done++; saveSet(done, list.length, '저장 중...'); return step(i + 1); }

      var id = uid();
      return blobPut(blobKey(tape.id, id), f).then(function () {
        return probeBlob(f);
      }).then(function (dur) {
        tape.tracks = tape.tracks || [];
        tape.tracks.push({ id: id, name: nm, dur: dur, size: f.size || 0 });
        added++;
        done++;
        saveSet(done, list.length, '저장 중...');
        return tapePut(tape);
      }).then(function () {
        return tick();
      }).then(function () {
        return step(i + 1);
      }).catch(function (err) {
        saveEnd();
        var quota = err && (err.name === 'QuotaExceededError' || /quota/i.test(String(err.name || err.message)));
        hint(quota ? '저장 공간이 부족합니다 · 오래된 테이프를 지워 주세요' : '저장 중 문제가 생겼습니다', 6000);
        throw err;
      });
    }

    return step(0);
  }

  function pickForTape(tape) {
    S.fileTarget = 'tape';
    S.targetTape = tape;
    fileInput.value = '';
    fileInput.click();
  }

  function takeFilesForTape(tape, files) {
    return addFilesToTape(tape, files).then(function (added) {
      if (!added) { hint('담은 곡이 없습니다', 2500); return; }
      renderShelf();
      if (S.tape && S.tape.id === tape.id) {
        syncCurrentTape();
        if (S.i < 0) setTrack(0, true);
      } else {
        renderShelf();
        closeSheets();
        insertTape(tape, { animate: true, autoplay: true });
        hint('"' + clip(tape.name, 12) + '" 테이프에 ' + added + '곡을 담았습니다', 4000);
      }
    }).catch(function () {});
  }

  function syncCurrentTape() {
    var cur = S.tracks[S.i];
    S.tracks = tracksOf(S.tape);
    if (cur) {
      for (var k = 0; k < S.tracks.length; k++) {
        if (S.tracks[k].id === cur.id) { S.i = k; break; }
      }
    }
    renderNow();
  }

  /* ───────── 새 테이프 만들기 ───────── */
  function openNew(files) {
    S.pending = files ? Array.prototype.slice.call(files).filter(isAudio) : [];
    elNewName.value = '';
    S.newStyle = styleKey(S.newStyle);
    paintStyles();
    renderPending();
    openSheet('new');
  }

  function paintStyles() {
    $$('.swatch', elNewStyles).forEach(function (b) {
      b.setAttribute('aria-checked', String(b.dataset.style === S.newStyle));
    });
  }

  function renderPending() {
    elNewList.innerHTML = '';
    var size = 0;
    S.pending.forEach(function (f, idx) {
      size += f.size || 0;
      var li = document.createElement('li');
      li.className = 'pend';

      var num = document.createElement('span');
      num.className = 'pl__num';
      num.textContent = pad2(idx + 1);

      var nm = document.createElement('span');
      nm.className = 'pl__name';
      nm.textContent = cleanName(f.name);

      var sz = document.createElement('span');
      sz.className = 'pl__dur';
      sz.textContent = bytes(f.size || 0);

      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'pend__x';
      x.textContent = '✕';
      x.setAttribute('aria-label', cleanName(f.name) + ' 빼기');
      x.addEventListener('click', function () {
        S.pending.splice(idx, 1);
        renderPending();
      });

      li.appendChild(num); li.appendChild(nm); li.appendChild(sz); li.appendChild(x);
      elNewList.appendChild(li);
    });

    elNewCount.textContent = S.pending.length + '곡';
    elNewSize.textContent = size ? '· ' + bytes(size) : '';
    elNewSave.disabled = !(S.pending.length && elNewName.value.trim());
    elNewSave.textContent = S.pending.length ? '테이프 만들기 (' + S.pending.length + '곡)' : '테이프 만들기';
  }

  function saveNewTape() {
    if (S.busy) return;
    var name = elNewName.value.trim() || '새 테이프';
    var files = S.pending.slice();
    if (!files.length) return;

    var tape = {
      id: uid(),
      name: name,
      style: styleKey(S.newStyle),
      createdAt: Date.now(),
      tracks: []
    };

    S.busy = true;
    elNewSave.disabled = true;
    elNewSave.textContent = '저장 준비...';

    tapePut(tape).then(function () {
      S.tapes.unshift(tape);
      return addFilesToTape(tape, files);
    }).then(function (added) {
      S.busy = false;
      S.pending = [];
      try { localStorage.setItem('opirus.style', S.newStyle); } catch (e) {}
      closeSheets();
      insertTape(tape, { animate: true, autoplay: true });
      hint('"' + clip(name, 14) + '" 테이프를 만들었습니다 · ' + added + '곡', 4000);
    }).catch(function () {
      S.busy = false;
      renderShelf();
      elNewSave.disabled = false;
      elNewSave.textContent = '테이프 만들기';
    });
  }

  /* ───────── 기본 테이프 3개 ───────── */
  function seedDefaults() {
    var seeded = null;
    try { seeded = localStorage.getItem('opirus.seeded'); } catch (e) {}
    if (seeded === '1') return Promise.resolve();

    var base = Date.now();
    var chain = Promise.resolve();
    DEFAULTS.forEach(function (d, i) {
      chain = chain.then(function () {
        var t = { id: uid(), name: d.name, style: d.style, createdAt: base - i, tracks: [] };
        S.tapes.push(t);
        return tapePut(t).catch(function () { S.idbOk = false; });
      });
    });
    return chain.then(function () {
      try { localStorage.setItem('opirus.seeded', '1'); } catch (e) {}
    });
  }

  /* ───────── 시트 ───────── */
  var sheets = { tapes: sheetTapes, new: sheetNew, info: sheetInfo };

  function openSheet(name) {
    closeSheets();
    if (!sheets[name]) return;
    if (name === 'tapes') { renderNow(); renderShelf(); }
    if (name === 'new') { paintStyles(); renderPending(); }
    sheets[name].hidden = false;
    var f = sheets[name].querySelector('.sheet__close');
    if (f) f.focus({ preventScroll: true });
  }

  function closeSheets() {
    Object.keys(sheets).forEach(function (k) { sheets[k].hidden = true; });
  }

  /* ───────── 부팅 화면 ───────── */
  var bootEl = $('#boot');
  var bootTimer = 0;

  function startBoot(ms) {
    clearTimeout(bootTimer);
    monitor.classList.add('is-booting');
    bootTimer = setTimeout(endBoot, ms || 1500);
  }

  function endBoot() {
    clearTimeout(bootTimer);
    monitor.classList.remove('is-booting');
  }

  /* ───────── 전원 ───────── */
  function powerOn() {
    S.off = false;
    monitor.classList.remove('is-off');
    startBoot(1500);
  }

  function powerOff() {
    S.off = true;
    closeSheets();
    audio.pause();
    monitor.classList.add('is-off');
  }

  function togglePower() { if (S.off) powerOn(); else powerOff(); }

  /* ───────── 잠금화면 · 차량 리모컨 ───────── */
  function mediaMeta(t) {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    var base = location.href.replace(/[^/]*$/, '');
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.name,
        artist: '오피러스 카세트' + (S.tape ? ' · ' + S.tape.name : ''),
        album: 'TAPE · v1.1',
        artwork: [
          { src: base + 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: base + 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      });
    } catch (e) {}
  }

  function mediaHandlers() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setActionHandler) return;
    var ms = navigator.mediaSession;
    function set(a, fn) { try { ms.setActionHandler(a, fn); } catch (e) {} }
    set('play', function () { play(); });
    set('pause', function () { audio.pause(); });
    set('stop', function () { audio.pause(); audio.currentTime = 0; });
    set('previoustrack', function () { prev(); });
    set('nexttrack', function () { next(); });
    set('seekbackward', function (d) { tapSeek(-((d && d.seekOffset) || 10) / 10); });
    set('seekforward', function (d) { tapSeek(((d && d.seekOffset) || 10) / 10); });
    set('seekto', function (d) {
      if (d && isFinite(d.seekTime)) { audio.currentTime = d.seekTime; updateTime(); }
    });
  }

  /* ───────── 오디오 이벤트 ───────── */
  audio.addEventListener('play', function () { S.playing = true; paintPlaying(); startLoop(); });
  audio.addEventListener('pause', function () { S.playing = false; paintPlaying(); stopLoop(); updateTime(); });
  audio.addEventListener('timeupdate', updateTime);

  audio.addEventListener('loadedmetadata', function () {
    var t = S.tracks[S.i];
    if (t && !isFinite(t.dur) && isFinite(audio.duration)) {
      t.dur = audio.duration;
      if (S.tape) {
        var src = S.tape.tracks[S.i];
        if (src) { src.dur = audio.duration; tapePut(S.tape).catch(function () {}); }
        renderNowTracks();
      }
    }
    updateTime();
  });

  audio.addEventListener('ended', function () {
    if (S.tracks.length > 1) next();
    else { audio.currentTime = 0; audio.pause(); updateTime(); }
  });

  audio.addEventListener('error', function () {
    if (!audio.currentSrc) return;
    hint('이 파일은 재생할 수 없습니다', 4000);
    S.playing = false;
    paintPlaying();
  });

  /* ───────── 조작 연결 ───────── */
  elPlay.addEventListener('click', function () { clickSound(); togglePlay(); });
  holdButton($('#key-back'), -1);
  holdButton($('#key-fwd'), 1);

  function pickFiles(target) {
    S.fileTarget = target;
    clickSound();
    fileInput.value = '';
    fileInput.click();
  }

  $('#key-shelf').addEventListener('click', function () { clickSound(); openSheet('tapes'); });
  $('#now-add').addEventListener('click', function () {
    if (S.tape) pickForTape(S.tape);
  });
  $('#new-pick').addEventListener('click', function () { pickFiles('new'); });

  fileInput.addEventListener('change', function () {
    var files = Array.prototype.slice.call(fileInput.files || []);
    if (!files.length) return;
    if (S.fileTarget === 'tape' && S.targetTape) {
      takeFilesForTape(S.targetTape, files);
      return;
    }
    if (!sheetNew.hidden) {
      S.pending = S.pending.concat(files.filter(isAudio));
      renderPending();
      return;
    }
    openNew(files);
  });

  $('#btn-sel').addEventListener('click', function () { clickSound(); openSheet('tapes'); });
  $('#btn-info').addEventListener('click', function () { clickSound(); openSheet('info'); });
  $('#btn-prev').addEventListener('click', function () { clickSound(); prev(); });
  $('#btn-next').addEventListener('click', function () { clickSound(); next(); });
  $('#btn-pwr').addEventListener('click', function () { clickSound(); togglePower(); });

  $('#btn-eject').addEventListener('click', function () {
    clickSound();
    if (S.tape) ejectTape({ animate: true });
    else openSheet('tapes');
  });

  srcTape.addEventListener('click', function () { clickSound(); openSheet('tapes'); });

  $('#now-eject').addEventListener('click', function () {
    clickSound();
    ejectTape({ animate: true });
    closeSheets();
  });

  $('#tapes-new').addEventListener('click', function () { clickSound(); openNew(); });
  $('#new-save').addEventListener('click', function () { clickSound(); saveNewTape(); });
  elNewName.addEventListener('input', function () { renderPending(); });

  elNewStyles.addEventListener('click', function (e) {
    var b = e.target.closest('.swatch');
    if (!b) return;
    clickSound(true);
    S.newStyle = b.dataset.style;
    paintStyles();
  });

  Object.keys(sheets).forEach(function (k) {
    sheets[k].addEventListener('click', function (e) {
      if (e.target === sheets[k]) closeSheets();
    });
    $$('[data-close]', sheets[k]).forEach(function (b) {
      b.addEventListener('click', function () { closeSheets(); });
    });
  });

  elSeek.addEventListener('pointerdown', function () { S.dragging = true; });
  window.addEventListener('pointerup', function () { S.dragging = false; });
  elSeek.addEventListener('input', function () {
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    cancelWind();
    var p = elSeek.value / 1000;
    S.dragging = true;
    audio.currentTime = p * d;
    elCur.textContent = fmt(p * d);
    elFill.style.width = (p * 100).toFixed(2) + '%';
    paintTape(p);
  });
  elSeek.addEventListener('change', function () { S.dragging = false; updateTime(); });

  var sw = $('#sw-click');
  sw.setAttribute('aria-checked', String(S.click));
  sw.addEventListener('click', function () {
    S.click = !S.click;
    sw.setAttribute('aria-checked', String(S.click));
    try { localStorage.setItem('opirus.click', S.click ? '1' : '0'); } catch (e) {}
    if (S.click) clickSound();
    else sndWind(false);
  });

  /* 화면이 돌아오면 음악 EQ 컨텍스트도 깨워 둔다 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && W.hold) { holdEnd(false); return; }
    if (document.visibilityState === 'visible' && mg && mg.ctx.state === 'suspended') {
      try { mg.ctx.resume(); } catch (e) {}
    }
  });

  document.addEventListener('keydown', function (e) {
    if (monitor.classList.contains('is-booting')) { e.preventDefault(); endBoot(); return; }
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') closeSheets();
      return;
    }
    if (e.key === 'Escape') { closeSheets(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case ' ': case 'Spacebar': e.preventDefault(); clickSound(); togglePlay(); break;
      case 'ArrowLeft': e.preventDefault(); clickSound(); tapSeek(-1); break;
      case 'ArrowRight': e.preventDefault(); clickSound(); tapSeek(1); break;
      case 'ArrowUp': e.preventDefault(); clickSound(); prev(); break;
      case 'ArrowDown': e.preventDefault(); clickSound(); next(); break;
      case 'l': case 'L':
        if (S.tape) pickForTape(S.tape); else pickFiles('new');
        break;
      case 's': case 'S': openSheet('tapes'); break;
      case 'n': case 'N': openNew(); break;
      case 'e': case 'E': if (S.tape) ejectTape({ animate: true }); else openSheet('tapes'); break;
      case 'i': case 'I': openSheet('info'); break;
      case 'p': case 'P': clickSound(); togglePower(); break;
    }
  });

  /* 설치 */
  var btnInstall = $('#btn-install');
  var deferredPrompt = null;
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (!standalone) btnInstall.hidden = false;
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    btnInstall.hidden = true;
  });
  btnInstall.addEventListener('click', function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function () {
        deferredPrompt = null;
        btnInstall.hidden = true;
      });
    } else openSheet('info');
  });
  if (!standalone && isIOS) btnInstall.hidden = false;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  /* ───────── 첫 화면 ───────── */
  tickClock();
  setInterval(tickClock, 1000);
  paintTape(0);
  paintPlaying();
  applyLabel(null);
  renderNow();
  renderShelf();
  mediaHandlers();
  updateTime();

  (function stars() {
    var g = document.getElementById('boot-stars');
    if (!g) return;
    var NS = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 84; i++) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', (Math.random() * 400).toFixed(1));
      c.setAttribute('cy', (Math.random() * 300).toFixed(1));
      c.setAttribute('r', (Math.random() < .84 ? .45 + Math.random() * .7 : 1.05 + Math.random()).toFixed(2));
      c.setAttribute('fill', '#ffffff');
      if (Math.random() < .42) {
        c.setAttribute('class', 'st');
        c.style.animationDelay = (Math.random() * 4).toFixed(2) + 's';
        c.style.animationDuration = (2.6 + Math.random() * 3.2).toFixed(2) + 's';
      } else {
        c.setAttribute('opacity', (.16 + Math.random() * .5).toFixed(2));
      }
      g.appendChild(c);
    }
  })();

  bootEl.addEventListener('pointerdown', function (e) { e.stopPropagation(); endBoot(); });
  startBoot(1500);

  loadTapeList().then(function (all) {
    S.tapes = all.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    return seedDefaults();
  }).then(function () {
    S.tapes.sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
    renderShelf();

    var id = lastId();
    var t = null;
    if (id) t = S.tapes.filter(function (x) { return x.id === id; })[0];
    if (t) insertTape(t, { animate: false, autoplay: false });
    else hint(HINT_HOME);
  }).catch(function () {
    renderShelf();
  });
})();
