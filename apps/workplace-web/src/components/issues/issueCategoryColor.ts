// 상태 범주 색(WP-808) — 범주 아이콘(IssueStatusIcon)·보드 범주 띠(BoardCategoryBand)·모바일 상태 탭 색 띠(MobileBoard)가
// 같은 시맨틱 토큰(할 일 흐린 muted · 진행 중 primary · 완료 success · 취소 muted)을 쓰도록 한곳에 둔다.
// Tailwind 가 클래스를 찾을 수 있게 조합하지 않은 완성 클래스 문자열로 둔다.
import type { IssueStatus } from '@/types/issue';

export const CATEGORY_COLOR: Record<IssueStatus, { icon: string; band: string }> = {
  // 할 일 띠 라벨은 기본 글자색 — 취소(muted)와 글자색으로도 구분된다. 테두리는 아이콘과 같은 흐린 muted.
  TODO: { icon: 'text-muted-foreground/60', band: 'border-muted-foreground/60 text-foreground' },
  IN_PROGRESS: { icon: 'text-primary', band: 'border-primary text-primary' },
  DONE: { icon: 'text-success', band: 'border-success text-success' },
  CANCELED: { icon: 'text-muted-foreground', band: 'border-muted-foreground text-muted-foreground' },
};
