// WP-139 사용자 AI 사용 설정 쿼리 — 빈 대화 추천·후속 질문 표시와 설정 화면 스위치가 같은 캐시를 본다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAiPreferences, updateAiPreferences } from '../../api/aiSuggestions';
import { starterStore } from '../../lib/ai/starterStorage';
import { handleApiError } from '../../lib/api-error';
import type { AiPreferences } from '../../types/aiSuggestions';
import { useAuth } from '../useAuth';

/**
 * 키에 사용자 id 를 넣는다 — 로그아웃은 react-query 캐시를 비우지 않아, 같은 탭에서 다른 계정으로 들어오면 이전 사용자의 켜기/끄기로
 * 최대 5분간 그려질 수 있었다(최종 리뷰 M7). 사용자가 없으면 null 칸(쿼리는 꺼 둔다).
 */
export const aiPreferenceKeys = {
  all: ['aiPreferences'] as const,
  me: (userId: number | null | undefined) => ['aiPreferences', 'me', userId ?? null] as const,
};

/** 본인 설정 — 자주 바뀌지 않아 5분 신선. 로그인 전에는 부르지 않는다(데이터 없음 = 숨김, fail-closed). */
export function useAiPreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: aiPreferenceKeys.me(user?.id),
    queryFn: getAiPreferences,
    staleTime: 5 * 60_000,
    enabled: user != null,
  });
}

/** 저장 — 응답으로 캐시를 바로 바꾸고, 다시 켰을 때 그날의 "꺼짐·실패" 기록 때문에 추천이 안 오지 않도록 실패 기록을 지운다. */
export function useUpdateAiPreferences() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (body: AiPreferences) => updateAiPreferences(body),
    onSuccess: (data) => {
      qc.setQueryData(aiPreferenceKeys.me(user?.id), data);
      starterStore.resetFailures();
    },
    onError: (e) => handleApiError(e, '추천 질문 설정 저장에 실패했습니다'),
  });
}
