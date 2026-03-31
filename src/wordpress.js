const xmlrpc = require('xmlrpc');
const fs = require('fs');
const path = require('path');

function getConfig() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const { WP_URL, WP_USERNAME, WP_APP_PASSWORD } = process.env;
  if (!WP_URL || !WP_USERNAME || !WP_APP_PASSWORD) {
    throw new Error('.env に WP_URL, WP_USERNAME, WP_APP_PASSWORD を設定してください。\n.env.example を参照してください。');
  }
  return { wpUrl: WP_URL.replace(/\/$/, ''), username: WP_USERNAME, password: WP_APP_PASSWORD };
}

function createClient(config) {
  const url = new URL(config.wpUrl + '/xmlrpc.php');
  const isHttps = url.protocol === 'https:';
  const createFn = isHttps ? xmlrpc.createSecureClient : xmlrpc.createClient;
  return createFn({
    host: url.hostname,
    port: isHttps ? 443 : 80,
    path: url.pathname,
  });
}

function callXmlRpc(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => {
      if (err) reject(err);
      else resolve(value);
    });
  });
}

async function uploadImage(config, imagePath, altText) {
  const client = createClient(config);
  const imageData = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);

  const mediaData = {
    name: filename,
    type: 'image/png',
    bits: imageData,
    overwrite: true,
  };

  try {
    const result = await callXmlRpc(client, 'wp.uploadFile', [
      0, config.username, config.password, mediaData
    ]);
    console.log(`  アップロード完了: ${result.url}`);
    return {
      id: result.id || result.attachment_id,
      url: result.url,
      altText,
    };
  } catch (err) {
    console.error(`  画像アップロードエラー: ${err.message}`);
    throw err;
  }
}

async function createPost(config, postData) {
  const client = createClient(config);
  const { title, content, categoryIds, slug, metaDescription, focusKeyphrase, status, date, featuredImageId } = postData;

  const wpPost = {
    post_type: 'post',
    post_status: status || 'draft',
    post_title: title,
    post_content: content,
    post_name: slug,
    terms_names: {},
  };

  if (categoryIds && categoryIds.length > 0) {
    wpPost.terms = { category: categoryIds };
  }

  if (date) {
    wpPost.post_date = date;
    wpPost.post_status = 'future';
  }

  if (featuredImageId) {
    wpPost.post_thumbnail = featuredImageId;
  }

  // AIOSEO custom fields
  if (metaDescription || focusKeyphrase) {
    wpPost.custom_fields = [];
    if (metaDescription) {
      wpPost.custom_fields.push({ key: '_aioseo_description', value: metaDescription });
    }
    if (focusKeyphrase) {
      wpPost.custom_fields.push({
        key: '_aioseo_keyphrases',
        value: JSON.stringify({ focus: { keyphrase: focusKeyphrase, score: 0 }, additional: [] })
      });
    }
  }

  try {
    const postId = await callXmlRpc(client, 'wp.newPost', [
      0, config.username, config.password, wpPost
    ]);

    // Get post details
    const post = await callXmlRpc(client, 'wp.getPost', [
      0, config.username, config.password, postId, ['post_id', 'post_title', 'post_status', 'post_date', 'link']
    ]);

    return {
      id: postId,
      link: post.link || `${config.wpUrl}/?p=${postId}`,
      status: post.post_status || wpPost.post_status,
      date: post.post_date || date,
    };
  } catch (err) {
    console.error(`  投稿エラー: ${err.message}`);
    throw err;
  }
}

async function getRecentPosts(config, count = 10) {
  const client = createClient(config);

  try {
    const posts = await callXmlRpc(client, 'wp.getPosts', [
      0, config.username, config.password,
      { number: count, orderby: 'post_date', order: 'DESC' },
      ['post_id', 'post_title', 'post_status', 'post_date', 'link']
    ]);

    return posts.map(post => ({
      id: post.post_id,
      title: post.post_title,
      status: post.post_status,
      date: post.post_date ? post.post_date.toISOString() : '',
      link: post.link,
    }));
  } catch (err) {
    console.error(`  投稿一覧取得エラー: ${err.message}`);
    throw err;
  }
}

async function checkImageUrls(config, postId) {
  const client = createClient(config);

  try {
    const post = await callXmlRpc(client, 'wp.getPost', [
      0, config.username, config.password, postId, ['post_content']
    ]);

    const content = post.post_content || '';
    const imgRegex = /src="([^"]+)"/gi;
    const urls = [];
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      urls.push(match[1]);
    }

    const axios = require('axios');
    const results = [];
    for (const url of urls) {
      try {
        const res = await axios.head(url, { timeout: 10000 });
        results.push({ url, status: res.status, ok: true });
      } catch (err) {
        results.push({ url, status: err.response?.status || 'ERROR', ok: false });
      }
    }

    return results;
  } catch (err) {
    console.error(`  画像URL検証エラー: ${err.message}`);
    throw err;
  }
}

async function testConnection(config) {
  const client = createClient(config);

  // 1. Test XML-RPC access
  console.log('  [1/3] XML-RPC接続テスト...');
  try {
    const methods = await callXmlRpc(client, 'system.listMethods', []);
    console.log(`  ✅ XML-RPC接続OK (${methods.length}メソッド利用可能)`);
  } catch (err) {
    console.log(`  ❌ XML-RPC接続失敗: ${err.message}`);
    return false;
  }

  // 2. Test authentication
  console.log('  [2/3] 認証テスト...');
  try {
    const profile = await callXmlRpc(client, 'wp.getProfile', [
      0, config.username, config.password
    ]);
    console.log(`  ✅ 認証OK: ${profile.display_name || profile.username} (${profile.roles || 'unknown'})`);
  } catch (err) {
    console.log(`  ❌ 認証失敗: ${err.message}`);
    return false;
  }

  // 3. Test post listing
  console.log('  [3/3] 投稿権限テスト...');
  try {
    const posts = await callXmlRpc(client, 'wp.getPosts', [
      0, config.username, config.password,
      { number: 1 },
      ['post_id', 'post_title']
    ]);
    console.log(`  ✅ 投稿取得OK`);
  } catch (err) {
    console.log(`  ❌ 投稿取得失敗: ${err.message}`);
    return false;
  }

  return true;
}

module.exports = { getConfig, uploadImage, createPost, getRecentPosts, checkImageUrls, testConnection };
