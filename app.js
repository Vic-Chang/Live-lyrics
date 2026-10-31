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

/* ======================= 網易雲音樂（NeteaseCloudMusicApi） =======================
 * 使用者自己架設 NeteaseCloudMusicApi（或 api-enhanced），在設定裡填入網址。
 * 搜尋：GET {base}/cloudsearch?keywords=…   歌詞：GET {base}/lyric?id=…
 */
let neteaseBase = store.get('neteaseApi', '');

function normalizeBase(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  return u.replace(/\/+$/, '');
}

async function fetchWithTimeout(url, signal, ms = 10000) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } catch (err) {
    if (signal && signal.aborted) throw err;
    throw new Error(err.name === 'AbortError' ? '逾時' : err.message);
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

async function neteaseJSON(path, signal) {
  const res = await fetchWithTimeout(neteaseBase + path, signal);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data && data.code && data.code !== 200) throw new Error('網易雲回應 ' + data.code + (data.message ? '：' + data.message : ''));
  return data;
}

async function searchNetease(q, signal) {
  const data = await neteaseJSON(`/cloudsearch?keywords=${encodeURIComponent(q)}&limit=30`, signal);
  const songs = (data.result && data.result.songs) || [];
  return songs.map((s) => ({
    source: 'netease',
    id: s.id,
    trackName: s.name || '',
    artistName: (s.ar || []).map((a) => a.name).filter(Boolean).join(' / '),
    albumName: (s.al && s.al.name) || '',
    duration: s.dt ? s.dt / 1000 : 0,
    needsLyrics: true,
  }));
}

async function fetchNeteaseLyrics(id, signal) {
  const data = await neteaseJSON(`/lyric?id=${encodeURIComponent(id)}`, signal);
  const lrc = (data.lrc && data.lrc.lyric) || '';
  if (!lrc.trim()) return { syncedLyrics: null, plainLyrics: null };
  if (parseLRC(lrc).length >= 2) return { syncedLyrics: lrc, plainLyrics: null };
  // 沒有時間軸：去掉時間標記當純文字
  const plain = lrc.split(/\r?\n/).map((l) => l.replace(/\[[^\]]*\]/g, '').trim())
    .filter((l) => l && !l.startsWith('{')).join('\n');
  return { syncedLyrics: null, plainLyrics: plain || null };
}

/* ======================= LRCLIB ======================= */
async function searchLrclib(q, signal) {
  const list = await fetchJSON(`${LRCLIB}/search?q=${encodeURIComponent(q)}`, signal);
  return list
    .filter((r) => r.syncedLyrics || r.plainLyrics)
    // 會跟著捲動（有時間）的歌詞排前面
    .sort((a, b) => (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0))
    .map((r) => ({ ...r, source: 'lrclib' }));
}

function lrclibErrorText(err) {
  if (err.name === 'OutageError') return 'LRCLIB 目前暫時故障（伺服器回應 ' + err.message + '）';
  return 'LRCLIB 連不上（' + err.message + '）';
}

/* ======================= 搜尋 ======================= */
async function search(q) {
  q = q.trim();
  if (!q) { setStatus('請先輸入歌名或歌手。', 'error'); els.input.focus(); return; }
  if (searchCtrl) searchCtrl.abort();
  searchCtrl = new AbortController();
  const signal = searchCtrl.signal;
  els.input.value = q;
  setStatus(`正在搜尋「${q}」…`, 'loading');
  els.results.innerHTML = '';
  els.resultCount.textContent = '';
  els.examples.hidden = true;
  els.legend.hidden = true;

  // 網易雲（有設定才搜）優先，LRCLIB 同時搜尋當備用
  const [ne, lr] = await Promise.allSettled([
    neteaseBase ? searchNetease(q, signal) : Promise.resolve(null),
    searchLrclib(q, signal),
  ]);
  if (signal.aborted) return;

  const conv = await getS2T();
  if (signal.aborted) return;

  const neList = ne.status === 'fulfilled' && ne.value ? ne.value : [];
  const lrList = lr.status === 'fulfilled' ? lr.value : [];
  const list = [...neList, ...lrList].slice(0, 60).map((r) => {
    const t = toTraditionalSong(r, conv);
    t.original = r; // 載入歌詞後若發現是日文，改回原文
    return t;
  });
  renderResults(list);

  // 哪個來源失敗，就在下面註明
  const notes = [];
  if (neteaseBase && ne.status === 'rejected') notes.push('網易雲連不上（' + ne.reason.message + '）');
  if (lr.status === 'rejected') notes.push(lrclibErrorText(lr.reason));

  if (list.length) {
    els.resultCount.textContent = `共 ${list.length} 首`;
    els.legend.hidden = false;
    setStatus('點一首歌，歌詞就會開始捲動。', '', notes.length ? '提醒：' + notes.join('；') + '，以下只顯示其他來源的結果。' : '');
  } else if (notes.length && (!neteaseBase || ne.status === 'rejected') && lr.status === 'rejected') {
    const onlyOutage = !neteaseBase && lr.reason.name === 'OutageError';
    setStatus(onlyOutage
      ? '歌詞資料庫（LRCLIB）目前暫時故障，不是你的網路問題。請過幾分鐘再試，或在下方「歌詞來源設定」加上網易雲。'
      : '所有歌詞來源都搜尋失敗。', 'error', '詳細：' + notes.join('；'));
    els.examples.hidden = false;
  } else {
    setStatus(`找不到「${q}」的歌詞。可以試試只打歌名，或換成歌手名字。`, 'error', notes.join('；'));
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
    if (r.source === 'netease') {
      badge.className = 'badge netease';
      badge.textContent = '網易雲';
    } else {
      badge.className = 'badge' + (r.syncedLyrics ? ' synced' : '');
      badge.textContent = r.syncedLyrics ? '✓ 會跟著捲動' : '只有文字';
    }
    const dur = document.createElement('span');
    dur.className = 'r-dur';
    dur.textContent = r.duration ? fmt(r.duration) : '';
    side.append(badge, dur);

    li.append(main, side);
    const pick = () => {
      els.results.querySelectorAll('li.active').forEach((x) => x.classList.remove('active'));
      li.classList.add('active');
      pickSong(r);
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    els.results.appendChild(li);
  });
}

// 網易雲的歌要點了才去抓歌詞
let pickToken = 0;
async function pickSong(r) {
  const token = ++pickToken;
  if (!r.needsLyrics) { loadSong(r); return; }

  player.pause();
  els.title.textContent = r.trackName || '';
  els.artist.textContent = [r.artistName, r.albumName].filter(Boolean).join(' · ');
  els.lyrics.innerHTML = '<div class="placeholder">正在載入歌詞…</div>';
  state.lines = [];
  enableControls();

  try {
    const lyr = await fetchNeteaseLyrics(r.id);
    if (token !== pickToken) return;
    let song = { ...r.original, ...lyr, needsLyrics: false };
    song = toTraditionalSong(song, await getS2T()); // 日文歌（有假名）不轉換
    if (token !== pickToken) return;
    Object.assign(r, song, { original: r.original }); // 下次點同一首不用再抓
    loadSong(song);
  } catch (err) {
    if (token !== pickToken) return;
    els.lyrics.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'placeholder';
    d.textContent = '這首歌的歌詞載入失敗（' + err.message + '），請再點一次或換一首。';
    els.lyrics.appendChild(d);
  }
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

/* ======================= 全螢幕 ======================= */
const fsBtn = $('fsBtn');
const fsLabel = fsBtn.querySelector('.fs-label');
const fsIcon = fsBtn.querySelector('.fs-icon');
const nativeFS = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
let wakeLock = null;

function isFS() { return fsElement() === els.stage || els.stage.classList.contains('pseudo-fs'); }

async function enterFS() {
  if (nativeFS) {
    try {
      await (els.stage.requestFullscreen ? els.stage.requestFullscreen() : els.stage.webkitRequestFullscreen());
      return; // 由 fullscreenchange 更新畫面
    } catch { /* 改用模擬全螢幕 */ }
  }
  els.stage.classList.add('pseudo-fs');
  document.body.classList.add('fs-lock');
  updateFS();
}

async function exitFS() {
  if (fsElement()) {
    try { await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); } catch { /* 忽略 */ }
  }
  els.stage.classList.remove('pseudo-fs');
  document.body.classList.remove('fs-lock');
  updateFS();
}

function toggleFS() { isFS() ? exitFS() : enterFS(); }

// 全螢幕時讓螢幕保持亮著（手機上看歌詞時很有用）
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wakeLock = null; }
}

function updateFS() {
  const on = isFS();
  els.stage.classList.toggle('is-fs', on);
  fsLabel.textContent = on ? '離開全螢幕' : '全螢幕';
  fsIcon.textContent = on ? '✕' : '⛶';
  fsBtn.setAttribute('aria-label', on ? '離開全螢幕' : '全螢幕');
  fsBtn.title = (on ? '離開全螢幕' : '全螢幕') + '（F 鍵）';
  keepAwake(on);
  // 版面大小改變後，把目前這句重新置中
  const cur = state.lines[state.activeIndex];
  if (cur && cur.el) requestAnimationFrame(() => scrollToLine(cur.el));
}

fsBtn.addEventListener('click', toggleFS);
document.addEventListener('fullscreenchange', updateFS);
document.addEventListener('webkitfullscreenchange', updateFS);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isFS()) keepAwake(true);
});
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (e.key === 'Escape' && els.stage.classList.contains('pseudo-fs')) exitFS();
  else if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFS(); }
});

/* ======================= 歌詞來源設定 ======================= */
const srcEls = { url: $('neteaseUrl'), save: $('neteaseSave'), clear: $('neteaseClear'), msg: $('neteaseMsg'), box: $('sourceBox') };
function showNeteaseState() {
  srcEls.url.value = neteaseBase;
  srcEls.clear.hidden = !neteaseBase;
  if (!neteaseBase) srcEls.msg.textContent = '目前只使用 LRCLIB。';
}
srcEls.save.addEventListener('click', async () => {
  const base = normalizeBase(srcEls.url.value);
  if (!base) { srcEls.msg.textContent = '請輸入網址，例如 http://localhost:3000'; return; }
  srcEls.msg.className = 'hint';
  srcEls.msg.textContent = '測試連線中…';
  const prev = neteaseBase;
  neteaseBase = base;
  try {
    const list = await searchNetease('晴天');
    store.set('neteaseApi', base);
    srcEls.msg.className = 'hint ok';
    srcEls.msg.textContent = `✓ 連線成功（試搜「晴天」找到 ${list.length} 首）。之後會先搜尋網易雲。`;
  } catch (err) {
    neteaseBase = prev;
    srcEls.msg.className = 'hint bad';
    srcEls.msg.textContent = '連不上這個網址（' + err.message + '）。請確認服務有在執行、網址和連接埠正確。';
  }
  showNeteaseState();
  srcEls.url.value = base;
});
srcEls.clear.addEventListener('click', () => {
  neteaseBase = '';
  store.set('neteaseApi', '');
  srcEls.msg.className = 'hint';
  showNeteaseState();
});
showNeteaseState();
if (neteaseBase) srcEls.msg.textContent = '已設定網易雲，搜尋時會優先使用。';

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
  // 歌詞區大小改變（例如進出全螢幕、旋轉手機）後，把目前這句重新置中
  const cur = state.lines[state.activeIndex];
  if (cur && cur.el) requestAnimationFrame(() => scrollToLine(cur.el));
}).observe(els.lyrics);
