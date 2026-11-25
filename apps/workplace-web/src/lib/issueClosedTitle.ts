import { isClosedStatus } from './issueGrouping';

// 사용자 정의 상태 이름이나 종료 시각과 무관하게 상태 범주로 제목의 색과 삭선을 정한다.
export function issueClosedTitleClass(status: string): string {
  if (!isClosedStatus(status)) return '';

  const closedTitleClass = 'text-muted-foreground group-hover:text-foreground';
  return status === 'CANCELED' ? `${closedTitleClass} line-through` : closedTitleClass;
}
