// AI 채팅 화면 컨텍스트 계약(WP-54) — 사용자가 보고 있는 화면의 대상(레벨1)·목록 상태(레벨2).
// workplace-api AiScreenContext record · ai-agent screenContextSchema 와 1:1 미러. 값은 표시 문자열이라 서버가 가공하지 않는다.

import type { AiMemoryScope } from './aiMemory';

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
  /**
   * WP-379: 이 화면의 앱 — 홈 채팅이 공통 + 이 앱 메모리를 고르는 데 쓴다(요청 본문 app). 화면 참고 칩을 꺼도 보낸다.
   * 서버로 보내는 screenContext 에는 싣지 않는다(screenContextPayload) — API·ai-agent 계약에 없는 필드다.
   */
  app?: AiMemoryScope;
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
