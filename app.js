'use strict';

/* ======================= 元素 ======================= */
const $ = (id) => document.getElementById(id);
const els = {
  form: $('searchForm'), input: $('searchInput'), mic: $('micBtn'), lang: $('voiceLang'),
  status: $('status'), results: $('results'),
  title: $('songTitle'), artist: $('songArtist'), lyrics: $('lyrics'),
  play: $('playBtn'), seek: $('seek'), cur: $('curTime'), dur: $('durTime'),
  fontDown: $('fontDown'), fontUp: $('fontUp'), fontRange: $('fontRange'),
  offDown: $('offDown'), offUp: $('offUp'), offVal: $('offVal'),
};

const LRCLIB = 'https://lrclib.net/api';

/* ======================= 狀態 ======================= */
const state = {
  lines: [],          // [{ time, text, el }]
  synced: false,
  activeIndex: -1,
  offset: 0,          // 秒；正數 = 歌詞提早出現
  userScrollUntil: 0, // 使用者手動捲動後，暫停自動捲動
  song: null,
};

/* ======================= 小工具 ======================= */
const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 忽略 */ } },
};
const setStatus = (msg) => { els.status.textContent = msg; };

/* ======================= 播放計時器 =======================
 * 不播放音樂，只用計時器讓歌詞依時間軸滾動。
 */
const player = {
  playing: false,
  base: 0,       // 暫停時的時間點（秒）
  startedAt: 0,  // 開始播放時的 performance.now()
  duration: 0,

  get time() {
    return this.playing ? this.base + (performance.now() - this.startedAt) / 1000 : this.base;
  },
  play() {
    if (this.duration && this.base >= this.duration) this.base = 0;
    this.startedAt = performance.now();
    this.playing = true;
    updatePlayBtn();
  },
  pause() {
    this.base = this.time;
    this.playing = false;
    updatePlayBtn();
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  seek(t) {
    this.base = Math.max(0, Math.min(t, this.duration || t));
    this.startedAt = performance.now();
    state.userScrollUntil = 0; // 跳轉後立刻恢復自動捲動
    tick(true);
  },
};

function updatePlayBtn() { els.play.textContent = player.playing ? '❚❚' : '▶'; }
function enableControls() {
  const ok = state.lines.length > 0;
  els.play.disabled = !ok;
  els.seek.disabled = !ok;
}

/* ======================= 歌詞解析 ======================= */
function parseLRC(text) {
  const out = [];
  let offset = 0;
  const lineRe = /^((?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;
  const tagRe = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) { offset = Number(off[1]) / 1000; continue; }
    const m = raw.match(lineRe);
    if (!m) continue;
    const txt = m[2].trim();
    let t;
    tagRe.lastIndex = 0;
    while ((t = tagRe.exec(m[1]))) {
      const sec = Number(t[1]) * 60 + Number(t[2].replace(':', '.'));
      out.push({ time: Math.max(0, sec - offset), text: txt });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

// 沒有時間軸的純文字歌詞：平均分配到整首歌的長度
function plainToLines(text, duration) {
  const rows = text.split(/\r?\n/).map((s) => s.trim());
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  while (rows.length && !rows[0]) rows.shift();
  const total = duration > 0 ? duration : rows.length * 4;
  const step = total / Math.max(rows.length, 1);
  return rows.map((txt, i) => ({ time: i * step, text: txt }));
}

/* ======================= 歌詞顯示 ======================= */
function renderLyrics() {
  const box = els.lyrics;
  box.innerHTML = '';
  state.activeIndex = -1;

  if (!state.lines.length) {
    box.innerHTML = '<div class="placeholder">這首歌沒有歌詞資料（可能是純音樂）。</div>';
    return;
  }
  if (!state.synced) {
    const n = document.createElement('div');
    n.className = 'notice';
    n.textContent = '⚠ 這首歌只有純文字歌詞，滾動時間是依歌曲長度平均估算的。';
    box.appendChild(n);
  }

  const frag = document.createDocumentFragment();
  state.lines.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'line' + (line.text ? '' : ' empty');
    el.textContent = line.text || '♪';
    el.dataset.index = i;
    el.title = '從 ' + fmt(line.time) + ' 開始播放';
    line.el = el;
    frag.appendChild(el);
  });
  box.appendChild(frag);
  box.scrollTop = 0;
}

// 點任何一行歌詞 → 跳到那一段播放
els.lyrics.addEventListener('click', (e) => {
  const el = e.target.closest('.line');
  if (!el) return;
  const line = state.lines[Number(el.dataset.index)];
  if (!line) return;
  player.seek(line.time - state.offset + 0.01);
  if (!player.playing) player.play();
});

// 使用者自己捲動歌詞時，暫停自動捲動 3 秒
['wheel', 'touchmove'].forEach((ev) =>
  els.lyrics.addEventListener(ev, () => { state.userScrollUntil = performance.now() + 3000; }, { passive: true })
);

function findActiveIndex(t) {
  const L = state.lines;
  let lo = 0, hi = L.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (L[mid].time <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

function scrollToLine(el) {
  const box = els.lyrics;
  box.scrollTo({ top: el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' });
}

function setActive(idx, force) {
  if (idx === state.activeIndex && !force) return;
  const prev = state.lines[state.activeIndex];
  if (prev && prev.el) prev.el.classList.remove('active');
  state.lines.forEach((l, i) => l.el && l.el.classList.toggle('past', i < idx));
  state.activeIndex = idx;
  const cur = state.lines[idx];
  const canScroll = performance.now() > state.userScrollUntil;
  if (cur && cur.el) {
    cur.el.classList.add('active');
    if (canScroll) scrollToLine(cur.el);
  } else if (idx < 0 && canScroll) {
    els.lyrics.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* ======================= 主迴圈 ======================= */
let seeking = false;
function tick(force) {
  const t = player.time;
  const dur = player.duration;

  // 播到結尾自動停止
  if (player.playing && dur && t >= dur) { player.pause(); player.base = dur; }

  if (!seeking) {
    els.seek.max = dur || 0;
    els.seek.value = Math.min(t, dur || t);
  }
  els.cur.textContent = fmt(t);
  els.dur.textContent = fmt(dur);

  if (state.lines.length) setActive(findActiveIndex(t + state.offset), force === true);
}
(function loop() { tick(); requestAnimationFrame(loop); })();

/* ======================= 播放控制 ======================= */
els.play.addEventListener('click', () => player.toggle());
els.seek.addEventListener('input', () => { seeking = true; els.cur.textContent = fmt(Number(els.seek.value)); });
els.seek.addEventListener('change', () => { seeking = false; player.seek(Number(els.seek.value)); });

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') return;
  if (els.play.disabled) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  else if (e.code === 'ArrowRight') player.seek(player.time + 5);
  else if (e.code === 'ArrowLeft') player.seek(player.time - 5);
});

/* ======================= 歌詞時間微調 ======================= */
function setOffset(v) {
  state.offset = Math.round(v * 10) / 10;
  els.offVal.textContent = (state.offset > 0 ? '+' : '') + state.offset.toFixed(1) + 's';
  tick(true);
}
els.offUp.addEventListener('click', () => setOffset(state.offset + 0.5));
els.offDown.addEventListener('click', () => setOffset(state.offset - 0.5));

/* ======================= 字體大小 ======================= */
function setFont(px) {
  px = Math.max(14, Math.min(64, Math.round(px)));
  document.documentElement.style.setProperty('--lyric-size', px + 'px');
  els.fontRange.value = px;
  store.set('lyricSize', px);
  const cur = state.lines[state.activeIndex];
  if (cur && cur.el) requestAnimationFrame(() => scrollToLine(cur.el));
}
els.fontUp.addEventListener('click', () => setFont(Number(els.fontRange.value) + 2));
els.fontDown.addEventListener('click', () => setFont(Number(els.fontRange.value) - 2));
els.fontRange.addEventListener('input', () => setFont(Number(els.fontRange.value)));
// Ctrl + 滾輪 也能縮放歌詞
els.lyrics.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setFont(Number(els.fontRange.value) + (e.deltaY < 0 ? 2 : -2));
}, { passive: false });
setFont(store.get('lyricSize', 26));

/* ======================= 簡體 → 正體 =======================
 * 歌詞是簡體中文時，轉成正體中文（台灣字形）顯示；其他語言不更動。
 * 使用 opencc-js（從 jsDelivr 載入），載入失敗就顯示原文。
 */
const OPENCC_URL = 'https://cdn.jsdelivr.net/npm/opencc-js@1.4.2/dist/umd/cn2t.js';
let s2tPromise = null;

function loadS2T() {
  if (!s2tPromise) {
    s2tPromise = new Promise((resolve) => {
      const sc = document.createElement('script');
      sc.src = OPENCC_URL;
      sc.async = true;
      sc.onload = () => {
        try { resolve(window.OpenCC.Converter({ from: 'cn', to: 'tw' })); } catch { resolve(null); }
      };
      sc.onerror = () => { s2tPromise = null; resolve(null); }; // 下次搜尋再試
      document.head.appendChild(sc);
    });
  }
  return s2tPromise;
}

// 最多等 4 秒，等不到就先顯示原文
function getS2T() {
  return Promise.race([loadS2T(), new Promise((r) => setTimeout(() => r(null), 4000))]);
}

const HAN_RE = /\p{Script=Han}/u;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u; // 有假名 = 日文

// 中文歌（有漢字、沒有日文假名）才轉換；英文、韓文、日文等原樣保留
function toTraditionalSong(r, conv) {
  if (!conv) return r;
  const all = [r.trackName, r.artistName, r.albumName, r.syncedLyrics, r.plainLyrics].filter(Boolean).join('\n');
  if (!HAN_RE.test(all) || KANA_RE.test(all)) return r;
  const out = { ...r };
  for (const k of ['trackName', 'artistName', 'albumName', 'syncedLyrics', 'plainLyrics']) {
    if (typeof out[k] === 'string' && HAN_RE.test(out[k])) out[k] = conv(out[k]);
  }
  return out;
}

loadS2T(); // 開啟頁面時先在背景載入

/* ======================= 搜尋 ======================= */
let searchCtrl = null;

// 連線路線：先直接連 LRCLIB；被網路或瀏覽器擋住時，改走公開的中繼服務
const ROUTES = [
  { name: '直接連線', wrap: (u) => u },
  { name: '中繼 1', wrap: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) },
  { name: '中繼 2', wrap: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u) },
  { name: '中繼 3', wrap: (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u) },
];
let routeIndex = Number(store.get('routeIndex', 0)) || 0; // 記住上次成功的路線

async function fetchJSON(url, outerSignal) {
  const order = [routeIndex, ...ROUTES.keys()].filter((v, i, a) => a.indexOf(v) === i && ROUTES[v]);
  const errors = [];
  for (const i of order) {
    if (outerSignal.aborted) throw new DOMException('aborted', 'AbortError');
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    outerSignal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      if (i !== 0) setStatus(`改用${ROUTES[i].name}搜尋中…`);
      const res = await fetch(ROUTES[i].wrap(url), { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('回應格式不正確');
      routeIndex = i;
      store.set('routeIndex', i);
      return data;
    } catch (err) {
      if (outerSignal.aborted) throw new DOMException('aborted', 'AbortError');
      errors.push(`${ROUTES[i].name}：${err.name === 'AbortError' ? '逾時' : err.message}`);
    } finally {
      clearTimeout(timer);
      outerSignal.removeEventListener('abort', onAbort);
    }
  }
  throw new Error(errors.join('；'));
}

async function search(q) {
  q = q.trim();
  if (!q) { setStatus('請輸入要搜尋的內容。'); return; }
  if (searchCtrl) searchCtrl.abort();
  searchCtrl = new AbortController();
  setStatus(`正在搜尋「${q}」…`);
  els.results.innerHTML = '';

  try {
    const signal = searchCtrl.signal;
    let list = await fetchJSON(`${LRCLIB}/search?q=${encodeURIComponent(q)}`, signal);
    const conv = await getS2T();
    if (signal.aborted) return;
    list = list.map((r) => toTraditionalSong(r, conv));
    // 有時間軸（可滾動）的歌詞排前面
    list = list
      .filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental)
      .sort((a, b) => (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0))
      .slice(0, 40);
    renderResults(list);
    setStatus(list.length ? `找到 ${list.length} 首，點一首就會開始播放歌詞。` : `找不到「${q}」的歌詞，換個關鍵字試試看。`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus('搜尋失敗，所有連線方式都連不上歌詞網站。可能是公司網路或瀏覽器外掛（例如廣告封鎖）擋住了，請換個網路（例如手機 4G/5G）或關掉外掛再試。詳細：' + err.message);
  }
}

function renderResults(list) {
  els.results.innerHTML = '';
  list.forEach((r) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'r-title';
    title.textContent = r.trackName || '（未知歌名）';
    const meta = document.createElement('div');
    meta.className = 'r-meta';
    const who = document.createElement('span');
    who.textContent = [r.artistName, r.albumName].filter(Boolean).join(' · ');
    const dur = document.createElement('span');
    dur.textContent = r.duration ? fmt(r.duration) : '';
    const badge = document.createElement('span');
    badge.className = 'badge' + (r.syncedLyrics ? ' synced' : '');
    badge.textContent = r.syncedLyrics ? '滾動歌詞' : r.instrumental ? '純音樂' : '純文字';
    meta.append(who, dur, badge);
    li.append(title, meta);
    li.addEventListener('click', () => {
      els.results.querySelectorAll('li.active').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      loadSong(r);
    });
    els.results.appendChild(li);
  });
}

function loadSong(r) {
  state.song = r;
  els.title.textContent = r.trackName || '';
  els.artist.textContent = [r.artistName, r.albumName].filter(Boolean).join(' · ');

  if (r.syncedLyrics) {
    state.lines = parseLRC(r.syncedLyrics);
    state.synced = true;
  } else if (r.plainLyrics) {
    state.lines = plainToLines(r.plainLyrics, r.duration);
    state.synced = false;
  } else {
    state.lines = [];
    state.synced = false;
  }

  const lastT = state.lines.length ? state.lines[state.lines.length - 1].time : 0;
  player.duration = Math.max(r.duration || 0, lastT + 5);
  player.pause();
  player.base = 0;

  renderLyrics();
  enableControls();
  tick(true);

  // 選好歌就直接從頭開始播放、歌詞開始滾動
  if (state.lines.length) { player.seek(0); player.play(); }
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(els.input.value);
});

/* ======================= 語音輸入 ======================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
let listening = false;

els.lang.value = store.get('voiceLang', 'zh-TW');
els.lang.addEventListener('change', () => store.set('voiceLang', els.lang.value));

if (!SR) {
  els.mic.title = '這個瀏覽器不支援語音輸入（請使用 Chrome、Edge 或 Safari）';
  els.mic.style.opacity = .4;
}

els.mic.addEventListener('click', () => {
  if (!SR) {
    setStatus('這個瀏覽器不支援語音輸入，請改用 Chrome、Edge 或 Safari。');
    return;
  }
  if (listening) { recog && recog.stop(); return; }

  recog = new SR();
  recog.lang = els.lang.value;
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  recog.continuous = false;

  let finalText = '';
  recog.onstart = () => {
    listening = true;
    els.mic.classList.add('listening');
    setStatus('🎤 請說出歌名、歌手或一句歌詞…');
  };
  recog.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const txt = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += txt; else interim += txt;
    }
    els.input.value = (finalText + interim).trim();
  };
  recog.onerror = (e) => {
    const msg = {
      'not-allowed': '麥克風權限被拒絕，請在瀏覽器允許使用麥克風。',
      'no-speech': '沒有聽到聲音，請再試一次。',
      'audio-capture': '找不到麥克風。',
      'network': '語音辨識需要網路連線。',
    }[e.error] || '語音辨識錯誤：' + e.error;
    setStatus(msg);
  };
  recog.onend = () => {
    listening = false;
    els.mic.classList.remove('listening');
    const q = finalText.trim() || els.input.value.trim();
    if (q) search(q);
  };

  try { recog.start(); } catch (err) { setStatus('無法啟動語音辨識：' + err.message); }
});

/* ======================= 讓第一句／最後一句也能置中 ======================= */
new ResizeObserver(() => {
  els.lyrics.style.setProperty('--lyric-pad', Math.round(els.lyrics.clientHeight / 2) + 'px');
}).observe(els.lyrics);
