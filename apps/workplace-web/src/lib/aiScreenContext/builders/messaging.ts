// 채팅 화면 컨텍스트 builder(WP-54). DM 도 channelId(get_channel_messages 인자). 스레드는 루트 메시지 id(get_thread_replies 인자).
import type { AiScreenContext } from '@/types/aiScreenContext';

import { buildFacts, buildRefs, clip, LIMITS } from '../common';

/** 채널 화면 — 채널 scope + (열린 경우) 스레드 focus. */
export function buildChannelContext(input: {
  channelId: number;
  name: string;
  memberCount: number;
  archived: boolean;
  thread: { id: number; authorName: string; body: string; replyCount: number } | null;
}): AiScreenContext {
  const ctx: AiScreenContext = {
    view: '채널',
    scope: {
      label: clip(`채널 #${input.name}`, LIMITS.label),
      refs: buildRefs({ channelId: input.channelId }),
      facts: buildFacts([['멤버', input.memberCount], ['보관됨', input.archived]]),
    },
  };
  if (input.thread) {
    // 본문 첫 줄만 라벨로 — 전체 본문은 AI 가 get_thread_replies 로 조회.
    const firstLine = input.thread.body.split('\n').find((l) => l.trim()) ?? '';
    ctx.focus = {
      type: '스레드',
      label: clip(`${input.thread.authorName}: ${firstLine}`, LIMITS.label),
      refs: buildRefs({ messageId: input.thread.id }),
      facts: buildFacts([['답글', input.thread.replyCount]]),
    };
  }
  return ctx;
}

/** DM 화면 — 참여자 이름 라벨 + channelId. */
export function buildDmContext(input: { channelId: number; participantNames: string[] }): AiScreenContext {
  return {
    view: 'DM',
    scope: { label: clip(`DM · ${input.participantNames.join(', ')}`, LIMITS.label), refs: buildRefs({ channelId: input.channelId }) },
  };
}

/** 스레드 모아보기 — 로드된 스레드 수(count)와 추가 페이지 여부. */
export function buildThreadsInboxContext(input: { count: number; hasMore: boolean }): AiScreenContext {
  return { view: '스레드 모아보기', scope: { label: '내 스레드 모아보기', count: input.count, hasMore: input.hasMore } };
}
