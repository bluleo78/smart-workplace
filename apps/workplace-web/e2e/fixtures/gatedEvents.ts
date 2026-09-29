// /api/v1/events 게이트 SSE 모킹 공용 픽스처 (WP-59).
import type { Page } from '@playwright/test';

/**
 * /api/v1/events 를 게이트된 단일 프레임으로 모킹한다.
 * - deliver() 이전에 도착한 요청은 보류한다. StrictMode 이중 마운트로 첫 연결 요청이 2번 올 수 있어(앞선 것은 취소됨)
 *   '몇 번째 요청인가'가 아니라 '릴리스 이전에 도착했는가'로 구분한다.
 * - deliver(body) 시 보류 요청이 그 본문으로 응답한다.
 * - deliver() 이후 도착하는 재연결 요청은 abort 한다. 유한 본문 SSE 는 응답 직후 종료되어 클라이언트가 재연결하는데,
 *   재연결 catch-up(활성 쿼리 전체 재조회)이 스텁 없는 API 를 때리거나 resource.changed 분기가 없어도 테스트가 통과해 버리기 때문이다.
 * 호출 측은 화면이 첫 렌더·캐시 준비를 마친 것을 확인한 뒤에만 deliver() 해야 한다 — 그 전에 프레임이 오면 무효화할 캐시가 없어 검증이 무의미해진다.
 */
export async function mockGatedEvents(page: Page): Promise<{ deliver(body: string): void }> {
  let open!: (body: string) => void;
  const gate = new Promise<string>((r) => (open = r));
  let delivered = false;
  await page.route(
    (url) => url.pathname === '/api/v1/events',
    async (route) => {
      if (delivered) return route.abort();
      const body = await gate;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache' },
        body,
      });
    },
  );
  return {
    deliver: (body) => {
      delivered = true; // 이후 도착하는 재연결 요청은 abort
      open(body);
    },
  };
}
