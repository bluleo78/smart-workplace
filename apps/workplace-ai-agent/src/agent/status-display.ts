// WP-869: 비서 프롬프트에 싣는 이슈 상태 표기 — 채팅 user message·메일 [연결 이슈]·이슈 현황 요약이 함께 쓴다.

/** 상태 범주 코드 → 한국어 라벨. 범주는 TODO→IN_PROGRESS→DONE→CANCELED 고정 4개. */
const ISSUE_STATUS_LABEL: Record<string, string> = {
  TODO: '할 일',
  IN_PROGRESS: '진행 중',
  DONE: '완료',
  CANCELED: '취소',
};

/**
 * 이슈 상태 표기. API 가 프로젝트 상태 이름을 함께 보내면 「검토 중(진행 중 범주)」 — 이름만으로는 완료 여부를 알 수 없어 범주를 붙인다.
 * 기본 상태처럼 이름이 그 범주 라벨과 같거나, 이름이 없으면(이름 필드를 보내지 않는 구 API) 라벨만 — 「진행 중(진행 중 범주)」 같은 중복을 막는다.
 * 모르는 범주 값은 그대로 보인다.
 */
export function statusDisplay(category: string, name?: string | null): string {
  const label = ISSUE_STATUS_LABEL[category] ?? category;
  const trimmed = name?.trim();
  return trimmed && trimmed !== label ? `${trimmed}(${label} 범주)` : label;
}
