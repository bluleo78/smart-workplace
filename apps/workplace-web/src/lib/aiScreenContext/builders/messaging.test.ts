// 채팅 화면 컨텍스트 builder 단위 테스트(WP-54).
import { describe, expect, it } from 'vitest';

import { buildChannelContext, buildDmContext, buildThreadsInboxContext } from './messaging';

describe('messaging builders', () => {
  it('채널 + 열린 스레드(본문 첫 줄)', () => {
    expect(
      buildChannelContext({ channelId: 5, name: 'dev', memberCount: 8, archived: false, thread: { id: 77, authorName: '김철수', body: '배포 언제?\n내일 가능?', replyCount: 3 } }),
    ).toEqual({
      view: '채널',
      focus: { type: '스레드', label: '김철수: 배포 언제?', refs: { messageId: '77' }, facts: [{ label: '답글', value: '3' }] },
      scope: { label: '채널 #dev', refs: { channelId: '5' }, facts: [{ label: '멤버', value: '8' }] },
    });
  });
  it('보관 채널·스레드 없음', () => {
    const ctx = buildChannelContext({ channelId: 5, name: 'old', memberCount: 2, archived: true, thread: null });
    expect(ctx.focus).toBeUndefined();
    expect(ctx.scope!.facts).toContainEqual({ label: '보관됨', value: '예' });
  });
  it('DM', () => {
    expect(buildDmContext({ channelId: 9, participantNames: ['양동희', '김철수'] })).toEqual({ view: 'DM', scope: { label: 'DM · 양동희, 김철수', refs: { channelId: '9' } } });
  });
  it('스레드 모아보기', () => {
    expect(buildThreadsInboxContext({ count: 4, hasMore: true })).toEqual({ view: '스레드 모아보기', scope: { label: '내 스레드 모아보기', count: 4, hasMore: true } });
  });
});
