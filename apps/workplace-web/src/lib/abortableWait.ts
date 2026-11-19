/**
 * 취소할 수 있는 대기 도구 — 타이머 대기(sleep)와 온라인 복귀 대기(waitForOnline).
 * 드라이브 나눠 올리기(chunkedUpload)와 메일 첨부 자동 재시도(api/mailMessages)가 같은 방식으로 쓴다.
 * signal 이 끊기면 axios 취소 오류(CanceledError)로 reject 해, 호출부가 axios.isCancel 로 취소를 가려 낸다.
 */
import { CanceledError } from 'axios';

/**
 * 취소 가능한 대기 한 번 — register 가 리스너·타이머를 걸고 「끝났다」 콜백을 받아 정리 함수를 돌려준다.
 * 이미 취소된 signal 이면 바로 reject, 대기 중 취소되면 정리 후 reject 한다.
 */
export function abortable(signal: AbortSignal | undefined, register: (done: () => void) => () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CanceledError());
      return;
    }
    const onAbort = () => {
      cleanup();
      reject(new CanceledError());
    };
    const cleanup = register(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** ms 만큼 기다린다. signal 이 끊기면 타이머를 풀고 즉시 reject 한다. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return abortable(signal, (done) => {
    const t = setTimeout(done, ms);
    return () => clearTimeout(t);
  });
}

/**
 * 온라인이면 바로, 오프라인이면 다시 온라인(online 이벤트)이 될 때까지 기다린다.
 * 짧은 끊김에 재시도 횟수를 허비하지 않게 하려는 것이다. signal 이 끊기면 즉시 reject 한다.
 */
export function waitForOnline(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    return signal?.aborted ? Promise.reject(new CanceledError()) : Promise.resolve();
  }
  return abortable(signal, (done) => {
    const onOnline = () => {
      window.removeEventListener('online', onOnline);
      done();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  });
}
