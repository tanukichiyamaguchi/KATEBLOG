# KATEstageLASH ブログ自動化システム — Agent Team 構成

## プロジェクト概要
アイブロウ・まつ毛専門サロン「KATEstageLASH蒲田西口店」のSEOブログ記事を自動生成し、WordPressに予約投稿するシステム。

## 重要ルール
- **マツエク（まつ毛エクステンション）は当サロンでは提供していない**。記事にマツエクを当店メニューとして記載しないこと。
- **記事の文章執筆はClaude Code自身が行う。文章生成に外部LLM APIは使わない。**
- 文章は**新PASONAの法則**に沿って、**女性スタッフが語りかけるような柔らかい口調**（サロン名義は維持・個人名は出さない）で書く。
- **画像**は Node.jsツールが **OpenAI（ChatGPT）Images API** で内容に応じたリアル写真風を生成（APIキーが無ければ sharp にフォールバック）。
- ブログは**週1回のペースで自動公開**する（`queue/` にストックし、週次GitHub Actionsが1本ずつ `output/` へ移動 → WPプラグインが取り込み予約公開）。
- Node.jsツール（cli.js）は画像生成・WordPress投稿・リンク検証・品質チェック・週次キュー管理を担当。

## ディレクトリ構成
```
KATEBLOG/
├── CLAUDE.md          # このファイル（Agent Team定義）
├── salon.json         # サロン情報
├── .env               # WordPress認証 + OpenAI APIキー（git管理外）
├── config/
│   ├── shiji.md       # 執筆ルール（新PASONA・口調・視認性）
│   ├── eeat-config.json  # E-E-A-T設定
│   └── tracked-keywords.json  # KW管理
├── briefs/            # 記事ブリーフJSON
├── queue/             # 週1公開用ストック（queue.json + {slug}.html）
├── output/            # 公開対象記事HTML（WPプラグインが走査）
├── src/
│   ├── image-generator.js          # sharp画像生成（フォールバック）
│   ├── openai-image-generator.js   # OpenAI写真風画像生成
│   ├── image-provider.js           # 画像プロバイダ切替（openai/sharp/auto）
│   ├── queue.js                    # 週次キュー管理（publish-next）
│   ├── wordpress.js                # WP XML-RPC
│   ├── reviewer.js                 # 品質チェック
│   └── publisher.js                # 公開パイプライン
├── .github/workflows/
│   └── weekly-publish.yml          # 週1自動公開（cron）
└── cli.js             # CLIエントリーポイント
```

詳しい運用手順は **`docs/weekly-automation.md`** を参照。

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
1. 指定されたブリーフJSON（`briefs/{slug}.json`）を読み込む（`pasona` と `imagePrompts` を確認）
2. `config/shiji.md`（執筆ルール：新PASONA・口調・視認性コンポーネント）を読み込む
3. `config/eeat-config.json` を読み込む
4. `salon.json` を読み込む
5. **新PASONAの法則**（P→A→S→O→N→A）に沿ってH2を構成し、3,000〜8,000文字をHTMLで執筆
6. 週1ストック運用では `queue/{slug}.html` に保存（即時公開なら `output/{slug}.html`）し、`queue/queue.json` の `pending` に追加

**記事HTML形式**:
```html
<!-- TITLE: 記事タイトル -->
<!-- META: メタディスクリプション120-160文字 -->
<!-- KEYWORD: メインKW -->
<!-- CATEGORY: カテゴリID -->
<!-- SLUG: スラッグ -->
<!-- IMG_STYLE: 全画像共通スタイル（任意・英語推奨） -->
<!-- IMG_PROMPT_1: 1枚目H2画像の被写体（任意・英語推奨） -->

<p>導入文（悩みに共感＋最初の100文字以内にメインKW）...</p>
<h2>見出し1（Problem）</h2>
<img src="%%IMAGE_1%%" alt="見出し内容の説明" style="max-width: 100%; height: auto;">
<p>本文＋視認性コンポーネント...</p>
...
<script type="application/ld+json">FAQ構造化データ</script>
```

**品質基準**:
- 構成は新PASONAの法則（各H2をP/A/S/O/N/Aに対応、記号は見出しに出さない）
- 女性スタッフ風の柔らかい語りかけ口調（サロン名義維持・個人名は出さない）
- 各H2に視認性コンポーネントを最低1つ（ポイントボックス／スタッフボイス／チェックリスト／まとめボックス等）
- 画像は内容に合わせて `IMG_PROMPT_N` ヒントを付与（OpenAI写真風）
- メインKWを自然に5〜10回／最初の100文字以内にメインKW
- E-E-A-T: 当サロンの経験に基づくアドバイスを2〜3箇所（スタッフボイス）
- FAQ構造化データ（JSON-LD）を3〜5個埋め込み
- 最後のH2は「KATEstageLASH蒲田西口店の○○の特徴」
- 末尾にHot Pepper Beauty予約リンク＋公式LINE
- `<figcaption>` 禁止、`>>○○はこちら` 禁止、絵文字の本文連続使用禁止
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
**役割**: 画像生成と公開（週1自動 / 手動）

**実行タイミング**: 品質レビュー通過後

**画像生成**:
- 既定で **OpenAI（ChatGPT）Images API** によるリアル写真風（`IMG_PROMPT_N` / `imagePrompts` を反映）。
- `OPENAI_API_KEY` が無い・生成失敗時は **sharp**（グラデーション）に自動フォールバック。
- プロバイダは `--provider openai|sharp|auto` または `.env` の `IMAGE_PROVIDER` で指定（既定 `auto`）。

**週1自動公開（推奨フロー）**:
1. 記事は `queue/{slug}.html` にストックし、`queue/queue.json` の `pending` に登録。
2. 週次 GitHub Actions（`.github/workflows/weekly-publish.yml`, cron）が `node cli.js publish-next` を実行。
3. キュー先頭1本の画像を生成して `output/images-{slug}/` に保存、HTMLを `output/{slug}.html` へ移動、`briefs/{slug}.json` に公開日（当日JST 11:00）をセット。
4. commit & push → WPプラグインが1時間以内に取り込み、予約公開。

**手動公開（XML-RPC直）**:
1. `node cli.js publish output/{slug}.html --date YYYY-MM-DD --time 11:00` を実行
2. 画像生成（OpenAI/sharp）→ WordPressへアップロード → 予約投稿 → 画像URL検証

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
[Article Writer]   → queue/{slug}.html（新PASONA・女性スタッフ口調・視認性）
        ↓
[Quality Reviewer] + [Fact Checker] + [Human Writing Auditor] + [UI/UX Designer]
        ↓                ↓                    ↓                      ↓
     品質校閲          情報正確性         人間らしさ監査        デザイン最適化
        ↓（全チェック通過後 → queue/queue.json に登録）
[Publisher]   → 週次cron(publish-next) → OpenAI画像生成 → GitHubプッシュ → WP自動インポート
```

### 週次フロー（毎週1本・自動）
```
1. Article Writer が新PASONAで記事を執筆 → queue/{slug}.html（ストック）
2. Quality Reviewer 等がチェック → queue/queue.json の pending に登録
3. 週次 GitHub Actions（cron, 月曜11:00 JST想定）が publish-next を実行
   → キュー先頭1本の OpenAI画像を生成 → output/ へ移動 → 公開日セット → commit/push
4. WPプラグインが取り込み、予約公開
```

## CLI コマンド一覧
| コマンド | 説明 |
|---------|------|
| `node cli.js review <file.html>` | 品質チェック |
| `node cli.js review <file.html> --skip-links` | リンク検証をスキップして品質チェック |
| `node cli.js generate-images <file.html> [--provider openai\|sharp\|auto]` | 画像生成のみ |
| `node cli.js publish <file.html>` | 画像生成 + WordPress投稿（下書き） |
| `node cli.js publish <file.html> --date 2026-04-15 --time 11:00` | 予約投稿 |
| `node cli.js batch output/*.html --start 2026-04-01 --interval 3 --time 11:00` | バッチ投稿 |
| `node cli.js publish-next [--date ... --time ... --provider ...]` | 週次キューから次の1本を公開準備 |
| `node cli.js queue` | 公開キューの状況を表示 |
| `node cli.js status` | 投稿済み記事一覧 |
| `node cli.js check-images <postId>` | 投稿後の画像URL検証 |

## 初回セットアップ
1. WordPress管理画面でApplication Passwordを生成
2. `.env` ファイルを `.env.example` を参考に作成（`OPENAI_API_KEY` も設定）
3. `npm install` で依存パッケージをインストール
4. テスト記事で `node cli.js review` が通ることを確認
5. `node cli.js generate-images` で画像生成を確認 → `node cli.js publish` でWordPress投稿テスト
6. 週1自動公開は **`docs/weekly-automation.md`** を参照（GitHub Secrets / cron / WPプラグインのブランチ設定）
