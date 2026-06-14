// OpenAI（ChatGPT）画像生成モジュール
// 記事の内容（H2見出し・画像プロンプトヒント）に応じて、
// OpenAI Images API でリアルな写真風のブログ画像を生成する。
// API キーが無い場合・生成に失敗した場合は sharp 生成にフォールバックする（image-provider.js 側で制御）。

const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const salon = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'salon.json'), 'utf-8'));

const OUTPUT_WIDTH = 1200;
const OUTPUT_HEIGHT = 630;

// .env から OpenAI 設定を読み込む
function getOpenAIConfig() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const {
    OPENAI_API_KEY,
    OPENAI_IMAGE_MODEL,
    OPENAI_IMAGE_SIZE,
    OPENAI_IMAGE_QUALITY,
    OPENAI_IMAGE_STYLE,
    OPENAI_BASE_URL,
  } = process.env;

  return {
    apiKey: OPENAI_API_KEY || '',
    model: OPENAI_IMAGE_MODEL || 'gpt-image-1',
    size: OPENAI_IMAGE_SIZE || '', // 空なら model に応じて自動決定
    quality: OPENAI_IMAGE_QUALITY || 'high',
    stylePrompt: OPENAI_IMAGE_STYLE || '',
    baseUrl: (OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
}

function hasOpenAIKey(cfg) {
  return Boolean((cfg || getOpenAIConfig()).apiKey);
}

// 記事タイトルからサロンのテーマ（色味・雰囲気）を推定
function selectThemeMood(title) {
  const t = title || '';
  if (/まつ毛パーマ|パリジェンヌ|ラッシュリフト/.test(t)) {
    return 'elegant eyelash perm theme, deep navy and soft violet accents, refined and chic mood';
  }
  if (/アイブロウ|眉/.test(t)) {
    return 'eyebrow styling theme, warm beige and soft gold tones, natural and sophisticated mood';
  }
  if (/美容液|トリートメント|ケア/.test(t)) {
    return 'lash care theme, soft pink and rose tones, gentle and caring mood';
  }
  if (/蒲田|大田区/.test(t)) {
    return 'local Tokyo salon theme, fresh teal and mint accents, friendly neighborhood mood';
  }
  return 'general beauty theme, warm coral and peach tones, bright and welcoming mood';
}

// 見出し・ヒントから画像生成プロンプトを組み立てる
function buildPrompt({ heading, articleTitle, hint, globalStyle, themeMood, cfgStyle }) {
  // 被写体: ヒントが指定されていればそれを最優先で採用
  const subject = hint && hint.trim()
    ? hint.trim()
    : `a scene that visually represents the blog section titled "${heading}" about eyelash perm / eyebrow beauty care at a Japanese salon`;

  const base = [
    'Photorealistic, high-quality beauty editorial photograph for a Japanese eyelash perm and eyebrow styling salon blog.',
    `Subject: ${subject}.`,
    'Feature a Japanese woman in her late 20s to 40s with natural healthy-looking eyelashes and beautifully shaped eyebrows, soft natural makeup, clean and elegant.',
    `Mood and palette: ${themeMood}.`,
    'Bright, clean and airy salon atmosphere, soft natural lighting, shallow depth of field, tasteful and trustworthy.',
    'Absolutely no text, no letters, no numbers, no logo, no watermark, no signage.',
    'Horizontal (landscape) composition, magazine-quality, suitable as a blog header image.',
  ];

  if (globalStyle && globalStyle.trim()) base.push(globalStyle.trim());
  if (cfgStyle && cfgStyle.trim()) base.push(cfgStyle.trim());

  return base.join(' ');
}

// model に応じた画像サイズを決定（横長）
function resolveSize(cfg) {
  if (cfg.size) return cfg.size;
  if (/dall-e-3/i.test(cfg.model)) return '1792x1024';
  if (/dall-e-2/i.test(cfg.model)) return '1024x1024';
  return '1536x1024'; // gpt-image-1 既定（横長）
}

// OpenAI Images API を呼び出して 1 枚生成し、image-{index}.png に保存
async function generateOpenAIImage({ heading, articleTitle, hint, globalStyle, index, outputDir, cfg }) {
  cfg = cfg || getOpenAIConfig();
  if (!cfg.apiKey) {
    throw new Error('OPENAI_API_KEY が未設定です');
  }

  const prompt = buildPrompt({
    heading,
    articleTitle,
    hint,
    globalStyle,
    themeMood: selectThemeMood(articleTitle),
    cfgStyle: cfg.stylePrompt,
  });

  const size = resolveSize(cfg);
  const body = { model: cfg.model, prompt, size, n: 1 };

  // model ごとのパラメータ差異を吸収
  if (/gpt-image/i.test(cfg.model)) {
    body.quality = cfg.quality; // low | medium | high | auto
  } else if (/dall-e-3/i.test(cfg.model)) {
    body.response_format = 'b64_json';
    body.quality = /hd/i.test(cfg.quality) ? 'hd' : 'standard';
  } else {
    body.response_format = 'b64_json';
  }

  const res = await axios.post(`${cfg.baseUrl}/images/generations`, body, {
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    timeout: 180000,
  });

  const data = res.data && res.data.data && res.data.data[0];
  if (!data) throw new Error('OpenAI から画像データが返りませんでした');

  let buffer;
  if (data.b64_json) {
    buffer = Buffer.from(data.b64_json, 'base64');
  } else if (data.url) {
    const img = await axios.get(data.url, { responseType: 'arraybuffer', timeout: 60000 });
    buffer = Buffer.from(img.data);
  } else {
    throw new Error('OpenAI 応答に b64_json も url も含まれていません');
  }

  // ブログのアイキャッチ比率（1200x630）に揃える
  const filename = `image-${index}.png`;
  const outputPath = path.join(outputDir, filename);
  await sharp(buffer)
    .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT, { fit: 'cover', position: 'attention' })
    .png({ quality: 90 })
    .toFile(outputPath);

  return { filename, outputPath, prompt };
}

module.exports = {
  getOpenAIConfig,
  hasOpenAIKey,
  buildPrompt,
  selectThemeMood,
  generateOpenAIImage,
};
