# ブログ全自動パイプライン

このファイルを参照して実行すると、Agent Teamが連携して記事を自動生成・投稿します。

## 1記事の全自動フロー

Claude Codeに以下のように依頼してください:

```
KATEBLOG/agents/run-pipeline.md を参照して、KW「{キーワード}」の記事を自動生成・投稿してください。
投稿日は {YYYY-MM-DD} です。
```

### パイプライン実行手順

**Step 1: ブリーフ生成** (Keyword Planner Agent)
- `agents/keyword-planner.md` のルールに従い、指定KWのブリーフJSONを `briefs/{slug}.json` に生成

**Step 2: 記事執筆** (Article Writer Agent)
- `agents/article-writer.md` のルールに従い、ブリーフに基づいて記事を執筆
- `config/shiji.md` の執筆ルールを厳守
- `output/{slug}.html` に保存

**Step 3: 品質レビュー** (Quality Reviewer Agent)
- `agents/quality-reviewer.md` のルールに従い、記事を校閲
- `node cli.js review output/{slug}.html` を実行
- 問題があれば修正して再レビュー

**Step 4: WordPress投稿** (Publisher Agent)
- `.env` が設定されている場合のみ実行
- `node cli.js publish output/{slug}.html --date {日付} --time 11:00`

## 月次バッチフロー

```
KATEBLOG/agents/run-pipeline.md を参照して、今月の記事10本を自動生成してください。
テーマ: {テーマ}
開始日: {YYYY-MM-DD}
間隔: 3日おき
```

### バッチ実行手順
1. Keyword Planner が10本分のKW計画を立案
2. 各KWのブリーフJSONを生成
3. Article Writer が順次記事を執筆
4. Quality Reviewer が全記事をチェック
5. `.env` 設定済みなら `node cli.js batch output/*.html --start {開始日} --interval 3 --time 11:00`

## 重要な注意事項
- WordPress投稿には `.env` の設定が必要です
- `.env` 未設定の場合、Step 1〜3（記事生成まで）は実行可能です
- 記事HTMLは `output/` に保存されるので、後から手動投稿も可能です
