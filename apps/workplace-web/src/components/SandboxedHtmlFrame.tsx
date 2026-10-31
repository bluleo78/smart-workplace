import { type ComponentProps, useMemo, useState } from 'react'

import { withSandboxHead } from '../lib/sandboxedHtml'

/**
 * 신뢰할 수 없는 HTML(메일 원문·업로드 파일·LLM 생성물)을 렌더하는 공용 격리 iframe(WP-275).
 *
 * - sandbox 고정: 스크립트·폼·same-origin 을 차단한다(#486 XSS 패턴). 호출부가 바꿀 수 없다.
 *   팝업만 허용하고(allow-popups) 새 창은 sandbox 를 벗어나게 한다(allow-popups-to-escape-sandbox) —
 *   srcDoc 의 `<base target="_blank">` 와 함께 링크를 새 탭에서 연다(WP-427). 빈 sandbox 는 iframe 자체 이동을
 *   막지 못해, 링크가 iframe 안에서 열리고 SharePoint 등 프레임 표시를 거부하는 사이트는 '연결할 수 없음'이 됐다.
 *   새 탭은 opener 없이 열린다(target=_blank 는 표준상 noopener 를 함축 — 링크를 연 사이트가 본문 프레임을 조작하지 못한다).
 * - srcDoc 에 링크 대상 `<base>` 와 슬림 스크롤바 스타일을 주입한다 — srcDoc 문서는 앱 CSS 를 상속하지 않아
 *   그대로 두면 OS 기본 두꺼운 스크롤바가 보인다(WP-274 에서 드라이브만 고쳤던 것을 한 곳으로 모음).
 * 주입은 html 이 바뀔 때만 한다 — 수 MB 문서를 렌더마다(폴링·호버 등) 다시 잇지 않게.
 * - 내용이 바뀌면 iframe 을 새로 만든다(key) — 같은 iframe 의 srcDoc 을 바꾸면 iframe 안 이동이 되어 상위 창
 *   뒤로가기 기록에 칸이 쌓인다. 그러면 ‹(history.go)·스와이프가 그 칸만 되돌려 화면이 그대로 남는다.
 *   iOS PWA 는 앱 전환 때 테마를 잠깐 뒤집어 다크 변환 메일 본문이 두 번 다시 그려지고, 인라인 이미지 치환도
 *   본문을 한 번 더 바꾼다. 새 iframe 의 첫 로드는 기록에 남지 않는다.
 */
export function SandboxedHtmlFrame({
  html,
  allowScripts = false,
  ...props
}: {
  html: string
  title: string
  /**
   * 스크립트 허용(WP-1242 노트 HTML 블록) — 기본 false 는 지금처럼 스크립트 차단(메일·업로드 미리보기). 호출부가 sandbox 문자열을
   * 직접 고르지 못하고 이 플래그 하나만 준다. 켜도 allow-same-origin 은 주지 않는다 — 문서가 불투명 출처(origin "null")라
   * 스크립트가 앱 쿠키·localStorage·부모 DOM 에 닿지 못한다(둘을 함께 주면 스크립트가 sandbox 속성을 지워 격리를 풀 수 있다).
   * 다운로드(차트 「이미지로 저장」)·팝업(링크 — 브라우저가 사용자 동작 없는 팝업은 막는다)은 허용한다. 대화상자(allow-modals)는 주지 않는다 —
   * alert·confirm·prompt 를 되풀이하는 스크립트가 앱 탭을 잠그지 못하게(WP-1242 결정). 막힌 alert 는 아무 일 없이 지나간다.
   */
  allowScripts?: boolean
} & Omit<ComponentProps<'iframe'>, 'srcDoc' | 'sandbox' | 'src'>) {
  const doc = useMemo(() => withSandboxHead(html), [html])
  // 문서가 바뀔 때마다 올리는 세대 번호 — iframe key. 수 MB 문서 자체를 key 로 쓰지 않으려고 렌더 중에 번호만 갱신한다.
  const [frame, setFrame] = useState({ doc, generation: 0 })
  if (frame.doc !== doc) setFrame({ doc, generation: frame.generation + 1 })
  // 공용 구현부 — srcDoc iframe 직접 사용 금지 규칙(eslint.config.js)의 유일한 예외.
  // eslint-disable-next-line no-restricted-syntax
  return <iframe key={frame.generation} {...props} sandbox={allowScripts ? SCRIPT_SANDBOX : INERT_SANDBOX} srcDoc={doc} />
}

/** 기본 격리 — 스크립트·폼·same-origin 차단, 링크 팝업만(WP-427). */
const INERT_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox'

/** 스크립트 허용 격리(WP-1242) — allow-same-origin(있으면 스크립트가 앱 출처로 돈다)·allow-modals(대화상자로 탭 잠금)는 없다. */
const SCRIPT_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads'
