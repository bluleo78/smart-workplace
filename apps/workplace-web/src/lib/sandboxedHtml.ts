/**
 * 격리 iframe(sandbox="" + srcDoc)에 넣을 문서를 만든다(WP-274, WP-275). 렌더는 SandboxedHtmlFrame 이 맡는다.
 *
 * 왜: srcDoc 문서는 앱 CSS 를 상속하지 않아 전역 슬림 스크롤바(index.css)가 적용되지 않고,
 * OS 기본(약 15px) 스크롤바가 다크 화면 안에서 튀어 보인다.
 * 문서 앞에 얇은 스크롤바 스타일만 주입한다 — 스크립트가 아니므로 sandbox="" 격리는 그대로다.
 */

/**
 * 주입할 스타일. 문서 자신의 스타일보다 앞에 오고 명시도가 가장 낮아, 문서가 스크롤바를 직접 꾸몄다면 그쪽이 이긴다.
 * - scrollbar-width 는 상속되지 않아 중첩 스크롤 영역까지 얇게 하려면 `*` 에 건다.
 * - scrollbar-color 는 상속되므로 `:root` 에만 건다 — `*` 에 걸면 문서가 body 등에 준 색의 상속을 끊는다.
 * 앱 스크롤바 토큰(index.css)은 앱 배경 기준이라 쓰지 않는다 — 문서 배경을 알 수 없어
 * 밝은·어두운 배경 모두에서 보이는 반투명 회색 thumb 를 쓴다. ::-webkit-* 는 표준 속성을 모르는 구형 WebKit 폴백.
 */
export const THIN_SCROLLBAR_STYLE =
  '<style data-thin-scrollbar>' +
  '*{scrollbar-width:thin}' +
  ':root{scrollbar-color:rgb(128 128 128 / 0.45) transparent}' +
  '::-webkit-scrollbar{width:8px;height:8px}' +
  '::-webkit-scrollbar-track{background:transparent}' +
  '::-webkit-scrollbar-thumb{background-color:rgb(128 128 128 / 0.45);border-radius:9999px}' +
  '</style>'

/** HTML 공백(파서가 건너뛰는 문자). */
const isHtmlSpace = (c: string) => c === ' ' || c === '\n' || c === '\t' || c === '\r' || c === '\f'

/**
 * 문서 맨 앞 프롤로그(BOM·공백·주석·XML 선언) 뒤에 오는 `<!DOCTYPE ...>` 의 끝 위치. 없으면 -1.
 * 주석·XML 선언(파서는 주석으로 취급)은 DOCTYPE 앞에 와도 표준 모드를 깨지 않지만, 그 앞에 `<style>` 을 두면 깨진다.
 * 정규식이 아니라 한 번 훑는 스캔이다 — `(공백|주석)*` 꼴 정규식은 주석·공백이 길게 이어지고 DOCTYPE 이 없는
 * 입력에서 지수 백트래킹해, 신뢰 불가 HTML(메일 등) 하나로 탭을 멈출 수 있었다.
 */
function leadingDoctypeEnd(html: string): number {
  let i = html.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    while (i < html.length && isHtmlSpace(html[i])) i++
    if (html.startsWith('<!--', i)) {
      const close = html.indexOf('-->', i + 4)
      if (close < 0) return -1
      i = close + 3
    } else if (html.startsWith('<?', i)) {
      // HTML 파서는 `<?...` 를 첫 `>` 까지의 주석으로 읽는다.
      const close = html.indexOf('>', i + 2)
      if (close < 0) return -1
      i = close + 1
    } else break
  }
  if (html.slice(i, i + 9).toLowerCase() !== '<!doctype') return -1
  const close = html.indexOf('>', i + 9)
  return close < 0 ? -1 : close + 1
}

/**
 * 원문 HTML 에 스크롤바 스타일을 주입한다.
 * DOCTYPE 앞에 요소를 두면 문서가 quirks 모드로 렌더돼 레이아웃이 달라지므로,
 * DOCTYPE 이 있으면(앞의 주석·XML 선언 포함) 그 바로 뒤에, 없으면 맨 앞에 넣는다.
 */
export function withThinScrollbar(html: string): string {
  const end = leadingDoctypeEnd(html)
  if (end < 0) return THIN_SCROLLBAR_STYLE + html
  return html.slice(0, end) + THIN_SCROLLBAR_STYLE + html.slice(end)
}
