// 記事HTMLから「AIっぽい囲い・吹き出し」を外し、中身は普通の段落/箇条書きとして残す。
// 対象: スタッフボイス吹き出し / ポイントボックス / Q&Aボックス / まとめボックス
const fs = require('fs');

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node strip-boxes.js <file...>'); process.exit(1); }

function transform(html) {
  let n = 0;
  const count = (re, fn) => { html = html.replace(re, (...a) => { n++; return fn(...a); }); };

  // 1) スタッフボイス吹き出し（background:#f7f4ff＋アバター）→ 中の文章を普通の段落に
  count(/<div style="[^"]*background:#f7f4ff;[^"]*">\s*<div style="[^"]*flex:0 0 auto[^"]*">[\s\S]*?<\/div>\s*<p style="[^"]*">([\s\S]*?)<\/p>\s*<\/div>/g,
    (_m, text) => `<p>${text.trim()}</p>`);

  // 2) ポイントボックス（border-left:5px solid #e86a8e、ラベル＋本文）→ 本文のみ普通の段落に
  count(/<div style="[^"]*border-left:5px solid #e86a8e;[^"]*">\s*<p style="[^"]*">[\s\S]*?<\/p>\s*<p style="[^"]*">([\s\S]*?)<\/p>\s*<\/div>/g,
    (_m, text) => `<p>${text.trim()}</p>`);

  // 3) Q&Aボックス（color:#5a4a8a）→ 普通の段落（Qを太字、Aを改行）
  count(/<div style="[^"]*border:1px solid #eee;[^"]*">\s*<p style="[^"]*color:#5a4a8a;[^"]*">([\s\S]*?)<\/p>\s*<p style="[^"]*">([\s\S]*?)<\/p>\s*<\/div>/g,
    (_m, q, a) => `<p><strong>${q.trim()}</strong><br>${a.trim()}</p>`);

  // 4) まとめボックス（linear-gradient(180deg,#fffaf3）→ 囲いなしの見出し＋箇条書き
  count(/<div style="[^"]*linear-gradient\(180deg,#fffaf3[^"]*">\s*<p style="[^"]*">この記事のまとめ<\/p>\s*<ul style="[^"]*">([\s\S]*?)<\/ul>\s*<\/div>/g,
    (_m, items) => `<p><strong>この記事のまとめ</strong></p>\n<ul style="line-height:2;">${items}</ul>`);

  return { html, n };
}

for (const f of files) {
  const src = fs.readFileSync(f, 'utf-8');
  const { html, n } = transform(src);
  fs.writeFileSync(f, html);
  console.log(`${f}: ${n} 箇所を変換`);
}
