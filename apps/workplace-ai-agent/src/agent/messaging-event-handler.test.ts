// WP-1490: 같은 대화의 실행은 하나만 — 실행 중 온 메시지는 끝난 뒤 가장 최근 이벤트로 한 번만 다시 실행한다.
import { describe, it, expect, vi } from 'vitest';
import { createMessagingRunner, messagingRunKey } from './messaging-event-handler.js';
import { inflightCount } from '../graceful-shutdown.js';
import type { EventHandlerDeps } from './event-handler.js';
import type { MessagingEventEnvelope } from '../types/messaging-events.js';

/** 테스트용 이벤트 — 키를 이루는 세 값과 메시지 id 만 바꿔 쓴다. */
function ev(
  messageId: number,
  opts: { channelId?: number; parent?: number | null; agent?: number } = {},
): MessagingEventEnvelope {
  return {
    type: 'messaging.message.posted',
    payload: {
      channelId: opts.channelId ?? 1,
      channelKind: 'DM',
      messageId,
      respondAsAgentId: opts.agent ?? 9,
      actor: { id: 2, name: '사용자', kind: 'HUMAN' },
      body: `메시지 ${messageId}`,
      mentions: [],
      triggerParentMessageId: opts.parent ?? null,
      occurredAt: '2026-11-11T00:00:00Z',
    },
  };
}

const deps = {} as EventHandlerDeps;

/** 손으로 끝낼 수 있는 실행기 — 시작된 실행의 메시지 id 와 끝내기 함수를 모은다. */
function manualRun() {
  const started: number[] = [];
  const finishers: Array<(ok: boolean) => void> = [];
  const run = vi.fn(
    (env: MessagingEventEnvelope) =>
      new Promise<void>((resolve, reject) => {
        started.push(env.payload.messageId);
        finishers.push((ok) => (ok ? resolve() : reject(new Error('실패'))));
      }),
  );
  return { run, started, finishers };
}

/** 마이크로태스크를 비워 다음 실행이 시작되게 한다. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('messaging 실행 합치기 (WP-1490)', () => {
  it('실행 중 같은 키로 메시지 3개가 오면 끝난 뒤 한 번만, 마지막 이벤트로 다시 실행한다', async () => {
    const { run, started, finishers } = manualRun();
    const runner = createMessagingRunner(run);

    runner.submit({ env: ev(1), deps });
    runner.submit({ env: ev(2), deps });
    runner.submit({ env: ev(3), deps });
    runner.submit({ env: ev(4), deps });
    expect(started).toEqual([1]);

    finishers[0](true);
    await flush();
    expect(started).toEqual([1, 4]);

    finishers[1](true);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(runner.activeKeys()).toBe(0);
  });

  it('다른 채널·다른 스레드·다른 AI 끼리는 서로 막지 않는다', async () => {
    const { started, finishers, run } = manualRun();
    const runner = createMessagingRunner(run);

    runner.submit({ env: ev(1), deps });
    runner.submit({ env: ev(2, { channelId: 2 }), deps });
    runner.submit({ env: ev(3, { parent: 100 }), deps });
    runner.submit({ env: ev(4, { agent: 10 }), deps });
    expect(started).toEqual([1, 2, 3, 4]);
    expect(runner.activeKeys()).toBe(4);

    finishers.forEach((f) => f(true));
    await flush();
    expect(runner.activeKeys()).toBe(0);
  });

  it('실행이 오류로 끝나도 밀린 실행이 돌고, 끝나면 키가 정리된다', async () => {
    const { started, finishers, run } = manualRun();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = createMessagingRunner(run);

    runner.submit({ env: ev(1), deps });
    runner.submit({ env: ev(2), deps });
    finishers[0](false);
    await flush();
    expect(started).toEqual([1, 2]);
    expect(errSpy).toHaveBeenCalled();

    finishers[1](false);
    await flush();
    expect(runner.activeKeys()).toBe(0);
    errSpy.mockRestore();
  });

  it('밀린 게 없으면 키를 비우고, 그 뒤 같은 키 메시지는 바로 새로 실행한다', async () => {
    const { started, finishers, run } = manualRun();
    const runner = createMessagingRunner(run);

    runner.submit({ env: ev(1), deps });
    finishers[0](true);
    await flush();
    expect(runner.activeKeys()).toBe(0);

    runner.submit({ env: ev(2), deps });
    expect(started).toEqual([1, 2]);
    finishers[1](true);
    await flush();
  });

  it('종료 대기(trackInflight)는 밀린 다시 실행까지 묶어 기다린다', async () => {
    const { finishers, run } = manualRun();
    const runner = createMessagingRunner(run);
    const before = inflightCount();

    runner.submit({ env: ev(1), deps });
    runner.submit({ env: ev(2), deps });
    expect(inflightCount()).toBe(before + 1);

    finishers[0](true);
    await flush();
    // 첫 실행은 끝났지만 밀린 실행이 도는 동안 여전히 대기 목록에 있다.
    expect(inflightCount()).toBe(before + 1);

    finishers[1](true);
    await flush();
    expect(inflightCount()).toBe(before);
  });

  it('한 실행이 상한 시간 안에 끝나지 않으면 오류로 보고 밀린 실행으로 넘어가 키가 영영 잡히지 않는다', async () => {
    const { started, finishers, run } = manualRun();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runner = createMessagingRunner(run, 20);

    runner.submit({ env: ev(1), deps });
    runner.submit({ env: ev(2), deps });
    await new Promise((r) => setTimeout(r, 40));
    expect(started).toEqual([1, 2]);
    expect(errSpy).toHaveBeenCalled();

    finishers[1](true);
    await flush();
    expect(runner.activeKeys()).toBe(0);
    finishers[0](true);
    errSpy.mockRestore();
  });

  it('대화 키 = 채널 + 스레드 부모(없으면 root) + 답할 AI', () => {
    expect(messagingRunKey(ev(1))).toBe('1:root:9');
    expect(messagingRunKey(ev(1, { channelId: 5, parent: 7, agent: 3 }))).toBe('5:7:3');
  });
});
