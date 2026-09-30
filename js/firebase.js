import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getDatabase, ref, push, query, orderByChild, limitToLast, get, startAt } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-database.js";

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

// 週間 or 全期間
window.currentRankingPeriod = 'weekly';

// タブ切り替え
window.switchRankingTab = function (period) {
  window.currentRankingPeriod = period;
  const tabWeekly = document.getElementById('tab-weekly');
  const tabAll = document.getElementById('tab-all');
  if (tabWeekly) tabWeekly.classList.toggle('progressive', period === 'weekly');
  if (tabAll) tabAll.classList.toggle('progressive', period === 'all');
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

// ランキング取得 & 描画
window.loadLeaderboard = async function () {
  const tbody = document.getElementById('leaderboard-body');
  if (!tbody) return;

  if (!db) {
    tbody.innerHTML = '<tr><td colspan="6">APIキー未設定</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="6">読み込み中...</td></tr>';
  try {
    let data = [];
    if (window.currentRankingPeriod === 'weekly') {
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const scoresRef = query(ref(db, 'leaderboard'), orderByChild('timestamp'), startAt(oneWeekAgo));
      const snapshot = await get(scoresRef);
      snapshot.forEach(child => {
        data.push(child.val());
      });
      data.sort((a, b) => b.score - a.score);
      data = data.slice(0, 10);
    } else {
      const scoresRef = query(ref(db, 'leaderboard'), orderByChild('score'), limitToLast(10));
      const snapshot = await get(scoresRef);
      snapshot.forEach(child => {
        data.push(child.val());
      });
      data.sort((a, b) => b.score - a.score);
    }

    tbody.innerHTML = '';
    if (data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">スコアなし</td></tr>';
      return;
    }

    data.forEach((d, i) => {
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
    console.error(e);
    tbody.innerHTML = '<tr><td colspan="6">ランキング取得エラー</td></tr>';
  }
};