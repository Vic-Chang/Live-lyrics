'use strict';

/* ======================= 元素 ======================= */
const $ = (id) => document.getElementById(id);
const els = {
  form: $('searchForm'), input: $('searchInput'), mic: $('micBtn'),
  voicePanel: $('voicePanel'), voiceTitle: $('voiceTitle'), voiceText: $('voiceText'),
  voiceDone: $('voiceDone'), voiceCancel: $('voiceCancel'),
  langChips: document.querySelectorAll('.voice-langs .chip'),
  status: $('status'), results: $('results'), resultCount: $('resultCount'),
  examples: $('examples'), legend: $('legend'), tip: $('tip'), tipClose: $('tipClose'),
  stage: document.querySelector('.stage'),
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
// type：'' 一般、'loading' 讀取中、'error' 錯誤；detail 是給進階使用者看的細節
function setStatus(msg, type = '', detail = '') {
  els.status.className = 'status' + (type ? ' ' + type : '');
  els.status.textContent = msg;
  if (detail) {
    const d = document.createElement('span');
    d.className = 'detail';
    d.textContent = detail;
    els.status.appendChild(d);
  }
}

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

function updatePlayBtn() {
  els.play.textContent = player.playing ? '❚❚' : '▶';
  els.play.setAttribute('aria-label', player.playing ? '暫停' : '播放');
  els.play.title = (player.playing ? '暫停' : '播放') + '（空白鍵）';
}
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
  els.offVal.textContent = state.offset === 0 ? '準時'
    : `${state.offset > 0 ? '快' : '慢'} ${Math.abs(state.offset).toFixed(1)} 秒`;
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

// 歌詞網站本身故障（伺服器回 5xx）：換中繼也沒用，直接告訴使用者
class OutageError extends Error {
  constructor(status) { super('HTTP ' + status); this.name = 'OutageError'; this.status = status; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// LRCLIB 要求程式表明身分（瀏覽器不能改 User-Agent，所以用 Lrclib-Client 標頭）
const CLIENT_ID = 'LiveLyrics/1.0 (https://github.com/Vic-Chang/Live-lyrics)';
let sendClientHeader = true;
async function fetchDirect(url, signal) {
  if (sendClientHeader) {
    try {
      return await fetch(url, { signal, headers: { 'Lrclib-Client': CLIENT_ID } });
    } catch (err) {
      if (signal.aborted) throw err;
      sendClientHeader = false; // 瀏覽器擋了這個標頭，改用不帶標頭的請求
    }
  }
  return fetch(url, { signal });
}

async function fetchJSON(url, outerSignal) {
  // 一律先試直接連線，再試上次成功的中繼
  const order = [0, routeIndex, ...ROUTES.keys()].filter((v, i, a) => a.indexOf(v) === i && ROUTES[v]);
  const errors = [];
  for (const i of order) {
    if (outerSignal.aborted) throw new DOMException('aborted', 'AbortError');
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    outerSignal.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      if (i !== 0) setStatus(`連線比較慢，換一條路線再試（${ROUTES[i].name}）…`, 'loading');
      let res = i === 0 ? await fetchDirect(url, ctrl.signal) : await fetch(ROUTES[i].wrap(url), { signal: ctrl.signal });
      if (i === 0 && res.status >= 500) {
        // 直接連線有通，但 LRCLIB 伺服器出錯：等一下再試一次
        setStatus('歌詞網站回應有點慢，再試一次…', 'loading');
        await sleep(1500);
        res = await fetchDirect(url, ctrl.signal);
        if (res.status >= 500) throw new OutageError(res.status);
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('回應格式不正確');
      routeIndex = i;
      store.set('routeIndex', i);
      return data;
    } catch (err) {
      if (outerSignal.aborted) throw new DOMException('aborted', 'AbortError');
      if (err.name === 'OutageError') throw err; // 網站本身故障，不用再試中繼
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
  if (!q) { setStatus('請先輸入歌名或歌手。', 'error'); els.input.focus(); return; }
  if (searchCtrl) searchCtrl.abort();
  searchCtrl = new AbortController();
  els.input.value = q;
  setStatus(`正在搜尋「${q}」…`, 'loading');
  els.results.innerHTML = '';
  els.resultCount.textContent = '';
  els.examples.hidden = true;
  els.legend.hidden = true;

  try {
    const signal = searchCtrl.signal;
    let list = await fetchJSON(`${LRCLIB}/search?q=${encodeURIComponent(q)}`, signal);
    const conv = await getS2T();
    if (signal.aborted) return;
    list = list
      .map((r) => toTraditionalSong(r, conv))
      .filter((r) => r.syncedLyrics || r.plainLyrics)
      // 會跟著捲動（有時間）的歌詞排前面
      .sort((a, b) => (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0))
      .slice(0, 40);
    renderResults(list);
    if (list.length) {
      els.resultCount.textContent = `共 ${list.length} 首`;
      els.legend.hidden = false;
      setStatus('點一首歌，歌詞就會開始捲動。');
    } else {
      setStatus(`找不到「${q}」的歌詞。可以試試只打歌名，或換成歌手名字。`, 'error');
      els.examples.hidden = false;
    }
  } catch (err) {
    if (err.name === 'AbortError') return;
    if (err.name === 'OutageError') {
      setStatus('歌詞資料庫（LRCLIB）目前暫時故障，不是你的網路問題。請過幾分鐘再搜尋一次。', 'error', '詳細：LRCLIB 伺服器回應 ' + err.message);
      els.examples.hidden = false;
      return;
    }
    setStatus('連不上歌詞網站。可能是網路（例如公司網路）或瀏覽器外掛（例如廣告封鎖）擋住了，請換個網路（例如手機 4G/5G）或關掉外掛再試。', 'error', '詳細：' + err.message);
    els.examples.hidden = false;
  }
}

function renderResults(list) {
  els.results.innerHTML = '';
  list.forEach((r) => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.setAttribute('role', 'button');

    const main = document.createElement('div');
    main.className = 'r-main';
    const title = document.createElement('div');
    title.className = 'r-title';
    title.textContent = r.trackName || '（未知歌名）';
    const artist = document.createElement('div');
    artist.className = 'r-artist';
    artist.textContent = [r.artistName, r.albumName].filter(Boolean).join(' · ');
    main.append(title, artist);

    const side = document.createElement('div');
    side.className = 'r-side';
    const badge = document.createElement('span');
    badge.className = 'badge' + (r.syncedLyrics ? ' synced' : '');
    badge.textContent = r.syncedLyrics ? '✓ 會跟著捲動' : '只有文字';
    const dur = document.createElement('span');
    dur.className = 'r-dur';
    dur.textContent = r.duration ? fmt(r.duration) : '';
    side.append(badge, dur);

    li.append(main, side);
    const pick = () => {
      els.results.querySelectorAll('li.active').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      loadSong(r);
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
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

  // 第一次選歌時提示「可以點歌詞跳段落」
  if (!store.get('tipSeen', false)) els.tip.hidden = false;

  // 手機版：選歌後自動捲到歌詞區
  if (window.matchMedia('(max-width: 800px)').matches) {
    els.stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

els.tipClose.addEventListener('click', () => { els.tip.hidden = true; store.set('tipSeen', true); });

// 範例歌曲：點了直接搜尋
els.examples.querySelectorAll('.chip').forEach((b) =>
  b.addEventListener('click', () => search(b.textContent)));

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(els.input.value);
});

/* ======================= 語音輸入 ======================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const LANG_NAMES = { 'zh-TW': '國語', 'zh-HK': '粵語', 'en-US': '英文', 'ja-JP': '日文', 'ko-KR': '韓文' };
let voiceLang = store.get('voiceLang', 'zh-TW');
if (!LANG_NAMES[voiceLang]) voiceLang = 'zh-TW';
let recog = null;
let voiceSession = 0; // 換語言或取消時，讓舊的辨識結果失效

function markLangChips() {
  els.langChips.forEach((c) => c.classList.toggle('on', c.dataset.lang === voiceLang));
}

function closeVoicePanel() {
  els.voicePanel.hidden = true;
  els.mic.classList.remove('listening');
}

function startListening() {
  if (!SR) {
    setStatus('這個瀏覽器不支援用說的搜尋，請改用 Chrome、Edge 或 Safari，或直接打字。', 'error');
    return;
  }
  if (recog) { try { recog.abort(); } catch { /* 忽略 */ } }

  const session = ++voiceSession;
  let finalText = '';
  let cancelled = false;

  recog = new SR();
  recog.lang = voiceLang;
  recog.interimResults = true;
  recog.maxAlternatives = 1;
  recog.continuous = false;

  els.voicePanel.hidden = false;
  els.mic.classList.add('listening');
  els.voiceText.textContent = '';
  els.voiceTitle.textContent = `正在聽（${LANG_NAMES[voiceLang]}）…請說出歌名或歌手`;
  markLangChips();

  recog.onresult = (e) => {
    if (session !== voiceSession) return;
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const txt = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += txt; else interim += txt;
    }
    els.voiceText.textContent = (finalText + interim).trim();
  };
  recog.onerror = (e) => {
    if (session !== voiceSession) return;
    if (e.error === 'aborted') return;
    cancelled = true;
    const msg = {
      'not-allowed': '沒有麥克風權限。請按網址列左邊的圖示，允許這個網頁使用麥克風。',
      'service-not-allowed': '沒有麥克風權限。請按網址列左邊的圖示，允許這個網頁使用麥克風。',
      'no-speech': '沒有聽到聲音，請靠近麥克風再按一次「用說的」。',
      'audio-capture': '找不到麥克風，請確認麥克風有接好。',
      'network': '用說的搜尋需要網路，請檢查網路連線。',
    }[e.error] || '語音辨識出了問題（' + e.error + '），請再試一次或直接打字。';
    setStatus(msg, 'error');
  };
  recog.onend = () => {
    if (session !== voiceSession) return; // 已經換語言重新開始
    closeVoicePanel();
    const q = (finalText || els.voiceText.textContent).trim();
    if (!cancelled && q) search(q);
  };
  // 取消：不搜尋
  recog.cancel = () => { cancelled = true; try { recog.abort(); } catch { /* 忽略 */ } };

  try { recog.start(); } catch (err) {
    closeVoicePanel();
    setStatus('無法開始語音辨識：' + err.message, 'error');
  }
}

if (!SR) {
  els.mic.title = '這個瀏覽器不支援用說的搜尋（請使用 Chrome、Edge 或 Safari）';
  els.mic.style.opacity = .5;
}

els.mic.addEventListener('click', () => {
  if (!els.voicePanel.hidden && recog) { recog.stop(); return; } // 再按一次 = 說完了
  startListening();
});
els.voiceDone.addEventListener('click', () => { if (recog) recog.stop(); });
els.voiceCancel.addEventListener('click', () => {
  if (recog && recog.cancel) recog.cancel();
  closeVoicePanel();
});
els.langChips.forEach((c) => c.addEventListener('click', () => {
  voiceLang = c.dataset.lang;
  store.set('voiceLang', voiceLang);
  startListening(); // 用新的語言重新聽
}));
markLangChips();

/* ======================= 讓第一句／最後一句也能置中 ======================= */
new ResizeObserver(() => {
  els.lyrics.style.setProperty('--lyric-pad', Math.round(els.lyrics.clientHeight / 2) + 'px');
}).observe(els.lyrics);
