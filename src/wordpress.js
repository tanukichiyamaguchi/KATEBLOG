const axios = require('axios');
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

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toXmlRpcValue(value) {
  if (value === null || value === undefined) return '<value><string></string></value>';
  if (typeof value === 'boolean') return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return `<value><int>${value}</int></value>`;
    return `<value><double>${value}</double></value>`;
  }
  if (Buffer.isBuffer(value)) return `<value><base64>${value.toString('base64')}</base64></value>`;
  if (Array.isArray(value)) {
    const items = value.map(v => toXmlRpcValue(v)).join('');
    return `<value><array><data>${items}</data></array></value>`;
  }
  if (typeof value === 'object') {
    const members = Object.entries(value).map(([k, v]) =>
      `<member><name>${escapeXml(k)}</name>${toXmlRpcValue(v)}</member>`
    ).join('');
    return `<value><struct>${members}</struct></value>`;
  }
  return `<value><string>${escapeXml(String(value))}</string></value>`;
}

function buildXmlRpcRequest(method, params) {
  const paramXml = params.map(p => `<param>${toXmlRpcValue(p)}</param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${paramXml}</params></methodCall>`;
}

function parseSimpleValue(xml) {
  // Parse string
  const strMatch = xml.match(/<string>([\s\S]*?)<\/string>/);
  if (strMatch) return strMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

  // Parse int
  const intMatch = xml.match(/<(?:int|i4)>([\s\S]*?)<\/(?:int|i4)>/);
  if (intMatch) return parseInt(intMatch[1]);

  // Parse boolean
  const boolMatch = xml.match(/<boolean>([\s\S]*?)<\/boolean>/);
  if (boolMatch) return boolMatch[1] === '1';

  // Parse double
  const dblMatch = xml.match(/<double>([\s\S]*?)<\/double>/);
  if (dblMatch) return parseFloat(dblMatch[1]);

  // Parse dateTime
  const dtMatch = xml.match(/<dateTime\.iso8601>([\s\S]*?)<\/dateTime\.iso8601>/);
  if (dtMatch) return dtMatch[1];

  // Parse base64
  const b64Match = xml.match(/<base64>([\s\S]*?)<\/base64>/);
  if (b64Match) return b64Match[1];

  // Parse array
  const arrMatch = xml.match(/<array><data>([\s\S]*?)<\/data><\/array>/);
  if (arrMatch) {
    const values = [];
    const valRegex = /<value>([\s\S]*?)<\/value>/g;
    let m;
    while ((m = valRegex.exec(arrMatch[1])) !== null) {
      values.push(parseSimpleValue(m[0]));
    }
    return values;
  }

  // Parse struct
  const structMatch = xml.match(/<struct>([\s\S]*?)<\/struct>/);
  if (structMatch) {
    const obj = {};
    const memberRegex = /<member>\s*<name>([\s\S]*?)<\/name>\s*<value>([\s\S]*?)<\/value>\s*<\/member>/g;
    let m;
    while ((m = memberRegex.exec(structMatch[1])) !== null) {
      obj[m[1]] = parseSimpleValue(`<value>${m[2]}</value>`);
    }
    return obj;
  }

  // Bare value (no type tag) - treat as string
  const bareMatch = xml.match(/<value>([\s\S]*?)<\/value>/);
  if (bareMatch) {
    const inner = bareMatch[1].trim();
    if (inner.startsWith('<')) return parseSimpleValue(inner);
    return inner;
  }

  return xml;
}

function parseXmlRpcResponse(xml) {
  // Check for fault
  const faultMatch = xml.match(/<fault>([\s\S]*?)<\/fault>/);
  if (faultMatch) {
    const fault = parseSimpleValue(faultMatch[1]);
    throw new Error(`XML-RPC Fault: ${fault.faultString || JSON.stringify(fault)}`);
  }

  // Extract params
  const paramMatch = xml.match(/<params>\s*<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>\s*<\/params>/);
  if (paramMatch) {
    return parseSimpleValue(`<value>${paramMatch[1]}</value>`);
  }

  throw new Error('Invalid XML-RPC response');
}

async function callXmlRpc(config, method, params) {
  const body = buildXmlRpcRequest(method, params);

  const response = await axios.post(`${config.wpUrl}/xmlrpc.php`, body, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    timeout: 30000,
    maxRedirects: 5,
  });

  if (typeof response.data !== 'string' || !response.data.includes('<?xml')) {
    throw new Error(`Unexpected response (not XML): ${String(response.data).substring(0, 200)}`);
  }

  return parseXmlRpcResponse(response.data);
}

async function uploadImage(config, imagePath, altText) {
  const imageData = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);

  const mediaData = {
    name: filename,
    type: 'image/png',
    bits: imageData,
    overwrite: true,
  };

  try {
    const result = await callXmlRpc(config, 'wp.uploadFile', [
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
  const { title, content, categoryIds, slug, metaDescription, focusKeyphrase, status, date, featuredImageId } = postData;

  const wpPost = {
    post_type: 'post',
    post_status: status || 'draft',
    post_title: title,
    post_content: content,
    post_name: slug,
  };

  if (categoryIds && categoryIds.length > 0) {
    wpPost.terms = { category: categoryIds };
  }

  if (date) {
    wpPost.post_date = date;
    wpPost.post_status = 'future';
  }

  if (featuredImageId) {
    wpPost.post_thumbnail = parseInt(featuredImageId);
  }

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
    const postId = await callXmlRpc(config, 'wp.newPost', [
      0, config.username, config.password, wpPost
    ]);

    const post = await callXmlRpc(config, 'wp.getPost', [
      0, config.username, config.password, parseInt(postId)
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
  try {
    const posts = await callXmlRpc(config, 'wp.getPosts', [
      0, config.username, config.password,
      { number: count, orderby: 'post_date', order: 'DESC' }
    ]);

    if (!Array.isArray(posts)) return [];

    return posts.map(post => ({
      id: post.post_id,
      title: post.post_title,
      status: post.post_status,
      date: post.post_date || '',
      link: post.link || '',
    }));
  } catch (err) {
    console.error(`  投稿一覧取得エラー: ${err.message}`);
    throw err;
  }
}

async function checkImageUrls(config, postId) {
  try {
    const post = await callXmlRpc(config, 'wp.getPost', [
      0, config.username, config.password, parseInt(postId)
    ]);

    const content = post.post_content || '';
    const imgRegex = /src="([^"]+)"/gi;
    const urls = [];
    let match;
    while ((match = imgRegex.exec(content)) !== null) {
      urls.push(match[1]);
    }

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
  // 1. Test XML-RPC access
  console.log('  [1/3] XML-RPC接続テスト...');
  try {
    const result = await callXmlRpc(config, 'system.listMethods', []);
    const methodCount = Array.isArray(result) ? result.length : 0;
    console.log(`  ✅ XML-RPC接続OK (${methodCount}メソッド利用可能)`);
  } catch (err) {
    console.log(`  ❌ XML-RPC接続失敗: ${err.message}`);
    return false;
  }

  // 2. Test authentication
  console.log('  [2/3] 認証テスト...');
  try {
    const profile = await callXmlRpc(config, 'wp.getProfile', [
      0, config.username, config.password
    ]);
    console.log(`  ✅ 認証OK: ${profile.display_name || profile.username}`);
  } catch (err) {
    console.log(`  ❌ 認証失敗: ${err.message}`);
    return false;
  }

  // 3. Test post listing
  console.log('  [3/3] 投稿権限テスト...');
  try {
    await callXmlRpc(config, 'wp.getPosts', [
      0, config.username, config.password,
      { number: 1 }
    ]);
    console.log(`  ✅ 投稿取得OK`);
  } catch (err) {
    console.log(`  ❌ 投稿取得失敗: ${err.message}`);
    return false;
  }

  return true;
}

module.exports = { getConfig, uploadImage, createPost, getRecentPosts, checkImageUrls, testConnection };
