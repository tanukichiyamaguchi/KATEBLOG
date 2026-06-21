// 週1自動公開のためのキュー管理
//
// 設計:
//   - 公開待ちの記事は queue/{slug}.html にストックする（WPプラグインは output/ のみ走査するため、
//     queue/ に置いている間は取り込まれない = 安全にストックできる）。
//   - 週次 GitHub Actions（cron）が publishNext() を1回呼ぶ。
//   - publishNext() は queue/queue.json の先頭スラッグを1本取り出し、
//       1) OpenAI/sharp で画像を output/images-{slug}/ に生成
//       2) queue/{slug}.html → output/{slug}.html へ移動
//       3) briefs/{slug}.json の publishDate / publishTime を当日（JST）にセット
//       4) queue.json の pending → published へ移す
//     を行う。あとはワークフローが commit & push し、WPプラグインが1時間以内に取り込んで予約公開する。

const fs = require('fs');
const path = require('path');
const { generateImages } = require('./image-provider');
const { applyInternalLinks } = require('./internal-links');

const ROOT = path.join(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'queue');
const OUTPUT_DIR = path.join(ROOT, 'output');
const BRIEFS_DIR = path.join(ROOT, 'briefs');
const QUEUE_FILE = path.join(QUEUE_DIR, 'queue.json');

// JST（Asia/Tokyo）の YYYY-MM-DD を返す
function todayJST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA は YYYY-MM-DD 形式
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

// queue.json を読み込む。無ければ queue/*.html から自動生成
function loadQueue() {
  let q = readJson(QUEUE_FILE, null);
  if (!q) {
    const pending = fs.existsSync(QUEUE_DIR)
      ? fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, '')).sort()
      : [];
    q = { pending, published: [] };
  }
  if (!Array.isArray(q.pending)) q.pending = [];
  if (!Array.isArray(q.published)) q.published = [];
  return q;
}

function extractMetaFromHtml(html) {
  const get = re => { const m = html.match(re); return m ? m[1].trim() : ''; };
  return {
    title: get(/<!--\s*TITLE:\s*(.+?)\s*-->/),
    metaDescription: get(/<!--\s*META:\s*(.+?)\s*-->/),
    keyword: get(/<!--\s*KEYWORD:\s*(.+?)\s*-->/),
    categoryId: parseInt(get(/<!--\s*CATEGORY:\s*(\d+)\s*-->/) || '27', 10),
    slug: get(/<!--\s*SLUG:\s*(.+?)\s*-->/),
  };
}

// ブリーフの publishDate / publishTime を更新（無ければHTMLメタから最小限を生成）
function upsertBriefDate(slug, html, date, time) {
  const briefPath = path.join(BRIEFS_DIR, `${slug}.json`);
  let brief = readJson(briefPath, null);
  if (!brief) {
    const meta = extractMetaFromHtml(html);
    brief = {
      keyword: meta.keyword,
      category: '',
      categoryId: meta.categoryId,
      slug,
      title: meta.title,
      metaDescription: meta.metaDescription,
    };
  }
  brief.publishDate = date;
  brief.publishTime = time;
  fs.mkdirSync(BRIEFS_DIR, { recursive: true });
  writeJson(briefPath, brief);
  return briefPath;
}

function moveFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  fs.unlinkSync(src);
}

function rmDirIfExists(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

// キューの先頭1本を公開準備（output/ へ移動 + 画像生成 + ブリーフ日付セット）
async function publishNext(options = {}) {
  const q = loadQueue();
  const date = options.date || todayJST();
  const time = options.time || '11:00';

  if (q.pending.length === 0) {
    return { published: false, reason: 'empty', message: 'キューに公開待ちの記事がありません。' };
  }

  const slug = q.pending[0];
  const htmlSrc = path.join(QUEUE_DIR, `${slug}.html`);
  if (!fs.existsSync(htmlSrc)) {
    // 実体が無いエントリはスキップして除去
    q.pending.shift();
    writeJson(QUEUE_FILE, q);
    return { published: false, reason: 'missing', slug, message: `queue/${slug}.html が見つからないためスキップしました。` };
  }

  const html = fs.readFileSync(htmlSrc, 'utf-8');
  const meta = extractMetaFromHtml(html);
  const title = meta.title || slug;
  const htmlDest = path.join(OUTPUT_DIR, `${slug}.html`);
  const imageDir = path.join(OUTPUT_DIR, `images-${slug}`);

  if (options.dryRun) {
    return {
      published: false,
      dryRun: true,
      slug,
      title,
      date,
      time,
      remaining: q.pending.length - 1,
      message: `[dry-run] 次に公開: ${slug}（${date} ${time}）`,
    };
  }

  // 1. 画像生成（OpenAI写真風 / sharp）
  const images = await generateImages(html, title, imageDir, { provider: options.provider });

  // 2. 過去記事への内部リンクを自動付与（公開済みの記事のみリンク）
  let linkInfo = { count: 0, inline: 0 };
  let outHtml = html;
  try {
    const r = applyInternalLinks(html, slug, { cutoff: date });
    outHtml = r.html;
    linkInfo = { count: r.count, inline: r.inline };
  } catch (e) {
    console.log(`  ⚠️ 内部リンク付与をスキップ: ${e.message}`);
  }

  // 3. HTML を output/ へ書き出し（queue 側は削除）
  fs.mkdirSync(path.dirname(htmlDest), { recursive: true });
  fs.writeFileSync(htmlDest, outHtml);
  fs.unlinkSync(htmlSrc);
  rmDirIfExists(path.join(QUEUE_DIR, `images-${slug}`));
  console.log(`  🔗 内部リンク: 関連${linkInfo.count}件 / 文脈リンク${linkInfo.inline}本`);

  // 4. ブリーフに公開日時をセット
  const briefPath = upsertBriefDate(slug, html, date, time);

  // 4. キュー更新
  q.pending.shift();
  q.published.push({ slug, title, date, time, publishedAt: new Date().toISOString() });
  writeJson(QUEUE_FILE, q);

  return {
    published: true,
    slug,
    title,
    date,
    time,
    images: images.length,
    provider: images[0] ? images[0].provider : 'n/a',
    htmlDest: path.relative(ROOT, htmlDest),
    briefPath: path.relative(ROOT, briefPath),
    remaining: q.pending.length,
    message: `${slug} を output/ へ移動し、${date} ${time}（JST）公開予定にセットしました。`,
  };
}

function queueStatus() {
  const q = loadQueue();
  return q;
}

module.exports = { publishNext, queueStatus, loadQueue, todayJST };
