// 부모 이슈 상세의 하위 항목 정렬(WP-412) — IssueChildrenSection 에서 뺀 순수 함수.
import type { IssueResponse } from '@/types/issue';

/**
 * 생성 시간 오름차순(원본 불변) — 백엔드 기본 정렬(updatedAt desc) 때문에 새로 추가한 항목이
 * 최상단에 끼어드는 역방향 UX 를 막는다(#166). 추가한 순서대로 아래로 쌓인다.
 */
export function sortChildrenByCreatedAt(items: IssueResponse[]): IssueResponse[] {
  return items.slice().sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
