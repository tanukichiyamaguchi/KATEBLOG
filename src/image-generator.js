const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const salon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'salon.json'), 'utf-8'));

function selectTheme(title) {
  const themes = salon.imageThemes;
  const themeOrder = ['eyelashPerm', 'eyebrow', 'eyelashCare', 'localArea', 'beautyGeneral'];
  for (const key of themeOrder) {
    const theme = themes[key];
    if (theme.triggers.length === 0) continue;
    if (theme.triggers.some(t => title.includes(t))) {
      return { key, ...theme };
    }
  }
  return { key: 'beautyGeneral', ...themes.beautyGeneral };
}

function generateGradientVariation(baseFrom, baseTo, index) {
  const shift = (index * 12) % 30;
  const adjustColor = (hex, amount) => {
    const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount));
    const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount));
    const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };
  return {
    from: adjustColor(baseFrom, shift - 15),
    to: adjustColor(baseTo, 15 - shift)
  };
}

function wrapText(text, maxCharsPerLine) {
  const lines = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (current.length >= maxCharsPerLine) {
      lines.push(current);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines;
}

// まつ毛の装飾SVGパーツ
function getLashDecoration(themeKey) {
  if (themeKey === 'eyelashPerm' || themeKey === 'eyelashCare') {
    // まつ毛をイメージした曲線装飾（上部）
    return `
    <g opacity="0.15">
      <path d="M200,80 Q400,20 600,60 Q800,100 1000,50" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
      <path d="M180,110 Q400,50 600,90 Q800,130 1020,70" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"/>
      <path d="M220,140 Q420,80 620,120 Q820,160 980,100" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </g>
    <g opacity="0.08">
      <circle cx="150" cy="500" r="80" fill="white"/>
      <circle cx="1050" cy="130" r="60" fill="white"/>
    </g>`;
  }
  if (themeKey === 'eyebrow') {
    // アーチ型の装飾（眉毛をイメージ）
    return `
    <g opacity="0.12">
      <path d="M250,100 Q600,30 950,100" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>
      <path d="M280,130 Q600,65 920,130" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
    </g>
    <g opacity="0.08">
      <circle cx="100" cy="530" r="70" fill="white"/>
      <circle cx="1100" cy="100" r="50" fill="white"/>
    </g>`;
  }
  // デフォルト: エレガントな円形装飾
  return `
    <g opacity="0.08">
      <circle cx="100" cy="100" r="120" fill="white"/>
      <circle cx="1100" cy="530" r="100" fill="white"/>
      <circle cx="1050" cy="80" r="40" fill="white"/>
    </g>`;
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function generateImage(headingText, articleTitle, index, outputDir) {
  const width = 1200;
  const height = 630;
  const theme = selectTheme(articleTitle);
  const colors = generateGradientVariation(theme.gradient.from, theme.gradient.to, index);

  const lines = wrapText(headingText, 16);
  const lineHeight = 58;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (height - totalTextHeight) / 2 - 30;

  const textElements = lines.map((line, i) => {
    const y = startY + 60 + i * lineHeight;
    return `<text x="600" y="${y}" font-family="'Meiryo', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif" font-size="42" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="middle" letter-spacing="2">${escapeXml(line)}</text>`;
  }).join('\n    ');

  // テーマに合わせた装飾
  const decoration = getLashDecoration(theme.key);

  const salonNameText = salon.name;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg${index}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.from};stop-opacity:1" />
      <stop offset="50%" style="stop-color:${colors.to};stop-opacity:0.9" />
      <stop offset="100%" style="stop-color:${colors.from};stop-opacity:0.85" />
    </linearGradient>
    <filter id="shadow${index}">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-opacity="0.3"/>
    </filter>
  </defs>

  <!-- 背景グラデーション -->
  <rect width="${width}" height="${height}" fill="url(#bg${index})" />

  <!-- テーマ別装飾 -->
  ${decoration}

  <!-- 上品なフレーム -->
  <rect x="50" y="50" width="${width - 100}" height="${height - 100}" rx="12" ry="12" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1.5" />
  <rect x="60" y="60" width="${width - 120}" height="${height - 120}" rx="8" ry="8" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1" />

  <!-- 見出しテキスト -->
  <g filter="url(#shadow${index})">
    ${textElements}
  </g>

  <!-- 区切り線 -->
  <line x1="450" y1="${startY + totalTextHeight + 70}" x2="750" y2="${startY + totalTextHeight + 70}" stroke="rgba(255,255,255,0.5)" stroke-width="1.5" stroke-linecap="round" />

  <!-- 小さなダイヤモンド装飾 -->
  <rect x="596" y="${startY + totalTextHeight + 64}" width="8" height="8" rx="1" fill="rgba(255,255,255,0.6)" transform="rotate(45, 600, ${startY + totalTextHeight + 68})" />

  <!-- サロン名 -->
  <text x="600" y="${startY + totalTextHeight + 108}" font-family="'Meiryo', 'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif" font-size="20" fill="rgba(255,255,255,0.7)" text-anchor="middle" letter-spacing="4">${escapeXml(salonNameText)}</text>
</svg>`;

  const filename = `image-${index}.png`;
  const outputPath = path.join(outputDir, filename);

  await sharp(Buffer.from(svg))
    .resize(width, height)
    .png({ quality: 90 })
    .toFile(outputPath);

  return { filename, outputPath };
}

async function generateArticleImages(htmlContent, articleTitle, outputDir) {
  const h2Regex = /<h2[^>]*>(.*?)<\/h2>/gi;
  const headings = [];
  let match;
  while ((match = h2Regex.exec(htmlContent)) !== null) {
    headings.push(match[1].replace(/<[^>]+>/g, '').trim());
  }

  if (headings.length === 0) {
    console.log('  警告: H2見出しが見つかりませんでした');
    return [];
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (let i = 0; i < headings.length; i++) {
    const result = await generateImage(headings[i], articleTitle, i, outputDir);
    results.push({ heading: headings[i], ...result });
    console.log(`  画像生成: ${result.filename} ← 「${headings[i]}」`);
  }

  return results;
}

module.exports = { generateArticleImages, generateImage, selectTheme };
