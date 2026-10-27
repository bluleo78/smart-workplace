// 이슈 키 표기(예: PLAN-3) 한 곳 — 프로젝트를 넘나드는 화면(다른 프로젝트 에픽·하위, WP-1039)이 키를 제각각 이어 붙이지 않게 모은다.

/** 프로젝트 키와 번호로 이슈 키를 만든다(PLAN, 3 → PLAN-3). */
export function formatIssueKey(projectKey: string, number: number): string {
  return `${projectKey}-${number}`;
}
