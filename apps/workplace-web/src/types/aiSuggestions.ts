// WP-139 AI 추천 질문 계약 — 백엔드 AiPreferencesResponse·AiSuggestionRequest/Response 와 1:1.
import type { AiScreenContext } from './aiScreenContext';

/** 사용자 AI 사용 설정(GET|PUT /users/me/ai-preferences). */
export interface AiPreferences {
  suggestionsEnabled: boolean;
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
