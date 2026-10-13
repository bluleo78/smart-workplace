// WP-139 AI 추천 질문 엔드포인트 — 빈 대화 추천과 사용자 켜기/끄기. 실패 토스트는 호출측이 정한다(추천은 조용히 실패한다).
import type { AiPreferences, StarterSuggestionsRequest, StarterSuggestionsResponse } from '../types/aiSuggestions';
import { client } from './client';

/** 빈 대화 추천 — 첫 호출은 수 초 걸린다(스펙 §6.1). 화면은 저장·고정 문구를 먼저 보이므로 기다리지 않는다. */
export async function fetchStarterSuggestions(body: StarterSuggestionsRequest): Promise<StarterSuggestionsResponse> {
  const { data } = await client.post<StarterSuggestionsResponse>('/ai/suggestions', body);
  return data;
}

/** 본인 AI 사용 설정. */
export async function getAiPreferences(): Promise<AiPreferences> {
  const { data } = await client.get<AiPreferences>('/users/me/ai-preferences');
  return data;
}

/** 본인 AI 사용 설정 저장 — 보낸 필드만 바뀌고(WP-55), 서버가 다시 읽은 두 값을 돌려받는다. */
export async function updateAiPreferences(body: Partial<AiPreferences>): Promise<AiPreferences> {
  const { data } = await client.put<AiPreferences>('/users/me/ai-preferences', body);
  return data;
}
