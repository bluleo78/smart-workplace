// 메시지 작성 mutation + optimistic UI.
// 임시 메시지 id 는 음수 (UI 키로만 쓰임) — onSuccess 시 서버 응답 id 로 replace(임시 행이 사라졌으면 insert).
// onError 시 그 전송의 임시 행만 걷고(스냅숏 복원 X — 다른 전송·SSE 행 보존, WP-1872) + toast.
// 다른 사람의 동시 메시지는 SSE(useChatStream)가 캐시에 넣으므로 onSettled 재요청은 두지 않는다 (네트워크 절약).

import { type InfiniteData,useMutation, useQueryClient } from '@tanstack/react-query';

import { chatApi } from '../../api/chat';
import type { MentionCandidate } from '../../components/mentions/types';
import { handleApiError } from '../../lib/api-error';
import { hydrateMentions } from '../../lib/chat-mentions';
import type {
  ChatMessagePage,
  ChatMessageResponse,
  CreateChatMessageRequest,
  UserKind,
} from '../../types/chat';
import { chatKeys } from './chatKeys';
import { removeOptimisticRow, settleOptimisticRow } from './optimisticRows';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

export function useCreateChatMessage(
  threadId: number,
  me: MeContext,
  // 낙관적 메시지의 멘션 칩 이름에 쓰는 후보 — 이슈챗은 참여자 + 프로젝트 AI(WP-1492)를 넘긴다.
  members: MentionCandidate[],
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateChatMessageRequest) =>
      chatApi.createMessage(threadId, payload).then((r) => r.data),

    onMutate: async (payload) => {
      const key = chatKeys.messages(threadId);
      await qc.cancelQueries({ queryKey: key });
      // 스냅숏은 들고 가지 않는다 — 캐시가 있었는지만 기억(없었으면 실패 뒤 무효화).
      const hadCache = qc.getQueryData<InfiniteData<ChatMessagePage>>(key) !== undefined;

      const tempId = -Math.floor(Math.random() * 1_000_000_000);
      const optimistic: ChatMessageResponse = {
        id: tempId,
        threadId,
        authorId: me.id,
        authorName: me.name,
        authorKind: me.kind,
        body: payload.body,
        // optimistic 단계에서도 멘션 칩이 올바른 이름으로 보이도록 멤버 목록으로 hydrate (#43).
        mentions: hydrateMentions(payload.body, members),
        attachments: [], // #358: optimistic 단계에서는 빈 배열 (Task 11에서 정제)
        driveLinks: [], // #358: optimistic 단계에서는 빈 배열 (Task 11에서 정제)
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

      return { hadCache, tempId };
    },

    onSuccess: (saved, _payload, ctx) => {
      const key = chatKeys.messages(threadId);
      // 임시 행 → 서버 메시지 치환(없으면 삽입, SSE echo 와 id dedup), 캐시 없이 보냈다면 목록 재조회(WP-1872).
      if (ctx) settleOptimisticRow(qc, key, ctx.tempId, saved, ctx.hadCache, 'start');
    },

    onError: (err, _payload, ctx) => {
      // 이 전송의 임시 행만 걷는다. 캐시가 없던 경우엔 무효화로 서버 상태를 다시 받는다.
      if (ctx) removeOptimisticRow(qc, chatKeys.messages(threadId), ctx.tempId, ctx.hadCache);
      handleApiError(err, '메시지 전송에 실패했습니다');
    },
  });
}
