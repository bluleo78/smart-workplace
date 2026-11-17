// DM 숨기기(WP-1676). 성공 시 DM 목록·안 읽음 요약 무효화 — 호출처가 /chat 으로 라우팅.
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import { messagingKeys } from './messagingKeys';

export function useHideDm() {
  const qc = useQueryClient();
  return useMutation<void, unknown, number>({
    // 떠나는 DM 표시 — DmPage 가 이 키로 「숨기는 중/숨김」을 알아 /chat 이동 전 「대화 없음」을 그리지 않는다(WP-1677).
    mutationKey: [...messagingKeys.dmDeparture(), 'hide'],
    mutationFn: async (channelId) => {
      try {
        await messagingApi.hideDm(channelId);
      } catch (e: unknown) {
        // 404 는 「이미 나갔거나 없는 DM」 — 목록에서 사라져야 한다는 결과는 같으므로 성공으로 본다(useLeaveChannel 과 같은 멱등 처리).
        const status = (e as { response?: { status?: number } })?.response?.status;
        if (status === 404) return;
        throw e;
      }
    },
    // 무효화 promise 를 돌려주지 않는다 — 돌려주면 다시 받은 목록(숨긴 DM 이 빠진)이 오기를 기다린 뒤에야 호출처 onSuccess(이동)가 불려
    // 그 사이 DM 화면이 「대화 없음」으로 잠깐 바뀐다.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagingKeys.dms() });
      qc.invalidateQueries({ queryKey: ['messaging-summary'], exact: true });
    },
    onError: (err) => handleApiError(err, '대화를 숨기지 못했습니다'),
  });
}
