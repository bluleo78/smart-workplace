// 종료된 에픽 행 공용 스타일(WP-245·WP-389) — 패널 「종료된 에픽」 구역·패널 위쪽 목록·모바일 시트 종료 구역이 같은 모습을 쓴다.
import { issueClosedTitleClass } from './issueClosedTitle';
import { cn } from './utils';

/** 색점·진행바 흐림 — 다크에서는 덜 흐려 어두운 바탕에서도 색이 읽히게 한다. */
export const CLOSED_EPIC_DIM = 'opacity-50 dark:opacity-70';

/**
 * 종료 에픽 제목 — 선택되지 않으면 흐린 글자, 취소는 취소선. 배지는 또렷하게 두므로 제목에만 쓴다.
 * hoverRestore 면 행 래퍼의 `group` 에 마우스를 올릴 때 또렷하게 — 다른 끝난 이슈 제목(issueClosedTitleClass)과 같은 규칙(WP-2101).
 * 끄는 곳: 호버가 없는 모바일 시트(행에 group 이 없다), 드래그 중인 데스크톱 패널(종료 에픽은 드롭 대상이 아닌데 밝아지면 받을 것처럼 보인다).
 */
export function closedEpicTitleClass(status: string, selected: boolean, hoverRestore = true): string {
  // 선택되지 않은 줄은 끝난 이슈 제목 공용 규칙을 그대로 쓴다 — 표시 규칙의 원본이 하나가 되게.
  if (!selected) return issueClosedTitleClass(status, hoverRestore ? undefined : '');
  return cn('text-foreground', status === 'CANCELED' && 'line-through');
}
