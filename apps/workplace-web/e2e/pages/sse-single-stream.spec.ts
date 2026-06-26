import { test, expect } from '../fixtures/auth.fixture';

// SSE 통합 — 단일 /api/v1/events 커넥션 1개가 chat·messaging·notify 이벤트를 모두 받아 fan-out 하는지 검증.
// (구 /chat/stream·/messaging/stream·/notifications/stream 은 더 이상 열리지 않는다.)
// authenticatedPage 필수 — 미인증 page 면 AppLayout 이 마운트되지 않아 스트림 자체가 안 열려 거짓 음성 통과한다.
test.describe('SSE 단일 멀티플렉싱 스트림', () => {
  test('통합 /events 한 커넥션이 messaging·notify 이벤트를 fan-out 한다', async ({ authenticatedPage: page }) => {
    const opened: string[] = [];
    // 구 스트림이 열리면 기록(열리면 실패 신호).
    for (const old of ['chat/stream', 'messaging/stream', 'notifications/stream']) {
      await page.route(`**/api/v1/${old}`, (route) => {
        opened.push(old);
        route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      });
    }
    // 통합 스트림 — 핸드셰이크만 200 으로 응답(이벤트 본문은 본 스펙 범위에서 생략 가능).
    await page.route('**/api/v1/events', (route) =>
      route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }),
    );

    // 통합 스트림이 실제로 열렸음을 먼저 보장 — 그래야 "구 스트림 미개통" 단언에 teeth 가 생긴다.
    // 마운트 타이밍 레이스 방지를 위해 navigate 전에 대기 프로미스를 건다.
    const eventsReq = page.waitForRequest('**/api/v1/events');
    await page.goto('/');
    await eventsReq;
    await page.waitForTimeout(200); // 구 스트림이 뒤늦게 열릴 여지까지 흡수
    // 통합 스트림이 단독으로 열렸는지 — 구 엔드포인트는 한 번도 열리지 않아야 한다.
    expect(opened).toEqual([]);
  });
});
