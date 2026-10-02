// 무중단 종료(WP-167) — 진행 중 HTTP 요청·백그라운드 실행을 기다린 뒤 정리·종료하는지, 상한에 걸리면 버리고 종료하는지.
import { createServer, request, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gracefulShutdown, inflightCount, trackInflight } from './graceful-shutdown.js';

/** 외부에서 끝낼 수 있는 promise — 백그라운드 실행 흉내. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** 이벤트 루프를 잠깐 넘겨 "아직 종료하지 않음"을 확인할 여유를 준다. */
const tick = () => new Promise((r) => setTimeout(r, 30));

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
    await tick();
    // 실행이 남아 있는 동안은 정리(opencode 종료)도 종료도 하지 않는다
    expect(cleanup).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();

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
    const body = new Promise<string>((resolve) => {
      request({ port, path: '/' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      }).end();
    });
    await tick(); // 응답 시작까지
    const exit = vi.fn();

    const done = gracefulShutdown({ server, drainTimeoutMs: 5_000, cleanup: () => {}, exit, log: () => {} });
    await tick();
    expect(exit).not.toHaveBeenCalled();

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
