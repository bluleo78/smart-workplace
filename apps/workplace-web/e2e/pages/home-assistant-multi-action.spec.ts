// #351: 홈 비서 다건 제안 일괄 확인 카드 E2E. #843: 제안은 서버 영속(id) — 승인/거부는 id 로, 결과는 대화에 결과 줄.
// 전략: /api/v1/ai/chat 를 delta + pending_action 배열 + done SSE 로 모킹하고,
//   /api/v1/home/proposals/{id}/(confirm|reject) 를 mockHomeProposals 로 스텁 + 호출 기록 검증.

import { expect, test } from '../fixtures/auth.fixture';
import { mockHomeChatGeneration, mockHomeProposals, proposal } from '../fixtures/home-chat-mock';

async function openWithTwoProposals(page: import('@playwright/test').Page) {
  await mockHomeChatGeneration(page, {
    frames: [
      { event: 'delta', data: { text: '두 가지를 처리해 드릴게요.' } },
      {
        event: 'pending_action',
        data: {
          sessionId: 's-multi-1',
          actions: [
            proposal(21, '이슈 생성: 버그 수정', { title: '버그 수정' }, 'issue.create'),
            proposal(22, '일정 생성: 팀 공지 회의', { title: '팀 공지' }),
          ],
        },
      },
      { event: 'done', data: { sessionId: 's-multi-1' } },
    ],
  });
  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-input').fill('두 가지 일 처리해줘');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByTestId('pending-action-item')).toHaveCount(2);
}

test('다건 제안 — 일부 승인 / 일부 거부', async ({ authenticatedPage: page }) => {
  const proposals = await mockHomeProposals(page, {
    reply: (_id, op) => ({ status: op === 'confirm' ? 'DONE' : 'REJECTED' }),
    summaries: { 21: '이슈 생성: 버그 수정', 22: '일정 생성: 팀 공지 회의' },
  });
  await openWithTwoProposals(page);

  await expect(page.getByTestId('chat-panel')).toContainText('두 가지를 처리해 드릴게요.');
  await expect(page.getByTestId('pending-action-card')).toContainText('확인이 필요해요');
  // 두 건 이상이므로 '모두 승인' 버튼이 노출된다.
  await expect(page.getByTestId('pending-action-approve-all')).toBeVisible();

  // 첫 항목 승인 → confirm 1회(id=21), 항목 1개로 감소
  await page.getByTestId('pending-action-item').first().getByRole('button', { name: '승인' }).click();
  await expect(page.getByTestId('pending-action-item')).toHaveCount(1);
  // 남은 1건이면 '모두 승인' 은 숨김
  await expect(page.getByTestId('pending-action-approve-all')).toHaveCount(0);

  // 남은 항목 거부 → reject(id=22) 후 카드 사라짐
  await page.getByTestId('pending-action-item').first().getByRole('button', { name: '거부' }).click();
  await expect(page.getByTestId('pending-action-card')).toHaveCount(0);
  expect(proposals.calls).toEqual([
    { id: 21, op: 'confirm' },
    { id: 22, op: 'reject' },
  ]);
  await expect(page.getByTestId('action-result')).toHaveCount(2);
});

test('모두 승인 — 카드 순서대로 하나씩 승인하고, 일부 실패는 토스트 1건으로 집계한다 (#843)', async ({
  authenticatedPage: page,
}) => {
  const proposals = await mockHomeProposals(page, {
    reply: (id) => (id === 21 ? { status: 'DONE' } : { status: 'FAILED', reason: '필요 권한 없음: calendar:write' }),
    summaries: { 21: '이슈 생성: 버그 수정', 22: '일정 생성: 팀 공지 회의' },
  });
  await openWithTwoProposals(page);

  await page.getByTestId('pending-action-approve-all').click();

  // 순차 실행 — 결과 줄 순서 = 카드 순서.
  await expect.poll(() => proposals.calls.map((c) => c.id)).toEqual([21, 22]);
  // 성공 카드는 사라지고 실패 카드만 사유와 함께 제자리에 남는다.
  const items = page.getByTestId('pending-action-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAttribute('data-phase', 'failed');
  await expect(items.first().getByTestId('pending-action-error')).toContainText('필요 권한 없음: calendar:write');
  // 토스트는 건마다가 아니라 1건 — 개수만.
  await expect(page.getByText('2건 중 1건을 처리하지 못했어요')).toHaveCount(1);
  await expect(page.getByTestId('action-result')).toHaveCount(2);
});
