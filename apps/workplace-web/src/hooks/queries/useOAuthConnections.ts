// 내 OAuth 앱 연결 목록 + 끊기 mutation(WP-1687).
// 목록은 staleTime 0 + 창으로 돌아올 때 다시 읽는다 — 연결은 이 탭 밖(Claude 앱 → 다른 탭의 동의 화면)에서 생기므로,
// 캐시를 믿으면 연결을 마치고 돌아와도 방금 만든 연결이 안 보인다.
// 끊기는 성공·실패 모두 onSettled 에서 목록을 다시 읽는다 — 404(다른 곳에서 이미 끊김)여도 줄이 사라져야 하고,
// 낙관적 제거는 하지 않아(서버가 끊은 것을 확인한 목록만 믿는다) 실패했을 때 되돌릴 일도 없다.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { listMyOAuthConnections, revokeMyOAuthConnection } from '../../api/oauthConnections';
import { handleApiError } from '../../lib/api-error';

export const oauthConnectionKeys = {
  mine: ['oauthConnections', 'me'] as const,
};

/** 내 앱 연결 목록 — 항상 오래된 것으로 보고, 창으로 돌아오면 다시 읽는다. */
export function useMyOAuthConnections() {
  return useQuery({
    queryKey: oauthConnectionKeys.mine,
    queryFn: listMyOAuthConnections,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** 앱 연결 끊기 — 결과와 무관하게 목록을 다시 읽어 줄을 맞춘다. */
export function useRevokeMyOAuthConnection() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    mutationFn: revokeMyOAuthConnection,
    onSuccess: () => {
      toast.success('앱 연결을 끊었습니다');
    },
    onError: (e) => handleApiError(e, '앱 연결 끊기에 실패했습니다'),
    // 다시 읽기 promise 를 돌려준다 — react-query 가 그것을 기다리는 동안 mutation 이 isPending 으로 남아, 끊은 줄이
    // 목록에서 빠질 때까지 그 줄의 「끊기」가 비활성으로 남는다(그 사이 다시 누르면 404 만 돌아온다).
    onSettled: () => qc.invalidateQueries({ queryKey: oauthConnectionKeys.mine }),
  });
}
