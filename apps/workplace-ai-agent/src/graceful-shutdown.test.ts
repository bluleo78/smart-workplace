// 무중단 종료(WP-167) — 진행 중 HTTP 요청·백그라운드 실행을 기다린 뒤 정리·종료하는지, 상한에 걸리면 버리고 종료하는지.
import { createServer, request, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { gracefulShutdown, inflightCount, trackInflight } from './graceful-shutdown.js';

/** 외부에서 끝낼 수 있는 promise — 백그라운드 실행 흉내. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** 부재 확인 창(ms) — expectNotCalledYet 만 쓴다. */
const ABSENCE_WINDOW_MS = 30;

/**
 * 부재 확인 — 창(ABSENCE_WINDOW_MS) 동안 fns 가 한 번도 불리지 않는지 창의 처음과 끝에서 본다. "아직 정리·종료하지 않았다"는 일정 시간
 * 아무 일도 없음을 봐야 해 고정 창이 불가피하다 — 그 창을 이 한 곳에 모은다. 기다리는 대상(실행·응답)이 끝나지 않은 채라 올바른 종료
 * 절차는 이 창이 아무리 길어도 부르지 않는다: 부하로 절차가 늦으면 거짓 통과할 수는 있어도 거짓 실패는 없다.
 */
async function expectNotCalledYet(...fns: Mock[]): Promise<void> {
  for (const f of fns) expect(f).not.toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, ABSENCE_WINDOW_MS));
  for (const f of fns) expect(f).not.toHaveBeenCalled();
}

describe('gracefulShutdown', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const s of servers) s.closeAllConnections();
  });

  /** 임의 포트로 띄운 테스트 서버와 포트. afterEach 가 남은 연결을 닫는다. */
  async function startServer(handler?: RequestListener) {
    const server = handler ? createServer(handler) : createServer();
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, () => r()));
    return { server, port: (server.address() as AddressInfo).port };
  }

  it('백그라운드 실행이 끝난 뒤에 정리하고 0 으로 종료한다', async () => {
    const { server } = await startServer();
    const job = deferred();
    trackInflight(job.promise);
    const cleanup = vi.fn();
    const exit = vi.fn();

    const done = gracefulShutdown({ server, drainTimeoutMs: 5_000, cleanup, exit, log: () => {} });
    // 실행이 남아 있는 동안은 정리(opencode 종료)도 종료도 하지 않는다
    await expectNotCalledYet(cleanup, exit);

    job.resolve();
    await done;
    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect(inflightCount()).toBe(0);
  });

  it('진행 중인 HTTP 응답(SSE 등)이 끝날 때까지 기다린다', async () => {
    let finish!: () => void;
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: start\n\n');
      finish = () => res.end('data: end\n\n');
    });
    // 응답이 시작됐다는 사건(클라이언트가 헤더를 받음)을 기다린다 — 시간(30ms)으로 기다리면 부하에서 요청이 서버에 닿기 전에 종료가
    // 시작돼, 진행 중 응답이 없는 채로(대기할 것 없이) 바로 종료됐다.
    let started!: () => void;
    const responding = new Promise<void>((r) => (started = r));
    const body = new Promise<string>((resolve, reject) => {
      request({ host: '127.0.0.1', port, path: '/' }, (res) => {
        started();
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
        res.on('error', reject);
      })
        .on('error', reject)
        .end();
    });
    await responding;
    const exit = vi.fn();

    const done = gracefulShutdown({ server, drainTimeoutMs: 5_000, cleanup: () => {}, exit, log: () => {} });
    // 응답을 끝내기 전에는 종료하지 않는다 — 아직 끝나지 않은 응답이라 부하와 무관하게 성립한다(종료가 응답을 기다리지 않는 결함이면
    // 리스너를 닫은 직후 몇 틱 안에 exit 가 불린다).
    await expectNotCalledYet(exit);

    finish();
    await done;
    expect(await body).toContain('data: end');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('대기 상한에 걸리면 남은 실행을 버리고 정리 후 1 로 종료한다', async () => {
    const { server } = await startServer();
    const job = deferred();
    trackInflight(job.promise);
    const cleanup = vi.fn();
    const exit = vi.fn();

    await gracefulShutdown({ server, drainTimeoutMs: 50, cleanup, exit, log: () => {} });

    expect(cleanup).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
    job.resolve();
  });

  it('trackInflight 는 받은 promise 를 그대로 돌려주고, 실패해도 대기 목록에서 빠진다', async () => {
    const failing = Promise.reject(new Error('boom'));
    const tracked = trackInflight(failing);
    expect(tracked).toBe(failing);
    await expect(tracked).rejects.toThrow('boom');
    await Promise.resolve();
    expect(inflightCount()).toBe(0);
  });
});
