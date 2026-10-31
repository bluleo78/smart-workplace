/**
 * 노트 CSS 가 가리지 못하게 고정할 화면 손잡이(WP-1240 페이지 스타일 칩, WP-1242 HTML 블록 머리 띠)를 인라인 !important 로 보이게 박는다.
 *
 * 왜: 페이지 스타일은 노트 본문 범위에 가둬 적용되는데, 손잡이도 그 범위 안에 있다 — `[범위] div{display:none !important}` 같은 노트 CSS 가
 * 지우기 단추·소스 편집 단추를 숨기거나 옮기거나 클릭을 막을 수 있다. 인라인 !important 는 어떤 스타일시트의 !important 보다도 앞선다
 * (캐스케이드의 「요소에 붙은 선언」 단계 — @layer 보다 먼저 비교된다).
 */
export function pinVisible(el: HTMLElement, display: string): void {
  el.style.setProperty('display', display, 'important')
  el.style.setProperty('visibility', 'visible', 'important')
  el.style.setProperty('opacity', '1', 'important')
  el.style.setProperty('pointer-events', 'auto', 'important')
  el.style.setProperty('position', 'static', 'important')
}
