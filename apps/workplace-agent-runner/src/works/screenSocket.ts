// 작업 화면 소켓(WP-1277) — Works 의 GET /api/v1/agent-runtime/runner/screen/{sessionId} 로 WebSocket 을 연다(runner 토큰 Bearer).
// 실행 환경 쪽에서 바깥(Works)으로만 여는 연결이다. 붙는 데 10초가 넘으면 포기한다(Works 는 15초 안에 runner 가 안 붙으면 관리자에게 알린다).
import WebSocket from 'ws';
import type { ScreenSocket } from '../screen.js';

const CONNECT_TIMEOUT_MS = 10_000;

/** http(s) origin → ws(s) 주소. */
export function screenSocketUrl(worksUrl: string, sessionId: string): string {
  return `${worksUrl.replace(/^http/, 'ws')}/api/v1/agent-runtime/runner/screen/${encodeURIComponent(sessionId)}`;
}

export function connectScreenSocket(worksUrl: string, token: string, sessionId: string): Promise<ScreenSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(screenSocketUrl(worksUrl, sessionId), {
      headers: { Authorization: `Bearer ${token}` },
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      // Works 가 큰 tmux 화면을 한 번에 보낼 수 있다 — 기본(100MiB)이면 충분하지만 상한을 둔다.
      maxPayload: 1024 * 1024,
    });
    ws.once('open', () =>
      resolve({
        send: (data) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: typeof data !== 'string' });
        },
        close: (code, reason) => ws.close(code, reason),
        onMessage: (cb) => ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => cb(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer), isBinary)),
        onClose: (cb) => ws.on('close', cb),
      }),
    );
    // 응답 본문·헤더는 쓰지 않는다 — 상태 코드만(토큰이 되돌아오는 일은 없지만 원문을 로그로 옮기지 않는 규칙대로).
    ws.once('unexpected-response', (_req, res) => {
      ws.terminate();
      reject(new Error(`작업 화면 소켓 거절 HTTP ${res.statusCode}`));
    });
    ws.once('error', (e) => reject(new Error(e.message.split('\n')[0].slice(0, 200))));
  });
}
