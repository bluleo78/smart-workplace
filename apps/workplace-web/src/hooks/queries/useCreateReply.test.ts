// 스레드 답글 replyCount 이중 카운트 방지 단위 테스트(WP-412) — 이전 E2E messaging-phase5(내 답글 self-echo 시 정확히 +1)를 대체.
// 낙관적 단계(appendOptimisticReply)는 부모 replyCount 를 건드리지 않고, SSE created self-echo(handleMessagingEvent)가 한 번만 +1 한다.
import { type InfiniteData, QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { MessagePage, MessageResponse } from '../../types/messaging';
import { handleMessagingEvent } from '../useMessageStream';
import { messagingKeys } from './messagingKeys';
import { appendOptimisticReply, bumpReplyCount } from './useCreateReply';

const CH = 504;
const PARENT = 9500;
const ME = 1;

function msg(over: Partial<MessageResponse>): MessageResponse {
  return {
    id: PARENT, channelId: CH, authorId: 2, authorName: '남', authorKind: 'HUMAN',
    body: '부모', mentions: [], parentMessageId: null, replyCount: 0, unreadReplyCount: 0, followed: false,
    reactions: [], attachments: [], driveLinks: [], createdAt: '2026-06-06T03:00:00Z', editedAt: null, deleted: false,
    ...over,
  };
}

function seed(): QueryClient {
  const qc = new QueryClient();
  qc.setQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH), {
    pages: [{ items: [msg({})], nextCursor: null, hasMore: false }],
    pageParams: [undefined],
  });
  return qc;
}

const replyCountOf = (qc: QueryClient) =>
  qc.getQueryData<InfiniteData<MessagePage>>(messagingKeys.messages(CH))!.pages[0].items[0].replyCount;

describe('답글 replyCount — 낙관적 + self-echo', () => {
  it('낙관적 답글은 스레드 캐시에만 들어가고 부모 replyCount 는 그대로', () => {
    const qc = seed();
    const tempId = appendOptimisticReply(qc, CH, PARENT, { id: ME, name: '나', kind: 'HUMAN' }, '내 답글');
    expect(tempId).toBeLessThan(0);
    expect(replyCountOf(qc)).toBe(0);
    const thread = qc.getQueryData<InfiniteData<MessagePage>>(messagingKeys.thread(PARENT))!;
    expect(thread.pages[0].items.map((m) => m.body)).toEqual(['내 답글']);
  });

  it('내 답글 self-echo 가 와도 정확히 1 증가한다(이중 카운트 없음)', () => {
    const qc = seed();
    appendOptimisticReply(qc, CH, PARENT, { id: ME, name: '나', kind: 'HUMAN' }, '내 답글');
    handleMessagingEvent(
      qc,
      'messaging.message.created',
      msg({ id: 9501, parentMessageId: PARENT, authorId: ME, body: '내 답글' }),
      ME,
    );
    expect(replyCountOf(qc)).toBe(1);
  });

  it('bumpReplyCount 는 0 아래로 내려가지 않는다', () => {
    const qc = seed();
    bumpReplyCount(qc, CH, PARENT, -1);
    expect(replyCountOf(qc)).toBe(0);
  });
});
