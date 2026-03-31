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

function getAuthHeader(config) {
  const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

async function uploadImage(config, imagePath, altText) {
  const imageData = fs.readFileSync(imagePath);
  const filename = path.basename(imagePath);

  const response = await axios.post(
    `${config.wpUrl}/wp-json/wp/v2/media`,
    imageData,
    {
      headers: {
        ...getAuthHeader(config),
        'Content-Type': 'image/png',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    }
  );

  return {
    id: response.data.id,
    url: response.data.source_url,
    altText,
  };
}

async function createPost(config, postData) {
  const { title, content, categoryIds, tags, slug, metaDescription, focusKeyphrase, status, date, featuredImageId } = postData;

  const wpPost = {
    title,
    content,
    status: status || 'draft',
    categories: categoryIds,
    slug,
  };

  if (date) {
    wpPost.date = date;
    wpPost.status = 'future';
  }

  if (featuredImageId) {
    wpPost.featured_media = featuredImageId;
  }

  // AIOSEO meta fields
  if (metaDescription || focusKeyphrase) {
    wpPost.meta = {};
    if (metaDescription) {
      wpPost.meta._aioseo_description = metaDescription;
    }
    if (focusKeyphrase) {
      wpPost.meta._aioseo_keyphrases = JSON.stringify({
        focus: { keyphrase: focusKeyphrase, score: 0 },
        additional: []
      });
    }
  }

  const response = await axios.post(
    `${config.wpUrl}/wp-json/wp/v2/posts`,
    wpPost,
    { headers: { ...getAuthHeader(config), 'Content-Type': 'application/json' } }
  );

  return {
    id: response.data.id,
    link: response.data.link,
    status: response.data.status,
    date: response.data.date,
  };
}

async function getRecentPosts(config, count = 10) {
  const response = await axios.get(
    `${config.wpUrl}/wp-json/wp/v2/posts`,
    {
      params: { per_page: count, orderby: 'date', order: 'desc' },
      headers: getAuthHeader(config),
    }
  );

  return response.data.map(post => ({
    id: post.id,
    title: post.title.rendered,
    status: post.status,
    date: post.date,
    link: post.link,
  }));
}

async function checkImageUrls(config, postId) {
  const response = await axios.get(
    `${config.wpUrl}/wp-json/wp/v2/posts/${postId}`,
    { headers: getAuthHeader(config) }
  );

  const content = response.data.content.rendered;
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
}

module.exports = { getConfig, uploadImage, createPost, getRecentPosts, checkImageUrls };
