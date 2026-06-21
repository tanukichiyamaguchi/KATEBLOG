// 記事HTMLのCTAを「KSESに強い」形に修正する。
//  - WordPressは投稿本文の <style> と <svg> を除去するため、本文には入れない
//  - ボタンは大きく押しやすいデザイン（絵文字アイコン＋角丸＋影、インラインstyleのみ）
//  - ホバー/シマー/パルス等の動的効果はプラグイン(wp_head)のCSSが付与（.kateblog-cta-*）
const fs = require('fs');

// 立体的なボタン（下に厚みのある base edge ＋ 上面グロス）。動的(光る/押し込み)はプラグインCSSが付与。
const LINE_STYLE = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;max-width:430px;box-sizing:border-box;padding:18px 28px;background:linear-gradient(180deg,#1be072 0%,#04b34c 100%);color:#fff;font-size:18px;font-weight:bold;text-decoration:none;border:0;border-radius:16px;box-shadow:0 6px 0 #04923f,0 10px 20px rgba(6,199,85,0.45),inset 0 2px 0 rgba(255,255,255,0.45);text-shadow:0 1px 1px rgba(0,0,0,0.18);position:relative;overflow:hidden;';
const BOOK_STYLE = 'display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;max-width:430px;box-sizing:border-box;padding:18px 28px;background:linear-gradient(180deg,#ff6a6a 0%,#e6001e 100%);color:#fff;font-size:18px;font-weight:bold;text-decoration:none;border:0;border-radius:16px;box-shadow:0 6px 0 #b3001a,0 10px 20px rgba(230,0,30,0.45),inset 0 2px 0 rgba(255,255,255,0.45);text-shadow:0 1px 1px rgba(0,0,0,0.18);position:relative;overflow:hidden;';

function transform(html) {
  // 1) <style> ブロックを削除（本文に表示される「変なコード」の元）
  html = html.replace(/<style>[\s\S]*?<\/style>\s*/g, '');

  // 2) ボタンの style を新デザインに差し替え（class 基準）
  html = html.replace(/(class="kateblog-cta-line" style=")[^"]*(")/g, `$1${LINE_STYLE}$2`);
  html = html.replace(/(class="kateblog-cta-booking" style=")[^"]*(")/g, `$1${BOOK_STYLE}$2`);

  // 3) ボタン内の <svg>（KSESで除去される）を絵文字アイコンに置換
  html = html.replace(/(<a [^>]*class="kateblog-cta-line"[^>]*>)\s*<svg[\s\S]*?<\/svg>\s*/g, '$1<span aria-hidden="true">💬</span> ');
  html = html.replace(/(<a [^>]*class="kateblog-cta-booking"[^>]*>)\s*<svg[\s\S]*?<\/svg>\s*/g, '$1<span aria-hidden="true">📅</span> ');

  // 4) 余分な空行を整理
  html = html.replace(/\n{3,}/g, '\n\n');
  return html;
}

const files = process.argv.slice(2);
for (const f of files) {
  const out = transform(fs.readFileSync(f, 'utf-8'));
  fs.writeFileSync(f, out);
  console.log(`fixed CTA: ${f}`);
}
