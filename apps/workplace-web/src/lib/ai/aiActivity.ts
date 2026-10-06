// AI 진입 버튼(모바일 탭바·헤더 ✦, 데스크톱 칩)의 표시 상태 — 순수 로직(WP-191).
// WP-190: 집계는 chatStreams 셀렉터가 한다.
// 표면을 닫아도 답변 생성은 셸 레벨에서 계속되므로, 닫힌 버튼이 "생성 중"·"새 답변"을 보여 줘야 한다.

/** idle = 표시 없음, pending = 생성 중(링 회전 + 반짝임), done = 닫힌 사이 끝난 답변이 있음(점). */
export type AiActivity = 'idle' | 'pending' | 'done';

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

/** 헤더 "대화 목록" 버튼 접근 이름(WP-190) — 점(색)만으로 전달되는 다른 대화 상태를 스크린리더에도 알린다. */
export function sessionListLabel(base: string, activity: AiActivity): string {
  if (activity === 'pending') return `${base}, 다른 대화 답변 중`;
  if (activity === 'done') return `${base}, 다른 대화에 새 답변`;
  return base;
}
