import dns from 'node:dns';
import net from 'node:net';

/**
 * 테스트 서버의 임시 포트 listen 을 127.0.0.1 에 묶는다 — vitest setupFiles 로 테스트 프로세스에서만 건다(운영 진입점은 그대로).
 *
 * 왜(포트 가로채기): macOS 는 임시 포트를 전역 순번으로 나눠 주고, 주소를 주지 않은 listen(0)(와일드카드 ::)은 "같은 주소+포트"만
 * 피한다(SO_REUSEADDR). 그래서 다른 프로세스가 127.0.0.1:P 를 쥐고 있어도(다른 테스트의 127.0.0.1 서버, 이 기계의 가상화 프록시·앱 등)
 * 순번이 한 바퀴(약 16,000번 할당) 돌면 와일드카드 listen(0) 이 같은 P 를 받는다. 이때 127.0.0.1:P 로 보낸 요청은 더 구체적인 쪽 — 남의
 * 서버 — 가 받는다(빈 본문 403·404 → MCP 클라이언트 "Error POSTing to endpoint: ", 프록시가 끊으면 ECONNRESET). 전체 테스트를 병렬로
 * 돌리면 연결마다 임시 포트를 쓰므로 한 바퀴가 금방 돈다 — 부하가 클수록 자주 난다(재현: 다른 프로세스·가상화 프록시가 127.0.0.1 에 쥔 포트를 받음, 고친 뒤 두 바퀴 4만 번 할당에서 겹침 0).
 * 테스트 클라이언트는 모두 127.0.0.1 로 붙으므로 서버도 127.0.0.1 에 묶으면, 같은 주소끼리의 겹침은 커널이 피하고 요청은 늘 자기 서버로 간다.
 *
 * 범위: 주소를 주지 않은 TCP 임시 포트(0 또는 생략) listen 만 — 고정 포트·주소 지정·유닉스 소켓·핸들은 손대지 않는다.
 *
 * 동기 bind 유지: 주소 없는 listen(0) 은 그 자리에서 bind 해 바로 address() 가 나온다(supertest 등이 이것에 기댄다). 주소를 주면 Node 는
 * dns.lookup 을 거쳐 다음 틱에 bind 하므로, 이 listen 호출 안에서만 127.0.0.1 조회를 그 자리에서 답해 예전처럼 동기로 bind 되게 한다
 * (loopbackListen.test.ts 가 확인한다 — Node 가 이 경로를 바꾸면 그 테스트가 깨진다).
 */
export const LOOPBACK = '127.0.0.1';

/** listen 인자에 127.0.0.1 을 넣은 것 — 범위 밖이면 그대로. */
export function withLoopback(args: unknown[]): unknown[] {
  const [first, second] = args;
  if (first !== null && typeof first === 'object') {
    // listen({ port, host, ... }) — 평범한 옵션 객체만(서버·소켓 핸들 객체는 그대로).
    if (Object.getPrototypeOf(first) !== Object.prototype) return args;
    const o = first as net.ListenOptions & { fd?: unknown; handle?: unknown };
    if (
      o.path !== undefined ||
      o.fd !== undefined ||
      o.handle !== undefined ||
      o.host !== undefined ||
      o.port
    )
      return args;
    return [{ ...o, host: LOOPBACK }, ...args.slice(1)];
  }
  // listen() · listen(콜백)
  if (first === undefined || typeof first === 'function')
    return [0, LOOPBACK, ...args.slice(first === undefined ? 1 : 0)];
  // listen(0) · listen(0, 콜백) · listen(0, backlog, 콜백) — 둘째 인자가 주소(문자열)면 이미 정한 것.
  if (first === 0 && typeof second !== 'string') return [0, LOOPBACK, ...args.slice(1)];
  return args;
}

/** 지금 listenOnLoopback 이 bind 하는 중인가 — 이때만 127.0.0.1 조회를 그 자리에서 답한다. */
let binding = false;

type LookupCallback = (
  err: Error | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;
const originalLookup = dns.lookup;
dns.lookup = function lookupLoopbackNow(this: unknown, ...args: unknown[]) {
  const [hostname, options] = args;
  if (binding && hostname === LOOPBACK) {
    const callback = args[args.length - 1] as LookupCallback;
    const all =
      typeof options === 'object' &&
      options !== null &&
      (options as dns.LookupAllOptions).all === true;
    return all ? callback(null, [{ address: LOOPBACK, family: 4 }]) : callback(null, LOOPBACK, 4);
  }
  return (originalLookup as (...a: unknown[]) => void).apply(this, args);
} as typeof dns.lookup;

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function listenOnLoopback(this: net.Server, ...args: unknown[]) {
  const listen = originalListen as (...a: unknown[]) => net.Server;
  const patched = withLoopback(args);
  if (patched === args) return listen.apply(this, args);
  binding = true;
  try {
    return listen.apply(this, patched);
  } finally {
    binding = false;
  }
} as typeof originalListen;
