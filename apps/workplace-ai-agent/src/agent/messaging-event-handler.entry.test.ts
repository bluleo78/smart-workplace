// WP-1490: handleMessagingEvent 진입점 — AGENT 메시지는 거르고, 사람 메시지는 모듈 싱글턴 합치기를 거쳐 실행기로 간다.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 실제 SDK 실행 대신 손으로 끝내는 가짜 실행기.
const finishers: Array<() => void> = [];
vi.mock('./run-messaging-agent.js', () => ({
  runMessagingAgent: vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finishers.push(resolve);
      }),
  ),
}));

import { handleMessagingEvent } from './messaging-event-handler.js';
import { runMessagingAgent } from './run-messaging-agent.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';

/** 테스트 이벤트 — 보낸 사람 종류와 메시지 id 만 바꾼다. */
function ev(messageId: number, kind: 'HUMAN' | 'AGENT' = 'HUMAN'): MessagingEventEnvelope {
  return {
    type: 'messaging.message.posted',
    payload: {
      channelId: 77,
      channelKind: 'DM',
      messageId,
      respondAsAgentId: 9,
      actor: { id: 2, name: '사용자', kind },
      body: '안녕',
      mentions: [],
      triggerParentMessageId: null,
      occurredAt: '2026-11-11T00:00:00Z',
    },
  };
}

const deps = {} as EventHandlerDeps;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('handleMessagingEvent (WP-1490)', () => {
  beforeEach(() => {
    vi.mocked(runMessagingAgent).mockClear();
  });

  it('AGENT 가 쓴 메시지는 실행하지 않는다', () => {
    handleMessagingEvent(ev(1, 'AGENT'), deps);
    expect(runMessagingAgent).not.toHaveBeenCalled();
  });

  it('같은 대화에 연달아 온 사람 메시지는 실행 하나 + 끝난 뒤 마지막 메시지로 한 번', async () => {
    handleMessagingEvent(ev(10), deps);
    handleMessagingEvent(ev(11), deps);
    handleMessagingEvent(ev(12), deps);
    expect(runMessagingAgent).toHaveBeenCalledTimes(1);

    finishers.shift()?.();
    await flush();
    expect(runMessagingAgent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runMessagingAgent).mock.calls[1][0].payload.messageId).toBe(12);

    finishers.shift()?.();
    await flush();
  });
});
