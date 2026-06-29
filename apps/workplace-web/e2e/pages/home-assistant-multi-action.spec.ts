// #351: 홈 비서 다건 제안 일괄 확인 카드 E2E.
// SSE pending_action 이벤트에 배열(2건)을 흘려 카드 2행 렌더 → 1건 승인(confirm POST 1회) → 1건 거부(카드 소멸).
// 전략: /api/v1/ai/chat 를 delta + pending_action 배열 + done SSE 로 모킹.
//   /api/v1/actions/confirm 을 201 스텁 + 호출 카운트로 검증.
//   auth.fixture 의 authenticatedPage + home-compose-widgets.spec.ts 의 SSE 스텁 패턴 재사용.

import { expect, test } from '../fixtures/auth.fixture';

test('다건 제안 — 일부 승인 / 일부 거부', async ({ authenticatedPage: page }) => {
  // /api/v1/ai/chat: delta 1개 + pending_action 배열(2건) + done
  await page.route(
    (url) => url.pathname === '/api/v1/ai/chat',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'event: delta',
          'data: {"text":"두 가지를 처리해 드릴게요."}',
          '',
          'event: pending_action',
          'data: [{"actionType":"CREATE_ISSUE","summary":"이슈 생성: 버그 수정","params":{"title":"버그 수정"}},{"actionType":"SEND_MESSAGE","summary":"메시지 발송: 팀 공지","params":{"content":"팀 공지"}}]',
          '',
          'event: done',
          'data: {"sessionId":"s-multi-1"}',
          '',
        ].join('\n'),
      }),
  );

  // /api/v1/actions/confirm: 201 성공 스텁 + 호출 카운트
  let confirmCount = 0;
  await page.route(
    (url) => url.pathname === '/api/v1/actions/confirm',
    (route) => {
      confirmCount++;
      return route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
    },
  );

  await page.goto('/');
  await page.getByTestId('chat-launcher').click();

  // 비서에 메시지 전송
  await page.getByTestId('chat-input').fill('두 가지 일 처리해줘');
  await page.getByRole('button', { name: '보내기' }).click();

  // delta 텍스트가 렌더된다.
  await expect(page.getByTestId('chat-panel')).toContainText('두 가지를 처리해 드릴게요.');

  // pending-action-item 이 2개 보인다.
  await expect(page.getByTestId('pending-action-item')).toHaveCount(2);

  // 카드 헤더 문구 확인
  await expect(page.getByTestId('pending-action-card')).toContainText('확인이 필요해요');

  // 두 건 이상이므로 '모두 승인' 버튼이 노출된다.
  await expect(page.getByTestId('pending-action-approve-all')).toBeVisible();

  // 첫 항목 승인 → confirm POST 1회, 항목 1개로 감소
  await page.getByTestId('pending-action-item').first().getByRole('button', { name: '승인' }).click();
  await expect(page.getByTestId('pending-action-item')).toHaveCount(1);
  expect(confirmCount).toBe(1);

  // 남은 항목 거부 → 서버 호출 없이 카드(pending-action-card) 사라짐
  await page.getByTestId('pending-action-item').first().getByRole('button', { name: '거부' }).click();
  await expect(page.getByTestId('pending-action-card')).toHaveCount(0);
  // 거부는 서버 호출 없음 — confirm POST 추가 호출 없어야 한다.
  expect(confirmCount).toBe(1);
});
