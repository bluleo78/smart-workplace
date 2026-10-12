import { describe, it, expect } from 'vitest';

import { buildMessagingUserMessage } from './messaging-user-message.js';
import type { MessagingMessagePostedPayload } from '../types/messaging-events.js';
import type { ChannelMessageItem } from '../clients/workplace-api.js';

const payload: MessagingMessagePostedPayload = {
  channelId: 42,
  channelKind: 'CHANNEL',
  messageId: 9,
  respondAsAgentId: 99,
  actor: { id: 7, name: 'Alice', kind: 'HUMAN' },
  body: '@AI 요약해줘',
  mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }],
  occurredAt: '2026-06-03T12:00:00Z',
};
const recent: ChannelMessageItem[] = [
  { id: 8, authorName: 'Alice', authorKind: 'HUMAN', body: '이전 메시지', createdAt: 't', deleted: false },
];

describe('buildMessagingUserMessage', () => {
  it('trigger·대화흐름·channelId 포함', () => {
    const msg = buildMessagingUserMessage(payload, recent);
    expect(msg).toContain('42');
    expect(msg).toContain('요약해줘');
    expect(msg).toContain('이전 메시지');
    expect(msg).toContain('채널');
  });

  it('WP-352: 더 과거 대화는 list_channel_messages 의 nextCursor 로 이어 읽도록 안내하고 옛 이름·"100건까지만" 은 없다', () => {
    const msg = buildMessagingUserMessage(payload, recent);
    expect(msg).toContain('list_channel_messages(42)');
    expect(msg).toContain('nextCursor 를 cursor 로 넘기면');
    expect(msg).not.toContain('get_channel_messages');
    expect(msg).not.toContain('100건까지만');
  });

  // WP-353: 도구 출력(list_channel_messages)은 멘션을 이름으로 푸는데 prefetch 가 원시 토큰을 넣으면 모델이 숫자 id 를 본다.
  it('트리거·최근 대화의 <@id> 멘션 토큰을 @이름(username) 으로 풀고 숫자 id 를 노출하지 않는다', () => {
    const p: MessagingMessagePostedPayload = {
      ...payload,
      body: '<@99> 이거 <@7> 와 같이 봐줘 <@555>',
      mentions: [
        { id: 99, username: 'ai', name: 'AI', kind: 'AGENT' },
        { id: 7, username: 'alice', name: 'Alice', kind: 'HUMAN' },
      ],
    };
    const history: ChannelMessageItem[] = [
      { id: 8, authorName: 'Bob', authorKind: 'HUMAN', body: '<@7> 확인 부탁', createdAt: 't', deleted: false, mentions: [{ id: 7, username: 'alice', name: 'Alice' }] },
      { id: 9, authorName: 'Bob', authorKind: 'HUMAN', body: '<@123> 도 참고', createdAt: 't', deleted: false },
      { id: 10, authorName: 'Bob', authorKind: 'HUMAN', body: '<@7> 지움', createdAt: 't', deleted: true },
    ];
    const msg = buildMessagingUserMessage(p, history);
    expect(msg).toContain('메시지: "@AI(ai) 이거 @Alice(alice) 와 같이 봐줘 @(알 수 없는 사용자)"');
    expect(msg).toContain('- [Bob] @Alice(alice) 확인 부탁');
    expect(msg).toContain('- [Bob] @(알 수 없는 사용자) 도 참고');
    expect(msg).not.toMatch(/<@\d+>/);
  });

  it('DM 이면 1:1 DM 표기', () => {
    const dm = { ...payload, channelKind: 'DM' };
    expect(buildMessagingUserMessage(dm, recent)).toContain('1:1 DM');
  });

  // L3 위임 Task 4: 위임 가능 프로젝트 섹션 주입.
  it('candidates 있으면 ## 위임 가능 프로젝트 섹션에 목록 표시', () => {
    const candidates = [
      { key: 'DESIGN', name: '디자인팀' },
      { key: 'FRONT', name: '프론트엔드' },
    ];
    const msg = buildMessagingUserMessage(payload, recent, candidates);
    expect(msg).toContain('## 위임 가능 프로젝트');
    expect(msg).toContain('- 디자인팀 (DESIGN)');
    expect(msg).toContain('- 프론트엔드 (FRONT)');
  });

  // Task 3: 후보 0건이면 개인 폴백 문구 제거 → 멤버 추가 요청 안내.
  it('후보 0건이면 멤버 추가 요청 안내를 포함한다', () => {
    const msg = buildMessagingUserMessage(payload, recent, []);
    expect(msg).toContain('멤버로 추가');
  });

  it('candidates 빈 배열이면 개인 작업 폴백 문구가 없다', () => {
    const msg = buildMessagingUserMessage(payload, recent, []);
    expect(msg).not.toContain('개인 작업으로 생성');
  });

  it('candidates 생략(기본값)이면 멤버 추가 요청 안내를 포함한다', () => {
    const msg = buildMessagingUserMessage(payload, recent);
    expect(msg).toContain('멤버로 추가');
  });
});
