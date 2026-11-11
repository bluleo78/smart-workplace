// 도움말 본문의 굵은 화면 문구 ↔ 실제 화면 버튼 잇기(WP-1505).
// 매뉴얼은 화면 버튼 이름을 굵게 쓴다(「**토큰 다시 넣기** 를 누른다」). 본문 글자에 마우스를 올리면 같은 이름의 화면 버튼을 강조해
// 어디를 누르라는 것인지 바로 보이게 한다. 반대 방향(버튼 포커스 → 본문 강조)은 포커스 신호를 다루는 WP-1506 몫이다(계획 「내가 정한 것」 11).

/** 강조 후보 — 사람이 누를 수 있는 것만(글 조각·제목은 빼서 엉뚱한 곳이 빛나지 않게). */
const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="link"]'

/**
 * 찾는 범위 — 앱 셸 페이지 영역([data-ai-page-root]: 레일·본문·오른쪽 도킹, 휴대폰은 탭 셸)과 상단 가운데 틀([data-ai-chip]: AI 칩·검색·「?」,
 * body 직속 포털이라 페이지 영역 밖). 굵은 글자에 마우스를 올릴 때마다 문서 전체를 훑지 않게 이 둘로 좁힌다.
 */
const SEARCH_ROOT_SELECTOR = '[data-ai-page-root], [data-ai-chip]'

/** 찾는 범위 요소들 — 앱 셸이 없으면(셸 밖 화면·단위 테스트) 문서 전체. */
function searchRoots(): ParentNode[] {
  const roots = [...document.querySelectorAll(SEARCH_ROOT_SELECTOR)]
  return roots.length > 0 ? roots : [document]
}

/** 공백 묶음을 한 칸으로, 앞뒤 공백 제거 — 버튼 글자의 줄바꿈·아이콘 사이 공백이 비교를 깨지 않게. */
function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * text 와 같은 이름의 화면 컨트롤을 찾는다(범위는 searchRoots — 페이지 영역·상단 가운데 틀).
 * - 이름은 공백을 정리한 글자(textContent) 또는 aria-label(아이콘 단추) 가운데 하나가 같으면 맞다.
 * - 도움말 패널([data-help-panel]) 안은 뺀다 — 본문을 읽는 자리 자신이 빛나면 화면을 가리키는 뜻이 없다.
 * - aria-hidden="true"·inert 조상 아래는 뺀다 — 모달 뒤로 가려졌거나 숨긴 사본(측정용 등)이다.
 */
export function findScreenControls(text: string, roots: ParentNode[] = searchRoots()): HTMLElement[] {
  const want = normalize(text)
  if (!want) return []
  return roots.flatMap((root) => [...root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)]).filter(
    (el) =>
      !el.closest('[data-help-panel]') &&
      !el.closest('[aria-hidden="true"], [inert]') &&
      (normalize(el.textContent) === want || normalize(el.getAttribute('aria-label')) === want),
  )
}

/** els 에 강조 표식(data-help-highlight — index.css 가 --ring 테두리로 그린다)을 달고, 떼는 함수를 돌려준다. */
export function highlightScreenControls(els: HTMLElement[]): () => void {
  for (const el of els) el.setAttribute('data-help-highlight', '')
  return () => {
    for (const el of els) el.removeAttribute('data-help-highlight')
  }
}
