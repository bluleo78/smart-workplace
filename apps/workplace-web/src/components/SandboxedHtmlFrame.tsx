import { type ComponentProps, useMemo } from 'react'

import { withThinScrollbar } from '../lib/sandboxedHtml'

/**
 * 신뢰할 수 없는 HTML(메일 원문·업로드 파일·LLM 생성물)을 렌더하는 공용 격리 iframe(WP-275).
 *
 * - sandbox="" 고정: 스크립트·폼·same-origin·네비게이션을 전면 차단한다(#486 XSS 패턴). 호출부가 바꿀 수 없다.
 * - srcDoc 에 슬림 스크롤바 스타일을 주입한다 — srcDoc 문서는 앱 CSS 를 상속하지 않아
 *   그대로 두면 OS 기본 두꺼운 스크롤바가 보인다(WP-274 에서 드라이브만 고쳤던 것을 한 곳으로 모음).
 * 주입은 html 이 바뀔 때만 한다 — 수 MB 문서를 렌더마다(폴링·호버 등) 다시 잇지 않게.
 */
export function SandboxedHtmlFrame({
  html,
  ...props
}: { html: string; title: string } & Omit<ComponentProps<'iframe'>, 'srcDoc' | 'sandbox' | 'src'>) {
  const doc = useMemo(() => withThinScrollbar(html), [html])
  // 공용 구현부 — srcDoc iframe 직접 사용 금지 규칙(eslint.config.js)의 유일한 예외.
  // eslint-disable-next-line no-restricted-syntax
  return <iframe {...props} sandbox="" srcDoc={doc} />
}
