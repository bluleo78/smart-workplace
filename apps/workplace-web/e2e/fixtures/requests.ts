// 요청 기록 fixture (WP-239).
// 스펙이 라우트 핸들러 안에서 직접 카운터를 올리면, 같은 URL 을 나중에 다시 page.route 한 핸들러가 먼저 응답해
// (Playwright 는 나중 등록 핸들러부터 실행) 앞 카운터가 조용히 멈춘다 → "요청 0번" 부재 확인이 거짓 통과할 수 있다.
// 여기서는 page.on('request') 로 브라우저가 보낸 요청 자체를 센다 — 어떤 라우트가 응답하든(또는 안 하든) 빠짐없이 잡힌다.
// 모킹(page.route·mockApi)은 응답만 맡고, "몇 번·무엇을 보냈나"는 이 tracker 가 맡는다.
import type { Page, Request } from '@playwright/test';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/** 경로 일치 조건 — 문자열은 pathname 완전 일치, 정규식은 pathname 검사, 함수는 URL·요청 전체를 받는다. */
export type PathMatcher = string | RegExp | ((url: URL, req: Request) => boolean);

export interface RequestTracker {
  /** 지금까지 기록된 요청 수 — expectStays(page, tracker.count, n) 처럼 함수째 넘긴다. */
  count: () => number;
  /** 기록된 요청 원본(순서대로). */
  requests: () => Request[];
  /** 요청 본문 JSON(본문이 없으면 null, JSON 이 아니면 원문 문자열). */
  bodies: <T = unknown>() => T[];
  /** 마지막 요청 본문 JSON. */
  lastBody: <T = unknown>() => T | undefined;
  /** 요청 URL(쿼리 확인용). */
  urls: () => URL[];
  /** 마지막 요청 URL — `lastUrl()?.searchParams.get('q')`. */
  lastUrl: () => URL | undefined;
  /** 요청이 누적 n 번(기본 1) 이상 기록될 때까지 기다린다. 도착 즉시 풀린다. */
  waitFor: (n?: number, opts?: { timeout?: number }) => Promise<void>;
}

function matches(matcher: PathMatcher, url: URL, req: Request): boolean {
  if (typeof matcher === 'string') return url.pathname === matcher;
  if (matcher instanceof RegExp) return matcher.test(url.pathname);
  return matcher(url, req);
}

/** 요청 본문 JSON — 본문이 없으면 null, JSON 이 아니면 원문. */
export function bodyOf(req: Request): unknown {
  try {
    return req.postDataJSON();
  } catch {
    return req.postData() ?? null;
  }
}

/**
 * method + 경로가 맞는 요청을 기록하기 시작한다. 기록은 호출 시점부터이므로 goto·동작 전에 만든다.
 *
 *   const patches = trackRequests(page, 'PATCH', `/api/v1/issues/${ID}`)
 *   ... 동작 ...
 *   await expectStays(page, patches.count, 0)
 *   expect(patches.lastBody()).toMatchObject({ title: '새 제목' })
 */
export function trackRequests(page: Page, method: HttpMethod | 'ANY', path: PathMatcher): RequestTracker {
  const hits: Request[] = [];
  // waitFor 대기자 — 기록될 때마다 목표 횟수에 닿은 대기자를 바로 깨운다(폴링 간격만큼 늦지 않게).
  const waiters = new Set<{ n: number; resolve: () => void }>();
  page.on('request', (req) => {
    if (method !== 'ANY' && req.method() !== method) return;
    if (!matches(path, new URL(req.url()), req)) return;
    hits.push(req);
    for (const w of waiters) if (hits.length >= w.n) w.resolve();
  });
  const last = () => hits[hits.length - 1];
  return {
    count: () => hits.length,
    requests: () => [...hits],
    bodies: <T>() => hits.map((r) => bodyOf(r) as T),
    lastBody: <T>() => (last() ? (bodyOf(last()) as T) : undefined),
    urls: () => hits.map((r) => new URL(r.url())),
    lastUrl: () => (last() ? new URL(last().url()) : undefined),
    waitFor: (n = 1, { timeout = 10_000 } = {}) => {
      if (hits.length >= n) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = {
          n,
          resolve: () => {
            clearTimeout(timer);
            waiters.delete(waiter);
            resolve();
          },
        };
        const timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`${method} ${String(path)} 요청 ${n}회 대기 시간 초과(${timeout}ms) — 실제 ${hits.length}회`));
        }, timeout);
        waiters.add(waiter);
      });
    },
  };
}
