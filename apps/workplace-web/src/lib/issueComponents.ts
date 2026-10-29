// 구성요소(WP-933) 화면 판정 — 보이는 조건·자동 지정 안내·피커 선택지(순수 함수, 단위 테스트로 고정).
// 왜: 구성요소를 쓰지 않는 프로젝트에선 이슈 상세·만들기·필터·열 고르기가 지금과 똑같아야 한다(스펙 6절 「보이는 조건」).

import type { AssigneeInvalidReason, ComponentResponse, UpdateComponentRequest } from '../types/component'

/** 사용 중(보관 안 됨) 구성요소가 하나라도 있는가 — 만들기 칸·필터 facet·열 고르기 노출 기준. */
export function hasActiveComponents(list: ComponentResponse[]): boolean {
  return list.some((c) => !c.archived)
}

/**
 * 무효 담당자의 이유 문구(WP-1123) — 설정 목록 경고(warning)와 편집 창 선택지 꼬리표(tag).
 * 예전엔 이유와 상관없이 「구성원 아님」 하나라, 구성원으로 남은 채 계정만 정지된 담당자도 「구성원이 아니에요」로 보여 관리자가 고칠 곳을 잘못 찾았다.
 * 이유를 모르면(이 필드가 없는 예전 서버) 두 이유를 아우르는 문구로 둔다.
 */
export function assigneeInvalidText(reason: AssigneeInvalidReason | null | undefined): { warning: string; tag: string } {
  switch (reason) {
    case 'INACTIVE':
      return { warning: '계정이 정지됐어요 — 자동 지정을 건너뛰어요', tag: '계정 정지' }
    case 'NOT_MEMBER':
      return { warning: '프로젝트 구성원이 아니에요 — 자동 지정을 건너뛰어요', tag: '구성원 아님' }
    case 'NOT_HUMAN':
      return { warning: 'AI 는 자동 지정할 수 없어요 — 자동 지정을 건너뛰어요', tag: 'AI' }
    default:
      return { warning: '자동 지정에 쓸 수 없는 담당자예요 — 자동 지정을 건너뛰어요', tag: '쓸 수 없음' }
  }
}

/**
 * 이슈 상세의 구성요소 칸 모드.
 * - edit: 사용 중 구성요소가 있다(권한이 없으면 피커만 비활성 — 그건 호출부 몫).
 * - readonly: 사용 중인 것은 없지만 보관된 구성요소가 이 이슈에 붙어 있다 — 값만 보인다.
 * - hidden: 둘 다 아니다 — 칸을 그리지 않는다.
 */
export function showComponentField(
  list: ComponentResponse[],
  issueComponents: { id: number }[],
): 'edit' | 'readonly' | 'hidden' {
  if (hasActiveComponents(list)) return 'edit'
  return issueComponents.length > 0 ? 'readonly' : 'hidden'
}

/**
 * 만들기 창의 「만들면 {구성요소} 담당 {이름} 님이 맡아요」 안내 — 서버 자동 지정(목록 순서로 처음 유효한 담당자)과 같은 규칙.
 * 고른 순서가 아니라 프로젝트 목록 순서로 본다 — 그래야 안내가 실제로 붙을 사람과 같다. 담당자를 이미 골랐거나 붙을 사람이 없으면 null.
 */
export function autoAssignHint(
  selectedIds: number[],
  list: ComponentResponse[],
  hasAssignee: boolean,
): { componentName: string; assigneeName: string } | null {
  if (hasAssignee || selectedIds.length === 0) return null
  const selected = new Set(selectedIds)
  const hit = list.find((c) => selected.has(c.id) && !c.archived && c.defaultAssignee && c.defaultAssigneeValid)
  return hit?.defaultAssignee ? { componentName: hit.name, assigneeName: hit.defaultAssignee.name } : null
}

/**
 * 피커 선택지 — 사용 중 구성요소 + 이 이슈에 이미 붙은 보관 구성요소(목록 순서).
 * 보관된 것은 새로 붙일 수 없지만, 이미 붙은 것까지 빼면 교체(PUT) 요청에서 조용히 떨어져 나간다.
 */
export function pickerComponentOptions(list: ComponentResponse[], attachedIds: number[]): ComponentResponse[] {
  const attached = new Set(attachedIds)
  return list.filter((c) => !c.archived || attached.has(c.id))
}

/** 칩 목록을 「앞 max 개 + 넘친 수」로 나눈다 — 카드·목록 칸·모바일 행 공용(최대 2개 + 「+N」). */
export function splitChips<T>(items: T[], max = 2): { shown: T[]; rest: number } {
  return { shown: items.slice(0, max), rest: Math.max(0, items.length - max) }
}

/** 구성요소 편집 창이 다루는 값 — 담당자 없음은 null. */
export interface ComponentDraft {
  name: string
  description: string
  assigneeId: number | null
}

/**
 * 편집 창 값 → 부분 수정 본문(바뀐 필드만). 이름은 앞뒤 공백을 걷고, 설명을 비우면 ''(서버가 지운다),
 * 담당자를 지우면 clearDefaultAssignee. 담당자 id 는 바뀐 경우에만 싣는다 — 서버가 담당자를 보낼 때마다 다시 검증하므로,
 * 이미 무효가 된 담당자를 그대로 둔 채 이름만 바꾸는 요청이 400 으로 막히지 않게.
 */
export function componentPatch(
  initial: Pick<ComponentResponse, 'name' | 'description' | 'defaultAssignee'>,
  draft: ComponentDraft,
): UpdateComponentRequest {
  const body: UpdateComponentRequest = {}
  const name = draft.name.trim()
  if (name !== initial.name) body.name = name
  const description = draft.description.trim()
  if (description !== (initial.description ?? '')) body.description = description
  const before = initial.defaultAssignee?.id ?? null
  if (draft.assigneeId !== before) {
    if (draft.assigneeId === null) body.clearDefaultAssignee = true
    else body.defaultAssigneeId = draft.assigneeId
  }
  return body
}
