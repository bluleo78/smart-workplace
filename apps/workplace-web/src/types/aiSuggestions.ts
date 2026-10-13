// WP-139 AI 추천 질문 계약 — 백엔드 AiPreferencesResponse·AiSuggestionRequest/Response 와 1:1.
import type { AiScreenContext } from './aiScreenContext';

/** 사용자 AI 사용 설정(GET|PUT /users/me/ai-preferences). PUT 은 보낸 필드만 바꾼다(WP-55). */
export interface AiPreferences {
  suggestionsEnabled: boolean;
  /** WP-55: 메모리 사용 — 끄면 저장도 반영도 하지 않는다(목록은 남는다). */
  memoryEnabled: boolean;
}

/** 빈 대화 추천 요청 — 화면 참고 칩이 켜져 있을 때만 screenContext 를 싣는다. */
export interface StarterSuggestionsRequest {
  screenContext?: AiScreenContext;
}

/** 빈 대화 추천 응답 — enabled=false 면 사용자가 추천을 껐다. */
export interface StarterSuggestionsResponse {
  items: string[];
  enabled: boolean;
}
