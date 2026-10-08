import { type ComponentProps, useMemo, useState } from 'react'

import { withThinScrollbar } from '../lib/sandboxedHtml'

/**
 * 신뢰할 수 없는 HTML(메일 원문·업로드 파일·LLM 생성물)을 렌더하는 공용 격리 iframe(WP-275).
 *
 * - sandbox="" 고정: 스크립트·폼·same-origin·네비게이션을 전면 차단한다(#486 XSS 패턴). 호출부가 바꿀 수 없다.
 * - srcDoc 에 슬림 스크롤바 스타일을 주입한다 — srcDoc 문서는 앱 CSS 를 상속하지 않아
 *   그대로 두면 OS 기본 두꺼운 스크롤바가 보인다(WP-274 에서 드라이브만 고쳤던 것을 한 곳으로 모음).
 * 주입은 html 이 바뀔 때만 한다 — 수 MB 문서를 렌더마다(폴링·호버 등) 다시 잇지 않게.
 * - 내용이 바뀌면 iframe 을 새로 만든다(key) — 같은 iframe 의 srcDoc 을 바꾸면 iframe 안 이동이 되어 상위 창
 *   뒤로가기 기록에 칸이 쌓인다. 그러면 ‹(history.go)·스와이프가 그 칸만 되돌려 화면이 그대로 남는다.
 *   iOS PWA 는 앱 전환 때 테마를 잠깐 뒤집어 다크 변환 메일 본문이 두 번 다시 그려지고, 인라인 이미지 치환도
 *   본문을 한 번 더 바꾼다. 새 iframe 의 첫 로드는 기록에 남지 않는다.
 */
export function SandboxedHtmlFrame({
  html,
  ...props
}: { html: string; title: string } & Omit<ComponentProps<'iframe'>, 'srcDoc' | 'sandbox' | 'src'>) {
  const doc = useMemo(() => withThinScrollbar(html), [html])
  // 문서가 바뀔 때마다 올리는 세대 번호 — iframe key. 수 MB 문서 자체를 key 로 쓰지 않으려고 렌더 중에 번호만 갱신한다.
  const [frame, setFrame] = useState({ doc, generation: 0 })
  if (frame.doc !== doc) setFrame({ doc, generation: frame.generation + 1 })
  // 공용 구현부 — srcDoc iframe 직접 사용 금지 규칙(eslint.config.js)의 유일한 예외.
  // eslint-disable-next-line no-restricted-syntax
  return <iframe key={frame.generation} {...props} sandbox="" srcDoc={doc} />
}
