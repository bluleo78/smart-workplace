// #335: AI 응답 스트리밍 중단 버튼 E2E.
// 홈 도크 compose SSE 스트리밍 중 '중단' 버튼 클릭 → AbortController.abort() 로 fetch 종료.
// 검증: (1) 스트리밍 중 '중단' 버튼 노출, (2) 클릭 시 부분 응답(이미 받은 delta) 보존,
//       (3) pending 종료(보내기 복귀), (4) 에러 버블 미표시.
//
// 전략: fetch 를 addInitScript 로 몽키패치 — compose 응답을 ReadableStream 으로 제어한다.
//   delta 1개를 흘린 뒤 done 없이 연결을 열어두고(abort 신호 대기), 사용자가 중단할 때까지 유지.
//   클라이언트 abort() → init.signal 발화 → 스트림 종료. (global-chat.spec.ts 의 #333 패턴 재사용.)

import { expect, test } from '../fixtures/auth.fixture';

test(
  'AI 응답 스트리밍 중 중단 버튼 클릭 → 부분 응답 보존 + 입력 재개',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (!url.includes('/api/v1/ai/compose') || (init?.method ?? 'GET') !== 'POST') {
          return originalFetch(input, init);
        }
        const signal = init?.signal ?? undefined;
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            // 1) delta 1개 — 부분 응답을 화면에 누적.
            controller.enqueue(enc.encode('event: delta\ndata: {"text":"부분 응답입니다"}\n\n'));
            // 2) done 없이 연결 유지 — 사용자가 중단(abort)할 때까지 스트림을 열어둔다.
            //    클라이언트 abort() 시 init.signal 이 발화하면 스트림을 닫는다.
            if (signal) {
              signal.addEventListener(
                'abort',
                () => {
                  try {
                    controller.close();
                  } catch {
                    /* 이미 닫힘 */
                  }
                },
                { once: true },
              );
            }
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      };
    });

    await page.goto('/');
    await page.getByTestId('chat-launcher').click();

    // 질의 제출 → 스트리밍 시작.
    await page.getByTestId('chat-input').fill('긴 작업 시작해줘');
    await page.getByRole('button', { name: '보내기' }).click();

    // 1) 부분 응답 delta 가 도착해 렌더된다.
    await expect(page.getByTestId('chat-panel')).toContainText('부분 응답입니다');

    // 2) 스트리밍 중이므로 '중단' 버튼이 노출된다('보내기'는 사라짐).
    const stopBtn = page.getByTestId('chat-stop');
    await expect(stopBtn).toBeVisible();
    await expect(page.getByRole('button', { name: '보내기' })).toHaveCount(0);

    // 3) 중단 클릭 → abort.
    await stopBtn.click();

    // 4) 부분 응답은 보존되고(커밋), 입력이 재개된다('보내기' 복귀 / '중단' 사라짐).
    await expect(page.getByTestId('chat-panel')).toContainText('부분 응답입니다');
    await expect(page.getByRole('button', { name: '보내기' })).toBeVisible();
    await expect(page.getByTestId('chat-stop')).toHaveCount(0);

    // 5) 중단은 정상 흐름 — 에러 안내 버블이 뜨지 않는다.
    await expect(page.getByTestId('chat-panel')).not.toContainText('응답 생성에 실패했습니다');
  },
);
