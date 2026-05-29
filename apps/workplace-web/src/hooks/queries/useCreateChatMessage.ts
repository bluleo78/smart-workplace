// 메시지 작성 mutation + optimistic UI.
// 임시 메시지 id 는 음수 (UI 키로만 쓰임) — onSuccess 시 서버 응답 id 로 replace.
// onError 시 snapshot 복원 + toast.
// 폴링이 concurrent 메시지를 5초 안에 동기화하므로 onSettled 재요청은 두지 않는다 (네트워크 절약).

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { chatApi } from '../../api/chat';
import type {
  ChatMessagePage,
  ChatMessageResponse,
  CreateChatMessageRequest,
  UserKind,
} from '../../types/chat';
import { handleApiError } from '../../lib/api-error';
import { chatKeys } from './chatKeys';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

export function useCreateChatMessage(threadId: number, me: MeContext) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateChatMessageRequest) =>
      chatApi.createMessage(threadId, payload).then((r) => r.data),

    onMutate: async (payload) => {
      const key = chatKeys.messages(threadId);
      await qc.cancelQueries({ queryKey: key });
      const snapshot = qc.getQueryData<InfiniteData<ChatMessagePage>>(key);

      const tempId = -Math.floor(Math.random() * 1_000_000_000);
      const optimistic: ChatMessageResponse = {
        id: tempId,
        threadId,
        authorId: me.id,
        authorName: me.name,
        authorKind: me.kind,
        body: payload.body,
        mentions: [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deleted: false,
      };

      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) {
          return {
            pages: [{ items: [optimistic], nextCursor: null, hasMore: false }],
            pageParams: [undefined],
          };
        }
        const [first, ...rest] = old.pages;
        return {
          ...old,
          pages: [{ ...first, items: [optimistic, ...first.items] }, ...rest],
        };
      });

      return { snapshot, tempId };
    },

    onSuccess: (saved, _payload, ctx) => {
      const key = chatKeys.messages(threadId);
      qc.setQueryData<InfiniteData<ChatMessagePage>>(key, (old) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => (m.id === ctx?.tempId ? saved : m)),
          })),
        };
      });
    },

    onError: (err, _payload, ctx) => {
      const key = chatKeys.messages(threadId);
      if (ctx?.snapshot) qc.setQueryData(key, ctx.snapshot);
      handleApiError(err, '메시지 전송에 실패했어요');
    },
  });
}
