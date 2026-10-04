import type { Page, Request } from '@playwright/test';

import { bodyOf, type HttpMethod, trackRequests } from './requests';

/** 캡처된 요청 정보 */
interface CapturedRequest {
  payload: unknown;
  url: URL;
  searchParams: URLSearchParams;
}

/** mockApi capture: true 반환 타입 */
export interface MockApiCapture {
  /** 캡처된 모든 요청 배열 */
  requests: CapturedRequest[];
  /** 마지막 캡처된 요청 */
  lastRequest: () => CapturedRequest | undefined;
  /** 다음 요청이 올 때까지 대기 (최대 10초) */
  waitForRequest: () => Promise<CapturedRequest>;
}

interface MockApiOptions {
  status?: number;
  headers?: Record<string, string>;
  /** true로 설정하면 MockApiCapture 객체를 반환하여 요청 캡처가 가능하다 */
  capture?: boolean;
}

/**
 * API 엔드포인트를 모킹한다. capture: true 옵션 사용 시 요청을 캡처할 수 있다.
 * @returns capture: true인 경우 MockApiCapture 반환, 아니면 void
 */
export async function mockApi(
  page: Page,
  method: HttpMethod,
  path: string,
  body: unknown,
  options: MockApiOptions & { capture: true },
): Promise<MockApiCapture>;
export async function mockApi(
  page: Page,
  method: HttpMethod,
  path: string,
  body: unknown,
  options?: MockApiOptions,
): Promise<void>;
export async function mockApi(
  page: Page,
  method: HttpMethod,
  path: string,
  body: unknown,
  options: MockApiOptions = {},
): Promise<MockApiCapture | void> {
  const { status = 200, headers = {}, capture = false } = options;
  // 캡처는 라우트 핸들러가 아니라 요청 기록(trackRequests)으로 한다 — 같은 경로를 나중에 다시 모킹해도 빠지지 않는다(WP-239).
  const tracker = capture ? trackRequests(page, method, path) : null;

  await page.route(
    (url) => url.pathname === path,
    (route) => {
      if (route.request().method() !== method) {
        return route.fallback();
      }
      return route.fulfill({
        status,
        contentType: 'application/json',
        headers,
        body: JSON.stringify(body),
      });
    },
  );

  if (tracker) {
    const toCaptured = (req: Request): CapturedRequest => {
      const url = new URL(req.url());
      return { payload: bodyOf(req), url, searchParams: url.searchParams };
    };
    return {
      get requests() {
        return tracker.requests().map(toCaptured);
      },
      lastRequest: () => {
        const all = tracker.requests();
        return all.length ? toCaptured(all[all.length - 1]) : undefined;
      },
      waitForRequest: async () => {
        await tracker.waitFor();
        const all = tracker.requests();
        return toCaptured(all[all.length - 1]);
      },
    };
  }
}

/**
 * 여러 API 엔드포인트를 한 번에 모킹한다.
 */
export async function mockApis(
  page: Page,
  mocks: Array<{ method: HttpMethod; path: string; body: unknown; options?: MockApiOptions }>,
): Promise<void> {
  for (const mock of mocks) {
    await mockApi(page, mock.method, mock.path, mock.body, mock.options);
  }
}

/**
 * Spring Boot PageResponse 형태의 응답 객체를 생성한다.
 */
export function createPageResponse<T>(
  content: T[],
  overrides?: { page?: number; size?: number; totalElements?: number; totalPages?: number },
) {
  const page = overrides?.page ?? 0;
  const size = overrides?.size ?? 10;
  const totalElements = overrides?.totalElements ?? content.length;
  const totalPages = overrides?.totalPages ?? Math.ceil(totalElements / size);
  return { content, page, size, totalElements, totalPages };
}
