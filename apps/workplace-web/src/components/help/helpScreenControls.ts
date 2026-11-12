// 도움말 본문의 굵은 화면 문구 ↔ 실제 화면 버튼 잇기(WP-1505).
// 매뉴얼은 화면 버튼 이름을 굵게 쓴다(「**토큰 다시 넣기** 를 누른다」). 본문 글자에 마우스를 올리면 같은 이름의 화면 버튼을 강조해
// 어디를 누르라는 것인지 바로 보이게 한다. 반대 방향(버튼 포커스 → 본문 강조)은 포커스 신호를 다루는 WP-1506 몫이다(계획 「내가 정한 것」 11).
import { AI_PANEL_SELECTOR, HELP_PANEL_SELECTOR } from '@/components/ai/aiPanelSurface'

/**
 * 강조 후보 — 사람이 누를 수 있는 것만(글 조각·제목은 빼서 엉뚱한 곳이 빛나지 않게).
 * 문맥 신호 훅(useHelpContextSignals, WP-1506)도 「포커스·클릭한 컨트롤」을 같은 기준으로 고르도록 내보낸다.
 */
export const CONTROL_SELECTOR = 'button, a[href], [role="button"], [role="tab"], [role="menuitem"], [role="link"]'

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

/**
 * 공백 묶음을 한 칸으로, 앞뒤 공백 제거 — 버튼 글자의 줄바꿈·아이콘 사이 공백이 비교를 깨지 않게.
 * 도움말 본문 굵은 글자 ↔ 포커스한 단추 이름 견주기(HighlightStrong, WP-1506)도 같은 정규화를 쓰도록 내보낸다.
 */
export function normalizeControlText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/**
 * 컨트롤 이름 — 공백을 정리한 글자(textContent), 비었으면(아이콘 단추) aria-label.
 * 포커스·클릭한 화면 단추와 본문 굵은 글자를 견줄 때(WP-1506) findScreenControls 와 같은 정규화를 쓰려고 내보낸다.
 */
export function controlName(el: Element): string {
  return normalizeControlText(el.textContent) || normalizeControlText(el.getAttribute('aria-label'))
}

/**
 * text 와 같은 이름의 화면 컨트롤을 찾는다(범위는 searchRoots — 페이지 영역·상단 가운데 틀).
 * - 이름은 공백을 정리한 글자(textContent) 또는 aria-label(아이콘 단추) 가운데 하나가 같으면 맞다.
 * - 도움말 패널([data-help-panel]) 안은 뺀다 — 본문을 읽는 자리 자신이 빛나면 화면을 가리키는 뜻이 없다.
 * - aria-hidden="true"·inert 조상 아래는 뺀다 — 모달 뒤로 가려졌거나 숨긴 사본(측정용 등)이다.
 * - opts.excludeAiSurface 면 AI 표면([data-ai-panel]) 안도 뺀다 — AI 답의 굵은 글자(WP-1511)가 AI 패널 안 같은 이름 단추(「새 대화」 등)를 화면 단추로 잘못 맞추지 않게.
 *   도움말 본문은 켜지 않는다 — 매뉴얼이 AI 패널의 단추(「새 대화」 등)를 설명하므로 그 굵은 글자는 AI 패널 안 단추도 강조해야 한다.
 */
export function findScreenControls(text: string, opts: ControlScanOptions = {}): HTMLElement[] {
  const want = normalizeControlText(text)
  if (!want) return []
  return candidateControls(searchRoots(), opts).filter(
    (el) => normalizeControlText(el.textContent) === want || normalizeControlText(el.getAttribute('aria-label')) === want,
  )
}

/** 컨트롤을 찾는 옵션 — excludeAiSurface: AI 표면 안 컨트롤도 뺀다(AI 답 쪽 호출자만 켠다). */
export type ControlScanOptions = { excludeAiSurface?: boolean }

/** 이름을 견줄 후보 컨트롤 — 도움말 패널·숨긴 것 아래는 늘 빼고, 옵션이 있으면 AI 표면 아래도 뺀 목록(findScreenControls 와 screenControlNames 가 같은 기준을 쓴다). */
function candidateControls(roots: ParentNode[], opts: ControlScanOptions): HTMLElement[] {
  const excluded = opts.excludeAiSurface ? `${HELP_PANEL_SELECTOR}, ${AI_PANEL_SELECTOR}` : HELP_PANEL_SELECTOR
  return roots
    .flatMap((root) => [...root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)])
    .filter((el) => !el.closest(excluded) && !el.closest('[aria-hidden="true"], [inert]'))
}

/**
 * 지금 화면 컨트롤들의 이름(정규화한 글자·aria-label) 집합 — 문서를 한 번만 훑어 여러 문구가 같이 쓰게 한다.
 * findScreenControls(text) 가 비어 있지 않을 필요충분조건은 normalizeControlText(text) 가 이 집합에 있는 것이다(WP-1511, AI 답 굵은 글자 일괄 판정).
 */
export function screenControlNames(opts: ControlScanOptions = {}): Set<string> {
  const names = new Set<string>()
  for (const el of candidateControls(searchRoots(), opts)) {
    names.add(normalizeControlText(el.textContent))
    names.add(normalizeControlText(el.getAttribute('aria-label')))
  }
  names.delete('')
  return names
}

/** els 에 강조 표식(data-help-highlight — index.css 가 --ring 테두리로 그린다)을 달고, 떼는 함수를 돌려준다. */
export function highlightScreenControls(els: HTMLElement[]): () => void {
  for (const el of els) el.setAttribute('data-help-highlight', '')
  return () => {
    for (const el of els) el.removeAttribute('data-help-highlight')
  }
}
