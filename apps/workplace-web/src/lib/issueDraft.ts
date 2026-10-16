// 이슈 입력 중 "저장하지 않은 내용이 있는가" 판정 — beforeunload 경고(useUnsavedChangesWarning)의 켜짐 조건.
// 화면에 흩어져 있던 조건식을 순수 함수로 모아 단위 테스트로 지킨다(WP-413 — 판정만 보던 E2E 를 대체).

/**
 * 이슈 생성 폼에 버리면 아까운 입력이 있는가 — 제목·본문 중 하나라도 공백 외 글자가 있으면 true.
 * 모바일 시트의 버림 확인과 새로고침 경고(#620)가 같은 기준을 쓴다.
 */
export function hasIssueDraftContent(title: string | null | undefined, body: string | null | undefined): boolean {
  return !!((title ?? '').trim() || (body ?? '').trim())
}

/**
 * 이슈 본문 인라인 편집이 원본과 달라졌는가(#823) — 편집 중이 아니거나, 편집에 들어가기만 하고
 * 고치지 않았으면(draft === 원본) 경고하지 않는다. 원본이 없으면(null) 빈 문자열과 비교한다.
 */
export function isBodyDraftDirty(editing: boolean, draft: string, body: string | null | undefined): boolean {
  return editing && draft !== (body ?? '')
}
