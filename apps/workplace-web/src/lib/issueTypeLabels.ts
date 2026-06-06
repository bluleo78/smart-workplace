// 이슈 유형 enum → 한국어 라벨 매핑.
// 백엔드 IssueTypeSummary.name 이 영문 enum 원문이므로 UI 표시 시 이 매핑을 사용한다.
// 미등록 값(커스텀 유형 등)은 fallback 으로 name 원문을 그대로 반환한다.

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  TASK: '태스크',
  BUG: '버그',
  STORY: '스토리',
  CHORE: '기타',
  SUBTASK: '하위 태스크',
};

/** 이슈 유형 name 을 한국어 라벨로 변환한다. 미등록 값은 원문 그대로 반환. */
export function getIssueTypeLabel(name: string): string {
  return ISSUE_TYPE_LABELS[name] ?? name;
}
