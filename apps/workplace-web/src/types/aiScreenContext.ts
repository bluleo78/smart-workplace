// AI 채팅 화면 컨텍스트 계약(WP-54) — 사용자가 보고 있는 화면의 대상(레벨1)·목록 상태(레벨2).
// workplace-api AiScreenContext record · ai-agent screenContextSchema 와 1:1 미러. 값은 표시 문자열이라 서버가 가공하지 않는다.

/** 라벨:값 한 쌍 — 이름으로 해석이 끝난 표시 문자열. */
export interface AiScreenFact {
  label: string;
  value: string;
}

/** AI 조회 도구 인자로 그대로 쓰는 식별자 맵 — 키는 MCP 도구 인자명(issueKey, messageId, …), 값은 문자열. */
export type AiScreenRefs = Record<string, string>;

export interface AiScreenContext {
  /** 화면 이름 — 예: '이슈 상세', '메일함' */
  view: string;
  /** 레벨1 — 보고 있는 대상 */
  focus?: {
    type: string;
    label: string;
    refs: AiScreenRefs;
    facts?: AiScreenFact[];
  };
  /** 레벨2 — 목록·범위·필터 상태 */
  scope?: {
    label: string;
    refs?: AiScreenRefs;
    facts?: AiScreenFact[];
    count?: number;
    hasMore?: boolean;
  };
}
