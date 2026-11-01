// 변경 스트림(SSE) — agent-runtime.changed 만 조정 트리거로 넘기고, 끊기면 다시 붙는다.
import { describe, expect, it, vi } from 'vitest';
import { parseSseEvents, runEventStream } from './events.js';

/** 주어진 조각들을 차례로 흘리고 닫는 SSE 응답. */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(status === 200 ? body : null, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const silentLog = { info: () => {}, warn: () => {}, error: () => {} };

describe('parseSseEvents', () => {
  it('splitsEventsAndIgnoresComments', () => {
    const { events, rest } = parseSseEvents(
      ':connected\n\n:ping\n\nevent:agent-runtime.changed\r\ndata:{"locationId":3}\r\n\r\nevent: other\ndata: x\n\nevent:agent-run',
    );
    expect(events).toEqual([
      { event: 'agent-runtime.changed', data: '{"locationId":3}' },
      { event: 'other', data: 'x' },
    ]);
    expect(rest).toBe('event:agent-run');
  });
});

describe('runEventStream', () => {
  it('triggersReconcileOnChangedEvent', async () => {
    const controller = new AbortController();
    const onChange = vi.fn(() => controller.abort());
    const fetchImpl = vi.fn(async () =>
      sseResponse([':connected\n\n', ':ping\n\n', 'event:other\ndata:{}\n\n', 'event:agent-runtime.changed\ndata:{"locationId":3}\n\n']),
    );

    await runEventStream({
      url: 'https://works.example.test/api/v1/agent-runtime/runner/events',
      token: 'rt_secret',
      fetchImpl,
      onChange,
      sleep: async () => {},
      signal: controller.signal,
      log: silentLog,
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://works.example.test/api/v1/agent-runtime/runner/events');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer rt_secret');
  });

  it('reconnectsAfterServerClose', async () => {
    const controller = new AbortController();
    const onChange = vi.fn(() => controller.abort());
    const responses = [
      // 30분이 되어 서버가 닫음
      sseResponse([':connected\n\n', ':ping\n\n']),
      // 네트워크 오류 한 번
      new Error('ECONNRESET'),
      // 다시 붙은 뒤 이벤트
      sseResponse([':connected\n\n', 'event:agent-runtime.changed\ndata:{}\n\n']),
    ];
    const fetchImpl = vi.fn(async () => {
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('unexpected extra connect');
      return next;
    });
    const sleeps: number[] = [];

    await runEventStream({
      url: 'u',
      token: 't',
      fetchImpl,
      onChange,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      signal: controller.signal,
      log: silentLog,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenCalledTimes(1);
    // 정상 연결 뒤 닫힘은 1초, 연속 실패는 두 배
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('reconnectsWhenStreamIdleFor90Seconds', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const encoder = new TextEncoder();
      // 첫 바이트만 오고 그 뒤로 아무것도 안 오는 멈춘 연결(닫히지도 않는다)
      const hanging = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(encoder.encode(':connected\n\n'));
            },
          }),
          { status: 200 },
        );
      const fetchImpl = vi.fn(async () => hanging());
      const sleeps: number[] = [];
      const done = runEventStream({
        url: 'u',
        token: 't',
        fetchImpl,
        onChange: () => {},
        sleep: async (ms) => {
          sleeps.push(ms);
          if (sleeps.length >= 2) controller.abort();
        },
        signal: controller.signal,
        log: silentLog,
      });

      // 89초까지는 기다리고, 90초가 되면 끊고 다시 붙는다
      await vi.advanceTimersByTimeAsync(89_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(90_000);
      await done;
      // 정상으로 붙었던 연결이라 백오프는 1초로 유지
      expect(sleeps).toEqual([1000, 1000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnectsWhenHeadersNeverArrive', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      // 응답 헤더가 오지 않는 연결 — signal 이 끊길 때만 실패한다(실제 fetch 처럼)
      const fetchImpl = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')));
          }),
      );
      const sleeps: number[] = [];
      const done = runEventStream({
        url: 'u',
        token: 't',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        onChange: () => {},
        sleep: async (ms) => {
          sleeps.push(ms);
          if (sleeps.length >= 2) controller.abort();
        },
        signal: controller.signal,
        log: silentLog,
      });

      // 29초까지는 기다리고, 30초가 되면 끊고 다시 붙는다
      await vi.advanceTimersByTimeAsync(29_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(30_000);
      await done;
      // 붙지 못한 연결이라 실패 백오프(1→2초)
      expect(sleeps).toEqual([1000, 2000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waitsOneMinuteAfterUnauthorized', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => sseResponse([], 401));
    const sleeps: number[] = [];

    await runEventStream({
      url: 'u',
      token: 't',
      fetchImpl,
      onChange: () => {},
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= 2) controller.abort();
      },
      signal: controller.signal,
      log: silentLog,
    });

    expect(sleeps).toEqual([60_000, 60_000]);
  });

  it('capsBackoffAtThirtySeconds', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => {
      throw new Error('down');
    });
    const sleeps: number[] = [];

    await runEventStream({
      url: 'u',
      token: 't',
      fetchImpl,
      onChange: () => {},
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length >= 7) controller.abort();
      },
      signal: controller.signal,
      log: silentLog,
    });

    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
