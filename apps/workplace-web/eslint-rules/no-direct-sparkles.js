// lucide-react 의 Sparkles 계열 아이콘 직접 import 금지(WP-1529).
// 왜: AI 표식이 화면마다 제각각(Sparkles 직접 사용 + 보라 원색)이라 디자인 시스템 §7.2 와 어긋났다.
//     AI 표식은 한 곳에서 관리하는 프리미티브를 거쳐야 색·접근성이 같이 바뀐다.
// 잡지 않는 것: `icons.Sparkles` 같은 lucide 의 icons 맵 접근과 `lucide-react/dynamic` 의 DynamicIcon name="sparkles" —
//     저장소에 그 패턴이 없어 비용 대비 효과가 없다고 판단해 의도적으로 제외했다.
// 무엇을 쓰나: @/components/ai 의 AiLabel(글자와 함께·AI 실행 버튼) · AiContent(AI 생성물) ·
//     AiSignalBadge(AI 신호) · AiIcon(아이콘만 놓이는 자리). AI 와 무관한 반짝임 아이콘이면 사유와 함께 disable 한다.

// Sparkles · Sparkle(단수) · SparklesIcon · LucideSparkles · WandSparkles 등 이름 변형.
const NAMES = /^(Lucide)?(Wand)?Sparkles?(Icon)?$/
// lucide-react/dist/esm/icons/sparkles 같은 딥 임포트 경로.
const DEEP = /^lucide-react\/.*\b(wand-)?sparkles(\.m?js)?$/

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      direct:
        'AI 표식은 lucide-react 의 {{name}} 를 직접 쓰지 말고 @/components/ai 의 AiLabel(글자와 함께·AI 실행 버튼)·AiContent(AI 생성물)·AiSignalBadge(AI 신호)·AiIcon(아이콘만 놓이는 자리)을 쓰세요 — docs/design-system/07-iconography.md §7.2. AI 와 무관한 아이콘이면 사유와 함께 disable 하세요.',
    },
  },
  create(context) {
    // `import * as X from 'lucide-react'` 로 들어온 네임스페이스 이름 — X.Sparkles 우회를 잡기 위해 기억한다.
    const namespaces = new Set()
    // 네임스페이스 멤버 접근(X.Sparkles)이면 보고한다. 일반 식과 JSX(<X.Sparkles />) 가 공용.
    function checkMember(node, objectName, propName) {
      if (namespaces.has(objectName) && NAMES.test(propName)) {
        context.report({ node, messageId: 'direct', data: { name: propName } })
      }
    }
    return {
      MemberExpression(node) {
        if (node.computed || node.object.type !== 'Identifier' || node.property.type !== 'Identifier') return
        checkMember(node, node.object.name, node.property.name)
      },
      JSXMemberExpression(node) {
        if (node.object.type !== 'JSXIdentifier') return
        checkMember(node, node.object.name, node.property.name)
      },
      ImportDeclaration(node) {
        const source = node.source.value
        if (source === 'lucide-react') {
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportNamespaceSpecifier') namespaces.add(spec.local.name)
            if (spec.type !== 'ImportSpecifier') continue
            // import { 'x' as y } 형태면 imported 가 Literal 이라 value 를 쓴다.
            const name = spec.imported.name ?? spec.imported.value
            if (NAMES.test(name)) context.report({ node: spec, messageId: 'direct', data: { name } })
          }
        } else if (DEEP.test(source)) {
          context.report({ node, messageId: 'direct', data: { name: source } })
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.source || node.source.value !== 'lucide-react') return
        for (const spec of node.specifiers) {
          const name = spec.local.name ?? spec.local.value
          if (NAMES.test(name)) context.report({ node: spec, messageId: 'direct', data: { name } })
        }
      },
    }
  },
}
