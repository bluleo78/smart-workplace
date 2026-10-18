// 이슈 일괄 삭제 확인 문구(WP-482) — 목록 툴바(IssueBulkActions)·행 메뉴 다중 선택(useIssueRowActions)이 같은 문구를 쓴다.
// 왜: 부모를 지우면 서버가 하위 태스크도 함께 지우는데, 일괄 삭제 확인창만 그 사실을 알리지 않았다(단건 확인창은 알린다).
import type { IssueResponse } from '../types/issue';

/**
 * 선택한 이슈를 지우면 함께 지워지는 하위 이슈 수. 선택한 이슈의 childCount 합에서, 이미 선택에 든 하위(부모도 선택됨)는 뺀다 —
 * 두 번 세지 않게. 캐시에 없는 이슈(undefined)는 알 수 없으므로 0 으로 본다.
 */
export function countCascadedChildren(issues: Array<IssueResponse | undefined>): number {
  const present = issues.filter((i): i is IssueResponse => i != null);
  const selected = new Set(present.map((i) => i.number));
  const childTotal = present.reduce((sum, i) => sum + (i.childCount ?? 0), 0);
  const alsoSelected = present.filter((i) => i.parent != null && selected.has(i.parent.number)).length;
  return Math.max(0, childTotal - alsoSelected);
}

/** 일괄 삭제 확인 문구 — 함께 지워질 하위가 있으면 그 수를 알린다(단건 확인창의 「함께 삭제됩니다」와 같은 말투). */
export function bulkDeleteDescription(count: number, cascadedChildren: number): string {
  const children = cascadedChildren > 0 ? ` 하위 태스크 ${cascadedChildren}개도 함께 삭제됩니다.` : '';
  return `선택한 ${count}개 태스크를 삭제할까요?${children} 이 작업은 되돌릴 수 없습니다.`;
}
