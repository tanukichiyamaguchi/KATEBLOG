# 週1自動公開 ＋ OpenAI画像生成 セットアップガイド

このドキュメントは、今回追加した3つの仕組みのセットアップ・運用手順をまとめたものです。

1. **新PASONAの法則＋女性スタッフ口調＋視認性の高いデザイン**（執筆ルール）
2. **OpenAI（ChatGPT）Images API による内容連動の画像生成**
3. **週1回の自動公開**（queue → output → WordPress）

---

## 1. 執筆ルール（新PASONA / 口調 / 視認性）

- マスタープロンプト: `config/shiji.md`
- 記事は **新PASONAの法則**（Problem → Affinity → Solution → Offer → Narrowing down → Action）でH2を構成。
- 文体は **サロン名義のまま、女性スタッフが語りかけるような柔らかい口調**（個人名は出さない）。
- 各H2に**視認性コンポーネント**（ポイントボックス／スタッフボイス吹き出し／チェックリスト／まとめボックス／マーカー／Q&A）を最低1つ配置。
- 実例: `queue/hitoe-matsuge-perm.html`（一重さん向けまつ毛パーマ記事）。

---

## 2. 画像生成（表紙＋手書き図解＋素人風写真）

### 方針
「AI感」を避けるため、画像は次の3種類を使い分けます（既定は**表紙＋図解中心**、写真は最小限）。

| 種別 | 生成方法 | 用途 |
|---|---|---|
| **表紙 cover** | 手書きフォント＋SVG（`src/diagram-generator.js`） | 1枚目＝アイキャッチ。タイトルを大きく高視認性で。 |
| **図解 diagram** | 手書きフォント＋SVG | cards/steps/checklist/point/compare。説明をわかりやすく。 |
| **写真 photo** | OpenAI Images API（`src/openai-image-generator.js`） | 素人が撮った20代女性のスマホ写真風。雰囲気づけに最小限。 |

- **なぜ図解はAIで作らないか**: 画像AIは日本語の文字を描かせると崩れる（かえってAI感が出る）。そこで図解・表紙の文字は**手書きフォント（Zen Kurenaido）で確実に描画**します。
- `src/image-provider.js` が種別を判定（`IMG_DIAGRAM_N`→図解／1枚目→表紙／`IMG_TYPE_N=photo`→写真）。
- 写真プロバイダは `openai|sharp|auto`（既定 auto＝キーがあればOpenAI、無ければsharp。個別失敗時もsharpへフォールバック）。
- 生成物は `output/images-{slug}/image-{0..N}.png`（1200×630）。WordPressプラグインはこのPNGをそのまま取り込みます（プラグイン側の改修は不要）。
- 図解・表紙の手書きフォントは `assets/fonts/`（OFLライセンス）。CIでは `scripts/install-fonts.sh` でfontconfigに登録してから生成します。書体は `.env` の `DIAGRAM_FONT` で変更可（既定 Zen Kurenaido、`Yomogi` も同梱）。

### 画像種別の指定（記事HTMLのメタコメント）
```html
<!-- IMG_DIAGRAM_1: layout=cover; title=記事タイトル; category=まつ毛パーマ -->
<!-- IMG_DIAGRAM_3: layout=cards; title=◯◯の3つの理由; items=理由1|理由2|理由3 -->
<!-- IMG_DIAGRAM_4: layout=steps; title=◯◯の4ステップ; items=手順1|手順2|手順3|手順4 -->
<!-- IMG_TYPE_6: photo -->
<!-- IMG_PROMPT_6: a casual smartphone snapshot of a Japanese woman in her 20s, natural, no text -->
```

### 画像の内容を記事に合わせる（ヒント）
記事HTMLの先頭メタコメント、またはブリーフJSONの `imagePrompts` で被写体を指定できます。

```html
<!-- IMG_STYLE: soft pastel tones, bright clean salon, no text -->
<!-- IMG_PROMPT_1: a close-up of a Japanese woman's natural curled eyelashes after an eyelash perm -->
<!-- IMG_PROMPT_2: a relaxing eyebrow styling treatment scene in a bright beauty salon -->
```
- `IMG_PROMPT_{N}` は N番目のH2画像の被写体（英語推奨）。未指定のH2は見出しから自動生成。
- `IMG_STYLE` は全画像共通の追加スタイル。

### .env 設定（`.env.example` 参照）
```
OPENAI_API_KEY=sk-...
OPENAI_IMAGE_MODEL=gpt-image-1     # dall-e-3 も可
OPENAI_IMAGE_SIZE=                 # 空なら model に応じて自動
OPENAI_IMAGE_QUALITY=high          # gpt-image-1: low|medium|high|auto
OPENAI_IMAGE_STYLE=                # 任意の共通スタイル
IMAGE_PROVIDER=auto                # openai|sharp|auto
```

### 動作確認
```bash
node cli.js generate-images queue/hitoe-matsuge-perm.html --provider openai
# キー未設定でも sharp で動作（--provider sharp / auto）
```

> 💡 コスト目安: 1記事あたりH2の数だけ画像を生成します（標準6枚）。`OPENAI_IMAGE_QUALITY=medium` でコストを抑えられます。

---

## 3. 週1自動公開

### 全体像
```
queue/{slug}.html（ストック）
      │  毎週 cron
      ▼
node cli.js publish-next   … 画像生成 + output/へ移動 + 公開日セット + queue更新
      │  commit & push（GitHub Actions）
      ▼
WordPressプラグイン（毎時インポート）→ 当日11:00 JST に予約公開
```

### キュー運用
- ストック: `queue/{slug}.html` に記事を置き、`queue/queue.json` の `pending` 配列にスラッグを追加（**公開したい順**に並べる）。
- 状況確認: `node cli.js queue`
- 手動で1本進める: `node cli.js publish-next`（`--dry-run` で対象だけ確認可）

`queue/queue.json` の例:
```json
{
  "pending": ["hitoe-matsuge-perm", "next-slug-2", "next-slug-3"],
  "published": []
}
```

### GitHub Actions（`.github/workflows/weekly-publish.yml`）
- スケジュール: 毎週日曜 20:00 UTC（= 月曜 05:00 JST）に実行 → 当日（月曜）11:00 JST 公開予定。
- 手動実行（Run workflow）も可能（`date` / `time` / `provider` を指定可）。

#### 必要な設定
1. **GitHub Secrets**
   - `OPENAI_API_KEY` … OpenAI画像生成用（未設定でも sharp で動作）
2. **（任意）GitHub Variables**
   - `OPENAI_IMAGE_MODEL`（既定 `gpt-image-1`）
   - `OPENAI_IMAGE_QUALITY`（既定 `high`）
3. **デフォルトブランチ要件（重要）**
   - GitHub の仕様上、`schedule`（cron）は**デフォルトブランチにあるワークフローしか起動しません**。
   - 本番で週1自動公開を動かすには、このワークフローを**デフォルトブランチへマージ**してください。
   - 手動実行（workflow_dispatch）は任意のブランチで可能です。
4. **WordPressプラグインのブランチ設定**
   - WP管理画面 → KATEBLOG → ブランチ を、ワークフローが push するブランチ（＝記事が `output/` に入るブランチ）に合わせてください。

### よくある質問
- **Q. output/ に直接置けば毎時取り込まれて即公開では？**
  → はい。だから「週1」にするために、ストックは `queue/`（プラグインが走査しない場所）に置き、cron が1本ずつ `output/` へ出します。
- **Q. 公開が即時にならず未来日時になるのは？**
  → cron を早朝（JST）に実行し、公開時刻を同日 11:00 にセットしているため、確実に「予約（future）」として登録されます。
- **Q. OpenAIキーが無いと止まりますか？**
  → 止まりません。sharp 画像で公開されます。
