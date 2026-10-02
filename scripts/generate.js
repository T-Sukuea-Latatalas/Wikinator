const fs = require('fs');
const path = require('path');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function askGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  const data = await response.json();
  const text = data.candidates[0].content.parts[0].text;
  return JSON.parse(text);
}

async function main() {
  const prompt = `
以下の条件で、Wikipedia推測ゲーム用のお題データ（JSON）を作成してください。

1. **デイリーお題（daily）**:
   - 一般常識レベルで知名度が高く、Wikipediaに単独記事が存在する興味深いトピックを1つ。
   - ヒントキーワード（hints）として、そのお題を連想させるが直接的すぎない絶妙な重要単語を3つ抽出。
2. **ジャンル別お題（genres）**:
   - 各ジャンル（history: 歴史, science: 科学, geo: 地理, anime: アニメ・サブカル, culture: 文化・芸術）ごとに、有名なお題を1つずつ＋ヒントキーワード3つ。
3. **難易度別お題（difficulty）**:
   - easy（初級・超有名）, normal（中級・教養）, hard（上級・深い知識）のお題を各1つずつ＋ヒントキーワード3つ。

【出力フォーマット（JSON）】
{
  "updatedAt": "${new Date().toISOString()}",
  "daily": {
    "title": "記事名",
    "hints": ["ヒント1", "ヒント2", "ヒント3"]
  },
  "genres": {
    "history": { "title": "記事名", "hints": ["..."] },
    "science": { "title": "記事名", "hints": ["..."] },
    "geo": { "title": "記事名", "hints": ["..."] },
    "anime": { "title": "記事名", "hints": ["..."] },
    "culture": { "title": "記事名", "hints": ["..."] }
  },
  "difficulty": {
    "easy": { "title": "記事名", "hints": ["..."] },
    "normal": { "title": "記事名", "hints": ["..."] },
    "hard": { "title": "記事名", "hints": ["..."] }
  }
}
`;

  try {
    console.log("Gemini APIでお題を生成中...");
    const result = await askGemini(prompt);
    
    // 過去のデイリーアーカイブを保持しながら追記
    const outputPath = path.join(__dirname, '../questions.json');
    let existingData = { archives: {} };
    if (fs.existsSync(outputPath)) {
      try { existingData = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch (e) {}
    }

    const todayKey = new Date().toISOString().split('T')[0];
    if (!existingData.archives) existingData.archives = {};
    existingData.archives[todayKey] = result.daily;

    const finalOutput = {
      ...result,
      archives: existingData.archives
    };

    fs.writeFileSync(outputPath, JSON.stringify(finalOutput, null, 2), 'utf8');
    console.log("questions.json の更新が完了しました！");
  } catch (error) {
    console.error("生成エラー:", error);
    process.exit(1);
  }
}

main();