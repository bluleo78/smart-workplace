// WP-1490: handleMessagingEvent 진입점 — AGENT 메시지는 거르고, 사람 메시지는 모듈 싱글턴 합치기를 거쳐 실행기로 간다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

/** 테스트 이벤트 — 보낸 사람 종류·메시지 id·채널(대화 키가 겹치지 않게)·스레드 부모를 바꾼다. */
function ev(
  messageId: number,
  kind: 'HUMAN' | 'AGENT' = 'HUMAN',
  opts: { channelId?: number; parent?: number | null; tenantId?: number } = {},
): MessagingEventEnvelope {
  return {
    type: 'messaging.message.posted',
    payload: {
      ...(opts.tenantId === undefined ? {} : { tenantId: opts.tenantId }),
      channelId: opts.channelId ?? 77,
      channelKind: 'DM',
      messageId,
      respondAsAgentId: 9,
      actor: { id: 2, name: '사용자', kind },
      body: '안녕',
      mentions: [],
      triggerParentMessageId: opts.parent ?? null,
      occurredAt: '2026-11-11T00:00:00Z',
    },
  };
}

/** 가짜 api client — 임대 acquire·release 응답을 정한다. */
function fakeDeps(
  acquire: () => Promise<unknown>,
  releases: Array<{ next: unknown | null }> = [{ next: null }],
) {
  const rel = [...releases];
  const client = {
    acquireMessagingRun: vi.fn((_key: unknown, _body: unknown) => acquire()),
    releaseMessagingRun: vi.fn(async () => rel.shift() ?? { next: null }),
  };
  return { client, deps: { client } as unknown as EventHandlerDeps };
}

/** acquire 가 실패하는 client — 메모리 합치기 대체 경로를 일부러 탄다. */
const rejectingDeps = () =>
  fakeDeps(async () => {
    throw new Error('404');
  });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('handleMessagingEvent (WP-1490)', () => {
  beforeEach(() => {
    vi.mocked(runMessagingAgent).mockClear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AGENT 가 쓴 메시지는 실행하지 않는다', () => {
    const { deps } = rejectingDeps();
    handleMessagingEvent(ev(1, 'AGENT'), deps);
    expect(runMessagingAgent).not.toHaveBeenCalled();
  });

  it('임대를 못 얻으면(acquire 실패) 메모리 합치기로 실행 하나 + 끝난 뒤 마지막 메시지로 한 번', async () => {
    const { deps } = rejectingDeps();
    handleMessagingEvent(ev(10), deps);
    handleMessagingEvent(ev(11), deps);
    handleMessagingEvent(ev(12), deps);
    // WP-1979: 임대 acquire 가 먼저라(acquire 가 실패해 폴백 → 메모리 합치기) 한 박자 뒤에 시작한다.
    await flush();
    expect(runMessagingAgent).toHaveBeenCalledTimes(1);

    finishers.shift()?.();
    await flush();
    expect(runMessagingAgent).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runMessagingAgent).mock.calls[1][0].payload.messageId).toBe(12);

    finishers.shift()?.();
    await flush();
  });

  it('ACQUIRED 면 키·본문을 담아 acquire 하고, 실행 뒤 같은 토큰으로 release 한다', async () => {
    const { client, deps } = fakeDeps(async () => ({ status: 'ACQUIRED', token: 'tk' }));
    const env = ev(20, 'HUMAN', { channelId: 201, parent: 5 });
    const p = handleMessagingEvent(env, deps)!;
    await flush();
    expect(client.acquireMessagingRun).toHaveBeenCalledWith(
      { channelId: 201, parentMessageId: 5, agentId: 9 },
      { messageId: 20, leaseMs: 15 * 60 * 1000 + 60000, event: env, token: expect.any(String) },
    );
    finishers.shift()?.();
    await p;
    expect(client.releaseMessagingRun).toHaveBeenCalledWith(
      { channelId: 201, parentMessageId: 5, agentId: 9 },
      { token: 'tk', leaseMs: 15 * 60 * 1000 + 60000 },
    );
    expect(vi.mocked(runMessagingAgent).mock.calls[0][1]).toBe(deps);
  });

  it('테넌트가 있는 이벤트는 한 번 스코프한 client 로 임대를 얻고 실행하고 반납한다', async () => {
    const acquire = async () => ({ status: 'ACQUIRED', token: 'tk' });
    const { client } = fakeDeps(acquire);
    const { client: scopedClient } = fakeDeps(acquire);
    const withOnBehalfOfTenant = vi.fn(() => scopedClient);
    const deps = { client: { ...client, withOnBehalfOfTenant } } as unknown as EventHandlerDeps;
    const env = ev(26, 'HUMAN', { channelId: 206, tenantId: 42 });

    const p = handleMessagingEvent(env, deps);
    await flush();
    finishers.shift()?.();
    await p;

    expect(scopedClient.acquireMessagingRun).toHaveBeenCalledOnce();
    expect(scopedClient.releaseMessagingRun).toHaveBeenCalledOnce();
    expect(vi.mocked(runMessagingAgent).mock.calls[0][1].client).toBe(scopedClient);
    expect(withOnBehalfOfTenant).toHaveBeenCalledExactlyOnceWith(42);
    expect(client.acquireMessagingRun).not.toHaveBeenCalled();
    expect(client.releaseMessagingRun).not.toHaveBeenCalled();
  });

  it('release 가 준 테넌트 이벤트도 처음 스코프한 client 로 실행하고 반납한다', async () => {
    const next = ev(28, 'HUMAN', { channelId: 207, tenantId: 42 });
    const acquire = async () => ({ status: 'ACQUIRED', token: 'tk' });
    const releases = [{ next }, { next: null }];
    const { client } = fakeDeps(acquire, releases);
    const { client: scopedClient } = fakeDeps(acquire, releases);
    const withOnBehalfOfTenant = vi.fn(() => scopedClient);
    const deps = { client: { ...client, withOnBehalfOfTenant } } as unknown as EventHandlerDeps;
    const env = ev(27, 'HUMAN', { channelId: 207, tenantId: 42 });

    const p = handleMessagingEvent(env, deps);
    await flush();
    finishers.shift()?.();
    await flush();
    finishers.shift()?.();
    await p;

    expect(runMessagingAgent).toHaveBeenCalledTimes(2);
    const [nextEnv, nextDeps] = vi.mocked(runMessagingAgent).mock.calls[1];
    expect(nextEnv).toEqual(next);
    expect(nextDeps.client).toBe(scopedClient);
    expect(scopedClient.acquireMessagingRun).toHaveBeenCalledOnce();
    expect(scopedClient.releaseMessagingRun).toHaveBeenCalledTimes(2);
    expect(withOnBehalfOfTenant).toHaveBeenCalledTimes(2);
    expect(withOnBehalfOfTenant).toHaveBeenNthCalledWith(1, 42);
    expect(withOnBehalfOfTenant).toHaveBeenNthCalledWith(2, 42);
  });

  it('구버전 이벤트의 release 가 테넌트 이벤트를 주면 그 이벤트의 테넌트 client 로 실행한다', async () => {
    const next = ev(30, 'HUMAN', { channelId: 208, tenantId: 43 });
    const acquire = async () => ({ status: 'ACQUIRED', token: 'tk' });
    const { client: baseClient } = fakeDeps(acquire, [{ next }]);
    const { client: scopedClient } = fakeDeps(acquire);
    const withOnBehalfOfTenant = vi.fn(() => scopedClient);
    const deps = { client: { ...baseClient, withOnBehalfOfTenant } } as unknown as EventHandlerDeps;

    const p = handleMessagingEvent(ev(29, 'HUMAN', { channelId: 208 }), deps)!;
    await flush();
    finishers.shift()?.();
    await flush();
    finishers.shift()?.();
    await p;

    const calls = vi.mocked(runMessagingAgent).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1].client).toBe(deps.client);
    expect(calls[1][0]).toEqual(next);
    expect(calls[1][1].client).toBe(scopedClient);
    expect(withOnBehalfOfTenant).toHaveBeenCalledExactlyOnceWith(43);
    expect(baseClient.releaseMessagingRun).toHaveBeenCalledOnce();
    expect(scopedClient.acquireMessagingRun).not.toHaveBeenCalled();
    expect(scopedClient.releaseMessagingRun).toHaveBeenCalledOnce();
  });

  it('테넌트 이벤트의 release 가 구버전 이벤트를 주면 기본 client 로 실행한다', async () => {
    const next = ev(32, 'HUMAN', { channelId: 209 });
    const acquire = async () => ({ status: 'ACQUIRED', token: 'tk' });
    const { client: baseClient } = fakeDeps(acquire);
    const { client: scopedClient } = fakeDeps(acquire, [{ next }]);
    const withOnBehalfOfTenant = vi.fn(() => scopedClient);
    const deps = { client: { ...baseClient, withOnBehalfOfTenant } } as unknown as EventHandlerDeps;

    const p = handleMessagingEvent(ev(31, 'HUMAN', { channelId: 209, tenantId: 43 }), deps)!;
    await flush();
    finishers.shift()?.();
    await flush();
    finishers.shift()?.();
    await p;

    const calls = vi.mocked(runMessagingAgent).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1].client).toBe(scopedClient);
    expect(calls[1][0]).toEqual(next);
    expect(calls[1][1].client).toBe(deps.client);
    expect(withOnBehalfOfTenant).toHaveBeenCalledExactlyOnceWith(43);
    expect(scopedClient.releaseMessagingRun).toHaveBeenCalledOnce();
    expect(baseClient.acquireMessagingRun).not.toHaveBeenCalled();
    expect(baseClient.releaseMessagingRun).toHaveBeenCalledOnce();
  });

  it('인라인 멘션(스레드 없음)은 parentMessageId 를 null 로 보낸다', async () => {
    const { client, deps } = fakeDeps(async () => ({ status: 'QUEUED' }));
    await handleMessagingEvent(ev(21, 'HUMAN', { channelId: 202 }), deps);
    expect(client.acquireMessagingRun.mock.calls[0][0]).toEqual({ channelId: 202, parentMessageId: null, agentId: 9 });
    expect(runMessagingAgent).not.toHaveBeenCalled();
    expect(client.releaseMessagingRun).not.toHaveBeenCalled();
  });

  it('release 가 준 밀린 이벤트는 검증한 envelope 로, 같은 deps 로 다시 실행한다', async () => {
    const next = ev(23, 'HUMAN', { channelId: 203 });
    const { client, deps } = fakeDeps(async () => ({ status: 'ACQUIRED', token: 'tk' }), [{ next }, { next: null }]);
    const p = handleMessagingEvent(ev(22, 'HUMAN', { channelId: 203 }), deps)!;
    await flush();
    finishers.shift()?.();
    await flush();
    expect(runMessagingAgent).toHaveBeenCalledTimes(2);
    const [env2, deps2] = vi.mocked(runMessagingAgent).mock.calls[1];
    expect(env2.payload.messageId).toBe(23);
    expect(deps2).toBe(deps);
    finishers.shift()?.();
    await p;
    expect(client.releaseMessagingRun).toHaveBeenCalledTimes(2);
  });

  it('검증 못 한 밀린 이벤트는 버리고 임대를 다시 반납한다', async () => {
    const { client, deps } = fakeDeps(async () => ({ status: 'ACQUIRED', token: 'tk' }), [
      { next: { type: 'messaging.message.posted', payload: { broken: true } } },
      { next: null },
    ]);
    const p = handleMessagingEvent(ev(24, 'HUMAN', { channelId: 204 }), deps)!;
    await flush();
    finishers.shift()?.();
    await p;
    expect(runMessagingAgent).toHaveBeenCalledTimes(1);
    expect(client.releaseMessagingRun).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalled();
  });

  it('다시 반납 상한(10회)에 닿으면 임대가 만료까지 남는다는 경고를 따로 한 번 남긴다', async () => {
    const broken = { next: { type: 'messaging.message.posted', payload: { broken: true } } };
    const { client, deps } = fakeDeps(
      async () => ({ status: 'ACQUIRED', token: 'tk' }),
      Array.from({ length: 10 }, () => broken),
    );
    const p = handleMessagingEvent(ev(25, 'HUMAN', { channelId: 205 }), deps)!;
    await flush();
    finishers.shift()?.();
    await p;
    expect(client.releaseMessagingRun).toHaveBeenCalledTimes(10);
    const capWarns = vi.mocked(console.warn).mock.calls.filter((c) => String(c[0]).includes('상한'));
    expect(capWarns).toHaveLength(1);
  });
});
