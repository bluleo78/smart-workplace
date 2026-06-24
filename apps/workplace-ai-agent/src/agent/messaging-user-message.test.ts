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

  it('candidates 빈 배열이면 후보 없음 안내 표시', () => {
    const msg = buildMessagingUserMessage(payload, recent, []);
    expect(msg).toContain('(후보 없음');
  });

  it('candidates 생략(기본값)이면 후보 없음 안내 표시', () => {
    const msg = buildMessagingUserMessage(payload, recent);
    expect(msg).toContain('(후보 없음');
  });
});
