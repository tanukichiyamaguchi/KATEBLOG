const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const salon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'salon.json'), 'utf-8'));

function selectTheme(title) {
  const themes = salon.imageThemes;
  // Check in priority order: specific topics first, then general
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
  // Create subtle variations for each image
  const shift = (index * 15) % 40;
  const adjustColor = (hex, amount) => {
    const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + amount));
    const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + amount));
    const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + amount));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };
  return {
    from: adjustColor(baseFrom, shift - 20),
    to: adjustColor(baseTo, 20 - shift)
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

async function generateImage(headingText, articleTitle, index, outputDir) {
  const width = 1200;
  const height = 630;
  const theme = selectTheme(articleTitle);
  const colors = generateGradientVariation(theme.gradient.from, theme.gradient.to, index);

  // Wrap heading text for display
  const lines = wrapText(headingText, 18);
  const lineHeight = 56;
  const totalTextHeight = lines.length * lineHeight;
  const startY = (height - totalTextHeight) / 2 - 20;

  // Build SVG text elements
  const textElements = lines.map((line, i) => {
    const y = startY + 60 + i * lineHeight;
    return `<text x="600" y="${y}" font-family="'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif" font-size="44" font-weight="bold" fill="${theme.textColor}" text-anchor="middle" dominant-baseline="middle">${escapeXml(line)}</text>`;
  }).join('\n    ');

  // Salon name at bottom
  const salonNameText = salon.name;

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${colors.from};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${colors.to};stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)" />
  <rect x="40" y="40" width="${width - 80}" height="${height - 80}" rx="16" ry="16" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" />
  <line x1="100" y1="${startY + totalTextHeight + 70}" x2="${width - 100}" y2="${startY + totalTextHeight + 70}" stroke="rgba(255,255,255,0.4)" stroke-width="1" />
  ${textElements}
  <text x="600" y="${startY + totalTextHeight + 110}" font-family="'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif" font-size="22" fill="rgba(255,255,255,0.8)" text-anchor="middle">${escapeXml(salonNameText)}</text>
</svg>`;

  const filename = `image-${index}.png`;
  const outputPath = path.join(outputDir, filename);

  await sharp(Buffer.from(svg))
    .resize(width, height)
    .png({ quality: 90 })
    .toFile(outputPath);

  return { filename, outputPath };
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function generateArticleImages(htmlContent, articleTitle, outputDir) {
  // Extract H2 headings from HTML
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
