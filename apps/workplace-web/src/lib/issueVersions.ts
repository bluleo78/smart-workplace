// 이슈의 수정 버전·영향 버전(WP-888) 화면 판정 — 보이는 조건·피커 선택지·타임라인 마커(순수 함수, 단위 테스트로 고정).
// 왜: 버전을 쓰지 않는 프로젝트에선 이슈 상세·필터·열 고르기·타임라인이 지금과 똑같아야 한다(스펙 6절 「보이는 조건」).

import type { VersionResponse, VersionSummary } from '../types/version'

/** 보관 여부 — 요약엔 archived 플래그가 없고 상태로 안다. 칩·피커·facet 이 같은 판정을 쓴다. */
export function isArchived(v: Pick<VersionSummary, 'status'>): boolean {
  return v.status === 'ARCHIVED'
}

/** 칩 툴팁 제목 — 보관된 버전은 이름 뒤에 「(보관됨)」. */
export function versionTitle(v: Pick<VersionSummary, 'name' | 'status'>): string {
  return isArchived(v) ? `${v.name} (보관됨)` : v.name
}

/** 상태별로 한 번 훑어 나눈다 — active 는 보관 안 된 것(입력 순서 그대로), 나머지는 상태별. 각 묶음 안의 순서는 입력 순서. */
export function partitionByStatus<T extends Pick<VersionSummary, 'status'>>(
  list: readonly T[],
): { active: T[]; unreleased: T[]; released: T[]; archived: T[] } {
  const out = { active: [] as T[], unreleased: [] as T[], released: [] as T[], archived: [] as T[] }
  for (const v of list) {
    if (isArchived(v)) {
      out.archived.push(v)
      continue
    }
    out.active.push(v)
    if (v.status === 'UNRELEASED') out.unreleased.push(v)
    else if (v.status === 'RELEASED') out.released.push(v)
  }
  return out
}

/** 보관되지 않은 버전이 하나라도 있는가 — 상세 두 줄·필터 facet·열 고르기·타임라인 레인 노출 기준. */
export function hasActiveVersions(list: Pick<VersionResponse, 'status'>[]): boolean {
  return list.some((v) => !isArchived(v))
}

/**
 * 이슈 상세의 버전 줄 모드(수정 버전·영향 버전 각각 같은 규칙).
 * - edit: 보관 안 된 버전이 있다(권한이 없으면 피커만 비활성 — 호출부 몫).
 * - readonly: 보관 안 된 버전은 없지만 보관된 버전이 이 이슈에 붙어 있다 — 값만 보인다.
 * - hidden: 둘 다 아니다 — 줄을 그리지 않는다.
 */
export function showVersionField(
  list: Pick<VersionResponse, 'status'>[],
  attached: Pick<VersionSummary, 'id'>[],
): 'edit' | 'readonly' | 'hidden' {
  if (hasActiveVersions(list)) return 'edit'
  return attached.length > 0 ? 'readonly' : 'hidden'
}

/**
 * 피커 선택지 — 보관 안 된 버전(미출시 먼저, 그다음 출시됨; 각 안의 순서는 서버 목록 순서) + 이 이슈에 이미 붙은 보관 버전(맨 뒤).
 * 보관된 것은 새로 붙일 수 없지만, 이미 붙은 것까지 빼면 교체(PUT) 요청에서 조용히 떨어져 나간다.
 */
export function pickerVersionOptions<T extends Pick<VersionResponse, 'id' | 'status'>>(list: T[], attachedIds: number[]): T[] {
  const attached = new Set(attachedIds)
  const { unreleased, released, archived } = partitionByStatus(list)
  return [...unreleased, ...released, ...archived.filter((v) => attached.has(v.id))]
}
