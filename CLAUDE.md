# KATEstageLASH ブログ自動化システム — Agent Team 構成

## プロジェクト概要
アイブロウ・まつ毛専門サロン「KATEstageLASH蒲田西口店」のSEOブログ記事を自動生成し、WordPressに予約投稿するシステム。

## 重要ルール
- **マツエク（まつ毛エクステンション）は当サロンでは提供していない**。記事にマツエクを当店メニューとして記載しないこと。
- 記事の執筆はClaude Code自身が行う。外部LLM APIは使わない。
- Node.jsツール（cli.js）は画像生成・WordPress投稿・リンク検証・品質チェックのみ担当。

## ディレクトリ構成
```
KATEBLOG/
├── CLAUDE.md          # このファイル（Agent Team定義）
├── salon.json         # サロン情報
├── .env               # WordPress認証（git管理外）
├── config/
│   ├── shiji.md       # 執筆ルール（マスタープロンプト）
│   ├── eeat-config.json  # E-E-A-T設定
│   └── tracked-keywords.json  # KW管理
├── briefs/            # 記事ブリーフJSON
├── output/            # 完成記事HTML
├── src/
│   ├── image-generator.js  # sharp画像生成
│   ├── wordpress.js        # WP REST API
│   ├── reviewer.js         # 品質チェック
│   └── publisher.js        # 公開パイプライン
└── cli.js             # CLIエントリーポイント
```

## Agent Team 構成

### Agent 1: Keyword Planner（キーワード企画エージェント）
**役割**: 月次KW計画の立案とブリーフJSON生成

**実行タイミング**: 毎月1日、またはユーザーが「今月のKW計画を立てて」と依頼した時

**手順**:
1. `config/tracked-keywords.json` を読み、既存KW計画を確認
2. `briefs/` 内の既存ブリーフを確認し、既に書いた記事のKWを把握
3. 月10本分のKW計画を立案（トピカルクラスター、ファネル、季節性を考慮）
4. 各KWについて `briefs/{slug}.json` を生成（`briefs/_template.json` 形式に準拠）
5. 投稿スケジュール（3日おき、11:00公開）を各ブリーフに設定

**参照ファイル**: `config/tracked-keywords.json`, `briefs/_template.json`, `salon.json`

**制約**:
- マツエク関連KWは含めない
- 蒲田・大田区のローカルSEOを意識
- KWの重複なし
- 認知→検討→行動のファネルを意識

---

### Agent 2: Article Writer（記事執筆エージェント）
**役割**: ブリーフJSONに基づくSEO記事の執筆

**実行タイミング**: ブリーフJSONが準備された時、またはユーザーが「briefs/xxx.json の記事を書いて」と依頼した時

**手順**:
1. 指定されたブリーフJSON（`briefs/{slug}.json`）を読み込む
2. `config/shiji.md`（執筆ルール）を読み込む
3. `config/eeat-config.json` を読み込む
4. `salon.json` を読み込む
5. ブリーフのH2構成に従い、4,000〜8,000文字の記事本文をHTML形式で執筆
6. 記事HTMLを `output/{slug}.html` に保存

**記事HTML形式**:
```html
<!-- TITLE: 記事タイトル -->
<!-- META: メタディスクリプション120-160文字 -->
<!-- KEYWORD: メインKW -->
<!-- CATEGORY: カテゴリID -->
<!-- SLUG: スラッグ -->

<p>導入文...</p>
<h2>見出し1</h2>
<img src="%%IMAGE_1%%" alt="見出し内容の説明" style="max-width: 100%; height: auto;">
<p>本文...</p>
...
<script type="application/ld+json">FAQ構造化データ</script>
```

**品質基準**:
- メインKWを自然に5〜10回使用
- 最初の100文字以内にメインKW
- E-E-A-T: 田中の経験を2〜3箇所に挿入
- FAQ構造化データ（JSON-LD）を3〜5個埋め込み
- 最後のH2は「KATEstageLASH蒲田西口店の○○の特徴」
- 末尾にHot Pepper Beauty予約リンク
- `<figcaption>` 禁止、`>>○○はこちら` 禁止
- 薬機法遵守（誇大表現禁止）

---

### Agent 3: Quality Reviewer（品質校閲エージェント）
**役割**: 記事の品質チェックと自動修正

**実行タイミング**: 記事HTML完成後

**手順**:
1. Claude Codeが記事を読み、文章品質・SEO・正確性を目視レビュー
2. `node cli.js review output/{slug}.html` を実行して自動チェック
3. 問題があれば記事を修正して再度レビュー
4. チェック通過するまで繰り返す

**チェック項目（自動）**:
- プロンプト指示の残留（【】形式）
- 文字化け（U+FFFD）
- ダミーURL
- `<figcaption>` タグ
- `>>○○はこちら` 形式CTA
- マツエク誤記混入
- 薬機法違反表現
- 画像ルール（alt属性、レスポンシブ、重複）
- リンクのHTTP検証（404は自動除去）

**チェック項目（Claude Code目視）**:
- 文章の自然さ・読みやすさ
- KWの適切な使用頻度
- E-E-A-T要素の適切な組み込み
- 情報の正確性（美容知識）
- CTA配置の自然さ

---

### Agent 5: UI/UX Designer（デザイン最適化エージェント）
**役割**: 記事の視認性・読みやすさ・コンバージョン率の最大化

**実行タイミング**: 記事HTML完成後（Quality Reviewerと並行）

**手順**:
1. 記事HTMLのデザイン要素を最適化
2. CTAボタンのブランド統一（LINE緑＋ホットペッパー赤）
3. 立体感・光るエフェクト・ホバーインタラクションの適用
4. モバイルファーストのレスポンシブチェック

**参照ファイル**: `agents/ui-ux-designer.md`

---

### Agent 6: Salon Researcher（サロン情報リサーチエージェント）
**役割**: サロンの正確な情報をリサーチし、記事に反映

**実行タイミング**: 記事執筆前（情報提供）・記事完成後（情報検証）

**手順**:
1. `salon.json` と公式サイト・ホットペッパー情報の整合性を確認
2. メニュー名称・住所・電話番号・URLの正確性を検証
3. 美容知識（持続期間、施術方法等）が業界の常識に沿っているか確認
4. マツエクを当店メニューとして記載していないかチェック

**参照ファイル**: `agents/salon-researcher.md`

---

### Agent 7: Fact Checker（ファクトチェックエージェント）
**役割**: 記事の情報正確性を徹底検証

**実行タイミング**: 記事完成後（Quality Reviewerと並行）

**手順**:
1. サロン固有情報（名称・住所・URL・メニュー）の正確性を検証
2. 美容・医学知識の正確性を確認
3. 薬機法・景品表示法のコンプライアンスチェック
4. 数値データ・統計の根拠確認
5. 記事内の矛盾チェック

**参照ファイル**: `agents/fact-checker.md`

---

### Agent 8: Human Writing Auditor（人間らしさ監査エージェント）
**役割**: AIだと気づかれない自然な文章かを監査

**実行タイミング**: 記事完成後（最終チェック）

**手順**:
1. 6項目の自然さスコアリング（各0〜10点、合計90点以上で合格）
2. AI文章の典型パターン（定型フレーズ多用・構造の単調さ等）を検出
3. 具体的エピソード・感情表現・トーンの緩急をチェック
4. 不合格の場合は修正箇所を指摘し、修正後に再スコアリング

**スコアリング基準**:
- 文型バリエーション（0-10）
- 定型フレーズの非反復（0-10）
- トーンの自然さ（0-10）
- 具体性（0-10）
- 感情・主観（0-10）
- 接続・展開（0-10）

**参照ファイル**: `agents/human-writing-auditor.md`

---

### Agent 4: Publisher（公開エージェント）
**役割**: 画像生成とWordPress予約投稿

**実行タイミング**: 品質レビュー通過後

**手順**:
1. `node cli.js publish output/{slug}.html --date YYYY-MM-DD --time 11:00` を実行
2. sharp で H2 見出しごとの画像を自動生成（グラデーション背景+テキスト）
3. 画像を WordPress にアップロード
4. 記事を WordPress に予約投稿
5. 投稿後に画像URL有効性を検証

**バッチ投稿**:
```bash
node cli.js batch output/*.html --start 2026-04-01 --interval 3 --time 11:00
```

---

## 自動実行パイプライン

### 1記事の完全自動フロー
```
[Salon Researcher] → サロン情報の最新確認
        ↓
[Keyword Planner]  → briefs/{slug}.json
        ↓
[Article Writer]   → output/{slug}.html
        ↓
[Quality Reviewer] + [Fact Checker] + [Human Writing Auditor] + [UI/UX Designer]
        ↓                ↓                    ↓                      ↓
     品質校閲          情報正確性         人間らしさ監査        デザイン最適化
        ↓（全チェック通過後）
[Publisher]         → 画像生成 → GitHubプッシュ → WP自動インポート
```

### 月次バッチフロー
```
1. Salon Researcher がサロン情報を確認
2. Keyword Planner が30本分のブリーフを生成（毎日投稿）
3. Article Writer が各ブリーフから記事を執筆
4. Quality Reviewer + Fact Checker + Human Writing Auditor + UI/UX Designer が並行チェック
5. Publisher が画像生成・GitHubプッシュ（WPプラグインが自動インポート）
```

## CLI コマンド一覧
| コマンド | 説明 |
|---------|------|
| `node cli.js review <file.html>` | 品質チェック |
| `node cli.js review <file.html> --skip-links` | リンク検証をスキップして品質チェック |
| `node cli.js publish <file.html>` | 画像生成 + WordPress投稿（下書き） |
| `node cli.js publish <file.html> --date 2026-04-15 --time 11:00` | 予約投稿 |
| `node cli.js batch output/*.html --start 2026-04-01 --interval 3 --time 11:00` | バッチ投稿 |
| `node cli.js status` | 投稿済み記事一覧 |
| `node cli.js check-images <postId>` | 投稿後の画像URL検証 |

## 初回セットアップ
1. WordPress管理画面でApplication Passwordを生成
2. `.env` ファイルを `.env.example` を参考に作成
3. `npm install` で依存パッケージをインストール
4. テスト記事で `node cli.js review` が通ることを確認
5. `node cli.js publish` でWordPress投稿テスト
