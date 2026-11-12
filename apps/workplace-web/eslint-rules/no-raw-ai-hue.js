// violet·purple·fuchsia·indigo 원색 Tailwind 클래스 금지(WP-1529).
// 왜: AI 표식을 보라 계열 원색으로 직접 칠해 디자인 시스템 §7.2 의 ai-accent 토큰과 어긋나고 다크 모드 대응도 제각각이었다.
// 무엇을 쓰나: AI 표식이면 ai-accent 토큰(text-ai-accent · bg-ai-accent-subtle), 그 밖이면 primary·info 등 시맨틱 토큰.
//     사용자가 고르는 색 팔레트처럼 원색이 필요한 곳은 eslint.config.js 허용 목록에 둔다.
// 검사 대상: 문자열 리터럴과 템플릿 리터럴의 정적 조각(className·cn() 인자·CSS 변수 문자열 모두).

// 접두사(dark: 등 변형·text-·bg- 등 유틸) + 색 이름 + 단계(50·100~900·950). 불투명도 접미사(/10)는 \b 로 허용해 함께 잡는다.
const HUE = /\b[a-z]+-(?:[a-z]+-)*?(violet|purple|fuchsia|indigo)-(?:50|[1-9]00|950)\b/

// 정규식 HUE 를 돌리기 전에 색 이름이 아예 없는 대다수 문자열을 싸게 거른다.
const QUICK = /violet|purple|fuchsia|indigo/

export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      rawHue:
        'violet·purple·fuchsia·indigo 원색 클래스({{cls}}) 대신 시맨틱 토큰을 쓰세요 — AI 표식이면 ai-accent(text-ai-accent·bg-ai-accent-subtle, §7.2), 그 밖이면 primary·info 등. 사용자가 고르는 색 팔레트는 eslint.config.js 허용 목록에 둡니다.',
    },
  },
  create(context) {
    /** 문자열에서 원색 클래스를 찾아 첫 매치를 보고한다. */
    function check(node, text) {
      if (!QUICK.test(text)) return
      const m = HUE.exec(text)
      if (m) context.report({ node, messageId: 'rawHue', data: { cls: m[0] } })
    }
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value)
      },
      TemplateElement(node) {
        check(node, node.value.raw)
      },
    }
  },
}
