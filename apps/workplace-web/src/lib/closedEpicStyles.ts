// 종료된 에픽 행 공용 스타일(WP-245·WP-389) — 패널 「종료된 에픽」 구역·패널 위쪽 목록·모바일 시트 종료 구역이 같은 모습을 쓴다.
import { cn } from './utils';

/** 색점·진행바 흐림 — 다크에서는 덜 흐려 어두운 바탕에서도 색이 읽히게 한다. */
export const CLOSED_EPIC_DIM = 'opacity-50 dark:opacity-70';

/** 종료 에픽 제목 — 선택되지 않으면 흐린 글자, 취소는 취소선. 배지는 또렷하게 두므로 제목에만 쓴다. */
export function closedEpicTitleClass(status: string, selected: boolean): string {
  return cn(selected ? 'text-foreground' : 'text-muted-foreground', status === 'CANCELED' && 'line-through');
}
