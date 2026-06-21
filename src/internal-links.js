// 過去記事への内部リンクを自動付与するモジュール
//   - 各記事末（末尾CTA直前）に「あわせて読みたい」関連記事ブロックを挿入
//   - 本文中に特徴的なタグ語が出たら文脈リンクを最大2本
//   - リンク先は「公開済み（publishDate <= cutoff）」の過去記事のみ。自記事は除外
//   - 冪等: 既存の自動リンクを除去してから再付与するので、何度実行しても重複しない
//
// 関連度 = タグ一致 + キーワード/サブKWトークン一致 + 同カテゴリ加点

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const salon = JSON.parse(fs.readFileSync(path.join(ROOT, 'salon.json'), 'utf-8'));

function blogUrl(slug) {
  return (salon.blogUrlPattern || 'https://eyelash12.com/blog/{slug}/').replace('{slug}', slug);
}

function todayJST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// briefs/*.json から記事コーパスを構築
function loadCorpus() {
  const dir = path.join(ROOT, 'briefs');
  const items = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === '_template.json') continue;
    let b;
    try { b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')); } catch { continue; }
    if (!b.slug) continue;
    const tags = (b.tags || []).map(t => String(t).trim()).filter(Boolean);
    const terms = new Set(tags);
    const addTokens = s => String(s || '').split(/[\s　,、]+/).filter(x => x.length >= 2).forEach(x => terms.add(x));
    addTokens(b.keyword);
    (b.subKeywords || []).forEach(addTokens);
    items.push({
      slug: b.slug,
      title: b.title || b.slug,
      keyword: String(b.keyword || ''),
      categoryId: b.categoryId || 0,
      publishDate: b.publishDate || '',
      tags,
      terms,
    });
  }
  return items;
}

// タグの文書頻度（distinctive な語ほど低い）
function tagDocFreq(corpus) {
  const df = {};
  for (const a of corpus) for (const t of new Set(a.tags)) df[t] = (df[t] || 0) + 1;
  return df;
}

function scorePair(a, b) {
  let shared = 0;
  for (const t of a.terms) if (b.terms.has(t)) shared++;
  let sharedTags = 0;
  for (const t of a.tags) if (b.tags.includes(t)) sharedTags++;
  let score = shared * 2 + sharedTags * 2;
  if (a.categoryId && a.categoryId === b.categoryId) score += 2;
  return { score, shared, sharedTags };
}

// 関連記事（公開済みのみ）を関連度順に返す
function related(targetSlug, opts = {}) {
  const corpus = opts.corpus || loadCorpus();
  const cutoff = opts.cutoff || todayJST();
  const max = opts.max || 4;
  const T = corpus.find(x => x.slug === targetSlug);
  if (!T) return [];
  const scored = corpus
    .filter(c => c.slug !== targetSlug && c.publishDate && c.publishDate <= cutoff)
    .map(c => ({ ...c, ...scorePair(T, c) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score || b.sharedTags - a.sharedTags || (b.publishDate > a.publishDate ? 1 : -1));
  return scored.slice(0, max);
}

// 「あわせて読みたい」ブロック（色は記事のローズ系で統一・囲みボックスにしない）
function relatedBlock(items) {
  if (!items.length) return '';
  const lis = items.map(it =>
    `<li style="margin:0 0 10px;padding-left:18px;position:relative;line-height:1.7;"><span style="position:absolute;left:0;top:1px;color:#df4d86;font-weight:bold;">―</span><a href="${blogUrl(it.slug)}" style="color:#c43f74;text-decoration:none;font-weight:600;border-bottom:1px solid #f0c3d5;">${escapeHtml(it.title)}</a></li>`
  ).join('\n');
  return `<!-- KATEBLOG_RELATED -->
<div class="kateblog-related" style="margin:34px 0;padding-top:10px;border-top:2px solid #f0d6e0;">
<p style="font-weight:bold;font-size:18px;color:#3a3330;margin:0 0 12px;">あわせて読みたい</p>
<ul style="list-style:none;padding:0;margin:0;">
${lis}
</ul>
</div>
<!-- /KATEBLOG_RELATED -->`;
}

// 既存の自動内部リンクを除去（冪等性）
function stripExisting(html) {
  html = html.replace(/<!-- KATEBLOG_RELATED -->[\s\S]*?<!-- \/KATEBLOG_RELATED -->\s*/g, '');
  html = html.replace(/<a class="kateblog-ilink"[^>]*>([\s\S]*?)<\/a>/g, '$1');
  return html;
}

// アンカーに不向きな汎用語（descriptive でない単独語）は文脈リンクにしない
const STOP_PHRASES = new Set([
  'おすすめ', 'サロン', 'ケア', '女性', '注意', '注意点', '効果', '原因', 'デザイン',
  '蒲田', '大田区', '蒲田駅', '初めて', '当日', '頻度', '書き方', '整え方', '選び方', '直し方',
]);

// 各タグ語を「最もよく表す公開記事」に割り当てる（文脈リンク先の精度を上げる）
function buildPhraseOwners(corpus, cutoff, targetSlug, relatedSlugs) {
  const df = tagDocFreq(corpus);
  const owners = {}; // phrase -> { slug, score, df }
  for (const c of corpus) {
    if (c.slug === targetSlug) continue;
    if (!(c.publishDate && c.publishDate <= cutoff)) continue;
    for (const tag of new Set(c.tags)) {
      if (tag.length < 4) continue;
      if (STOP_PHRASES.has(tag)) continue;
      if ((df[tag] || 0) > 8) continue; // 一般的すぎる語は文脈リンクにしない
      let score = 0;
      if (c.keyword.includes(tag)) score += 3; // フォーカスKWに含む＝その語の本命記事
      if (c.title.includes(tag)) score += 2;
      if (relatedSlugs.has(c.slug)) score += 1; // この記事と関連が強い
      if (score < 1) continue; // 単なるタグ一致だけの弱いリンクは除外
      const prev = owners[tag];
      if (!prev || score > prev.score || (score === prev.score && (df[tag] || 0) < prev.df)) {
        owners[tag] = { slug: c.slug, score, df: df[tag] || 0, phrase: tag };
      }
    }
  }
  return Object.values(owners).sort((a, b) => b.score - a.score || a.df - b.df || b.phrase.length - a.phrase.length);
}

// 本文の <p> 内に文脈リンクを最大 max 本挿入（特徴的なタグ語のテキストノードのみ）
function addInlineLinks(html, corpus, cutoff, targetSlug, relatedSlugs, max = 2) {
  const candidates = buildPhraseOwners(corpus, cutoff, targetSlug, relatedSlugs);

  let used = 0;
  const usedSlugs = new Set();
  const usedPhrases = new Set();

  html = html.replace(/<p>([\s\S]*?)<\/p>/g, (m, inner) => {
    if (used >= max) return m;
    if (/kateblog-cta|kateblog-related/.test(m)) return m;
    for (const c of candidates) {
      if (used >= max) break;
      if (usedSlugs.has(c.slug) || usedPhrases.has(c.phrase)) continue;
      const i = inner.indexOf(c.phrase);
      if (i === -1) continue;
      // タグ（属性）内ではなくテキストノード内であることを確認
      if (inner.lastIndexOf('<', i) > inner.lastIndexOf('>', i)) continue;
      const link = `<a class="kateblog-ilink" href="${blogUrl(c.slug)}" style="color:#c43f74;font-weight:600;border-bottom:1px solid #f0c3d5;text-decoration:none;">${c.phrase}</a>`;
      inner = inner.slice(0, i) + link + inner.slice(i + c.phrase.length);
      used++; usedSlugs.add(c.slug); usedPhrases.add(c.phrase);
      break; // 1段落につき1リンク
    }
    return '<p>' + inner + '</p>';
  });
  return html;
}

// 記事HTMLに内部リンクを付与（冪等）
function applyInternalLinks(html, targetSlug, opts = {}) {
  const corpus = opts.corpus || loadCorpus();
  const cutoff = opts.cutoff || todayJST();
  html = stripExisting(html);
  const items = related(targetSlug, { corpus, cutoff, max: opts.maxRelated || 4 });
  if (!items.length) return { html, count: 0, inline: 0 };
  const relatedSlugs = new Set(related(targetSlug, { corpus, cutoff, max: 8 }).map(r => r.slug));

  // 末尾CTA（公式LINE導入文）の直前で本文/末尾を分割
  const anchor = '<p>KATEstageLASH蒲田西口店の公式LINEでは';
  let idx = html.indexOf(anchor);
  if (idx === -1) {
    const f = html.indexOf('<script type="application/ld+json">');
    idx = f === -1 ? html.length : f;
  }
  let body = html.slice(0, idx);
  const tail = html.slice(idx);

  // 文脈リンクは本文部分のみに付与
  const before = (body.match(/kateblog-ilink/g) || []).length;
  body = addInlineLinks(body, corpus, cutoff, targetSlug, relatedSlugs, opts.maxInline != null ? opts.maxInline : 2);
  const inline = (body.match(/kateblog-ilink/g) || []).length - before;

  const block = relatedBlock(items);
  const out = body.replace(/\s*$/, '') + '\n\n' + block + '\n\n' + tail;
  return { html: out, count: items.length, inline };
}

module.exports = { applyInternalLinks, related, loadCorpus, relatedBlock, blogUrl, todayJST };
