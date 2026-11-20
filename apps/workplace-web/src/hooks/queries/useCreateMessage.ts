// 메시지 작성 mutation + optimistic UI. 임시 id 는 음수. onSuccess 시 서버 id 로 치환(임시 행이 사라졌으면 삽입) + id dedup
// (SSE self-echo 가 같은 id 를 먼저 넣었을 수 있음). onError 시 그 전송의 임시 행만 걷고(스냅숏 복원 X — 다른 전송·SSE 행 보존, WP-1872) + toast.
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type {
  CreateMessageRequest,
  MessagePage,
  MessageResponse,
  UserKind,
} from '../../types/messaging';
import { withLatestLinkPreviews } from './linkPreviewCache';
import { messagingKeys } from './messagingKeys';
import { removeOptimisticRow, settleOptimisticRow } from './optimisticRows';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

export function useCreateMessage(channelId: number, me: MeContext) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateMessageRequest) =>
      messagingApi.createMessage(channelId, payload).then((r) => r.data),

    onMutate: async (payload) => {
      const key = messagingKeys.messages(channelId);
      await qc.cancelQueries({ queryKey: key });
      // 스냅숏은 들고 가지 않는다 — 캐시가 있었는지만 기억(없었으면 실패 뒤 무효화).
      const hadCache = qc.getQueryData<InfiniteData<MessagePage>>(key) !== undefined;

      const tempId = -Math.floor(Math.random() * 1_000_000_000);
      const optimistic: MessageResponse = {
        id: tempId,
        channelId,
        authorId: me.id,
        authorName: me.name,
        authorKind: me.kind,
        body: payload.body,
        mentions: [], // optimistic — 서버 응답 시 실제값으로 치환
        parentMessageId: null, // 메인 컴포저는 최상위 메시지만 작성
        replyCount: 0,
        unreadReplyCount: 0, // optimistic 메시지는 본인 작성이므로 미읽음 없음
        followed: false, // 팔로우 여부는 서버 응답에서 결정
        reactions: [],
        attachments: [], // optimistic — 서버 응답 시 실제값으로 치환
        driveLinks: [], // optimistic — 서버 응답 시 실제값으로 치환 (#80)
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      };

      qc.setQueryData<InfiniteData<MessagePage>>(key, (old) => {
        if (!old) {
          return {
            pages: [{ items: [optimistic], nextCursor: null, hasMore: false }],
            pageParams: [undefined],
          };
        }
        const [first, ...rest] = old.pages;
        return { ...old, pages: [{ ...first, items: [optimistic, ...first.items] }, ...rest] };
      });

      return { hadCache, tempId };
    },

    onSuccess: (saved, _payload, ctx) => {
      const key = messagingKeys.messages(channelId);
      // POST 응답은 링크 미리보기를 가져오기 전 상태다(WP-874) — echo 에 이미 붙은 미리보기 SSE 값을 살린다.
      const next = withLatestLinkPreviews(qc, channelId, saved);
      // 임시 행이 사라졌으면 저장 행을 넣고, 캐시 없이 보냈다면 목록을 다시 부른다(WP-1872).
      if (ctx) settleOptimisticRow(qc, key, ctx.tempId, next, ctx.hadCache, 'start');
    },

    onError: (err, _payload, ctx) => {
      // 이 전송의 임시 행만 걷는다. 캐시가 없던 경우엔 무효화로 서버 상태를 다시 받는다.
      if (ctx) removeOptimisticRow(qc, messagingKeys.messages(channelId), ctx.tempId, ctx.hadCache);
      handleApiError(err, '메시지 전송에 실패했습니다');
    },
  });
}
