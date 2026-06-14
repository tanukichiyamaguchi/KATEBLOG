// 図解・表紙のサンプル一括生成（確認用）
const { generateDiagram, parseDiagramSpec } = require('../src/diagram-generator');

(async () => {
  const out = '/tmp/samples';
  require('fs').mkdirSync(out, { recursive: true });

  await generateDiagram({ layout: 'cover', title: '一重さんのまつ毛パーマ｜目もとが変わるカール選びとコツ', category: 'まつ毛パーマ' }, 0, out);
  console.log('cover done');

  await generateDiagram(parseDiagramSpec('layout=cards; title=一重さんのカールが埋もれる3つの理由; items=まぶたの厚み|まつ毛の生える向き|カールの角度'), 1, out);
  await generateDiagram(parseDiagramSpec('layout=steps; title=長持ちさせる4つのステップ; items=オイルフリーで洗う|目元をこすらない|まつ毛美容液でケア|適切な周期で通う'), 2, out);
  await generateDiagram(parseDiagramSpec('layout=checklist; title=こんな一重さんは専門サロンへ; items=過去に「変わらなかった」経験がある|下向き・内向きまつ毛でメイクに時間がかかる|自分に似合うカールが分からない'), 3, out);
  await generateDiagram(parseDiagramSpec('layout=point; title=ここがポイント; text=「上がらない」のではなく「上げたカールが見えていない」だけ'), 4, out);
  await generateDiagram(parseDiagramSpec('layout=compare; title=ナチュラル と しっかりカール; left=ナチュラル:自然な仕上がり,目元やさしい,初めて向き; right=しっかりカール:ぱっちり強調,華やか,イベント向き'), 5, out);
  console.log('diagrams done');

  console.log(require('fs').readdirSync(out).join('\n'));
})();
