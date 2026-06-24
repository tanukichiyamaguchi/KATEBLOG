// 記事HTMLのCTAを「KSESに強い」形に整える。
//  - 本文には <style>/<svg> を入れない（WPが除去するため）
//  - 絵文字は入れない（テキストのみ）
//  - 配色は記事のパステル（表紙・図解）に馴染むローズ/ラベンダーで一貫
//  - 立体感（厚み・グロス）はインライン、光る/押し込みの動的CSSはプラグイン(wp_head)が付与
const fs = require('fs');

// LINE = ラベンダー / 予約 = ローズ
// ※ width:100%+padding+box-sizing は WordPress(KSES)が box-sizing を除去すると右側に横はみ出し（余白/横スクロール）の原因に。
//    width指定をやめ display:flex+max-width+margin:0 auto で「親の枠内に必ず収まる」実装にする（box-sizing非依存）。
const LINE_STYLE = 'display:flex;align-items:center;justify-content:center;max-width:430px;margin:0 auto;padding:18px 22px;background:linear-gradient(180deg,#a98fe6 0%,#8265cf 100%);color:#fff;font-size:17px;font-weight:bold;letter-spacing:.02em;text-decoration:none;border:0;border-radius:16px;box-shadow:0 6px 0 #6a4bb0,0 10px 20px rgba(130,101,207,0.40),inset 0 2px 0 rgba(255,255,255,0.40);text-shadow:0 1px 1px rgba(0,0,0,0.18);position:relative;overflow:hidden;';
const BOOK_STYLE = 'display:flex;align-items:center;justify-content:center;max-width:430px;margin:0 auto;padding:18px 22px;background:linear-gradient(180deg,#f178a6 0%,#df4d86 100%);color:#fff;font-size:17px;font-weight:bold;letter-spacing:.02em;text-decoration:none;border:0;border-radius:16px;box-shadow:0 6px 0 #bf3a6e,0 10px 20px rgba(223,77,134,0.42),inset 0 2px 0 rgba(255,255,255,0.40);text-shadow:0 1px 1px rgba(0,0,0,0.18);position:relative;overflow:hidden;';

function transform(html) {
  // 1) <style> ブロックを削除
  html = html.replace(/<style>[\s\S]*?<\/style>\s*/g, '');

  // 2) ボタンの style を新デザインに差し替え（class 基準）
  html = html.replace(/(class="kateblog-cta-line" style=")[^"]*(")/g, `$1${LINE_STYLE}$2`);
  html = html.replace(/(class="kateblog-cta-booking" style=")[^"]*(")/g, `$1${BOOK_STYLE}$2`);

  // 3) ボタン内の絵文字span / svg を除去（テキストのみにする。LINEアイコンはプラグインCSSが付与）
  html = html.replace(/(<a [^>]*class="kateblog-cta-(?:line|booking)"[^>]*>)\s*<span aria-hidden="true">[^<]*<\/span>\s*/g, '$1');
  html = html.replace(/(<a [^>]*class="kateblog-cta-(?:line|booking)"[^>]*>)\s*<svg[\s\S]*?<\/svg>\s*/g, '$1');

  // 4) CTAラベルの統一
  html = html.replace(/空き枠確認・予約（ホットペッパービューティー）/g, '空席確認・予約する');
  html = html.replace(/公式LINEでお得な情報を受け取る/g, '限定特典配布中');

  // 5) 余分な空行を整理
  html = html.replace(/\n{3,}/g, '\n\n');
  return html;
}

const files = process.argv.slice(2);
for (const f of files) {
  fs.writeFileSync(f, transform(fs.readFileSync(f, 'utf-8')));
  console.log(`fixed CTA: ${f}`);
}
