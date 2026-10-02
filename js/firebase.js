import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, push, query, limitToLast, get } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC6UvafVPeO9asW7e_e7m1LOvPyfRhm_hQ",
  authDomain: "wikinator-rank.firebaseapp.com",
  databaseURL: "https://wikinator-rank-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "wikinator-rank",
  storageBucket: "wikinator-rank.firebasestorage.app",
  messagingSenderId: "753431540247",
  appId: "1:753431540247:web:d22441209b365d1059e252"
};

let db = null;
try {
  if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    const app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  }
} catch (e) {
  console.error("Firebase Init Error:", e);
}

// デフォルト期間: デイリー
window.currentRankingPeriod = 'daily';

// タブ切り替え（4タブ連動）
window.switchRankingTab = function (period) {
  window.currentRankingPeriod = period;
  ['daily', 'weekly', 'monthly', 'all'].forEach(p => {
    const btn = document.getElementById(`tab-${p}`);
    if (btn) btn.classList.toggle('progressive', p === period);
  });
  window.loadLeaderboard();
};

// スコア登録
window.submitScoreToDB = async function (name, score, timeStr, article) {
  if (!db) {
    alert("ランキング機能（APIキー）が未設定です。");
    return;
  }
  try {
    const scoresRef = ref(db, 'leaderboard');
    await push(scoresRef, {
      name: name || "名無し",
      score: score,
      time: timeStr,
      article: article,
      timestamp: Date.now()
    });
    await window.loadLeaderboard();
  } catch (e) {
    console.error(e);
    alert("スコア登録に失敗しました");
  }
};

// ランキング取得 & 描画（完全JS側フィルタリングで確実に動作）
window.loadLeaderboard = async function () {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;

  if (!db) {
    tbody.innerHTML = '<tr><td colspan="6">APIキー未設定</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="6">読み込み中...</td></tr>';
  try {
    // 直近の登録データを一括取得（インデックス不備エラーを完全回避）
    const scoresRef = query(ref(db, 'leaderboard'), limitToLast(500));
    const snapshot = await get(scoresRef);
    
    let allData = [];
    snapshot.forEach(child => {
      const val = child.val();
      if (val && typeof val.score === 'number') {
        allData.push(val);
      }
    });

    const now = Date.now();
    let filtered = allData;

    // JavaScript側で各期間を正確にフィルタリング
    if (window.currentRankingPeriod === 'daily') {
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      filtered = allData.filter(d => (d.timestamp || 0) >= oneDayAgo);
    } else if (window.currentRankingPeriod === 'weekly') {
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
      filtered = allData.filter(d => (d.timestamp || 0) >= oneWeekAgo);
    } else if (window.currentRankingPeriod === 'monthly') {
      const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;
      filtered = allData.filter(d => (d.timestamp || 0) >= oneMonthAgo);
    }
    // 'all' の場合は全期間そのまま

    // スコア降順ソート & 上位10件抽出
    filtered.sort((a, b) => b.score - a.score);
    const top10 = filtered.slice(0, 10);

    tbody.innerHTML = '';
    if (top10.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">該当期間のスコアはまだありません</td></tr>';
      return;
    }

    top10.forEach((d, i) => {
      const tr = document.createElement('tr');
      const artName = d.article || '-';
      const escapeFunc = window.escapeHtml || (s => s);
      const linkHtml = d.article
        ? `<a href="https://ja.wikipedia.org/wiki/${encodeURIComponent(d.article)}" target="_blank" rel="noopener noreferrer" class="wiki-ext-link">
            開く <svg class="svg-icon" viewBox="0 0 24 24" style="width:0.9em;height:0.9em;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
           </a>`
        : '-';

      tr.innerHTML = `
        <td>${i + 1}</td>
        <td style="font-weight:bold;">${escapeFunc(d.name)}</td>
        <td style="color:#d32f2f; font-weight:bold;">${d.score}</td>
        <td>${d.time}</td>
        <td style="font-weight:500;">${escapeFunc(artName)}</td>
        <td>${linkHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Leaderboard error:", e);
    tbody.innerHTML = '<tr><td colspan="6">ランキング取得エラー</td></tr>';
  }
};