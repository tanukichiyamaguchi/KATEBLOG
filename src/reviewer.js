const fs = require('fs');
const axios = require('axios');

// Forbidden patterns that indicate AI prompt leakage or quality issues
const FORBIDDEN_PATTERNS = [
  { pattern: /【[^】]*】/g, label: 'プロンプト指示の残留（【】形式）' },
  { pattern: /\u{FFFD}/gu, label: '文字化け（U+FFFD）' },
  { pattern: /example\.com/gi, label: 'ダミーURL（example.com）' },
  { pattern: /dummy\.(com|jp|org)/gi, label: 'ダミーURL' },
  { pattern: /https?:\/\/placeholder/gi, label: 'プレースホルダーURL' },
  { pattern: />>\s*[^\s<]+はこちら/g, label: '「>>○○はこちら」形式のCTAリンク' },
  { pattern: /以下に[、。]/g, label: 'AI指示残留（「以下に」）' },
  { pattern: /結論を太字で/g, label: 'AI指示残留（「結論を太字で」）' },
  { pattern: /まとめると以下/g, label: 'AI指示残留（「まとめると以下」）' },
  { pattern: /<figcaption[^>]*>.*?<\/figcaption>/gi, label: '<figcaption>タグ' },
];

// Matsueku (eyelash extension) related terms that should NOT be present
// as service offerings of this salon
const MATSUEKU_PATTERNS = [
  { pattern: /当(サロン|店|店舗)で(も)?マツエク/g, label: 'マツエクを当店メニューとして記載' },
  { pattern: /当(サロン|店|店舗)で(も)?まつ毛エクステ/g, label: 'まつ毛エクステを当店メニューとして記載' },
  { pattern: /マツエク(も|の)?(施術|メニュー|ご用意|提供|対応)/g, label: 'マツエクを施術メニューとして記載' },
  { pattern: /まつ毛エクステンション(も|の)?(施術|メニュー|ご用意|提供|対応)/g, label: 'まつ毛エクステンションをメニューとして記載' },
];

// Pharmaceutical/advertising law violations
const LEGAL_PATTERNS = [
  { pattern: /絶対に.{0,10}(伸びる|生える|治る|なくなる)/g, label: '薬機法違反の可能性（「絶対に」）' },
  { pattern: /100%\s*(持続|効果|改善)/g, label: '薬機法違反の可能性（「100%」）' },
  { pattern: /必ず(効果|改善|治|解消)/g, label: '薬機法違反の可能性（「必ず」）' },
  { pattern: /確実に(効果|治|改善)/g, label: '景品表示法違反の可能性（「確実に」）' },
];

function extractUrls(html) {
  const urlRegex = /href="(https?:\/\/[^"]+)"/gi;
  const urls = [];
  let match;
  while ((match = urlRegex.exec(html)) !== null) {
    urls.push({ url: match[1], fullMatch: match[0] });
  }
  return urls;
}

function checkForbiddenPatterns(html) {
  const issues = [];

  for (const { pattern, label } of FORBIDDEN_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(html)) !== null) {
      issues.push({ type: 'forbidden', label, match: match[0], index: match.index });
    }
  }

  for (const { pattern, label } of MATSUEKU_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(html)) !== null) {
      issues.push({ type: 'matsueku', label, match: match[0], index: match.index });
    }
  }

  for (const { pattern, label } of LEGAL_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(html)) !== null) {
      issues.push({ type: 'legal', label, match: match[0], index: match.index });
    }
  }

  return issues;
}

function autoFixHtml(html) {
  let fixed = html;
  const fixes = [];

  // Remove <figcaption> tags
  const figcaptionRegex = /<figcaption[^>]*>.*?<\/figcaption>/gi;
  if (figcaptionRegex.test(fixed)) {
    fixed = fixed.replace(figcaptionRegex, '');
    fixes.push('<figcaption>タグを除去');
  }

  // Remove >>xxx はこちら style CTAs
  const ctaRegex = />>\s*[^\s<]+はこちら/g;
  if (ctaRegex.test(fixed)) {
    fixed = fixed.replace(ctaRegex, '');
    fixes.push('「>>○○はこちら」形式のCTAを除去');
  }

  // Remove prompt instruction remnants 【...】
  const bracketRegex = /【[^】]*】/g;
  if (bracketRegex.test(fixed)) {
    fixed = fixed.replace(bracketRegex, '');
    fixes.push('プロンプト指示（【】形式）を除去');
  }

  return { html: fixed, fixes };
}

async function validateLinks(html) {
  const urls = extractUrls(html);
  const results = [];

  for (const { url } of urls) {
    try {
      const response = await axios.head(url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: (status) => status < 500,
      });
      results.push({ url, status: response.status, ok: response.status < 400 });
    } catch (err) {
      results.push({ url, status: 'ERROR', ok: false, error: err.message });
    }
  }

  return results;
}

function removeBrokenLinks(html, brokenUrls) {
  let fixed = html;
  for (const url of brokenUrls) {
    // Replace <a href="broken-url">text</a> with just text
    const linkRegex = new RegExp(`<a[^>]*href="${escapeRegex(url)}"[^>]*>(.*?)<\\/a>`, 'gi');
    fixed = fixed.replace(linkRegex, '$1');
  }
  return fixed;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkImageRules(html) {
  const issues = [];

  // Check for figcaption
  if (/<figcaption/i.test(html)) {
    issues.push('figcaptionタグが使用されています');
  }

  // Check for images without responsive styles
  const imgRegex = /<img[^>]+>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    const imgTag = match[0];
    if (!imgTag.includes('max-width') && !imgTag.includes('max-width: 100%')) {
      issues.push(`レスポンシブスタイルが未設定: ${imgTag.substring(0, 80)}...`);
    }
    if (!/alt="[^"]+"/i.test(imgTag)) {
      issues.push(`alt属性が空または未設定: ${imgTag.substring(0, 80)}...`);
    }
  }

  // Check for duplicate images in same H2 section
  const sections = html.split(/<h2[^>]*>/i);
  for (let i = 1; i < sections.length; i++) {
    const sectionImgs = (sections[i].match(/<img[^>]+>/gi) || []);
    if (sectionImgs.length > 1) {
      issues.push(`H2セクション${i}に画像が${sectionImgs.length}枚あります（1枚まで）`);
    }
  }

  return issues;
}

async function reviewArticle(filePath, options = {}) {
  const html = fs.readFileSync(filePath, 'utf-8');
  const report = {
    file: filePath,
    timestamp: new Date().toISOString(),
    patternIssues: [],
    imageIssues: [],
    linkResults: [],
    autoFixes: [],
    passed: true,
  };

  // 1. Check forbidden patterns
  console.log('  [1/4] 禁止パターンチェック...');
  report.patternIssues = checkForbiddenPatterns(html);
  if (report.patternIssues.length > 0) report.passed = false;

  // 2. Check image rules
  console.log('  [2/4] 画像ルールチェック...');
  report.imageIssues = checkImageRules(html);
  if (report.imageIssues.length > 0) report.passed = false;

  // 3. Auto-fix
  console.log('  [3/4] 自動修正...');
  const { html: fixedHtml, fixes } = autoFixHtml(html);
  report.autoFixes = fixes;
  if (fixes.length > 0) {
    fs.writeFileSync(filePath, fixedHtml, 'utf-8');
    console.log(`  自動修正${fixes.length}件を適用しました`);
  }

  // 4. Link validation (optional, skip if --skip-links)
  if (!options.skipLinks) {
    console.log('  [4/4] リンク検証...');
    report.linkResults = await validateLinks(fixedHtml);
    const brokenLinks = report.linkResults.filter(r => !r.ok);
    if (brokenLinks.length > 0) {
      console.log(`  壊れたリンク${brokenLinks.length}件を除去...`);
      const cleanedHtml = removeBrokenLinks(fixedHtml, brokenLinks.map(r => r.url));
      fs.writeFileSync(filePath, cleanedHtml, 'utf-8');
      report.autoFixes.push(`壊れたリンク${brokenLinks.length}件を除去`);
    }
  } else {
    console.log('  [4/4] リンク検証... スキップ');
  }

  // Re-check after fixes
  const finalHtml = fs.readFileSync(filePath, 'utf-8');
  const remainingIssues = checkForbiddenPatterns(finalHtml);
  const remainingImageIssues = checkImageRules(finalHtml);
  report.passed = remainingIssues.length === 0 && remainingImageIssues.length === 0;

  return report;
}

module.exports = { reviewArticle, checkForbiddenPatterns, checkImageRules, autoFixHtml, validateLinks };
