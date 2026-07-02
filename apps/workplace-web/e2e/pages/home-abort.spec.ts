// #335: AI 응답 스트리밍 중단 버튼 E2E(#593 편입 — POST 는 { correlationId } 즉시 반환, 델타는
// 통합 /events 채널로 도착).
// 홈 도크 AI 응답 스트리밍 중 '중단' 버튼 클릭 → AbortController.abort() → chatStream 이
// DELETE /api/v1/ai/chat/{correlationId} 를 호출.
// 검증: (1) 스트리밍 중 '중단' 버튼 노출, (2) 클릭 시 부분 응답(이미 받은 delta) 보존,
//       (3) pending 종료(보내기 복귀), (4) 에러 버블 미표시, (5) DELETE 취소 호출.
//
// 전략: mockHomeChatGeneration(delta 만, done 없음) — POST 는 { correlationId } 즉시 반환,
//   /events 는 delta 1개만 흘리고 done 은 보내지 않아 chatStream 의 Promise 가 미결(pending)로
//   남는다 → '중단' 버튼이 계속 노출된 상태를 유지할 수 있다.

import { expect, test } from '../fixtures/auth.fixture';
import { mockHomeChatCancel, mockHomeChatGeneration } from '../fixtures/home-chat-mock';

test(
  'AI 응답 스트리밍 중 중단 버튼 클릭 → 부분 응답 보존 + 입력 재개 + 취소 API 호출',
  { tag: '@smoke' },
  async ({ authenticatedPage: page }) => {
    const correlationId = 'corr-abort-1';

    await mockHomeChatGeneration(page, {
      correlationId,
      frames: [{ event: 'delta', data: { text: '부분 응답입니다' } }],
    });
    const cancel = await mockHomeChatCancel(page);

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

    // 6) 취소 API(DELETE /api/v1/ai/chat/{correlationId}) 가 호출됐다.
    await expect.poll(() => cancel.calls.length).toBe(1);
    expect(cancel.calls[0]).toContain(`/api/v1/ai/chat/${correlationId}`);
  },
);
