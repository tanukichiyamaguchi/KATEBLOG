const fs = require('fs');
const path = require('path');
const { generateImages } = require('./image-provider');
const { getConfig, uploadImage, createPost, checkImageUrls } = require('./wordpress');

function extractMeta(html) {
  // Extract title from <!-- TITLE: xxx --> comment
  const titleMatch = html.match(/<!--\s*TITLE:\s*(.+?)\s*-->/);
  // Extract meta description from <!-- META: xxx --> comment
  const metaMatch = html.match(/<!--\s*META:\s*(.+?)\s*-->/);
  // Extract keyword from <!-- KEYWORD: xxx --> comment
  const kwMatch = html.match(/<!--\s*KEYWORD:\s*(.+?)\s*-->/);
  // Extract category ID from <!-- CATEGORY: xxx --> comment
  const catMatch = html.match(/<!--\s*CATEGORY:\s*(\d+)\s*-->/);
  // Extract slug from <!-- SLUG: xxx --> comment
  const slugMatch = html.match(/<!--\s*SLUG:\s*(.+?)\s*-->/);

  return {
    title: titleMatch ? titleMatch[1] : '',
    metaDescription: metaMatch ? metaMatch[1] : '',
    keyword: kwMatch ? kwMatch[1] : '',
    categoryId: catMatch ? parseInt(catMatch[1]) : 27,
    slug: slugMatch ? slugMatch[1] : '',
  };
}

function stripMetaComments(html) {
  return html
    .replace(/<!--\s*(TITLE|META|KEYWORD|CATEGORY|SLUG):\s*.+?\s*-->\n?/g, '')
    .trim();
}

async function publishArticle(filePath, options = {}) {
  console.log(`\n📄 記事を公開準備中: ${filePath}`);

  const html = fs.readFileSync(filePath, 'utf-8');
  const meta = extractMeta(html);
  let content = stripMetaComments(html);

  if (!meta.title) {
    throw new Error('記事タイトルが見つかりません。HTMLに <!-- TITLE: タイトル --> を記載してください。');
  }

  const config = getConfig();
  const slug = meta.slug || path.basename(filePath, '.html');
  const imageDir = path.join(path.dirname(filePath), `images-${slug}`);

  // 1. Generate images（OpenAI写真風 / sharp。provider は --provider か IMAGE_PROVIDER で指定）
  console.log('\n🎨 画像生成中...');
  const images = await generateImages(content, meta.title, imageDir, { provider: options.provider });

  // 2. Upload images to WordPress and replace placeholders
  console.log('\n📤 画像をWordPressにアップロード中...');
  for (let i = 0; i < images.length; i++) {
    const placeholder = `%%IMAGE_${i + 1}%%`;
    if (content.includes(placeholder)) {
      const uploaded = await uploadImage(config, images[i].outputPath, images[i].heading);
      content = content.replace(placeholder, uploaded.url);
      console.log(`  アップロード完了: ${uploaded.url}`);
    }
  }

  // Also handle %%IMAGE_0%% for eyecatch
  if (images.length > 0 && content.includes('%%IMAGE_0%%')) {
    const uploaded = await uploadImage(config, images[0].outputPath, meta.title);
    content = content.replace('%%IMAGE_0%%', uploaded.url);
  }

  // 3. Build publish date
  let publishDate = null;
  if (options.date) {
    const time = options.time || '11:00';
    publishDate = `${options.date}T${time}:00`;
  }

  // 4. Create WordPress post
  console.log('\n📝 WordPress投稿作成中...');
  let featuredImageId = null;
  if (images.length > 0) {
    const eyecatch = await uploadImage(config, images[0].outputPath, meta.title);
    featuredImageId = eyecatch.id;
  }

  const post = await createPost(config, {
    title: meta.title,
    content,
    categoryIds: [meta.categoryId],
    slug,
    metaDescription: meta.metaDescription,
    focusKeyphrase: meta.keyword,
    status: publishDate ? 'future' : 'draft',
    date: publishDate,
    featuredImageId,
  });

  console.log(`\n✅ 投稿完了!`);
  console.log(`  ID: ${post.id}`);
  console.log(`  ステータス: ${post.status}`);
  console.log(`  URL: ${post.link}`);
  if (post.date) console.log(`  公開日時: ${post.date}`);

  // 5. Post-publish image check
  console.log('\n🔍 投稿後の画像URL検証...');
  const imageChecks = await checkImageUrls(config, post.id);
  const brokenImages = imageChecks.filter(r => !r.ok);
  if (brokenImages.length > 0) {
    console.log(`  ⚠️ 壊れた画像URL: ${brokenImages.length}件`);
    brokenImages.forEach(r => console.log(`    ${r.url} → ${r.status}`));
  } else {
    console.log(`  全画像URL正常 (${imageChecks.length}件)`);
  }

  return post;
}

module.exports = { publishArticle, extractMeta };
