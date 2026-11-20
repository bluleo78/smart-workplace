// 스레드 답글 작성. 낙관적: 스레드 캐시 끝(ASC)에 답글 append(id 멱등).
// 부모 replyCount 는 SSE created 이벤트가 갱신(echo-only) — 여기서 올리지 않는다(이중 카운트 방지).
import { type InfiniteData, type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query';

import { messagingApi } from '../../api/messaging';
import { handleApiError } from '../../lib/api-error';
import type { MessagePage, MessageResponse, UserKind } from '../../types/messaging';
import { withLatestLinkPreviews } from './linkPreviewCache';
import { messagingKeys } from './messagingKeys';
import { beginOptimisticSend, finishOptimisticSend, optimisticSendKey, removeOptimisticRow, settleOptimisticRow } from './optimisticRows';

interface MeContext {
  id: number;
  name: string;
  kind: UserKind;
}

/**
 * 답글 전송 직후 스레드 캐시 끝(ASC)에 임시(음수 id) 답글을 붙이고 그 임시 id 를 돌려준다.
 *
 * 부모 메시지의 replyCount 는 여기서 올리지 않는다 — 내 답글도 SSE created self-echo 로 돌아와
 * handleMessagingEvent 가 +1 하므로, 여기서도 올리면 "답글 2개"로 이중 카운트된다.
 */
export function appendOptimisticReply(
  qc: QueryClient,
  channelId: number,
  parentMessageId: number,
  me: MeContext,
  body: string,
): number {
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
    unreadReplyCount: 0, // optimistic 답글은 본인 작성이므로 미읽음 아님
    followed: false, // 답글은 부모가 아니므로 팔로우 무관
    reactions: [],
    attachments: [], // optimistic — 서버 응답 시 실제값으로 치환
    driveLinks: [], // optimistic — 서버 응답 시 실제값으로 치환 (#80)
    createdAt: new Date().toISOString(),
    editedAt: null,
    deleted: false,
  };

  // 스레드 캐시 끝에 append(ASC 정렬 — 첫 페이지가 가장 오래된 페이지).
  qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(parentMessageId), (old) => {
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
  return tempId;
}

export function useCreateReply(channelId: number, parentMessageId: number, me: MeContext) {
  const qc = useQueryClient();
  return useMutation({
    // 같은 스레드의 진행 중 전송 수를 세어 목록 복구를 마지막 전송 뒤 한 번만 하게 한다(WP-1872).
    mutationKey: optimisticSendKey(messagingKeys.thread(parentMessageId)),
    mutationFn: ({ body, fileIds, driveFileIds }: { body: string; fileIds?: number[]; driveFileIds?: number[] }) =>
      messagingApi
        // fileIds/driveFileIds 빈 배열이면 키 자체를 생략(텍스트 전용 payload 오염 방지).
        .createMessage(channelId, {
          body,
          parentMessageId,
          fileIds: fileIds?.length ? fileIds : undefined,
          driveFileIds: driveFileIds?.length ? driveFileIds : undefined,
        })
        .then((r) => r.data),

    onMutate: async ({ body }) => {
      const threadKey = messagingKeys.thread(parentMessageId);
      // 조회 취소 + 복구 필요 표시(캐시 없음/진행 중 조회). 스냅숏은 들고 가지 않는다.
      await beginOptimisticSend(qc, threadKey);

      // 스레드 캐시에만 낙관적 답글을 넣는다 — 부모 replyCount 는 건드리지 않는다(SSE echo 가 +1).
      const tempId = appendOptimisticReply(qc, channelId, parentMessageId, me, body);

      return { tempId };
    },

    onSuccess: (saved, _body, ctx) => {
      const threadKey = messagingKeys.thread(parentMessageId);
      // POST 응답은 링크 미리보기를 가져오기 전 상태다(WP-874) — echo 에 이미 붙은 미리보기 SSE 값을 살린다.
      const next = withLatestLinkPreviews(qc, channelId, saved);
      // 임시 답글이 사라졌으면 저장 답글을 끝에 넣고, 복구가 필요하면 마지막 전송 뒤 목록을 다시 부른다(WP-1872).
      if (ctx) settleOptimisticRow(qc, threadKey, ctx.tempId, next, 'end');
    },

    onError: (err, _body, ctx) => {
      // 이 전송의 임시 답글만 걷는다(스냅숏 복원 X — 다른 답글·SSE 행 보존, WP-1872). 목록 복구는 마지막 전송이 끝날 때 한 번.
      if (ctx) removeOptimisticRow(qc, messagingKeys.thread(parentMessageId), ctx.tempId);
      // onMutate 가 표시만 남기고 실패했으면(ctx 없음) 표시를 풀고 목록을 되살린다.
      else finishOptimisticSend(qc, messagingKeys.thread(parentMessageId));
      handleApiError(err, '답글 전송에 실패했습니다');
    },
  });
}

/** 채널 캐시에서 부모 메시지의 unreadReplyCount 를 delta 만큼 조정. 음수 방지(최솟값 0). */
export function bumpUnreadReplyCount(
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
          m.id === parentMessageId
            ? { ...m, unreadReplyCount: Math.max(0, m.unreadReplyCount + delta) }
            : m,
        ),
      })),
    };
  });
}

/** 채널 메시지 캐시에서 부모 메시지가 followed=true 인지 확인. 캐시에 없으면 false(보수적). */
export function isParentFollowed(
  qc: ReturnType<typeof useQueryClient>,
  channelId: number,
  parentMessageId: number,
): boolean {
  const data = qc.getQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(channelId));
  if (!data) return false;
  for (const p of data.pages) {
    const m = p.items.find((it) => it.id === parentMessageId);
    if (m) return m.followed;
  }
  return false;
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
