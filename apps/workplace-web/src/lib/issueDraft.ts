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
  return editing && !isSameBody(draft, body)
}

/**
 * 편집한 본문(draft)이 원본(body)과 같은가 — 바이트 그대로 같거나, 원본의 줄바꿈(\r\n·\r)을 \n 으로 바꾼 모양과 같으면 같다(WP-1656).
 * 왜: 본문 편집칸(본문 모드 RichInput)은 \r\n 원문을 \n 줄로 읽으므로, 고치지 않고 저장해도 \n 모양이 온다 — 이를 「바뀜」으로 보면
 * 열고 저장만 해도 PATCH 가 나가고 이탈 경고가 뜬다. 원본이 없으면(null) 빈 문자열과 비교한다.
 */
export function isSameBody(draft: string, body: string | null | undefined): boolean {
  const original = body ?? ''
  // \r 이 없는 원문(거의 전부)은 바꿔 볼 것이 없다 — 긴 본문을 키 입력마다 다시 만들지 않게.
  return draft === original || (original.includes('\r') && draft === original.replace(/\r\n?/g, '\n'))
}
