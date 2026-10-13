// WP-139 사용자 AI 사용 설정 쿼리 — 빈 대화 추천·후속 질문 표시와 설정 화면 스위치가 같은 캐시를 본다. WP-55: 메모리 켜기/끄기도 같은 캐시.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getAiPreferences, updateAiPreferences } from '../../api/aiSuggestions';
import { starterStore } from '../../lib/ai/starterStorage';
import { handleApiError } from '../../lib/api-error';
import type { AiPreferences } from '../../types/aiSuggestions';
import { useAuth } from '../useAuth';

/**
 * 키에 사용자 id 를 넣는다 — 로그아웃은 react-query 캐시를 비우지 않아, 같은 탭에서 다른 계정으로 들어오면 이전 사용자의 켜기/끄기로
 * 최대 5분간 그려질 수 있다. 사용자가 없으면 null 칸(쿼리는 꺼 둔다).
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

/**
 * 저장 응답 → 캐시. 보낸 필드만 응답 값으로 바꾼다 — 두 스위치(추천·메모리)는 저장을 따로 하므로, 동시에 누르면 먼저 보낸 저장의 응답이
 * 늦게 와 다른 스위치를 옛 값으로 되돌릴 수 있다(응답은 두 값을 모두 담는다). 캐시가 없으면 응답 전체를 쓴다.
 */
export function mergeSentPreferences(
  old: AiPreferences | undefined,
  sent: Partial<AiPreferences>,
  data: AiPreferences,
): AiPreferences {
  if (!old) return data;
  const next = { ...old };
  for (const k of Object.keys(sent) as Array<keyof AiPreferences>) {
    if (sent[k] !== undefined) next[k] = data[k];
  }
  return next;
}

/** 저장 — 응답으로 캐시를 바로 바꾸고, 다시 켰을 때 최근 "꺼짐·실패" 기록(10분) 때문에 추천이 안 오지 않도록 실패 기록을 지운다. */
export function useUpdateAiPreferences() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (body: Partial<AiPreferences>) => updateAiPreferences(body),
    onSuccess: (data, sent) => {
      qc.setQueryData<AiPreferences>(aiPreferenceKeys.me(user?.id), (old) => mergeSentPreferences(old, sent, data));
      starterStore.resetFailures();
    },
    // WP-55: 메모리 스위치도 같은 저장을 쓴다 — 무엇을 바꾸다 실패했는지 문구로 구분한다.
    onError: (e, body) =>
      handleApiError(e, body.memoryEnabled !== undefined ? '메모리 설정 저장에 실패했습니다' : '추천 질문 설정 저장에 실패했습니다'),
  });
}
