// 手書き風「図解」生成モジュール
// 画像AIに日本語文字を描かせると崩れるため、図解はこちらで
// 手書きフォント（既定: Zen Kurenaido）＋手描き風SVGで描画して PNG 化する。
// → 日本語が崩れず、「人が書いたノート」のような分かりやすい図解になる。
//
// レイアウト: cards | steps | checklist | point | compare
// 画像は image-{index}.png（1200×630）で出力（写真生成と同じ命名）。

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const W = 1200, H = 630;
const PAPER = '#fbf8f1';
const INK = '#3a3330';
const ACCENT = '#e86a8e';
const SUB = '#b9a98f';
const CARD_BG = ['#fde7ee', '#eaf3ff', '#fff3d9', '#e9f7ef'];
const CARD_BD = ['#f3b8cb', '#bcd6f5', '#f0d59a', '#bfe6cf'];

function font() {
  return process.env.DIAGRAM_FONT || 'Zen Kurenaido';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 日本語向けの素朴な折り返し（おおよそ1文字=font-size幅で計算）
function wrap(text, maxChars) {
  const out = [];
  let cur = '';
  for (const ch of String(text)) {
    cur += ch;
    if ([...cur].length >= maxChars) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

function tspans(lines, x, dy) {
  return lines.map((ln, i) =>
    `<tspan x="${x}" dy="${i === 0 ? 0 : dy}">${esc(ln)}</tspan>`).join('');
}

function bg() {
  const rules = Array.from({ length: 9 },
    (_, i) => `<line x1="40" y1="${70 + i * 62}" x2="${W - 40}" y2="${70 + i * 62}" stroke="#ece6da" stroke-width="1.5"/>`).join('');
  return `
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <g opacity="0.5">${rules}</g>
  <line x1="92" y1="40" x2="92" y2="${H - 30}" stroke="#f3c9cf" stroke-width="2" opacity="0.6"/>`;
}

function footer() {
  return `<text x="${W - 60}" y="${H - 28}" font-family="${font()}" font-size="22" fill="${SUB}" text-anchor="end">KATEstageLASH蒲田西口店</text>`;
}

function titleBlock(title) {
  const lines = wrap(title, 18);
  const fs2 = lines.length > 1 ? 40 : 50;
  const y0 = lines.length > 1 ? 78 : 108;
  const underlineY = y0 + (lines.length - 1) * (fs2 + 6) + 24;
  return `
  <g filter="url(#roughLine)">
    <text x="${W / 2}" y="${y0}" font-family="${font()}" font-size="${fs2}" fill="${INK}" text-anchor="middle" font-weight="700">${tspans(lines, W / 2, fs2 + 6)}</text>
    <path d="M${W / 2 - 250},${underlineY} q250,26 500,0" fill="none" stroke="${ACCENT}" stroke-width="6" stroke-linecap="round" opacity="0.85"/>
  </g>`;
}

function defs() {
  return `
  <defs>
    <filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.0"/></filter>
    <filter id="roughLine"><feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter>
  </defs>`;
}

// --- レイアウト: cards / steps（横並びカード。steps は矢印付き） ---
function layoutCards(spec, withArrows) {
  const items = (spec.items || []).slice(0, 4);
  const n = items.length || 1;
  const gap = 28;
  const margin = 96;
  const totalW = W - margin * 2;
  const cw = Math.min(320, (totalW - gap * (n - 1)) / n);
  const startX = (W - (cw * n + gap * (n - 1))) / 2;
  const y = 250, ch = 250;

  const cards = items.map((it, i) => {
    const x = startX + i * (cw + gap);
    const cx = x + cw / 2, cy = y + ch / 2;
    const rot = (i - (n - 1) / 2) * 1.4;
    const lines = wrap(it, Math.max(6, Math.floor(cw / 34)));
    return `
    <g transform="rotate(${rot} ${cx} ${cy})" filter="url(#rough)">
      <rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="18" fill="${CARD_BG[i % 4]}" stroke="${CARD_BD[i % 4]}" stroke-width="3"/>
      <circle cx="${x + 40}" cy="${y + 42}" r="26" fill="#fff" stroke="${ACCENT}" stroke-width="3"/>
      <text x="${x + 40}" y="${y + 54}" font-family="${font()}" font-size="34" fill="${ACCENT}" text-anchor="middle">${i + 1}</text>
      <text x="${cx}" y="${y + 130}" font-family="${font()}" font-size="32" fill="${INK}" text-anchor="middle" font-weight="700">${tspans(lines, cx, 40)}</text>
    </g>`;
  }).join('');

  let arrows = '';
  if (withArrows) {
    for (let i = 0; i < n - 1; i++) {
      const ax = startX + (i + 1) * (cw + gap) - gap / 2;
      const ay = y + ch / 2;
      arrows += `<g filter="url(#roughLine)" opacity="0.8">
        <path d="M${ax - 24},${ay} q24,-14 48,0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
        <path d="M${ax + 16},${ay - 7} l10,7 -11,6" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    }
  }
  return cards + arrows;
}

// --- レイアウト: checklist（縦並びチェックリスト） ---
function layoutChecklist(spec) {
  const items = (spec.items || []).slice(0, 5);
  const px = 150, pw = W - 300;
  const py = 200, rowH = 64;
  const ph = items.length * rowH + 40;
  const panel = `<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="20" fill="#ffffff" stroke="#eadfce" stroke-width="3" filter="url(#rough)"/>`;
  const rows = items.map((it, i) => {
    const ry = py + 30 + i * rowH + 18;
    const lines = wrap(it, 22);
    return `
    <g filter="url(#roughLine)">
      <circle cx="${px + 44}" cy="${ry - 8}" r="18" fill="#eafaf0" stroke="#06C755" stroke-width="3"/>
      <path d="M${px + 36},${ry - 9} l6,7 12,-14" fill="none" stroke="#06C755" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${px + 80}" y="${ry}" font-family="${font()}" font-size="30" fill="${INK}">${tspans(lines, px + 80, 36)}</text>
    </g>`;
  }).join('');
  return panel + rows;
}

// --- レイアウト: point（ひとつの要点を大きく） ---
function layoutPoint(spec) {
  const text = spec.text || (spec.items || [])[0] || '';
  const lines = wrap(text, 16);
  const px = 160, pw = W - 320, py = 230, ph = 260;
  const cx = W / 2;
  const startY = py + ph / 2 - (lines.length - 1) * 26 - 6;
  return `
  <g filter="url(#rough)">
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="24" fill="#fff7fa" stroke="${ACCENT}" stroke-width="3"/>
    <circle cx="${px + 48}" cy="${py + 46}" r="22" fill="#fff" stroke="${ACCENT}" stroke-width="3"/>
    <text x="${px + 48}" y="${py + 58}" font-family="${font()}" font-size="30" fill="${ACCENT}" text-anchor="middle" font-weight="700">!</text>
  </g>
  <text x="${cx}" y="${startY}" font-family="${font()}" font-size="40" fill="${INK}" text-anchor="middle" font-weight="700">${tspans(lines, cx, 56)}</text>`;
}

// --- レイアウト: compare（2カラム比較） ---
function layoutCompare(spec) {
  const cols = [spec.left, spec.right].map(c => c || { head: '', items: [] });
  const colW = 470, gap = 60, y = 220, ph = 290;
  const startX = (W - (colW * 2 + gap)) / 2;
  const heads = ['#fde7ee', '#eaf3ff'];
  const heads2 = ['#f3b8cb', '#bcd6f5'];
  return cols.map((c, i) => {
    const x = startX + i * (colW + gap);
    const headLines = wrap(c.head, 14);
    const items = (c.items || []).slice(0, 4);
    const lis = items.map((it, j) => {
      const ly = y + 110 + j * 52;
      const lines = wrap(it, 16);
      return `<text x="${x + 30}" y="${ly}" font-family="${font()}" font-size="27" fill="${INK}">${tspans(['・' + lines[0], ...lines.slice(1).map(s => '　' + s)], x + 30, 32)}</text>`;
    }).join('');
    return `
    <g filter="url(#rough)">
      <rect x="${x}" y="${y}" width="${colW}" height="${ph}" rx="20" fill="#ffffff" stroke="${heads2[i]}" stroke-width="3"/>
      <rect x="${x}" y="${y}" width="${colW}" height="64" rx="20" fill="${heads[i]}"/>
      <rect x="${x}" y="${y + 40}" width="${colW}" height="24" fill="${heads[i]}"/>
      <text x="${x + colW / 2}" y="${y + 44}" font-family="${font()}" font-size="30" fill="${INK}" text-anchor="middle" font-weight="700">${tspans(headLines, x + colW / 2, 34)}</text>
      ${lis}
    </g>`;
  }).join('');
}

function buildSVG(spec) {
  if ((spec.layout || '').toLowerCase() === 'cover') {
    return coverSVG(spec);
  }
  let body = '';
  switch ((spec.layout || 'cards').toLowerCase()) {
    case 'steps': body = layoutCards(spec, true); break;
    case 'checklist': body = layoutChecklist(spec); break;
    case 'point': body = layoutPoint(spec); break;
    case 'compare': body = layoutCompare(spec); break;
    case 'cards':
    default: body = layoutCards(spec, false); break;
  }
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  ${defs()}
  ${bg()}
  ${spec.title ? titleBlock(spec.title) : ''}
  ${body}
  ${footer()}
</svg>`;
}

// --- 表紙（アイキャッチ）: タイトルを大きく・高視認性で ---
function coverSVG(spec) {
  const title = spec.title || '';
  const chars = [...title].length;
  // 表紙タイトルは「1行・14文字程度」を基本に、15文字までは1行で大きく表示
  let size, maxChars;
  if (chars <= 10) { size = 66; maxChars = 10; }
  else if (chars <= 15) { size = 58; maxChars = 15; }
  else if (chars <= 28) { size = 48; maxChars = 14; }
  else { size = 42; maxChars = 16; }
  // 行を均等割りして最終行の孤立（1文字だけ等）を防ぐ
  const numLines = Math.max(1, Math.ceil(chars / maxChars));
  const lines = wrap(title, Math.ceil(chars / numLines));

  // タイトルカード（中央）
  const cardX = 90, cardW = W - 180;
  const lineH = size + 16;
  const textH = lines.length * lineH;
  const cardH = Math.max(260, textH + 150);
  const cardY = (H - cardH) / 2 + 14;
  const cx = W / 2;
  const textTop = cardY + (cardH - textH) / 2 + size * 0.78;

  // 中央寄せの行ごとに、後ろへマーカー帯を敷いて視認性UP
  const titleLines = lines.map((ln, i) => {
    const y = textTop + i * lineH;
    const w = Math.min(cardW - 80, [...ln].length * size * 1.02);
    const hx = cx - w / 2;
    return `
      <rect x="${hx}" y="${y - size * 0.72}" width="${w}" height="${size * 0.86}" rx="6" fill="#ffe1ec" opacity="0.9"/>
      <text x="${cx}" y="${y}" font-family="${font()}" font-size="${size}" fill="${INK}" text-anchor="middle" font-weight="700">${esc(ln)}</text>`;
  }).join('');

  const cat = spec.category || 'KATEstageLASH';

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cover" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffd9e6"/>
      <stop offset="50%" stop-color="#fff2e2"/>
      <stop offset="100%" stop-color="#e9defb"/>
    </linearGradient>
    <filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/></filter>
    <filter id="soft"><feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#d98aa6" flood-opacity="0.25"/></filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#cover)"/>

  <!-- まつ毛モチーフ（上部・控えめ） -->
  <g opacity="0.18" stroke="#fff" fill="none" stroke-linecap="round">
    <path d="M120,90 Q400,30 680,80" stroke-width="4"/>
    <path d="M150,130 Q420,70 720,120" stroke-width="3"/>
    <path d="M1040,520 Q900,470 760,520" stroke-width="3"/>
  </g>
  <g opacity="0.16" fill="#fff">
    <circle cx="1080" cy="120" r="60"/><circle cx="150" cy="520" r="48"/>
  </g>

  <!-- カテゴリピル -->
  <g filter="url(#rough)">
    <rect x="${W / 2 - 130}" y="${cardY - 70}" width="260" height="50" rx="25" fill="#fff" stroke="${ACCENT}" stroke-width="2.5"/>
    <text x="${W / 2}" y="${cardY - 36}" font-family="${font()}" font-size="26" fill="${ACCENT}" text-anchor="middle" font-weight="700">${esc(cat)}</text>
  </g>

  <!-- タイトルカード -->
  <g filter="url(#soft)"><rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="26" fill="#ffffff" opacity="0.96"/></g>
  <rect x="${cardX + 12}" y="${cardY + 12}" width="${cardW - 24}" height="${cardH - 24}" rx="20" fill="none" stroke="${ACCENT}" stroke-width="2.5" stroke-dasharray="2 10" stroke-linecap="round" opacity="0.7" filter="url(#rough)"/>
  ${titleLines}

  <text x="${W / 2}" y="${cardY + cardH + 44}" font-family="${font()}" font-size="24" fill="#8a6f57" text-anchor="middle">アイブロウ・まつ毛専門サロン｜蒲田駅西口</text>
</svg>`;
}

// "layout=cards; title=...; items=A|B|C" / compare は left/right を head:items;items 形式で
function parseDiagramSpec(str) {
  const spec = {};
  const parts = String(str).split(/\s*;\s*/);
  for (const p of parts) {
    const idx = p.indexOf('=');
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim();
    const val = p.slice(idx + 1).trim();
    if (key === 'items') spec.items = val.split('|').map(s => s.trim()).filter(Boolean);
    else if (key === 'left' || key === 'right') spec[key] = parseColumn(val);
    else spec[key] = val;
  }
  return spec;
}

// "見出し:項目1,項目2,項目3"
function parseColumn(val) {
  const ci = val.indexOf(':');
  if (ci === -1) return { head: val, items: [] };
  return {
    head: val.slice(0, ci).trim(),
    items: val.slice(ci + 1).split(',').map(s => s.trim()).filter(Boolean),
  };
}

async function generateDiagram(spec, index, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const svg = buildSVG(spec);
  const filename = `image-${index}.png`;
  const outputPath = path.join(outputDir, filename);
  await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(outputPath);
  return { filename, outputPath };
}

module.exports = { generateDiagram, parseDiagramSpec, buildSVG };
