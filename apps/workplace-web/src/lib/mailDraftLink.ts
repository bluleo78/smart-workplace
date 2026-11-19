// 임시보관 딥링크(WP-1786) — 앱 안 알림(메일 보내기 실패)이 그 임시보관을 메인 창의 쓰기 창으로 열게 하는 주소 규칙.
// 새 창 쓰기 화면(/mail/compose?draftId=N, 서버 푸시가 쓴다)은 앱 셸이 없는 독립 창이라 같은 탭에서 이동하면 셸이 사라진다.
// 그래서 앱 안에서는 /mail?draftId=N 으로 보내고, 셸에 한 번 둔 MailDraftDeepLink 가 받아 작성창으로 열고 주소에서 키를 뗀다.

/** 임시보관을 쓰기 창으로 여는 앱 안 주소. */
export function mailDraftPath(draftId: number): string {
  return `/mail?draftId=${draftId}`;
}

/**
 * 주소 쿼리에서 draftId 를 꺼낸다 — 양의 정수일 때만. 나머지 쿼리는 그대로 돌려줘 주소를 고쳐 쓸 때 쓴다(앞에 「?」, 없으면 빈 문자열).
 * 키가 없거나 값이 이상하면 null(주소를 건드리지 않는다).
 */
export function takeDraftIdParam(search: string): { draftId: number; search: string } | null {
  const sp = new URLSearchParams(search);
  const raw = sp.get('draftId');
  if (raw == null || !/^\d+$/.test(raw) || Number(raw) <= 0) return null;
  sp.delete('draftId');
  const rest = sp.toString();
  return { draftId: Number(raw), search: rest ? `?${rest}` : '' };
}
