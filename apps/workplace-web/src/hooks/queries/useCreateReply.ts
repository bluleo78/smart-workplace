// 스레드 답글 작성. 낙관적: 스레드 캐시 끝(ASC)에 답글 append(id 멱등).
// 부모 replyCount 는 SSE created 이벤트가 갱신(echo-only) — 여기서 올리지 않는다(이중 카운트 방지).
import { type InfiniteData, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { MessagePage, MessageResponse, UserKind } from '../../types/messaging';
import { messagingKeys } from './messagingKeys';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

export function useCreateReply(channelId: number, parentMessageId: number, me: MeContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      messagingApi.createMessage(channelId, { body, parentMessageId }).then((r) => r.data),

    onMutate: async (body) => {
      const threadKey = messagingKeys.thread(parentMessageId);
      await qc.cancelQueries({ queryKey: threadKey });
      const threadSnap = qc.getQueryData<InfiniteData<MessagePage>>(threadKey);

      const tempId = -Math.floor(Math.random() * 1_000_000_000);
      const optimistic: MessageResponse = {
        id: tempId,
        channelId,
        authorId: me.id,
        authorName: me.name,
        authorKind: me.kind,
        body,
        mentions: [],
        parentMessageId,
        replyCount: 0,
        reactions: [],
        attachments: [], // optimistic — 서버 응답 시 실제값으로 치환
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      };

      // 스레드 캐시 끝에 append(ASC 정렬 — 첫 페이지가 가장 오래된 페이지).
      qc.setQueryData<InfiniteData<MessagePage>>(threadKey, (old) => {
        if (!old) {
          return {
            pages: [{ items: [optimistic], nextCursor: null, hasMore: false }],
            pageParams: [undefined],
          };
        }
        const last = old.pages[old.pages.length - 1];
        const head = old.pages.slice(0, -1);
        return { ...old, pages: [...head, { ...last, items: [...last.items, optimistic] }] };
      });
      // replyCount 는 SSE created 이벤트가 갱신(echo-only) — 여기서 bump 하지 않는다.

      return { threadSnap, tempId };
    },

    onSuccess: (saved, _body, ctx) => {
      const threadKey = messagingKeys.thread(parentMessageId);
      qc.setQueryData<InfiniteData<MessagePage>>(threadKey, (old) => {
        if (!old) return old;
        const seen = new Set<number>();
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items
              .map((m) => (m.id === ctx?.tempId ? saved : m))
              .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))),
          })),
        };
      });
    },

    onError: (err, _body, ctx) => {
      if (ctx?.threadSnap) qc.setQueryData(messagingKeys.thread(parentMessageId), ctx.threadSnap);
      handleApiError(err, '답글 전송에 실패했어요');
    },
  });
}

/** 채널 캐시에서 특정 부모 메시지의 replyCount 를 delta 만큼 조정(SSE created-reply 이벤트에서 사용). */
export function bumpReplyCount(
  qc: ReturnType<typeof useQueryClient>,
  channelId: number,
  parentMessageId: number,
  delta: number,
) {
  qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId), (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({
        ...p,
        items: p.items.map((m) =>
          m.id === parentMessageId ? { ...m, replyCount: Math.max(0, m.replyCount + delta) } : m,
        ),
      })),
    };
  });
}
