import { describe, expect, it, vi } from 'vitest';
import { buildHomeTools } from './home-tools.js';
import { resultText } from './mcp-content.js';
import type { HomeToolClient } from './tool-client.js';

// 서버 응답 모양(Java record)을 그대로 따른 목 — 숫자 ID 필드가 실제로 들어 있어야 "뺐다" 단언이 의미가 있다.
const priorityItems = [
  { sourceType: 'ISSUE_DUE', sourceId: '412', title: '릴리스 노트', deepLink: '/projects/WP/issues/12', importanceScore: 8, urgencyScore: 9, reason: '마감 지남' },
  { sourceType: 'MENTION', sourceId: '77', title: '리뷰 요청', deepLink: '/projects/WP/issues/15', importanceScore: 6, urgencyScore: 5, reason: '멘션' },
  { sourceType: 'MAIL_NEEDS_REPLY', sourceId: '901', title: '견적 문의', deepLink: '/mail/3?messageId=901', importanceScore: 5, urgencyScore: 5, reason: '회신 필요' },
  { sourceType: 'MESSAGE_ATTENTION', sourceId: '55', title: '개발팀', deepLink: '/chat/channels/55', importanceScore: 4, urgencyScore: 4, reason: '메시징 확인 필요' },
  { sourceType: 'FUTURE_KIND', sourceId: 'x1', title: '새 종류', deepLink: '/somewhere', importanceScore: 1, urgencyScore: 1, reason: '?' },
];
const mailSummary = {
  unreadCount: 4, needsReplyCount: 1, classificationActive: true,
  recent: [{ id: 901, accountId: 3, threadId: 't', sender: '김철수', subject: '견적 문의', receivedAt: '2026-10-13T00:00:00Z', seen: false, aiCategory: '업무', aiNeedsReply: true, categoryPending: false }],
};
const messagingSummary = {
  unreadConversationCount: 2, needsReplyCount: 1, aiAttentionCount: 0, attentionCount: 1,
  recent: [
    { kind: 'DM', conversationId: 21, label: '김민수', lastAuthorName: '김민수', lastMessagePreview: '내일 가능?', lastMessageAt: '2026-10-13T01:00:00Z', unreadCount: 1, mentioned: false, needsReply: true, newThreadReplyCount: 0, aiReason: null },
    { kind: 'CHANNEL', conversationId: 55, label: '개발팀', lastAuthorName: null, lastMessagePreview: '배포 완료', lastMessageAt: '2026-10-13T00:30:00Z', unreadCount: 0, mentioned: true, needsReply: false, newThreadReplyCount: 2, aiReason: '회의 일정 언급' },
  ],
};
const activityPage = {
  items: [{ id: 5001, issueId: 412, projectKey: 'WP', issueNumber: 12, issueTitle: '릴리스 노트', actorId: 9, actorName: 'AI 비서', actorKind: 'AGENT', eventType: 'STATUS_CHANGED', createdAt: '2026-10-13T02:00:00Z' }],
  nextCursor: 'CUR1',
};
const inboxPage = {
  items: [{
    rootMessage: {
      id: 700, channelId: 55, authorId: 9, authorName: '앨리스', authorKind: 'HUMAN', body: '배포 일정 <@3> 확인 부탁', mentions: [{ id: 3, username: 'minsu', name: '김민수', kind: 'HUMAN' }],
      // 서버(ThreadInboxService)가 보내는 대로: replyCount 는 0(카드 불필요), 멘션은 본문 토큰을 풀 수 있게 채워 준다.
      parentMessageId: null, replyCount: 0, unreadReplyCount: 2, followed: true, deleted: false, reactions: [], attachments: [], driveLinks: [], createdAt: '2026-10-12T00:00:00Z',
    },
    channelName: '개발팀', lastReplyAt: '2026-10-13T03:00:00Z',
  }],
  nextCursor: 'CUR2', hasMore: true,
};

function mockClient(): HomeToolClient {
  return {
    getHomeActivity: vi.fn().mockResolvedValue(activityPage),
    getPriorityItems: vi.fn().mockResolvedValue(priorityItems),
    getHomeMailSummary: vi.fn().mockResolvedValue(mailSummary),
    getMessagingSummary: vi.fn().mockResolvedValue(messagingSummary),
    getThreadInbox: vi.fn().mockResolvedValue(inboxPage),
  };
}

const run = async (c: HomeToolClient, args: unknown = {}) => {
  const tool = buildHomeTools(c)[0];
  return JSON.parse(resultText(await tool.handler(args) as never));
};

describe('get_home_overview (WP-357)', () => {
  it('notify 앱의 읽기 도구 하나다(messaging 앱 슬롯을 쓰지 않는다)', () => {
    const tools = buildHomeTools(mockClient());
    expect(tools.map((t) => [t.name, t.kind, t.app])).toEqual([['get_home_overview', 'read', 'notify']]);
  });

  it('기본은 우선순위·메일·메시징 세 섹션만 읽고 활동·스레드는 요청하지 않는다', async () => {
    const c = mockClient();
    const out = await run(c);
    expect(Object.keys(out)).toEqual(['priority', 'mail', 'messaging']);
    expect(c.getHomeActivity).not.toHaveBeenCalled();
    expect(c.getThreadInbox).not.toHaveBeenCalled();
  });

  it('우선순위: 종류별 sourceId 를 후속 도구가 받는 이름(issueKey·notificationId·messageId·channelId)으로 풀고 점수·딥링크는 뺀다', async () => {
    const out = await run(mockClient(), { sections: ['priority'] });
    expect(out.priority.items).toEqual([
      { type: 'ISSUE_DUE', title: '릴리스 노트', reason: '마감 지남', issueKey: 'WP-12' },
      { type: 'MENTION', title: '리뷰 요청', reason: '멘션', issueKey: 'WP-15', notificationId: 77 },
      { type: 'MAIL_NEEDS_REPLY', title: '견적 문의', reason: '회신 필요', messageId: 901 },
      { type: 'MESSAGE_ATTENTION', title: '개발팀', reason: '메시징 확인 필요', channelId: 55 },
      { type: 'FUTURE_KIND', title: '새 종류', reason: '?', sourceId: 'x1' },
    ]);
    expect(out.priority).not.toHaveProperty('truncated');
  });

  it('우선순위는 위쪽 20건만 싣고 넘치면 truncated 로 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.getPriorityItems).mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ ...priorityItems[0], sourceId: String(i), deepLink: `/projects/WP/issues/${i}` })));
    const out = await run(c, { sections: ['priority'] });
    expect(out.priority.items).toHaveLength(20);
    expect(out.priority.truncated).toBe(true);
  });

  it('메일: 안 읽은 수·회신 필요 수와 list_mail 과 같은 행 뷰(accountId·threadId 제외)', async () => {
    const out = await run(mockClient(), { sections: ['mail'] });
    expect(out.mail).toEqual({
      unreadCount: 4, needsReplyCount: 1,
      recent: [{ id: 901, sender: '김철수', subject: '견적 문의', receivedAt: '2026-10-13T00:00:00Z', seen: false, aiCategory: '업무', aiNeedsReply: true }],
    });
  });

  it('메일: AI 분류가 꺼져 있으면 회신 필요 수가 뜻이 없다고 알린다', async () => {
    const c = mockClient();
    vi.mocked(c.getHomeMailSummary).mockResolvedValue({ ...mailSummary, classificationActive: false });
    expect((await run(c, { sections: ['mail'] })).mail.aiClassification).toBe(false);
  });

  it('메시징: conversationId 를 channelId 로 바꾸고 0·false·null 은 지운다', async () => {
    const out = await run(mockClient(), { sections: ['messaging'] });
    expect(out.messaging).toEqual({
      unreadConversationCount: 2, needsReplyCount: 1, aiAttentionCount: 0, attentionCount: 1,
      recent: [
        { channelId: 21, kind: 'DM', label: '김민수', lastAuthorName: '김민수', lastMessagePreview: '내일 가능?', lastMessageAt: '2026-10-13T01:00:00Z', unreadCount: 1, needsReply: true },
        { channelId: 55, kind: 'CHANNEL', label: '개발팀', lastMessagePreview: '배포 완료', lastMessageAt: '2026-10-13T00:30:00Z', mentioned: true, newThreadReplyCount: 2, aiReason: '회의 일정 언급' },
      ],
    });
  });

  it('활동: issueKey 하나로 합치고 이력 id·이슈 id·행위자 숫자 id 를 빼며, 커서 페이지로 낸다(한 페이지 10건)', async () => {
    const c = mockClient();
    const out = await run(c, { sections: ['activity'] });
    expect(c.getHomeActivity).toHaveBeenCalledWith({ cursor: undefined, size: 10 });
    expect(out.activity).toEqual({
      items: [{ issueKey: 'WP-12', issueTitle: '릴리스 노트', actorName: 'AI 비서', actorKind: 'AGENT', eventType: 'STATUS_CHANGED', createdAt: '2026-10-13T02:00:00Z' }],
      hasMore: true,
      nextCursor: 'CUR1',
    });
  });

  it('스레드 인박스: channelId 를 유지하고 사용자 ID·멘션 토큰을 정리하며 followed 노이즈를 뺀다', async () => {
    const c = mockClient();
    const out = await run(c, { sections: ['threads'] });
    expect(c.getThreadInbox).toHaveBeenCalledWith({ cursor: undefined, limit: 10 });
    expect(out.threads).toEqual({
      items: [{
        channelId: 55, channelName: '개발팀', lastReplyAt: '2026-10-13T03:00:00Z', id: 700, authorName: '앨리스', authorKind: 'HUMAN',
        body: '배포 일정 @김민수(minsu) 확인 부탁', mentions: [{ username: 'minsu', name: '김민수', kind: 'HUMAN' }], unreadReplyCount: 2, createdAt: '2026-10-12T00:00:00Z',
      }],
      hasMore: true,
      nextCursor: 'CUR2',
    });
  });

  // 서버가 멘션 사전을 못 채우던 때(mentions: [])의 모양 — 토큰은 숫자 ID 를 흘리지 않도록 @(알 수 없는 사용자) 로 바뀐다. 서버가 채우는 정상 경로는 위 테스트가 본다.
  it('멘션 사전이 비어 있으면 토큰은 숫자 대신 "@(알 수 없는 사용자)" 로 바뀐다', async () => {
    const c = mockClient();
    vi.mocked(c.getThreadInbox).mockResolvedValue({ items: [{ rootMessage: { ...inboxPage.items[0].rootMessage, mentions: [] }, channelName: 'c', lastReplyAt: 't' }], nextCursor: null });
    const out = await run(c, { sections: ['threads'] });
    expect(out.threads.items[0].body).toBe('배포 일정 @(알 수 없는 사용자) 확인 부탁');
  });

  it('스레드 본문은 미리보기 길이(200자)로 자른다', async () => {
    const c = mockClient();
    const long = 'a'.repeat(500);
    vi.mocked(c.getThreadInbox).mockResolvedValue({ items: [{ rootMessage: { ...inboxPage.items[0].rootMessage, body: long, mentions: [] }, channelName: 'c', lastReplyAt: 't' }], nextCursor: null });
    const out = await run(c, { sections: ['threads'] });
    expect(out.threads.items[0].body).toBe(`${'a'.repeat(200)}…`);
    expect(out.threads).not.toHaveProperty('hasMore');
  });

  it('cursor 는 활동 또는 스레드 하나만 요청할 때 그대로 전달되고, 그 밖의 조합은 거부한다', async () => {
    const c = mockClient();
    await run(c, { sections: ['activity'], cursor: 'CUR1' });
    expect(c.getHomeActivity).toHaveBeenCalledWith({ cursor: 'CUR1', size: 10 });
    await run(c, { sections: ['threads'], cursor: 'CUR2' });
    expect(c.getThreadInbox).toHaveBeenCalledWith({ cursor: 'CUR2', limit: 10 });
    await expect(run(c, { cursor: 'x' })).rejects.toThrow('cursor');
    await expect(run(c, { sections: ['activity', 'threads'], cursor: 'x' })).rejects.toThrow('cursor');
    await expect(run(c, { sections: ['mail'], cursor: 'x' })).rejects.toThrow('cursor');
  });

  it('한 섹션이 실패해도 나머지는 돌려주고 실패한 섹션에는 오류 문구를 둔다', async () => {
    const c = mockClient();
    vi.mocked(c.getMessagingSummary).mockRejectedValue(Object.assign(new Error('forbidden'), { response: { status: 403, data: { message: '권한 없음' } } }));
    const out = await run(c);
    expect(out.priority.items).toHaveLength(5);
    expect(out.mail.unreadCount).toBe(4);
    expect(out.messaging.error).toContain('권한 없음');
  });

  it('모든 섹션이 실패하면 오류로 던진다', async () => {
    const c = mockClient();
    for (const m of [c.getPriorityItems, c.getHomeMailSummary, c.getMessagingSummary]) vi.mocked(m).mockRejectedValue(new Error('down'));
    await expect(run(c)).rejects.toThrow('홈 개요를 읽지 못했습니다');
  });

  it('섹션을 중복해 주어도 한 번만 읽고, 빈 배열은 기본 섹션으로 본다', async () => {
    const c = mockClient();
    await run(c, { sections: ['mail', 'mail'] });
    expect(c.getHomeMailSummary).toHaveBeenCalledTimes(1);
    expect(Object.keys(await run(c, { sections: [] }))).toEqual(['priority', 'mail', 'messaging']);
  });

  it('알 수 없는 섹션 이름은 거부한다', async () => {
    await expect(run(mockClient(), { sections: ['calendar'] })).rejects.toThrow();
  });
});
