// 画像生成プロバイダの統合レイヤー
// 記事HTMLから H2 見出しと画像ヒントを抽出し、
// OpenAI（リアル写真風）または sharp（グラデーション）で画像を生成する。
//
//   provider = 'openai' | 'sharp' | 'auto'（既定: auto）
//   auto … OPENAI_API_KEY があれば OpenAI、無ければ sharp
//
// OpenAI で個別画像の生成に失敗した場合は、その画像だけ sharp にフォールバックする。

const fs = require('fs');
const { generateImage } = require('./image-generator'); // sharp 版（1枚）
const { getOpenAIConfig, generateOpenAIImage } = require('./openai-image-generator');

// 本文から H2 見出しを抽出
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
//   <!-- IMG_STYLE: 全画像共通のスタイル指定 -->
//   <!-- IMG_PROMPT_1: 1つ目のH2画像の被写体（英語推奨） -->
function extractImageHints(html) {
  const hints = {};
  let globalStyle = '';

  const styleMatch = html.match(/<!--\s*IMG_STYLE:\s*([\s\S]*?)\s*-->/i);
  if (styleMatch) globalStyle = styleMatch[1].trim();

  const promptRegex = /<!--\s*IMG_PROMPT_(\d+):\s*([\s\S]*?)\s*-->/gi;
  let m;
  while ((m = promptRegex.exec(html)) !== null) {
    hints[parseInt(m[1], 10)] = m[2].trim();
  }
  return { globalStyle, hints };
}

// プロバイダ決定
function resolveProvider(opts = {}) {
  let provider = opts.provider || process.env.IMAGE_PROVIDER || 'auto';
  provider = String(provider).toLowerCase();
  if (provider === 'auto') {
    const cfg = getOpenAIConfig();
    provider = cfg.apiKey ? 'openai' : 'sharp';
  }
  return provider;
}

// 記事の全 H2 画像を生成
async function generateImages(htmlContent, articleTitle, outputDir, opts = {}) {
  const headings = extractHeadings(htmlContent);
  if (headings.length === 0) {
    console.log('  警告: H2見出しが見つかりませんでした');
    return [];
  }

  const provider = resolveProvider(opts);
  const { globalStyle, hints } = extractImageHints(htmlContent);
  const cfg = getOpenAIConfig();

  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`  画像プロバイダ: ${provider}${provider === 'openai' ? ` (model: ${cfg.model})` : ''}`);

  const results = [];
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const hint = hints[i + 1]; // IMG_PROMPT_1 が最初の H2 に対応
    let result = null;

    if (provider === 'openai') {
      try {
        const r = await generateOpenAIImage({
          heading,
          articleTitle,
          hint,
          globalStyle,
          index: i,
          outputDir,
          cfg,
        });
        result = { heading, filename: r.filename, outputPath: r.outputPath, provider: 'openai' };
        console.log(`  ✅ OpenAI画像生成: ${r.filename} ← 「${heading}」`);
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

    results.push(result);
  }

  return results;
}

module.exports = { generateImages, extractHeadings, extractImageHints, resolveProvider };
