// 범주 색(WP-808) — 데스크톱 보드 범주 띠(BoardCategoryBand)와 모바일 상태 탭 색 띠(MobileBoard)가 같이 쓴다.
// IssueStatusIcon 과 같은 시맨틱 토큰(할 일 흐림 · 진행 중 primary · 완료 success · 취소 muted). 테두리 색이 띠, 글자 색이 라벨.
import type { IssueStatus } from '@/types/issue';

export const CATEGORY_TONE: Record<IssueStatus, string> = {
  TODO: 'border-muted-foreground/60 text-muted-foreground',
  IN_PROGRESS: 'border-primary text-primary',
  DONE: 'border-success text-success',
  CANCELED: 'border-muted-foreground text-muted-foreground',
};
