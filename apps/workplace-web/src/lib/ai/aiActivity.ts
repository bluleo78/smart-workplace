// AI 진입 버튼(모바일 탭바·헤더 ✦, 데스크톱 칩)의 표시 상태 — 순수 로직(WP-191).
// 표면을 닫아도 답변 생성은 셸 레벨에서 계속되므로, 닫힌 버튼이 "생성 중"·"새 답변"을 보여 줘야 한다.

/** idle = 표시 없음, pending = 생성 중(링 회전 + 반짝임), done = 닫힌 사이 끝난 답변이 있음(점). */
export type AiActivity = 'idle' | 'pending' | 'done';

/**
 * 완료 점 여부 갱신 — 렌더마다 직전 pending 과 비교해 호출한다.
 * 열려 있으면 사용자가 보고 있으므로 해제, 닫힌 채 생성 중→끝남이면 표시, 그 외엔 유지.
 * 성공·실패·중단 구분 없이 "끝남"이면 표시한다(열어 보면 결과/실패 문구가 있다).
 */
export function nextUnseenDone(s: { prevPending: boolean; pending: boolean; open: boolean; unseenDone: boolean }): boolean {
  if (s.open) return false;
  if (s.prevPending && !s.pending) return true;
  return s.unseenDone;
}

/** 표시 상태 — 생성 중이 완료보다 우선(새 질문을 다시 보낸 경우). */
export function aiActivity(pending: boolean, unseenDone: boolean): AiActivity {
  if (pending) return 'pending';
  return unseenDone ? 'done' : 'idle';
}

/** 트리거 접근 이름 — 색·움직임만으로 전달되는 상태를 스크린리더에도 알린다. */
export function aiTriggerLabel(base: string, activity: AiActivity): string {
  if (activity === 'pending') return `${base}, 답변 생성 중`;
  if (activity === 'done') return `${base}, 새 답변`;
  return base;
}
