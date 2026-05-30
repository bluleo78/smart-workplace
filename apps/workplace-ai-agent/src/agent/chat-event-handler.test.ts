import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./run-chat-agent.js', () => ({ runChatAgent: vi.fn() }));

import { runChatAgent } from './run-chat-agent.js';
import { handleChatEvent } from './chat-event-handler.js';
import type { ChatEventEnvelope } from '../types/chat-events.js';

const base = {
  projectKey: 'WP',
  issueKey: 'WP-1',
  issueId: 1,
  threadId: 5,
  messageId: 9,
  body: '@AI',
  mentions: [{ id: 99, username: 'ai', name: 'AI', kind: 'AGENT' as const }],
  occurredAt: '2026-05-30T12:00:00Z',
};
const env = (actorKind: 'HUMAN' | 'AGENT'): ChatEventEnvelope => ({
  type: 'chat.message.posted',
  payload: { ...base, actor: { id: 7, username: 'a', name: 'A', kind: actorKind } },
});

describe('handleChatEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(runChatAgent).mockResolvedValue(undefined);
  });

  it('HUMAN actor → runChatAgent 호출', () => {
    handleChatEvent(env('HUMAN'), { client: {} as never });
    expect(runChatAgent).toHaveBeenCalledOnce();
  });

  it('AGENT actor → self-loop skip', () => {
    handleChatEvent(env('AGENT'), { client: {} as never });
    expect(runChatAgent).not.toHaveBeenCalled();
  });

  it('runChatAgent reject → throw 안함', () => {
    vi.mocked(runChatAgent).mockRejectedValueOnce(new Error('boom'));
    expect(() => handleChatEvent(env('HUMAN'), { client: {} as never })).not.toThrow();
  });
});
