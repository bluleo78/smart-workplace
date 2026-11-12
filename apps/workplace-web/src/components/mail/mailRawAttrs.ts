/**
 * 메일 작성기 DOM 요소 만들기 도우미(WP-1524) — 속성을 문자열 그대로 싣는 요소.
 *
 * 왜 요소를 직접 만드나: ProseMirror 는 배열 명세의 style 을 `dom.style.cssText` 로 넣어 브라우저·jsdom 이 `#dc2626` 을
 * `rgb(220, 38, 38)` 로, 작은따옴표를 큰따옴표로 바꿔 직렬화한다. 받는 쪽에 16진값 그대로 보내려고 setAttribute 로
 * 문자열을 그대로 싣는다(값은 모두 정해 둔 목록에서 나오므로 그대로 넣어도 안전하다).
 */

/** tag 요소를 만들어 속성 맵을 문자열 그대로 싣는다(null·빈 값 제외). */
export function domWithRawAttrs<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown>,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs)) {
    if (value != null && value !== '') el.setAttribute(name, String(value))
  }
  return el
}
