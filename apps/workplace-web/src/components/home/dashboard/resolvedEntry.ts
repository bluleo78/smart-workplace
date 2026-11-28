// 홈 대시보드 위젯 엔트리 해석(WP-161 에서 Dashboard.tsx 로부터 분리) — 저장된 위젯 설정(cfg)을 시스템/카탈로그 정의와
// 짝지어 렌더 가능한 엔트리로 만들고, 제목·딥링크·항목 수 노출 조건 같은 엔트리 단위 규칙을 한곳에 둔다.
// 보기 카드·편집 카드(데스크톱/모바일)·편집 초안 훅이 모두 이 규칙을 공유한다.
import type { DashboardDevice, DashboardWidgetConfig } from '@/types/dashboard'

import { type CatalogWidget, getCatalogWidget } from '../widgets/catalogRegistry'
import { isMobileCardCollapsed } from '../widgets/mobile/types'
import { type DashboardWidget, getDashboardWidget } from '../widgets/registry'

// 총 위젯 인스턴스 상한 — 백엔드 DashboardService.MAX_WIDGETS 와 일치(프론트는 UX 가드, 최종 검증은 서버).
export const MAX_WIDGETS = 12
// 위젯 추가 강조 표시 지속 시간(ms) — 카드의 `duration-700` 강조 트랜지션과 짝을 이루며,
// e2e/pages/home.spec.ts 의 fastForward 경계값과도 결합되어 있으니 값을 바꿀 때 두 곳을 함께 확인한다.
export const HIGHLIGHT_DURATION_MS = 4000
// 편집에서 새로 추가하는 시스템 위젯의 기기별 기본 항목 수 — 데스크톱은 기존 5(요청 형태 불변), 모바일은 서버 모바일
// 기본값(DashboardService.MOBILE_DEFAULT_COUNT)과 일치하는 3.
export const DEFAULT_COUNT: Record<DashboardDevice, number> = { desktop: 5, mobile: 3 }

/** 카탈로그 위젯 설정(필터 params·사용자 라벨) 변경분 — 설정 팝오버 → 편집 초안. */
export type CatalogConfigPatch = { params: Record<string, unknown>; label: string | null }

/** 그리드 한 항목 = 알려진 위젯 정의(시스템|카탈로그) + 그 구성. 알 수 없는 타입은 미리 걸러진다. */
export type ResolvedEntry =
  | { kind: 'system'; def: DashboardWidget; cfg: DashboardWidgetConfig }
  | { kind: 'catalog'; def: CatalogWidget; cfg: DashboardWidgetConfig }

/** 위젯 설정(cfg) → 렌더 가능한 엔트리로 해석. 시스템/카탈로그 레지스트리 어느 쪽에도 없으면 null(스킵). */
export function resolveEntry(cfg: DashboardWidgetConfig): ResolvedEntry | null {
  const sys = getDashboardWidget(cfg.type)
  if (sys) return { kind: 'system', def: sys, cfg }
  const cat = getCatalogWidget(cfg.type)
  if (cat) return { kind: 'catalog', def: cat, cfg }
  return null
}

/** 위젯 설정 목록 → 알려진 위젯 엔트리만(순서/숨김 포함, 알 수 없는 타입은 조용히 스킵). */
export function resolveEntries(widgets: DashboardWidgetConfig[]): ResolvedEntry[] {
  return widgets.map(resolveEntry).filter((e): e is ResolvedEntry => e !== null)
}

/** 보기(편집 아님) 모드에 그릴 엔트리 — 숨김 위젯을 뺀다(저장 순서는 유지). 숨김은 편집 모드에서만 흐리게 보인다. */
export function visibleEntries(entries: ResolvedEntry[]): ResolvedEntry[] {
  return entries.filter((e) => !e.cfg.hidden)
}

/**
 * 이 엔트리의 본문을 지금 카드가 실제로 보여 주는가(WP-2077) — 본문 호스트는 보이는 본문만 그린다.
 * 데스크톱은 늘 본문을 보인다. 모바일은 타일형(`def.mobile.body` 없음)이면 본문 없이 요약 한 줄뿐이고,
 * 본문형도 접히면(`cfg.collapsed === true`) 본문이 없다 — MobileWidgetCard 와 같은 isMobileCardCollapsed 를 쓴다(보기·편집 공통).
 * 보이지 않는 본문을 호스트가 그리면 지연 청크·조회가 쓸데없이 돈다.
 */
export function showsBody(entry: ResolvedEntry, isMobile: boolean): boolean {
  if (!isMobile) return true
  return !isMobileCardCollapsed(entry.def.mobile, entry.cfg.collapsed)
}

/**
 * 위젯 자체 제목(WidgetFrame)이 카드 제목(h2)을 대신하는가(WP-1888·WP-2077) — 테두리 없는(chromeless) 카탈로그 위젯이 그렇다.
 * 카드(WidgetCard 의 sr-only h2 생략)와 본문 호스트(프레임 헤딩 레벨 2)가 같은 규칙을 쓰도록 한 곳에 둔다.
 */
export function frameIsCardHeading(entry: ResolvedEntry): boolean {
  return entry.cfg.chromeless === true && entry.kind === 'catalog'
}

/** 엔트리 표시 제목 — 카탈로그는 사용자 라벨 우선, 없으면 레지스트리 기본 제목. */
export function entryTitle(entry: ResolvedEntry): string {
  if (entry.kind === 'catalog' && entry.cfg.label) return entry.cfg.label
  return entry.def.title
}

/** 엔트리 앱 경로 — 시스템은 고정 경로, 카탈로그는 params 기반(#807: 위젯이 보고 있는 필터가 반영된 화면으로 이동). */
export function entryDeepLink(entry: ResolvedEntry): string | undefined {
  return entry.kind === 'system' ? entry.def.deepLink : entry.def.deepLink(entry.cfg.params)
}

/**
 * 항목 수 선택 노출 조건 — count 를 쓰는 시스템 위젯만. wide 시스템 위젯(요약·빠른 액션·AI 우선순위)과 카탈로그
 * 위젯은 count 를 무시하므로 선택 UI 자체를 숨긴다 — 보여줘도 동작하지 않는 컨트롤은 혼란만 준다.
 */
export function hasCountSelect(entry: ResolvedEntry): boolean {
  return entry.kind === 'system' && !entry.def.wide
}

/** wide: 카운트 스트립·2x2 분면처럼 1/3 폭에 찌그러지는 시스템 위젯 — lg:col-span-3(전체 폭). */
export function isWideEntry(entry: ResolvedEntry): boolean {
  return entry.kind === 'system' && Boolean(entry.def.wide)
}
