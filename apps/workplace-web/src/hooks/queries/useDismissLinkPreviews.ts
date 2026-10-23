// 링크 미리보기 지우기 mutation(WP-874) — 작성자 본인만 부른다.
// 낙관적으로 카드를 바로 숨기고(linkPreviews=[]), 실패하면 그 메시지의 원래 카드만 되돌린 뒤 토스트.
// 성공 뒤 서버가 보내는 messaging.message.link-previews(빈 배열) SSE 는 같은 값으로 덮으므로 충돌하지 않는다.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { LinkPreview, MessageResponse } from '../../types/messaging';
import { patchMessage } from '../useMessageStream';

export function useDismissLinkPreviews(channelId: number) {
  const qc = useQueryClient();

  // 채널 캐시·스레드 캐시 모두에서 그 메시지의 linkPreviews 를 바꾼다 — SSE 와 같은 patch 경로.
  const setPreviews = (messageId: number, linkPreviews: LinkPreview[]) => patchMessage(qc, channelId, messageId, { linkPreviews });

  return useMutation({
    mutationFn: (message: MessageResponse) => messagingApi.dismissLinkPreviews(message.id),

    // 캐시 전체 스냅샷이 아니라 그 메시지의 카드만 기억한다 — 실패 복구가 그 사이 도착한 다른 SSE 변경을 지우지 않게.
    onMutate: (message) => {
      const previous = message.linkPreviews ?? [];
      setPreviews(message.id, []);
      return { previous };
    },

    onError: (err, message, ctx) => {
      if (ctx) setPreviews(message.id, ctx.previous);
      handleApiError(err, '미리보기를 지우지 못했습니다');
    },
  });
}
