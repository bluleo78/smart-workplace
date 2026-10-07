/**
 * HTML 미리보기(sandbox iframe srcDoc)에 넣을 문서를 만든다(WP-274).
 *
 * 왜: srcDoc 문서는 앱 CSS 를 상속하지 않아 전역 슬림 스크롤바(index.css)가 적용되지 않고,
 * OS 기본(약 15px, 밝은 회색) 스크롤바가 다크 모달 안에서 튀어 보인다.
 * 문서 앞에 얇은 스크롤바 스타일만 주입한다 — 스크립트가 아니므로 sandbox="" 격리는 그대로다.
 */

/**
 * 주입할 스타일. 문서 자신의 스타일보다 앞에 오고 명시도가 가장 낮아, 문서가 스크롤바를 직접 꾸몄다면 그쪽이 이긴다.
 * - scrollbar-width 는 상속되지 않아 중첩 스크롤 영역까지 얇게 하려면 `*` 에 건다.
 * - scrollbar-color 는 상속되므로 `:root` 에만 건다 — `*` 에 걸면 문서가 body 등에 준 색의 상속을 끊는다.
 * 앱 스크롤바 토큰(index.css)은 앱 배경 기준이라 쓰지 않는다 — 문서 배경을 알 수 없어
 * 밝은·어두운 배경 모두에서 보이는 반투명 회색 thumb 를 쓴다. ::-webkit-* 는 표준 속성을 모르는 구형 WebKit 폴백.
 */
export const PREVIEW_SCROLLBAR_STYLE =
  '<style data-preview-scrollbar>' +
  '*{scrollbar-width:thin}' +
  ':root{scrollbar-color:rgb(128 128 128 / 0.45) transparent}' +
  '::-webkit-scrollbar{width:8px;height:8px}' +
  '::-webkit-scrollbar-track{background:transparent}' +
  '::-webkit-scrollbar-thumb{background-color:rgb(128 128 128 / 0.45);border-radius:9999px}' +
  '</style>'

/**
 * 문서 맨 앞 프롤로그(BOM·공백·주석·XML 선언) 뒤의 `<!DOCTYPE ...>` 선언까지.
 * 주석·XML 선언(파서는 주석으로 취급)은 DOCTYPE 앞에 와도 표준 모드를 깨지 않지만, 그 앞에 `<style>` 을 두면 깨진다.
 * 반복 그룹 안의 공백은 `\s+` 가 아니라 `\s` 한 글자 — `(\s+)*` 는 DOCTYPE 없는 입력에서 지수 백트래킹한다.
 */
const LEADING_DOCTYPE = /^\uFEFF?(?:\s|<!--[\s\S]*?-->|<\?[\s\S]*?\?>)*<!doctype[^>]*>/i

/**
 * 원문 HTML 에 스크롤바 스타일을 주입한다.
 * DOCTYPE 앞에 요소를 두면 문서가 quirks 모드로 렌더돼 레이아웃이 달라지므로,
 * DOCTYPE 이 있으면(앞의 주석·XML 선언 포함) 그 바로 뒤에, 없으면 맨 앞에 넣는다.
 */
export function withPreviewScrollbar(html: string): string {
  const doctype = LEADING_DOCTYPE.exec(html)
  if (!doctype) return PREVIEW_SCROLLBAR_STYLE + html
  const end = doctype[0].length
  return html.slice(0, end) + PREVIEW_SCROLLBAR_STYLE + html.slice(end)
}
