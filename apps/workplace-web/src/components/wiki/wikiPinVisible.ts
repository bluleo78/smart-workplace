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

/** 고정용 콜백 ref — 붙는 순간 pinVisible 로 박는다. 모듈 값이라 정체가 바뀌지 않아 붙을 때 한 번만 돈다(그릴 때마다 다시 돌지 않게). */
const pinRef = (display: string) => (el: HTMLElement | null) => {
  if (el) pinVisible(el, display)
}
/** HTML 블록 막대·「AI로 고치기」 칸(WP-1242·WP-1302)이 함께 쓰는 고정 ref — display 값별 하나씩. */
export const pinBlock = pinRef('block')
export const pinFlex = pinRef('flex')
export const pinGrid = pinRef('grid')
export const pinInlineFlex = pinRef('inline-flex')

/**
 * 손잡이 단추 공통 mousedown — 기본 동작을 막아 포커스·선택이 단추로 옮겨 가지 않게 한다.
 * 블록 막대에선 편집기 선택을, 「AI로 고치기」 칸에선 입력 칸 포커스를 그대로 남긴다(포커스·선택은 각 동작이 정한다).
 */
export const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()
