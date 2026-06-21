#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { reviewArticle } = require('./src/reviewer');
const { publishArticle } = require('./src/publisher');
const { getConfig, getRecentPosts, checkImageUrls, testConnection } = require('./src/wordpress');
const { generateImages } = require('./src/image-provider');
const { publishNext, queueStatus } = require('./src/queue');
const { applyInternalLinks, loadCorpus } = require('./src/internal-links');

const args = process.argv.slice(2);
const command = args[0];

function parseOptions(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--date' && args[i + 1]) opts.date = args[++i];
    else if (args[i] === '--time' && args[i + 1]) opts.time = args[++i];
    else if (args[i] === '--start' && args[i + 1]) opts.start = args[++i];
    else if (args[i] === '--interval' && args[i + 1]) opts.interval = parseInt(args[++i]);
    else if (args[i] === '--provider' && args[i + 1]) opts.provider = args[++i];
    else if (args[i] === '--skip-links') opts.skipLinks = true;
    else if (args[i] === '--dry-run') opts.dryRun = true;
  }
  return opts;
}

async function main() {
  switch (command) {
    case 'review': {
      const filePath = args[1];
      if (!filePath) {
        console.error('使用法: node cli.js review <file.html> [--skip-links]');
        process.exit(1);
      }
      const opts = parseOptions(args.slice(2));
      console.log(`\n🔍 品質レビュー: ${filePath}`);
      const report = await reviewArticle(filePath, opts);
      printReport(report);
      break;
    }

    case 'publish': {
      const filePath = args[1];
      if (!filePath) {
        console.error('使用法: node cli.js publish <file.html> [--date YYYY-MM-DD] [--time HH:MM]');
        process.exit(1);
      }
      const opts = parseOptions(args.slice(2));
      await publishArticle(filePath, opts);
      break;
    }

    case 'batch': {
      const files = [];
      const opts = parseOptions(args.slice(1));
      // Collect all .html files from args
      for (let i = 1; i < args.length; i++) {
        if (args[i].startsWith('--')) { i++; continue; }
        if (args[i].endsWith('.html')) files.push(args[i]);
      }
      if (files.length === 0) {
        console.error('使用法: node cli.js batch <file1.html> [file2.html ...] --start YYYY-MM-DD --interval N --time HH:MM');
        process.exit(1);
      }
      const startDate = new Date(opts.start || new Date().toISOString().split('T')[0]);
      const interval = opts.interval || 3;
      const time = opts.time || '11:00';

      console.log(`\n📦 バッチ投稿: ${files.length}本`);
      console.log(`  開始日: ${startDate.toISOString().split('T')[0]}, 間隔: ${interval}日, 時刻: ${time}\n`);

      for (let i = 0; i < files.length; i++) {
        const pubDate = new Date(startDate);
        pubDate.setDate(pubDate.getDate() + i * interval);
        const dateStr = pubDate.toISOString().split('T')[0];
        console.log(`--- [${i + 1}/${files.length}] ${files[i]} → ${dateStr} ${time} ---`);
        try {
          await publishArticle(files[i], { date: dateStr, time });
        } catch (err) {
          console.error(`  ❌ エラー: ${err.message}`);
        }
      }
      break;
    }

    case 'status': {
      console.log('\n📊 投稿ステータス確認...');
      const config = getConfig();
      const posts = await getRecentPosts(config);
      console.log(`\n最近の投稿 (${posts.length}件):`);
      posts.forEach(p => {
        const statusIcon = p.status === 'publish' ? '✅' : p.status === 'future' ? '⏰' : '📝';
        console.log(`  ${statusIcon} [${p.status}] ${p.date.split('T')[0]} | ${p.title} | ${p.link}`);
      });
      break;
    }

    case 'check-images': {
      const postId = args[1];
      if (!postId) {
        console.error('使用法: node cli.js check-images <postId>');
        process.exit(1);
      }
      console.log(`\n🔍 画像URL検証: 投稿ID ${postId}`);
      const config = getConfig();
      const results = await checkImageUrls(config, parseInt(postId));
      results.forEach(r => {
        const icon = r.ok ? '✅' : '❌';
        console.log(`  ${icon} [${r.status}] ${r.url}`);
      });
      break;
    }

    case 'generate-images': {
      const filePath = args[1];
      if (!filePath) {
        console.error('使用法: node cli.js generate-images <file.html> [--provider openai|sharp|auto]');
        process.exit(1);
      }
      const opts = parseOptions(args.slice(2));
      const html = fs.readFileSync(filePath, 'utf-8');
      const titleMatch = html.match(/<!--\s*TITLE:\s*(.+?)\s*-->/);
      const slugMatch = html.match(/<!--\s*SLUG:\s*(.+?)\s*-->/);
      const title = titleMatch ? titleMatch[1] : path.basename(filePath, '.html');
      const slug = slugMatch ? slugMatch[1] : path.basename(filePath, '.html');
      const imageDir = path.join(path.dirname(filePath), `images-${slug}`);
      console.log(`\n🎨 画像生成: ${filePath}`);
      const images = await generateImages(html, title, imageDir, { provider: opts.provider });
      console.log(`\n✅ ${images.length}枚の画像を生成しました → ${imageDir}/`);
      break;
    }

    case 'publish-next': {
      const opts = parseOptions(args.slice(1));
      console.log('\n📅 週次キューから次の記事を公開準備...');
      const result = await publishNext(opts);
      console.log(`\n${result.published ? '✅' : 'ℹ️'} ${result.message}`);
      if (result.published) {
        console.log(`  記事: ${result.title}`);
        console.log(`  画像: ${result.images}枚 (${result.provider})`);
        console.log(`  公開予定: ${result.date} ${result.time}（JST）`);
        console.log(`  残りキュー: ${result.remaining}本`);
        console.log('\n  → このあとワークフローが commit & push し、WPプラグインが取り込みます。');
      }
      break;
    }

    case 'queue': {
      const q = queueStatus();
      console.log('\n📋 公開キュー');
      console.log(`\n公開待ち (${q.pending.length}本):`);
      q.pending.forEach((slug, i) => console.log(`  ${i + 1}. ${slug}`));
      console.log(`\n公開済み (${q.published.length}本):`);
      q.published.slice(-10).forEach(p => console.log(`  ✅ ${p.date} ${p.time} | ${p.slug}`));
      break;
    }

    case 'internal-links': {
      const corpus = loadCorpus();
      let targets = [];
      if (args[1] === '--all') {
        targets = fs.readdirSync('output').filter(f => f.endsWith('.html')).map(f => path.join('output', f));
      } else if (args[1]) {
        targets = [args[1]];
      } else {
        console.error('使用法: node cli.js internal-links <file.html> | --all');
        process.exit(1);
      }
      console.log(`\n🔗 内部リンク付与: ${targets.length}件`);
      let total = 0;
      for (const file of targets) {
        const slug = path.basename(file, '.html');
        const html = fs.readFileSync(file, 'utf-8');
        const r = applyInternalLinks(html, slug, { corpus });
        if (r.count > 0) {
          fs.writeFileSync(file, r.html);
          total++;
          console.log(`  ✅ ${slug} … 関連${r.count}件 / 文脈リンク${r.inline}本`);
        } else {
          console.log(`  － ${slug} … 関連記事なし（スキップ）`);
        }
      }
      console.log(`\n完了: ${total}/${targets.length} 件に内部リンクを付与`);
      break;
    }

    case 'test': {
      console.log('\n🔧 WordPress接続テスト...');
      const config = getConfig();
      const ok = await testConnection(config);
      if (ok) {
        console.log('\n✅ 全テスト通過。WordPress投稿が可能です。');
      } else {
        console.log('\n❌ テスト失敗。上記のエラーを確認してください。');
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`
KATEstageLASH ブログ自動化ツール

使用法:
  node cli.js test                                 WordPress接続テスト
  node cli.js review <file.html> [--skip-links]   品質チェック
  node cli.js generate-images <file.html> [--provider openai|sharp|auto]  画像生成のみ
  node cli.js publish <file.html> [options]        画像生成 + WordPress投稿
  node cli.js batch <files...> [options]           バッチ投稿
  node cli.js publish-next [options]               週次キューから次の1本を公開準備
  node cli.js queue                                公開キューの状況を表示
  node cli.js internal-links <file.html> | --all   過去記事への内部リンクを自動付与
  node cli.js status                               投稿ステータス確認
  node cli.js check-images <postId>                画像URL検証

publish オプション:
  --date YYYY-MM-DD    予約投稿日
  --time HH:MM         投稿時刻（デフォルト: 11:00）
  --provider NAME      画像プロバイダ openai|sharp|auto（既定: auto）

batch オプション:
  --start YYYY-MM-DD   開始日
  --interval N         投稿間隔（日数、デフォルト: 3）
  --time HH:MM         投稿時刻（デフォルト: 11:00）

publish-next オプション:
  --date YYYY-MM-DD    公開日（既定: 当日 JST）
  --time HH:MM         公開時刻（既定: 11:00）
  --provider NAME      画像プロバイダ openai|sharp|auto（既定: auto）
  --dry-run            実際には移動せず、次に公開される記事を表示
      `);
  }
}

function printReport(report) {
  console.log('\n━━━ レビュー結果 ━━━');

  if (report.patternIssues.length > 0) {
    console.log(`\n⚠️ 禁止パターン (${report.patternIssues.length}件):`);
    report.patternIssues.forEach(i => console.log(`  - [${i.type}] ${i.label}: 「${i.match}」`));
  }

  if (report.imageIssues.length > 0) {
    console.log(`\n⚠️ 画像ルール違反 (${report.imageIssues.length}件):`);
    report.imageIssues.forEach(i => console.log(`  - ${i}`));
  }

  if (report.autoFixes.length > 0) {
    console.log(`\n🔧 自動修正 (${report.autoFixes.length}件):`);
    report.autoFixes.forEach(f => console.log(`  - ${f}`));
  }

  if (report.linkResults.length > 0) {
    const broken = report.linkResults.filter(r => !r.ok);
    if (broken.length > 0) {
      console.log(`\n🔗 壊れたリンク (${broken.length}件):`);
      broken.forEach(r => console.log(`  - [${r.status}] ${r.url}`));
    } else {
      console.log(`\n🔗 全リンク正常 (${report.linkResults.length}件)`);
    }
  }

  console.log(`\n${report.passed ? '✅ チェック通過' : '❌ 要修正項目あり'}\n`);
}

main().catch(err => {
  console.error(`\n❌ エラー: ${err.message}`);
  process.exit(1);
});
