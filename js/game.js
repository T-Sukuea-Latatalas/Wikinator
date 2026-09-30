// --- グローバル変数 & 状態 ---
const MAX_HINTS = 3;
let currentArticle = null;
let attempts = [];
let hintsUsed = 0;
let isGameOver = false;
let currentTurn = 0;
let startTime = 0;
window.currentScore = 0;
window.currentTimeStr = '';
let hintCandidates = [];
let charRevealed;
let audioCtx = null;
let isMuted = false;

// AI生成データ (questions.json)
let questionsData = null;

// お助け機能状態
let helperParticleUsed = false;
let helperNumberUsed = false;

// 永続ハイライト & ナビゲーション状態
let currentNavWord = null;
let currentNavIndices = [];
let currentNavCurrentPos = 0;

// 内蔵フォールバックリスト（完全オフライン・読み込み失敗時用）
const builtinFallbackPool = {
  easy: ["地球", "太陽", "日本", "ネコ", "水", "富士山", "イネ", "東京", "チョコレート", "野球"],
  normal: ["織田信長", "恐竜", "相対性理論", "フランス革命", "人工知能", "古代エジプト", "深海", "抗生物質"],
  hard: ["量子力学", "産業革命", "バベルの塔", "冷戦", "素数", "クフ王のピラミッド", "ルネサンス"],
  pr: ["富士山"],
  history: ["織田信長", "フランス革命", "産業革命", "明治維新", "冷戦"],
  science: ["相対性理論", "量子力学", "人工知能", "ブラックホール", "DNA"],
  geo: ["富士山", "サハラ砂漠", "アマゾン川", "エベレスト", "南極大陸"],
  anime: ["ポケットモンスター", "ドラゴンボール", "スタジオジブリ", "千と千尋の神隠し", "スーパーマリオ"],
  culture: ["ルネサンス", "モナ・リザ", "シェイクスピア", "古典音楽", "歌舞伎"]
};

window.escapeHtml = function (str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
};

function getTodayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// questions.json の安全な読み込み
async function loadQuestionsJson() {
  try {
    const res = await fetch('./questions.json');
    if (res.ok) {
      questionsData = await res.json();
    }
  } catch (e) {
    console.info("questions.json は利用できません。内蔵データを使用します。");
  }
}

// 初期化統合リスナー
window.addEventListener('DOMContentLoaded', () => {
  const picker = document.getElementById('daily-date-picker');
  if (picker) {
    picker.value = getTodayString();
    picker.max = getTodayString();
  }

  const setupRankWrapper = document.getElementById('setup-ranking-wrapper');
  const rankSection = document.getElementById('ranking-section');
  if (setupRankWrapper && rankSection) {
    setupRankWrapper.appendChild(rankSection);
  }

  loadQuestionsJson();
  if (window.loadLeaderboard) {
    window.loadLeaderboard();
  }
});

// PRNG (Mulberry32)
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getSeedFromDateString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

window.toggleMode = function () {
  const mode = document.querySelector('input[name="game-mode"]:checked').value;
  document.getElementById('list-select-wrapper').style.display = (mode === 'list') ? 'block' : 'none';
  document.getElementById('daily-wrapper').style.display = (mode === 'daily') ? 'block' : 'none';
};

// Web Audio API
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

window.toggleMute = function () {
  isMuted = !isMuted;
  const volIcon = document.getElementById('vol-icon');
  if (isMuted) {
    volIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>';
  } else {
    volIcon.innerHTML = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>';
  }
};

function playTone(freq, type, duration, vol) {
  if (isMuted || !audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + duration);
}

function playClick() { playTone(600, 'sine', 0.05, 0.1); }
function playHit(count) { playTone(400 + Math.min(count, 25) * 20, 'triangle', 0.25, 0.2); }
function playMiss() { playTone(120, 'sawtooth', 0.2, 0.15); }
function playClear() {
  setTimeout(() => playTone(523.25, 'square', 0.3, 0.15), 0);
  setTimeout(() => playTone(659.25, 'square', 0.3, 0.15), 100);
  setTimeout(() => playTone(783.99, 'square', 0.3, 0.15), 200);
  setTimeout(() => playTone(1046.5, 'square', 0.6, 0.15), 300);
}
function playGiveup() {
  setTimeout(() => playTone(349.23, 'triangle', 0.3, 0.2), 0);
  setTimeout(() => playTone(329.63, 'triangle', 0.3, 0.2), 200);
  setTimeout(() => playTone(293.66, 'triangle', 0.6, 0.2), 400);
}

function normalizeChar(char) {
  let c = char.toLowerCase();
  if (/[Ａ-Ｚａ-ｚ０-９]/.test(c)) c = String.fromCharCode(c.charCodeAt(0) - 0xfee0);
  if (/[ァ-ン]/.test(c)) c = String.fromCharCode(c.charCodeAt(0) - 0x60);
  return c;
}

function normalizeText(str) {
  let res = '';
  for (let i = 0; i < str.length; i++) res += normalizeChar(str[i]);
  return res;
}

// lists/*.json からリストを非同期取得
async function loadListFromFile(listKey) {
  try {
    const res = await fetch(`./lists/${listKey}.json`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    }
  } catch (e) {
    console.warn(`lists/${listKey}.json の読み込みに失敗しました。内蔵フォールバックを使用します。`, e);
  }
  return builtinFallbackPool[listKey] || builtinFallbackPool['easy'];
}

async function fetchArticle(mode) {
  let playedHistory = JSON.parse(sessionStorage.getItem('wikinator_history') || '[]');

  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      let endpoint = '';
      let listLabelName = '';
      let dailyDateFormatted = '';
      let targetTitle = '';
      let aiHints = [];

      // 1. デイリー問題モード
      if (mode === 'daily') {
        const pickerVal = document.getElementById('daily-date-picker').value || getTodayString();
        dailyDateFormatted = pickerVal.replace(/-/g, '/');
        const isToday = (pickerVal === getTodayString());

        if (isToday && questionsData?.daily) {
          const item = questionsData.daily;
          targetTitle = typeof item === 'string' ? item : item.title;
          if (item.hints) aiHints = item.hints;
        } else if (questionsData?.archives?.[pickerVal]) {
          const item = questionsData.archives[pickerVal];
          targetTitle = typeof item === 'string' ? item : item.title;
          if (item.hints) aiHints = item.hints;
        }

        if (!targetTitle) {
          const pool = ["地球", "太陽", "月", "水", "空気", "火", "海", "日本", "東京", "富士山", "織田信長", "恐竜", "相対性理論", "フランス革命", "人工知能", "古代エジプト", "量子力学", "産業革命", "冷戦", "素数"];
          const seed = getSeedFromDateString(pickerVal);
          const rng = mulberry32(seed);
          targetTitle = pool[Math.floor(rng() * pool.length)];
        }

        endpoint = `https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|categories|links&titles=${encodeURIComponent(targetTitle)}&redirects=1&explaintext=1&cllimit=max&pllimit=max&plnamespace=0&origin=*&format=json`;
      }
      // 2. リスト選択モード（lists/*.json 連動）
      else if (mode === 'list') {
        const selectElem = document.getElementById('list-select');
        const listKey = selectElem.value;
        const fullOptionText = selectElem.selectedOptions[0].text;
        const match = fullOptionText.match(/[\u4e00-\u9fa5\w]+/g);
        listLabelName = match ? match[0] : listKey;

        const listData = await loadListFromFile(listKey);

        if (listData && listData.length > 0) {
          let available = listData.filter(item => {
            const t = typeof item === 'string' ? item : (item.title || '');
            return !playedHistory.includes(t);
          });
          if (available.length === 0) available = listData;

          const chosen = available[Math.floor(Math.random() * available.length)];
          if (typeof chosen === 'string') {
            targetTitle = chosen;
          } else if (typeof chosen === 'object' && chosen.title) {
            targetTitle = chosen.title;
            if (chosen.hints) aiHints = chosen.hints;
          }
        }

        if (!targetTitle) targetTitle = "地球";

        endpoint = `https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|categories|links&titles=${encodeURIComponent(targetTitle)}&redirects=1&explaintext=1&cllimit=max&pllimit=max&plnamespace=0&origin=*&format=json`;
      }
      // 3. 完全ランダムモード
      else {
        endpoint = `https://ja.wikipedia.org/w/api.php?action=query&generator=random&grnnamespace=0&grnlimit=10&prop=extracts|links&explaintext=1&pllimit=max&plnamespace=0&origin=*&format=json`;
      }

      const res = await fetch(endpoint);
      const data = await res.json();

      if (data && data.query && data.query.pages) {
        let pages = Object.values(data.query.pages).sort(() => Math.random() - 0.5);
        for (const p of pages) {
          if (!p || p.missing !== undefined) continue;

          const minLen = (mode === 'random') ? 500 : 200;
          if (!p.extract || p.extract.length < minLen || p.title.includes('曖昧さ回避') || p.title.includes('一覧')) continue;
          const cleanTitle = p.title.replace(/\s*\(.*?\)$/, '');

          if (mode === 'random' && playedHistory.includes(cleanTitle)) continue;

          let extractedHints = [];
          const normExtract = normalizeText(p.extract);
          const normTitle = normalizeText(cleanTitle);

          if (p.links) {
            extractedHints = p.links
              .map(l => l.title.replace(/\s*\(.*?\)$/, ''))
              .filter(t => t.length >= 2 && !t.includes(':'))
              .filter(t => {
                const normT = normalizeText(t);
                if (normT.includes(normTitle) || normTitle.includes(normT)) return false;
                return normExtract.includes(normT);
              });
          }

          playedHistory.push(cleanTitle);
          if (playedHistory.length > 20) playedHistory.shift();
          sessionStorage.setItem('wikinator_history', JSON.stringify(playedHistory));

          let finalModeName = '';
          if (mode === 'daily') finalModeName = `デイリー問題 (${dailyDateFormatted})`;
          else if (mode === 'random') finalModeName = '完全ランダム';
          else if (mode === 'list') finalModeName = `リスト選択 (${listLabelName})`;

          return {
            title: p.title,
            cleanTitle: cleanTitle,
            extract: p.extract,
            normalizedExtract: normExtract,
            normalizedCleanTitle: normTitle,
            url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
            modeName: finalModeName,
            hints: extractedHints,
            aiHints: aiHints
          };
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // 最終フォールバック
  const fallbackTitle = "地球";
  const res = await fetch(`https://ja.wikipedia.org/w/api.php?action=query&prop=extracts|categories|links&titles=${encodeURIComponent(fallbackTitle)}&redirects=1&explaintext=1&cllimit=max&pllimit=max&plnamespace=0&origin=*&format=json`);
  const data = await res.json();
  const p = Object.values(data.query.pages)[0];
  return {
    title: p.title,
    cleanTitle: p.title,
    extract: p.extract,
    normalizedExtract: normalizeText(p.extract),
    normalizedCleanTitle: normalizeText(p.title),
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    modeName: 'リスト選択 (初級)',
    hints: [],
    aiHints: ["惑星", "太陽系", "生命"]
  };
}

window.startGame = async function () {
  initAudio();
  const mode = document.querySelector('input[name="game-mode"]:checked').value;

  let loadingText = 'Wikipediaから記事全文を取得しています...';
  if (mode === 'daily') loadingText = '本日のデイリー問題を取得しています...';
  else if (mode === 'random') loadingText = '完全ランダム記事を探しています...';
  else if (mode === 'list') loadingText = '選択されたリストからお題を取得しています...';

  document.getElementById('loading-msg').textContent = loadingText;
  document.getElementById('setup-view').style.display = 'none';
  document.getElementById('loading-view').style.display = 'block';

  currentArticle = await fetchArticle(mode);
  charRevealed = new Uint16Array(currentArticle.extract.length);
  hintCandidates = currentArticle.hints;

  helperParticleUsed = false;
  helperNumberUsed = false;
  document.getElementById('helper-particle-btn').disabled = false;
  document.getElementById('helper-number-btn').disabled = false;
  document.getElementById('docked-hints-container').style.display = 'none';
  document.getElementById('docked-hints-list').innerHTML = '';
  document.getElementById('docked-result-actions').style.display = 'none';
  window.closeNav();

  document.getElementById('loading-view').style.display = 'none';
  document.getElementById('game-view').style.display = 'block';
  document.getElementById('bottom-panel').style.display = 'flex';
  document.getElementById('article-length').textContent = `記事の総文字数: 約 ${currentArticle.extract.length.toLocaleString()} 文字`;

  updateArticlePreview(0);
  document.getElementById('word-input').focus();
  startTime = Date.now();
};

window.handleGuess = function (e) {
  e.preventDefault();
  if (isGameOver) return;
  initAudio();
  const inputElem = document.getElementById('word-input');
  const rawWord = inputElem.value.trim();
  if (rawWord.length < 1) return;

  const charArray = Array.from(rawWord);
  if (charArray.length === 1 && !/^[\p{Script=Han}々]$/u.test(rawWord)) {
    window.showToast('ひらがな・カタカナ・英数字は2文字以上で入力してください');
    inputElem.value = '';
    inputElem.focus();
    return;
  }
  processGuess(rawWord, false);
  inputElem.value = '';
};

function processGuess(rawWord, isHint = false) {
  const normWord = normalizeText(rawWord);
  if (attempts.some(a => a.norm === normWord)) {
    if (!isHint) window.showToast('すでに質問済みです');
    return false;
  }
  currentTurn++;
  let count = 0;
  const text = currentArticle.normalizedExtract;
  const len = normWord.length;
  let startIndex = 0;
  while ((startIndex = text.indexOf(normWord, startIndex)) !== -1) {
    count++;
    for (let j = 0; j < len; j++) charRevealed[startIndex + j] = currentTurn;
    startIndex += 1;
  }
  const isCorrect = normWord === currentArticle.normalizedCleanTitle || rawWord === currentArticle.title;
  attempts.unshift({ word: rawWord, norm: normWord, count, hit: count > 0, turn: currentTurn, isCorrect, isHint });

  if (!isHint) {
    if (count > 0) playHit(count);
    else playMiss();
  }
  updateUI();
  updateArticlePreview(currentTurn);
  if (isCorrect) endGame(true);
  return true;
}

// 付属語OPEN (Intl.Segmenter高精度解析・フリーズゼロ)
window.openParticles = function () {
  if (isGameOver || helperParticleUsed) return;
  helperParticleUsed = true;
  document.getElementById('helper-particle-btn').disabled = true;
  initAudio();
  playClick();

  const particles = new Set([
    'は', 'が', 'を', 'に', 'へ', 'と', 'から', 'より', 'で', 'や', 'の', 'も',
    'ね', 'よ', 'か', 'な', 'ぞ', 'さ', 'し', 'ば', 'て', 'ても', 'けれど', 'けれども',
    'のに', 'ので', 'なら', 'たら', 'たり', 'だの', 'なり', 'やら', 'きり', 'さえ',
    'すら', 'こそ', 'ばかり', 'まで', 'など', 'くらい', 'ぐらい', 'ほど', 'かしら', 'わ'
  ]);
  const auxiliaries = new Set([
    'です', 'ます', 'だ', 'た', 'ない', 'れる', 'られる', 'せる', 'させる', 'たい',
    'らしい', 'ようだ', 'そうだ', 'ぬ', 'ん', 'まい', 'よう', 'そう', 'たら', 'だろ',
    'でし', 'ませ', 'ず', 'べき'
  ]);

  currentTurn++;
  const text = currentArticle.extract;

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ja-JP', { granularity: 'word' });
    const segments = segmenter.segment(text);
    for (const seg of segments) {
      const w = seg.segment;
      if (particles.has(w) || auxiliaries.has(w)) {
        for (let j = 0; j < w.length; j++) {
          if (seg.index + j < charRevealed.length) {
            charRevealed[seg.index + j] = currentTurn;
          }
        }
      }
    }
  } else {
    const allWords = [...particles, ...auxiliaries];
    for (const w of allWords) {
      let idx = 0;
      while ((idx = text.indexOf(w, idx)) !== -1) {
        for (let j = 0; j < w.length; j++) {
          if (idx + j < charRevealed.length) {
            charRevealed[idx + j] = currentTurn;
          }
        }
        idx += w.length;
      }
    }
  }

  window.showToast(`付属語（助詞・助動詞）を一括開示しました (-1000点)`);
  updateArticlePreview(currentTurn);
};

// 数字OPEN
window.openNumbers = function () {
  if (isGameOver || helperNumberUsed) return;
  helperNumberUsed = true;
  document.getElementById('helper-number-btn').disabled = true;
  initAudio();
  playClick();

  currentTurn++;
  const numRegex = /[0-9０-９〇一二三四五六七八九十百千万億兆京]/;
  const text = currentArticle.extract;
  for (let i = 0; i < text.length; i++) {
    if (numRegex.test(text[i])) {
      charRevealed[i] = currentTurn;
    }
  }

  window.showToast(`数字（アラビア・漢数字）を一括開示しました (-500点)`);
  updateArticlePreview(currentTurn);
};

// 3段階ヒント
window.useHint = function () {
  if (isGameOver || hintsUsed >= MAX_HINTS) return;

  hintsUsed++;
  playClick();

  const dockedBox = document.getElementById('docked-hints-container');
  const dockedList = document.getElementById('docked-hints-list');
  dockedBox.style.display = 'block';

  let toastMsg = "";

  if (hintsUsed === 1) {
    const length = currentArticle.cleanTitle.length;
    const p = document.createElement('div');
    p.style.marginBottom = "2px";
    p.innerHTML = `<strong>ヒント1:</strong> タイトルは <strong>${length}</strong> 文字です`;
    dockedList.appendChild(p);
    toastMsg = `第1ヒント（文字数）を開示しました (${hintsUsed}/${MAX_HINTS})`;
  } else if (hintsUsed === 2) {
    let hintWord = '';
    const normTitle = currentArticle.normalizedCleanTitle;

    // 1. AI生成データ (questions.json) のキーワードを優先
    if (currentArticle.aiHints && currentArticle.aiHints.length > 0) {
      const availableAiHints = currentArticle.aiHints.filter(c => {
        const norm = normalizeText(c);
        if (norm.includes(normTitle) || normTitle.includes(norm)) return false;
        return !attempts.some(a => a.norm === norm);
      });
      if (availableAiHints.length > 0) {
        hintWord = availableAiHints[Math.floor(Math.random() * availableAiHints.length)];
      }
    }

    // 2. なければ Wikipedia の関連リンクから選定
    if (!hintWord && hintCandidates.length > 0) {
      const availableHints = hintCandidates.filter(c => {
        const norm = normalizeText(c);
        if (norm.includes(normTitle) || normTitle.includes(norm)) return false;
        return !attempts.some(a => a.norm === norm);
      });
      if (availableHints.length > 0) {
        hintWord = availableHints[Math.floor(Math.random() * availableHints.length)];
      }
    }

    // 3. 最終フォールバック
    if (!hintWord) {
      hintWord = currentArticle.extract.replace(/\s/g, '').substring(50, 55);
    }

    processGuess(hintWord, true);

    const p = document.createElement('div');
    p.style.marginBottom = "2px";
    p.innerHTML = `<strong>ヒント2 (重要語):</strong> <span class="hint-badge">${window.escapeHtml(hintWord)}</span>`;
    dockedList.appendChild(p);
    toastMsg = `第2ヒント（重要語「${hintWord}」）を開示しました (${hintsUsed}/${MAX_HINTS})`;
  } else if (hintsUsed === 3) {
    const firstChar = currentArticle.cleanTitle.charAt(0);
    const p = document.createElement('div');
    p.style.marginBottom = "2px";
    p.innerHTML = `<strong>ヒント3:</strong> 頭文字は『 <strong>${window.escapeHtml(firstChar)}</strong> 』です`;
    dockedList.appendChild(p);
    toastMsg = `第3ヒント（頭文字）を開示しました (${hintsUsed}/${MAX_HINTS})`;
  }

  window.showToast(toastMsg);

  const remain = MAX_HINTS - hintsUsed;
  document.getElementById('hint-btn').innerHTML = `
    <svg class="svg-icon" viewBox="0 0 24 24"><path d="M9 18h6"></path><path d="M10 22h4"></path><path d="M12 2a7 7 0 0 0-7 7c0 2.4 1.2 4.5 3 5.7V17h8v-2.3c1.8-1.2 3-3.3 3-5.7a7 7 0 0 0-7-7z"></path></svg>
    ヒント(${remain})
  `;
  if (hintsUsed >= MAX_HINTS) document.getElementById('hint-btn').disabled = true;
};

function updateUI() {
  const manualAttempts = attempts.filter(a => !a.isHint);
  document.getElementById('guess-count').textContent = manualAttempts.length;
  const hits = manualAttempts.filter(a => a.hit).length;
  const rate = Math.round((hits / manualAttempts.length) * 100) || 0;
  document.getElementById('hit-rate-pc').textContent = `(ヒット率: ${rate}%)`;
  renderHistory();
}

function renderHistory() {
  const html = attempts.map(item => {
    let bClass = 'badge-miss';
    if (item.count > 0 && item.count < 5) bClass = 'badge-low';
    else if (item.count >= 5 && item.count < 20) bClass = 'badge-mid';
    else if (item.count >= 20) bClass = 'badge-high';
    const hintMark = item.isHint ? ' <span style="font-size:0.8em; color:var(--ooui-blue);">[ヒント]</span>' : '';
    return `<li class="toc-item ${item.hit ? 'hit' : 'miss'}" onclick="highlightTurn(${item.turn})">
      <span class="toc-word">${window.escapeHtml(item.word)}${hintMark}</span>
      <span class="toc-badge ${bClass}">${item.count}回</span></li>`;
  }).join('');
  document.getElementById('history-list').innerHTML = html;
}

function updateArticlePreview(latestTurn) {
  const html = [];
  const text = currentArticle.extract;
  const maskRegex = /[\p{L}\p{N}々〆]/u;
  let addedLatestId = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      html.push('\n');
      continue;
    }
    if (maskRegex.test(text[i]) && charRevealed[i] === 0 && !isGameOver) {
      let j = i;
      while (j < text.length && maskRegex.test(text[j]) && charRevealed[j] === 0 && !isGameOver) j++;
      html.push(`<span class="masked-block">${'█'.repeat(j - i)}</span>`);
      i = j - 1;
    } else {
      if (charRevealed[i] > 0 && maskRegex.test(text[i])) {
        const turn = charRevealed[i];
        const isLatest = turn === latestTurn;
        let idStr = '';
        if (isLatest && !addedLatestId) {
          idStr = ' id="latest-hit"';
          addedLatestId = true;
        }
        html.push(`<span class="revealed turn-${turn} ${isLatest ? 'revealed-latest' : ''}"${idStr}>${window.escapeHtml(text[i])}</span>`);
      } else {
        html.push(window.escapeHtml(text[i]));
      }
    }
  }
  document.getElementById('article-preview').innerHTML = html.join('');
  if (latestTurn > 0) scrollToLatest();
}

function scrollToLatest() {
  const el = document.getElementById('latest-hit');
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 永続ハイライト & 前後ナビ
window.highlightTurn = function (turn) {
  const item = attempts.find(a => a.turn === turn);
  if (!item || !item.hit) {
    window.showToast("その単語は本文中に存在しません");
    window.closeNav();
    return;
  }

  document.querySelectorAll('.highlight-active').forEach(el => el.classList.remove('highlight-active'));
  const els = Array.from(document.querySelectorAll(`.turn-${turn}`));
  if (els.length === 0) return;

  els.forEach(el => el.classList.add('highlight-active'));

  const wordLen = item.word.length;
  const targetGroupSpans = [];
  for (let i = 0; i < els.length; i += wordLen) {
    targetGroupSpans.push(els[i]);
  }

  currentNavIndices = targetGroupSpans;
  currentNavCurrentPos = 0;
  currentNavWord = item.word;

  showNavControls();
  jumpToNavPos(0);
};

function showNavControls() {
  const navBox = document.getElementById('jump-nav-box');
  if (currentNavIndices.length > 0) {
    navBox.style.display = 'flex';
    updateNavUI();
  } else {
    navBox.style.display = 'none';
  }
}

function updateNavUI() {
  document.getElementById('nav-info-text').textContent = `「${window.escapeHtml(currentNavWord)}」 ${currentNavCurrentPos + 1} / ${currentNavIndices.length} 件`;
}

window.nextNav = function () {
  if (currentNavIndices.length === 0) return;
  currentNavCurrentPos = (currentNavCurrentPos + 1) % currentNavIndices.length;
  jumpToNavPos(currentNavCurrentPos);
};

window.prevNav = function () {
  if (currentNavIndices.length === 0) return;
  currentNavCurrentPos = (currentNavCurrentPos - 1 + currentNavIndices.length) % currentNavIndices.length;
  jumpToNavPos(currentNavCurrentPos);
};

function jumpToNavPos(pos) {
  const el = currentNavIndices[pos];
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  updateNavUI();
}

window.closeNav = function () {
  document.getElementById('jump-nav-box').style.display = 'none';
  document.querySelectorAll('.highlight-active').forEach(el => el.classList.remove('highlight-active'));
  currentNavIndices = [];
};

window.giveUp = function () {
  if (isGameOver) return;
  if (!confirm('ギブアップして答えを見ますか？')) return;
  endGame(false);
};

function endGame(isClear) {
  isGameOver = true;
  document.getElementById('word-input').blur();
  document.getElementById('word-input').disabled = true;
  document.getElementById('submit-btn').disabled = true;
  document.getElementById('hint-btn').disabled = true;
  document.getElementById('giveup-btn').disabled = true;
  document.getElementById('helper-particle-btn').disabled = true;
  document.getElementById('helper-number-btn').disabled = true;
  window.closeNav();

  const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeStr = isClear ? `${minutes}分${seconds}秒` : '記録なし';

  let finalScore = 0;
  if (isClear) {
    const manualAttempts = attempts.filter(a => !a.isHint).length;
    const penaltyAttempts = manualAttempts * 50;
    const penaltyHints = hintsUsed * 500;
    const penaltyTime = elapsedSeconds * 5;
    let penaltyHelpers = 0;
    if (helperParticleUsed) penaltyHelpers += 1000;
    if (helperNumberUsed) penaltyHelpers += 500;
    finalScore = Math.max(100, 10000 - penaltyAttempts - penaltyHints - penaltyTime - penaltyHelpers);
  }
  window.currentScore = finalScore;
  window.currentTimeStr = timeStr;

  document.getElementById('article-heading').textContent = currentArticle.title;
  updateArticlePreview(0);

  const ambox = document.getElementById('result-ambox');
  ambox.className = `ambox ${isClear ? 'ambox-success' : 'ambox-danger'}`;

  const resIcon = document.getElementById('result-icon');
  if (isClear) {
    resIcon.innerHTML = '<svg class="svg-icon" style="width:32px;height:32px;stroke:var(--ambox-green);" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
  } else {
    resIcon.innerHTML = '<svg class="svg-icon" style="width:32px;height:32px;stroke:var(--ambox-red);" viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>';
  }

  document.getElementById('result-title').textContent = isClear ? '見事正解です！' : 'ギブアップしました。';
  document.getElementById('result-time').textContent = timeStr;
  document.getElementById('result-score').textContent = finalScore;
  document.getElementById('result-desc').innerHTML = `正解の記事は「<strong>${window.escapeHtml(currentArticle.title)}</strong>」でした。<br><span style="font-size:0.9rem; color:var(--text-muted); display:inline-block; margin-top:4px;">出題モード: ${window.escapeHtml(currentArticle.modeName)}</span>`;

  // 常時固定の下部パネルにも終了後アクションを表示
  const shareUrl = "https://t-sukuea-latatalas.github.io/Wikinator/";
  let shareText = '';
  if (isClear) {
    shareText = `📚 Wikinator\n記事名："${currentArticle.title}"\n得点："${finalScore}"点\nタイム："${timeStr}"\n${shareUrl}\n#Wikinator`;
  } else {
    shareText = `📚 Wikinator\n記事名："${currentArticle.title}"\n\nクリアならず\n\n${shareUrl}\n#Wikinator`;
  }

  const xIntentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
  document.getElementById('docked-share-x-btn').href = xIntentUrl;
  document.getElementById('docked-result-link').href = currentArticle.url;
  document.getElementById('docked-result-actions').style.display = 'flex';

  document.getElementById('result-ranking-wrapper').appendChild(document.getElementById('ranking-section'));
  if (isClear) document.getElementById('ranking-form').style.display = 'flex';
  if (window.loadLeaderboard) window.loadLeaderboard();

  ambox.style.display = 'flex';
  if (isClear) {
    playClear();
    startConfetti();
  } else {
    playGiveup();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.submitScoreBtn = async function () {
  const name = document.getElementById('player-name').value.trim() || '名無し';
  document.getElementById('ranking-form').style.display = 'none';
  if (window.submitScoreToDB) {
    await window.submitScoreToDB(name, window.currentScore, window.currentTimeStr, currentArticle.title);
  }
};

let toastTimeout;
window.showToast = function (msg) {
  const toast = document.getElementById('toast');
  toast.innerText = msg;
  toast.style.opacity = 1;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => (toast.style.opacity = 0), 3500);
};

let particles = [], confettiFrame;
function startConfetti() {
  const cvs = document.getElementById('confetti-canvas');
  const ctx = cvs.getContext('2d');
  cvs.width = window.innerWidth;
  cvs.height = window.innerHeight;
  cvs.style.display = 'block';
  const colors = ['#202122', '#0645ad', '#fc3', '#00af89', '#eaecf0'];
  for (let i = 0; i < 150; i++) {
    particles.push({
      x: Math.random() * cvs.width,
      y: Math.random() * cvs.height - cvs.height,
      r: Math.random() * 6 + 4,
      dx: Math.random() * 4 - 2,
      dy: Math.random() * 3 + 2,
      color: colors[Math.floor(Math.random() * colors.length)],
      tilt: Math.random() * 10 - 10,
      tiltAngle: 0,
      tiltAngleInc: Math.random() * 0.07 + 0.05
    });
  }
  function animate() {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    let active = false;
    for (let p of particles) {
      p.tiltAngle += p.tiltAngleInc;
      p.y += p.dy;
      p.x += Math.sin(p.tiltAngle) * 2 + p.dx;
      if (p.y <= cvs.height) active = true;
      ctx.beginPath();
      ctx.lineWidth = p.r;
      ctx.strokeStyle = p.color;
      ctx.moveTo(p.x + p.tilt + p.r, p.y);
      ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
      ctx.stroke();
    }
    if (active) confettiFrame = requestAnimationFrame(animate);
    else {
      cvs.style.display = 'none';
      particles = [];
    }
  }
  animate();
}