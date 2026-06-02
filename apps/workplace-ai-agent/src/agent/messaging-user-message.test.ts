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
});
