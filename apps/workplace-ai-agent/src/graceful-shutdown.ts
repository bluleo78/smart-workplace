// 무중단 종료(WP-167) — SIGTERM 을 받으면 새 요청은 받지 않고, 진행 중인 HTTP 요청(SSE 포함)과 202 로 먼저 응답한 뒤 계속 도는
// 백그라운드 에이전트 실행이 끝날 때까지 기다린 다음 정리하고 종료한다.
//
// 왜: 롤링 배포로 구 파드를 내릴 때 진행 중인 채팅 응답·이슈 코멘트 작성이 끊기면 사용자는 답을 못 받는다. 예전에는 opencode 서버를 먼저
// 닫고 5초 뒤 강제 종료해 실행 중이던 작업이 즉시 잘렸다. 대기 상한은 쿠버네티스 terminationGracePeriodSeconds 안에 들어오게 잡는다(넘으면
// SIGKILL).
import type { Server } from 'node:http';

/** 진행 중인 백그라운드 실행 — 202 응답 후 이어지는 작업은 HTTP 연결로 추적되지 않으므로 따로 센다. */
const inflight = new Set<Promise<unknown>>();

/** 백그라운드 실행을 종료 대기 대상으로 등록한다. 받은 promise 를 그대로 돌려준다(호출부의 .catch 체인 유지). */
export function trackInflight<T>(p: Promise<T>): Promise<T> {
  inflight.add(p);
  const done = () => inflight.delete(p);
  p.then(done, done);
  return p;
}

/** 지금 진행 중인 백그라운드 실행 수. */
export function inflightCount(): number {
  return inflight.size;
}

/** 등록된 백그라운드 실행이 모두 끝날 때까지 기다린다(대기 중 새로 등록된 것도 포함). */
async function drainInflight(): Promise<void> {
  while (inflight.size > 0) {
    await Promise.allSettled([...inflight]);
  }
}

/** 리스너를 닫고 열린 연결이 모두 끝나면 resolve — Node 19+ 는 유휴 keep-alive 연결은 즉시 닫는다. */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export interface ShutdownDeps {
  server: Server;
  /** 진행 중 작업을 기다릴 최대 시간(ms) — 넘으면 남은 작업을 버리고 종료한다. */
  drainTimeoutMs: number;
  /** 대기가 끝난 뒤 실행할 정리(opencode 서버·자식 프로세스 종료). */
  cleanup: () => void;
  exit: (code: number) => void;
  log?: (msg: string) => void;
}

/**
 * 무중단 종료 절차 — ① 리스너 닫기(새 요청 거절) ② HTTP 연결·백그라운드 실행 대기(상한 drainTimeoutMs) ③ cleanup ④ exit.
 * 다 끝나면 0, 상한에 걸리면 1 로 종료한다.
 */
export async function gracefulShutdown(deps: ShutdownDeps): Promise<void> {
  const log = deps.log ?? ((m: string) => console.log(m));
  log(`[ai-agent] 종료 시작 — 진행 중 백그라운드 실행 ${inflightCount()}건 대기(최대 ${deps.drainTimeoutMs}ms)`);

  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), deps.drainTimeoutMs);
  });
  const drained = Promise.all([closeServer(deps.server), drainInflight()]).then(() => false);
  const hitLimit = await Promise.race([drained, timedOut]);
  clearTimeout(timer);

  if (hitLimit) {
    log(`[ai-agent] 종료 대기 상한 도달 — 남은 백그라운드 실행 ${inflightCount()}건을 버리고 종료`);
  } else {
    log('[ai-agent] 진행 중 작업 완료 — 종료');
  }
  deps.cleanup();
  deps.exit(hitLimit ? 1 : 0);
}
