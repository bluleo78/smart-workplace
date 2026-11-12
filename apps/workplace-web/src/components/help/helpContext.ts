// 도움말 문맥 판정(WP-1506) — 지금 만지는 화면 칸(data-help)·열린 대화상자·스크롤 위치 신호로 보일 절을 고르는 순수 함수.
// 브라우저 신호 수집(useHelpContextSignals)과 떼어 두어 신호 우선순위·도움말 id 층 올라가기·스크롤 칸 고르기·대화상자 고르기의
// 경계(잘못된 id, 관리자 장, 닫히는 중 대화상자, 패널 안 대화상자)를 vitest 로 지킨다. 설계 문서 help-panel-design.md 4~6절.
import type { HelpIndexChapter } from './helpBundle'
import { findSection, type HelpTarget, type HelpView, isChapterVisible, resolveHelpView } from './helpNav'

/**
 * 스크롤이 멈춘 뒤 칸을 재기까지 기다리는 시간(ms) — 스크롤 중 매 프레임 절이 바뀌어 패널이 깜박이지 않게(설계 5절).
 * 아래 두 기준선은 설정 가이드 섹션 따라가기(components/settings-guide/activeSection.ts)와 같은 값이다 — 가이드 코드는 이전 이슈가 지우므로 가져다 쓰지 않고 값만 둔다.
 */
export const HELP_SCROLL_SETTLE_MS = 200
/** 기준선 — 스크롤 요소 보이는 높이의 위쪽 30%. 이 선에 걸친 칸을 「보고 있는 칸」으로 본다. */
export const HELP_SCROLL_BASELINE = 0.3
/** 맨 아래까지 내렸을 때의 기준선(60%) — 짧은 마지막 칸은 30% 선까지 못 올라오므로 선을 내려 잡는다. */
export const HELP_SCROLL_BASELINE_AT_BOTTOM = 0.6

/** 화면에서 모은 문맥 신호 — 각각 그 신호가 가리키는 도움말 id(없으면 null). */
export type HelpSignals = { dialog: string | null; focus: string | null; scroll: string | null }

/** 보일 절이 어디서 왔는가 — 신호 셋 또는 화면 주소. */
export type HelpSignalSource = 'dialog' | 'focus' | 'scroll' | 'address'

/** 신호 우선순위 — 열린 대화상자 > 포커스·클릭 > 스크롤 위치. 모두 없으면 null(주소로 간다). */
export function pickSignal(s: HelpSignals): { id: string; source: Exclude<HelpSignalSource, 'address'> } | null {
  if (s.dialog) return { id: s.dialog, source: 'dialog' }
  if (s.focus) return { id: s.focus, source: 'focus' }
  if (s.scroll) return { id: s.scroll, source: 'scroll' }
  return null
}

/** 도움말 id 형식 — 소문자 영문·숫자·`-` 조각을 점으로 잇는다(설계 14절). */
const HELP_ID_PATTERN = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/

/**
 * 도움말 id 와 그 위 층들 — `'a.b.c'` → `['a.b.c','a.b','a']`(자기부터 위로).
 * 형식이 틀린 id(대문자·빈 조각·`#` 든 장 내부 id 등)는 빈 목록 — 화면의 오타가 엉뚱한 절을 맞추지 않게.
 */
export function helpIdAncestors(id: string): string[] {
  if (!HELP_ID_PATTERN.test(id)) return []
  const parts = id.split('.')
  return parts.map((_, i) => parts.slice(0, parts.length - i).join('.'))
}

/**
 * 도움말 id 로 이 사용자에게 보이는 장의 절을 찾는다 — 없으면 한 층씩 올라간다. 끝까지 없으면 null.
 * 관리자 장 절은 관리자에게만 맞는다(일반 구성원 화면에 같은 id 가 붙어도 관리자 매뉴얼이 보이지 않게).
 */
export function resolveHelpId(index: HelpIndexChapter[], id: string, isAdmin: boolean): HelpTarget | null {
  for (const candidate of helpIdAncestors(id)) {
    const ref = findSection(index, candidate)
    if (ref && isChapterVisible(ref.chapter, isAdmin)) return { chapter: ref.chapter.chapter, sectionId: ref.section.id }
  }
  return null
}

/**
 * 문맥으로 보일 내용 — 가장 높은 신호의 id 로 절을 찾는다(층 올라가기).
 * 그 신호로 끝까지 못 찾으면 낮은 신호로 내려가지 않고 주소의 장 첫머리(설계 6절 — 지금 만지는 칸과 다른 칸 설명이 뜨지 않게), 출처는 신호 쪽 그대로.
 * 신호가 없으면 주소의 장 첫머리, 맞는 장도 없으면 목차(주소 대체는 resolveHelpView 를 그대로 쓴다).
 */
export function resolveContextTarget(a: {
  index: HelpIndexChapter[]
  pathname: string
  isAdmin: boolean
  signals: HelpSignals
}): { view: HelpView; source: HelpSignalSource } {
  const signal = pickSignal(a.signals)
  const byAddress = () => resolveHelpView({ index: a.index, pathname: a.pathname, selected: null, isAdmin: a.isAdmin })
  if (!signal) return { view: byAddress(), source: 'address' }
  const target = resolveHelpId(a.index, signal.id, a.isAdmin)
  return { view: target ? { kind: 'section', target } : byAddress(), source: signal.source }
}

/** 스크롤 요소 안 data-help 칸 하나의 위치 — top·bottom 은 보이는 영역 위끝 기준 px, depth 는 감싸는 data-help 조상 수. */
export type HelpBox = { id: string; top: number; bottom: number; depth: number }

/**
 * 스크롤 위치로 보고 있는 칸 — 기준선(보이는 높이 30%, 맨 아래면 60%)에 걸친(top ≤ 선 < bottom) 칸 가운데 가장 안쪽(depth 큰 것, 같으면 뒤의 것).
 * 걸친 칸이 없으면(칸 사이 틈) 선 위에서 시작한 마지막 칸, 그것도 없으면 첫 칸(아직 아무 칸도 선에 닿지 않음), 빈 목록이면 null.
 * boxes 는 문서 순서(위→아래)다.
 */
export function pickScrollHelp(boxes: HelpBox[], viewHeight: number, atBottom: boolean): string | null {
  if (boxes.length === 0) return null
  const line = viewHeight * (atBottom ? HELP_SCROLL_BASELINE_AT_BOTTOM : HELP_SCROLL_BASELINE)
  let hit: HelpBox | null = null
  let above: HelpBox | null = null
  for (const b of boxes) {
    if (b.top <= line) {
      above = b
      if (line < b.bottom && (hit === null || b.depth >= hit.depth)) hit = b
    }
  }
  return (hit ?? above ?? boxes[0]).id
}

/**
 * 열린 대화상자의 도움말 id — DOM 순서 목록에서 열려 있고(data-state=open) data-help 가 있으며 도움말 패널·AI 표면에 속하지 않는 것 가운데 마지막(맨 위).
 * 닫히는 중(퇴장 애니메이션 동안 data-state=closed 로 남음)은 이미 닫힌 것으로, 패널 안 대화상자(그림 확대·⌄ 목록·휴대폰 시트)는
 * 패널이 자기 자신을 가리키게 되므로 뺀다.
 */
export function pickOpenDialogHelp(dialogs: { helpId: string | null; state: string | null; insidePanel: boolean }[]): string | null {
  let found: string | null = null
  for (const d of dialogs) {
    if (d.state === 'open' && d.helpId && !d.insidePanel) found = d.helpId
  }
  return found
}
