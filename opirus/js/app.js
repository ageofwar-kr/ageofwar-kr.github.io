/* 오피러스 카세트 v1.0 — 후석 7inch LCD MONITOR 감성 카세트 플레이어
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
  var STYLES = {
    cream: { label: '크림', bg: '#e0d8c4', ink: '#5a5344', line: 'rgba(96,86,66,.45)', mini: '#e0d8c4' },
    gold:  { label: '블랙 골드', bg: '#1d1a17', ink: '#d9bb7d', line: 'rgba(170,140,86,.6)', mini: '#2a241d' },
    red:   { label: '레드', bg: '#a8353b', ink: '#f8ead9', line: 'rgba(255,224,204,.42)', mini: '#a8353b' },
    blue:  { label: '블루', bg: '#2f4f7a', ink: '#e4edf9', line: 'rgba(216,231,251,.38)', mini: '#2f4f7a' },
    green: { label: '그린', bg: '#3c6b48', ink: '#e8f2de', line: 'rgba(226,241,216,.38)', mini: '#3c6b48' }
  };

  var DEFAULTS = [
    { name: '클래식 50곡', style: 'gold' },
    { name: '트로트', style: 'red' },
    { name: '긴 뽕짝', style: 'blue' }
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

  /* ───────── 버튼 딸깍 소리 ───────── */
  var ac = null;

  function clickSound(soft) {
    if (!S.click || S.off) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = ac || new AC();
      if (ac.state === 'suspended') ac.resume();
      var t0 = ac.currentTime;
      var n = Math.floor(ac.sampleRate * 0.026);
      var buf = ac.createBuffer(1, n, ac.sampleRate);
      var ch = buf.getChannelData(0);
      for (var i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      var src = ac.createBufferSource();
      src.buffer = buf;
      var bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = soft ? 1700 : 2500;
      bp.Q.value = 1.2;
      var g = ac.createGain();
      g.gain.value = soft ? 0.05 : 0.075;
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(t0);

      var o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(soft ? 150 : 220, t0);
      o.frequency.exponentialRampToValueAtTime(80, t0 + 0.05);
      var g2 = ac.createGain();
      g2.gain.setValueAtTime(soft ? 0.035 : 0.05, t0);
      g2.gain.exponentialRampToValueAtTime(0.0006, t0 + 0.06);
      o.connect(g2).connect(ac.destination);
      o.start(t0);
      o.stop(t0 + 0.07);
    } catch (e) {}
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
    var st = STYLES[(tape && tape.style) || 'cream'] || STYLES.cream;
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

  function tapSeek(dir) {
    if (!S.tracks.length) { openSheet('tapes'); return; }
    var d = audio.duration;
    if (!isFinite(d) || d <= 0) return;
    if (dir < 0 && audio.currentTime <= 2 && S.tracks.length > 1) { prev(); return; }
    audio.currentTime = Math.min(d, Math.max(0, audio.currentTime + dir * 10));
    updateTime();
  }

  function wind(dir, on) {
    clearInterval(S.wind);
    S.wind = 0;
    if (on) {
      if (!S.tracks.length) return;
      monitor.classList.add('is-winding');
      monitor.classList.toggle('is-rew', dir < 0);
      S.wind = setInterval(function () {
        var d = audio.duration;
        if (!isFinite(d) || d <= 0) return;
        audio.currentTime = Math.min(d, Math.max(0, audio.currentTime + dir * 0.9));
        updateTime();
      }, 90);
    } else {
      monitor.classList.remove('is-winding', 'is-rew');
    }
  }

  function holdButton(el, dir) {
    var timer = null, holding = false;

    function down(e) {
      if (e && e.button !== undefined && e.button > 0) return;
      holding = false;
      el.classList.add('is-down');
      clearTimeout(timer);
      timer = setTimeout(function () {
        holding = true;
        wind(dir, true);
        if (navigator.vibrate) { try { navigator.vibrate(6); } catch (err) {} }
      }, 300);
    }

    function up() {
      clearTimeout(timer);
      el.classList.remove('is-down');
      if (holding) { holding = false; wind(dir, false); }
      else { clickSound(); tapSeek(dir); }
    }

    function cancel() {
      clearTimeout(timer);
      el.classList.remove('is-down');
      if (holding) { holding = false; wind(dir, false); }
    }

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickSound(); tapSeek(dir); }
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

      S.insertTimer.push(setTimeout(function () { flap(true); clickSound(true); }, 120));
      S.insertTimer.push(setTimeout(function () {
        tapeEl.classList.remove('is-ghost');
        tapeEl.classList.remove('tape--in');
        void tapeEl.offsetWidth;
        tapeEl.classList.add('tape--in');
      }, 300));
      S.insertTimer.push(setTimeout(function () {
        flap(false);
        clickSound(true);
        S.insertTimer.push(setTimeout(function () { clickSound(); }, 90));
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
      setTimeout(function () { flap(true); clickSound(true); }, 60);
      setTimeout(function () {
        tapeEl.classList.remove('tape--out');
        tapeEl.classList.add('is-ghost');
        applyLabel(null);
        elTitle.textContent = 'NO TAPE - 테이프를 넣으세요';
        flap(false);
        osd('');
        clickSound();
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

  function miniEl(styleKey) {
    var st = STYLES[styleKey] || STYLES.cream;
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
      var armed = 0;
      del.addEventListener('click', function () {
        if (!armed) {
          armed = 1;
          del.classList.add('is-armed');
          del.textContent = '삭제?';
          setTimeout(function () {
            armed = 0; del.classList.remove('is-armed'); del.textContent = '✕';
          }, 6000);
          return;
        }
        removeTape(t.id);
      });

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
    label.textContent = others.length || S.tape ? '새 테이프 만들기 — 이름과 라벨을 정해요' : '첫 테이프 만들기';
    addBtn.appendChild(icon);
    addBtn.appendChild(label);
    addBtn.addEventListener('click', function () { clickSound(); openNew(); });
    addLi.appendChild(addBtn);
    elShelf.appendChild(addLi);

    updateStorageNote();
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
    S.newStyle = STYLES[S.newStyle] ? S.newStyle : 'cream';
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
      style: S.newStyle,
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
        album: 'TAPE · v1.0',
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
