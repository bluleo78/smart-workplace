// #843: 확인카드 승인 실패 처리 E2E — 실패해도 카드는 제자리에서 사유를 보여주고, 결과는 대화 이력에 남아
// 다음 턴 AI 가 알 수 있으며, 재시도 대신 "AI에게 수정 요청" 으로 이어진다. 세션 복원 시 카드·결과 줄도 복원된다.
// 좁은 패널에서 긴 사유가 가로로 넘치지 않는지(기하·스크린샷, @layout) 1건만 남긴다(WP-966). 전송 중 잠금·AI에게 수정 요청 payload·
// 409 사유·세션 복원·done 전 카드의 sessionId 확정은 페이지 테스트 src/components/ai/homeAssistantProposals.test.tsx 가 지킨다.

import { expect, test } from '../fixtures/auth.fixture';
import { mockHomeChatGeneration, mockHomeProposals, proposal } from '../fixtures/home-chat-mock';

/** 좁은 패널에서 줄바꿈을 검증하기 위한 실제 길이의 서버 사유(한국어·무공백 토큰 포함). */
const LONG_REASON =
  '일정을 찾을 수 없습니다: 987654321 — 이미 삭제되었거나 다른 사용자의 일정일 수 있습니다. 반복 일정이면 occurrenceDate(예: 2026-09-23T10:00:00+09:00)를 함께 지정하세요.';

async function openWithProposal(page: import('@playwright/test').Page) {
  const chats = await mockHomeChatGeneration(page, {
    frames: [
      { event: 'delta', data: { text: '회의를 삭제할게요.' } },
      { event: 'pending_action', data: { sessionId: 's-fail-1', actions: [proposal(31, '주간 회의 삭제', { id: 987654321 }, 'calendar.delete_event')] } },
      { event: 'done', data: { sessionId: 's-fail-1' } },
    ],
  });
  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-input').fill('주간 회의 지워줘');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByTestId('pending-action-item')).toHaveCount(1);
  return chats;
}

test('승인 실패 — 카드가 제자리에서 사유를 보여주고 결과 줄이 남는다(토스트·재삽입 없음)', { tag: '@layout' }, async ({
  authenticatedPage: page,
}) => {
  await mockHomeProposals(page, {
    reply: () => ({ status: 'FAILED', reason: LONG_REASON }),
    summaries: { 31: '주간 회의 삭제' },
  });
  await openWithProposal(page);

  const item = page.getByTestId('pending-action-item');
  await item.getByRole('button', { name: '승인' }).click();

  await expect(item).toHaveAttribute('data-phase', 'failed');
  await expect(item.getByTestId('pending-action-error')).toContainText('이미 삭제되었거나');
  // 같은 파라미터 재시도 버튼 대신 AI 수정 요청·닫기.
  await expect(item.getByRole('button', { name: '승인' })).toHaveCount(0);
  await expect(item.getByRole('button', { name: 'AI에게 수정 요청' })).toBeVisible();
  await expect(item.getByRole('button', { name: '닫기' })).toBeVisible();
  // 결과 줄(대화 이력) — 다음 턴 AI 맥락과 같은 문장.
  const result = page.getByTestId('action-result');
  await expect(result).toHaveAttribute('data-status', 'failed');
  await expect(result).toContainText(`승인 실패: 주간 회의 삭제 — 사유: ${LONG_REASON}`);

  // 긴 사유가 좁은 패널에서 가로로 넘치지 않는다(카드·결과 줄 모두 패널 안).
  const panel = (await page.getByTestId('chat-scroll').boundingBox())!;
  for (const box of [await item.boundingBox(), await result.boundingBox()]) {
    expect(box!.x + box!.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
  }
  const scroll = page.getByTestId('chat-scroll');
  expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);

  await page.screenshot({ path: 'test-results/tc/home-assistant-proposal-failure/failed-card.png' });

  // 닫기 → 서버 호출 없이 카드만 사라지고 결과 줄은 남는다.
  await item.getByRole('button', { name: '닫기' }).click();
  await expect(page.getByTestId('pending-action-card')).toHaveCount(0);
  await expect(result).toBeVisible();
});
