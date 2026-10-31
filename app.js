'use strict';

/* ======================= 元素 ======================= */
const $ = (id) => document.getElementById(id);
const els = {
  form: $('searchForm'), input: $('searchInput'), mic: $('micBtn'), lang: $('voiceLang'),
  status: $('status'), results: $('results'),
  audio: $('audio'), audioFile: $('audioFile'), audioName: $('audioName'),
  title: $('songTitle'), artist: $('songArtist'), lyrics: $('lyrics'),
  play: $('playBtn'), seek: $('seek'), cur: $('curTime'), dur: $('durTime'),
  fontDown: $('fontDown'), fontUp: $('fontUp'), fontRange: $('fontRange'),
  offDown: $('offDown'), offUp: $('offUp'), offVal: $('offVal'),
};

const LRCLIB = 'https://lrclib.net/api';

/* ======================= 状态 ======================= */
const state = {
  lines: [],          // [{ time, text, el }]
  synced: false,
  activeIndex: -1,
  offset: 0,          // 秒；正数 = 歌词提早出现
  userScrollUntil: 0, // 使用者手动滚动后暂停自动滚动
  song: null,
};

/* ======================= 小工具 ======================= */
const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const setStatus = (msg) => { els.status.textContent = msg; };

/* ======================= 播放器 =======================
 * 两种模式：
 *  - audio：使用者载入本机音乐档，用 <audio> 播放
 *  - clock：没有音乐档时，用计时器模拟播放，歌词照样滚动
 */
const player = {
  mode: 'clock',
  playing: false,
  base: 0,        // clock 模式：暂停时的时间点
  startedAt: 0,   // clock 模式：开始播放的 performance.now()
  clockDuration: 0,

  get duration() {
    if (this.mode === 'audio') return isFinite(els.audio.duration) ? els.audio.duration : 0;
    return this.clockDuration;
  },
  get time() {
    if (this.mode === 'audio') return els.audio.currentTime;
    if (!this.playing) return this.base;
    return this.base + (performance.now() - this.startedAt) / 1000;
  },
  play() {
    if (this.mode === 'audio') {
      els.audio.play().catch((e) => setStatus('无法播放音乐：' + e.message));
    } else {
      this.startedAt = performance.now();
      this.playing = true;
    }
    this.playing = true;
    updatePlayBtn();
  },
  pause() {
    if (this.mode === 'audio') els.audio.pause();
    else this.base = this.time;
    this.playing = false;
    updatePlayBtn();
  },
  toggle() { this.playing ? this.pause() : this.play(); },
  seek(t) {
    t = Math.max(0, Math.min(t, this.duration || t));
    if (this.mode === 'audio') {
      els.audio.currentTime = t;
    } else {
      this.base = t;
      this.startedAt = performance.now();
    }
    state.userScrollUntil = 0; // 跳转后立即恢复自动滚动
    tick(true);
  },
};

function updatePlayBtn() {
  els.play.textContent = player.playing ? '❚❚' : '▶';
}

function enableControls() {
  const ok = state.lines.length > 0 || player.mode === 'audio';
  els.play.disabled = !ok;
  els.seek.disabled = !ok;
}

/* ======================= 歌词解析 ======================= */
function parseLRC(text) {
  const out = [];
  let offset = 0;
  const lineRe = /^((?:\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\])+)(.*)$/;
  const tagRe = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;

  for (const raw of text.split(/\r?\n/)) {
    const off = raw.match(/^\[offset:\s*([+-]?\d+)\s*\]/i);
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

// 没有时间轴的纯文字歌词：平均分配到整首歌长度
function plainToLines(text, duration) {
  const rows = text.split(/\r?\n/).map((s) => s.trim());
  while (rows.length && !rows[rows.length - 1]) rows.pop();
  const total = duration > 0 ? duration : rows.length * 4;
  const step = total / Math.max(rows.length, 1);
  return rows.map((txt, i) => ({ time: i * step, text: txt }));
}

/* ======================= 歌词显示 ======================= */
function renderLyrics() {
  const box = els.lyrics;
  box.innerHTML = '';
  state.activeIndex = -1;

  if (!state.lines.length) {
    box.innerHTML = '<div class="placeholder">这首歌没有歌词资料（可能是纯音乐）。</div>';
    return;
  }
  if (!state.synced) {
    const n = document.createElement('div');
    n.className = 'notice';
    n.textContent = '⚠ 这首歌只有纯文字歌词，滚动时间是依歌曲长度平均估算的。';
    box.appendChild(n);
  }

  const frag = document.createDocumentFragment();
  state.lines.forEach((line, i) => {
    const el = document.createElement('div');
    el.className = 'line' + (line.text ? '' : ' empty');
    el.textContent = line.text || '♪';
    el.dataset.index = i;
    el.title = '从 ' + fmt(line.time) + ' 开始播放';
    line.el = el;
    frag.appendChild(el);
  });
  box.appendChild(frag);
  box.scrollTop = 0;
}

// 点任何一行歌词 → 跳到那一段播放
els.lyrics.addEventListener('click', (e) => {
  const el = e.target.closest('.line');
  if (!el) return;
  const line = state.lines[Number(el.dataset.index)];
  if (!line) return;
  player.seek(line.time - state.offset + 0.01);
  if (!player.playing) player.play();
});

// 使用者自己滚动歌词时，暂停自动滚动 3 秒
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
  const top = el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2;
  box.scrollTo({ top, behavior: 'smooth' });
}

function setActive(idx, force) {
  if (idx === state.activeIndex && !force) return;
  const prev = state.lines[state.activeIndex];
  if (prev && prev.el) prev.el.classList.remove('active');
  state.lines.forEach((l, i) => l.el && l.el.classList.toggle('past', i < idx));
  state.activeIndex = idx;
  const cur = state.lines[idx];
  if (cur && cur.el) {
    cur.el.classList.add('active');
    if (performance.now() > state.userScrollUntil) scrollToLine(cur.el);
  } else if (idx < 0 && performance.now() > state.userScrollUntil) {
    els.lyrics.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/* ======================= 主循环 ======================= */
let seeking = false;
function tick(force) {
  const t = player.time;
  const dur = player.duration;

  // clock 模式播到结尾自动停止
  if (player.mode === 'clock' && player.playing && dur && t >= dur) {
    player.pause();
    player.base = dur;
  }

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

els.audio.addEventListener('play', () => { player.playing = true; updatePlayBtn(); });
els.audio.addEventListener('pause', () => { player.playing = false; updatePlayBtn(); });
els.audio.addEventListener('ended', () => { player.playing = false; updatePlayBtn(); });

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (els.play.disabled) return;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  else if (e.code === 'ArrowRight') { player.seek(player.time + 5); }
  else if (e.code === 'ArrowLeft') { player.seek(player.time - 5); }
});

/* ======================= 歌词与音乐时间微调 ======================= */
function setOffset(v) {
  state.offset = Math.round(v * 10) / 10;
  els.offVal.textContent = (state.offset > 0 ? '+' : '') + state.offset.toFixed(1) + 's';
  tick(true);
}
els.offUp.addEventListener('click', () => setOffset(state.offset + 0.5));
els.offDown.addEventListener('click', () => setOffset(state.offset - 0.5));

/* ======================= 字体大小 ======================= */
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
// Ctrl + 滚轮 也能缩放歌词
els.lyrics.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setFont(Number(els.fontRange.value) + (e.deltaY < 0 ? 2 : -2));
}, { passive: false });
setFont(store.get('lyricSize', 26));

/* ======================= 搜索 ======================= */
let searchCtrl = null;

async function search(q) {
  q = q.trim();
  if (!q) { setStatus('请输入要搜索的内容。'); return; }
  if (searchCtrl) searchCtrl.abort();
  searchCtrl = new AbortController();
  setStatus(`正在搜索「${q}」…`);
  els.results.innerHTML = '';

  try {
    const res = await fetch(`${LRCLIB}/search?q=${encodeURIComponent(q)}`, { signal: searchCtrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    let list = await res.json();
    // 有同步(时间轴)歌词的排前面
    list = list
      .filter((r) => r.syncedLyrics || r.plainLyrics || r.instrumental)
      .sort((a, b) => (b.syncedLyrics ? 1 : 0) - (a.syncedLyrics ? 1 : 0))
      .slice(0, 40);
    renderResults(list);
    setStatus(list.length ? `找到 ${list.length} 首，点一首来显示歌词。` : `找不到「${q}」的歌词，换个关键字试试。`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    setStatus('搜索失败：' + err.message + '（请检查网络连线）');
  }
}

function renderResults(list) {
  els.results.innerHTML = '';
  list.forEach((r) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'r-title';
    title.textContent = r.trackName || '(未知歌名)';
    const meta = document.createElement('div');
    meta.className = 'r-meta';
    const who = document.createElement('span');
    who.textContent = [r.artistName, r.albumName].filter(Boolean).join(' · ');
    const dur = document.createElement('span');
    dur.textContent = r.duration ? fmt(r.duration) : '';
    const badge = document.createElement('span');
    badge.className = 'badge' + (r.syncedLyrics ? ' synced' : '');
    badge.textContent = r.syncedLyrics ? '滚动歌词' : r.instrumental ? '纯音乐' : '纯文字';
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
    const d = player.mode === 'audio' && player.duration ? player.duration : r.duration;
    state.lines = plainToLines(r.plainLyrics, d);
    state.synced = false;
  } else {
    state.lines = [];
    state.synced = false;
  }

  // 计时器模式的总长度
  const lastT = state.lines.length ? state.lines[state.lines.length - 1].time : 0;
  player.clockDuration = Math.max(r.duration || 0, lastT + 5);

  // 切歌时，计时器模式从头开始
  if (player.mode === 'clock') { player.pause(); player.base = 0; }

  renderLyrics();
  enableControls();
  tick(true);
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  search(els.input.value);
});

/* ======================= 语音输入 ======================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
let listening = false;

els.lang.value = store.get('voiceLang', 'zh-TW');
els.lang.addEventListener('change', () => store.set('voiceLang', els.lang.value));

if (!SR) {
  els.mic.title = '这个浏览器不支援语音输入（请用 Chrome 或 Edge）';
  els.mic.style.opacity = .4;
}

els.mic.addEventListener('click', () => {
  if (!SR) {
    setStatus('这个浏览器不支援语音输入，请改用 Chrome、Edge 或 Safari。');
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
    setStatus('🎤 请说出歌名、歌手或一句歌词…');
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
      'not-allowed': '麦克风权限被拒绝，请在浏览器允许使用麦克风。',
      'no-speech': '没有听到声音，请再试一次。',
      'audio-capture': '找不到麦克风。',
      'network': '语音识别需要网络连线。',
    }[e.error] || '语音识别错误：' + e.error;
    setStatus(msg);
  };
  recog.onend = () => {
    listening = false;
    els.mic.classList.remove('listening');
    const q = els.input.value.trim();
    if (finalText.trim() || q) search(finalText.trim() || q);
  };

  try { recog.start(); } catch (err) { setStatus('无法启动语音识别：' + err.message); }
});

/* ======================= 本机音乐档 ======================= */
let objectUrl = null;
els.audioFile.addEventListener('change', () => {
  const file = els.audioFile.files[0];
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);

  if (player.mode === 'clock') player.pause();
  player.mode = 'audio';
  player.playing = false;
  els.audio.src = objectUrl;
  els.audioName.textContent = '🎧 ' + file.name;
  updatePlayBtn();
  enableControls();

  els.audio.addEventListener('loadedmetadata', () => {
    // 纯文字歌词：依实际音乐长度重新分配时间
    if (state.song && !state.synced && state.song.plainLyrics) loadSong(state.song);
    tick(true);
  }, { once: true });

  // 还没选歌的话，用档名自动帮忙搜索歌词
  if (!state.song) {
    const name = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    els.input.value = name;
    search(name);
  }
});

/* ======================= 让第一句/最后一句也能置中 ======================= */
new ResizeObserver(() => {
  els.lyrics.style.setProperty('--lyric-pad', Math.round(els.lyrics.clientHeight / 2) + 'px');
}).observe(els.lyrics);
