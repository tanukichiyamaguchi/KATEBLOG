// 画像生成プロバイダの統合レイヤー
// 記事HTMLから H2 見出しと画像ヒントを抽出し、画像種別ごとに生成する。
//
//   ・表紙（cover）   … タイトルを大きく見せる高視認性のタイトルカード（手書き風）
//   ・図解（diagram） … 手書き風の図解（cards/steps/checklist/point/compare）
//   ・写真（photo）   … OpenAIで「素人が撮った20代女性のスマホ写真」風（キー無→sharp）
//
// 画像種別の決定（N = 1始まり。IMG_*_N は N番目のH2に対応）:
//   1. IMG_DIAGRAM_N がある           → その図解（layout=cover も指定可）
//   2. index 0（最初のH2）でヒント無し → 表紙（cover）を自動生成
//   3. IMG_TYPE_N = cover|diagram|photo → 指定種別
//   4. それ以外                          → 写真（IMG_PROMPT_N があれば被写体に反映）

const fs = require('fs');
const { generateImage } = require('./image-generator');               // sharp（写真フォールバック）
const { getOpenAIConfig, generateOpenAIImage } = require('./openai-image-generator');
const { generateDiagram, parseDiagramSpec } = require('./diagram-generator');

function extractHeadings(html) {
  const h2Regex = /<h2[^>]*>(.*?)<\/h2>/gis;
  const headings = [];
  let m;
  while ((m = h2Regex.exec(html)) !== null) {
    headings.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  return headings;
}

// 画像ヒントを抽出
//   <!-- IMG_STYLE: 写真共通スタイル -->
//   <!-- IMG_PROMPT_1: 写真の被写体（英語推奨） -->
//   <!-- IMG_TYPE_1: cover|diagram|photo -->
//   <!-- IMG_DIAGRAM_3: layout=cards; title=...; items=A|B|C -->
function extractImageHints(html) {
  const hints = {};   // 写真の被写体
  const types = {};   // 種別
  const diagrams = {}; // 図解スペック文字列
  let globalStyle = '';

  const styleMatch = html.match(/<!--\s*IMG_STYLE:\s*([\s\S]*?)\s*-->/i);
  if (styleMatch) globalStyle = styleMatch[1].trim();

  const grab = (re, into, transform) => {
    let m;
    while ((m = re.exec(html)) !== null) into[parseInt(m[1], 10)] = transform ? transform(m[2]) : m[2].trim();
  };
  grab(/<!--\s*IMG_PROMPT_(\d+):\s*([\s\S]*?)\s*-->/gi, hints);
  grab(/<!--\s*IMG_TYPE_(\d+):\s*([\s\S]*?)\s*-->/gi, types, v => v.trim().toLowerCase());
  grab(/<!--\s*IMG_DIAGRAM_(\d+):\s*([\s\S]*?)\s*-->/gi, diagrams);

  return { globalStyle, hints, types, diagrams };
}

function resolveProvider(opts = {}) {
  let provider = opts.provider || process.env.IMAGE_PROVIDER || 'auto';
  provider = String(provider).toLowerCase();
  if (provider === 'auto') {
    provider = getOpenAIConfig().apiKey ? 'openai' : 'sharp';
  }
  return provider;
}

// タイトルから表紙のカテゴリラベルを推定
function detectCoverCategory(title) {
  const t = title || '';
  if (/まつ毛パーマ|パリジェンヌ|ラッシュリフト/.test(t)) return 'まつ毛パーマ';
  if (/アイブロウ|眉/.test(t)) return 'アイブロウ';
  if (/美容液|トリートメント|ケア/.test(t)) return 'まつ毛ケア';
  if (/蒲田|大田区/.test(t)) return '蒲田・大田区';
  return 'KATEstageLASH';
}

async function generateImages(htmlContent, articleTitle, outputDir, opts = {}) {
  const headings = extractHeadings(htmlContent);
  if (headings.length === 0) {
    console.log('  警告: H2見出しが見つかりませんでした');
    return [];
  }

  const provider = resolveProvider(opts);
  const { globalStyle, hints, types, diagrams } = extractImageHints(htmlContent);
  const cfg = getOpenAIConfig();

  fs.mkdirSync(outputDir, { recursive: true });

  const results = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const N = i + 1;
    let type = types[N];

    if (diagrams[N]) type = 'diagram';
    else if (!type) type = i === 0 ? 'cover' : 'photo';

    let result = null;

    // --- 図解 ---
    if (type === 'diagram' || type === 'cover') {
      let spec;
      if (type === 'cover') {
        spec = diagrams[N] ? parseDiagramSpec(diagrams[N]) : {};
        spec.layout = 'cover';
        if (!spec.title) spec.title = articleTitle;
        if (!spec.category) spec.category = detectCoverCategory(articleTitle);
      } else {
        spec = parseDiagramSpec(diagrams[N] || `title=${heading}`);
      }
      const r = await generateDiagram(spec, i, outputDir);
      result = { heading, filename: r.filename, outputPath: r.outputPath, provider: spec.layout === 'cover' ? 'cover' : 'diagram' };
      console.log(`  🖍️ ${result.provider}生成: ${r.filename} ← 「${heading}」`);
    }

    // --- 写真（OpenAI → 失敗時 sharp） ---
    if (!result && type === 'photo') {
      if (provider === 'openai') {
        try {
          const r = await generateOpenAIImage({ heading, articleTitle, hint: hints[N], globalStyle, index: i, outputDir, cfg });
          result = { heading, filename: r.filename, outputPath: r.outputPath, provider: 'openai' };
          console.log(`  📷 OpenAI写真生成: ${r.filename} ← 「${heading}」`);
        } catch (err) {
          const status = err.response?.status;
          const detail = err.response?.data?.error?.message || err.message;
          console.log(`  ⚠️ OpenAI生成失敗 (${status || 'ERR'}): ${detail} → sharpにフォールバック`);
        }
      }
      if (!result) {
        const r = await generateImage(heading, articleTitle, i, outputDir);
        result = { heading, filename: r.filename, outputPath: r.outputPath, provider: 'sharp' };
        console.log(`  画像生成(sharp): ${r.filename} ← 「${heading}」`);
      }
    }

    results.push(result);
  }

  return results;
}

module.exports = { generateImages, extractHeadings, extractImageHints, resolveProvider, detectCoverCategory };
