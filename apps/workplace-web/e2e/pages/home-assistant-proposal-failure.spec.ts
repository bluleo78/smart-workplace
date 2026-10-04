// #843: 확인카드 승인 실패 처리 E2E — 실패해도 카드는 제자리에서 사유를 보여주고, 결과는 대화 이력에 남아
// 다음 턴 AI 가 알 수 있으며, 재시도 대신 "AI에게 수정 요청" 으로 이어진다. 세션 복원 시 카드·결과 줄도 복원된다.

import { expect, test } from '../fixtures/auth.fixture';
import { mockApi } from '../fixtures/api-mock';
import { mockHomeChatGeneration, mockHomeProposals, proposal } from '../fixtures/home-chat-mock';
import type { HomeMessage } from '../../src/types/home';

/** 좁은 패널에서 줄바꿈을 검증하기 위한 실제 길이의 서버 사유(한국어·무공백 토큰 포함). */
const LONG_REASON =
  '일정을 찾을 수 없습니다: 987654321 — 이미 삭제되었거나 다른 사용자의 일정일 수 있습니다. 반복 일정이면 occurrenceDate(예: 2026-09-23T10:00:00+09:00)를 함께 지정하세요.';

async function openWithProposal(page: import('@playwright/test').Page, onStart?: (q: string) => void) {
  await mockHomeChatGeneration(page, {
    onStart: (b) => onStart?.(b.query),
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
}

test('승인 실패 — 카드가 제자리에서 사유를 보여주고 결과 줄이 남는다(토스트·재삽입 없음)', async ({
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

test('전송 중 — 스피너와 함께 카드 버튼이 잠겨 중복 승인되지 않는다', async ({ authenticatedPage: page }) => {
  const proposals = await mockHomeProposals(page, {
    reply: () => ({ status: 'DONE' }),
    summaries: { 31: '주간 회의 삭제' },
    delayMs: 800,
  });
  await openWithProposal(page);

  const item = page.getByTestId('pending-action-item');
  const approve = item.getByRole('button', { name: '승인' });
  await approve.click();
  await expect(item).toHaveAttribute('aria-busy', 'true');
  await expect(approve).toBeDisabled();
  await expect(item.getByRole('button', { name: '거부' })).toBeDisabled();
  // 잠긴 버튼 강제 클릭도 요청을 늘리지 못한다.
  // eslint-disable-next-line playwright/no-force-option -- 비활성(잠긴) 버튼을 일부러 눌러 중복 요청이 막히는지 검증
  await approve.click({ force: true });
  await expect(page.getByTestId('pending-action-card')).toHaveCount(0);
  expect(proposals.calls).toHaveLength(1);
});

test('AI에게 수정 요청 — 실패 요약을 담아 새 질문을 보낸다', async ({ authenticatedPage: page }) => {
  await mockHomeProposals(page, {
    reply: () => ({ status: 'FAILED', reason: '일정을 찾을 수 없습니다' }),
    summaries: { 31: '주간 회의 삭제' },
  });
  const queries: string[] = [];
  await openWithProposal(page, (q) => queries.push(q));

  const item = page.getByTestId('pending-action-item');
  await item.getByRole('button', { name: '승인' }).click();
  await expect(item).toHaveAttribute('data-phase', 'failed');
  await item.getByRole('button', { name: 'AI에게 수정 요청' }).click();

  await expect.poll(() => queries.length).toBe(2);
  expect(queries[1]).toContain('주간 회의 삭제');
  expect(queries[1]).toContain('실패');
});

test('이미 처리된 카드(409) — 사유를 카드에 표시하고 다시 승인할 수 없다', async ({ authenticatedPage: page }) => {
  await mockHomeProposals(page, { reply: () => ({ httpStatus: 409, message: '이미 처리된 확인 카드입니다: 31' }) });
  await openWithProposal(page);

  const item = page.getByTestId('pending-action-item');
  await item.getByRole('button', { name: '승인' }).click();
  await expect(item).toHaveAttribute('data-phase', 'failed');
  await expect(item.getByTestId('pending-action-error')).toContainText('이미 처리된 확인 카드입니다');
});

test('세션 복원 — 결과 줄과 미처리 카드가 함께 복원된다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/home/sessions', {
    items: [{ id: 's-rest', title: '회의 정리', lastMessageAt: '2026-09-23T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  });
  const messages: HomeMessage[] = [
    { id: 1, role: 'USER', content: '회의 두 개 지워줘', widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:00Z' },
    { id: 2, role: 'ASSISTANT', content: '두 건을 제안했어요.', widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:01Z' },
    { id: 3, role: 'ACTION_FAILED', content: '승인 실패: 월간 회의 삭제 — 사유: 일정을 찾을 수 없습니다', widgets: null, toolCalls: null, createdAt: '2026-09-23T00:00:02Z' },
  ];
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-rest/messages', messages);
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-rest/proposals', [proposal(41, '주간 회의 삭제')]);

  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-session-switcher').click();
  await page.getByTestId('chat-session-select').first().click();

  // ACTION_FAILED 는 사용자 말풍선이 아니라 결과 줄로 복원된다.
  const result = page.getByTestId('action-result');
  await expect(result).toHaveAttribute('data-status', 'failed');
  await expect(result).toContainText('일정을 찾을 수 없습니다');
  // 미처리 카드는 새로고침·복원 후에도 다시 보인다.
  await expect(page.getByTestId('pending-action-item')).toHaveCount(1);
  await expect(page.getByTestId('pending-action-card')).toContainText('주간 회의 삭제');
});

test('새 세션 — 카드가 done 보다 먼저 와도 봉투의 sessionId 로 세션이 확정된다', async ({ authenticatedPage: page }) => {
  const starts: (string | null)[] = [];
  await mockHomeChatGeneration(page, {
    onStart: (b) => starts.push(b.sessionId),
    // done 없음 — 카드만 오고 스트림이 아직 끝나지 않은 상황.
    frames: [{ event: 'pending_action', data: { sessionId: 's-early', actions: [proposal(51, '팀 회의 생성')] } }],
  });
  await page.goto('/');
  await page.getByTestId('chat-launcher').click();
  await page.getByTestId('chat-input').fill('팀 회의 잡아줘');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect(page.getByTestId('pending-action-item')).toHaveCount(1);

  // 스트림을 멈추고 다음 질문을 보내면 같은 세션으로 이어져야 한다(null 이면 결과가 엉뚱한 새 세션에 쌓인다).
  await page.getByTestId('chat-stop').click();
  await page.getByTestId('chat-input').fill('고마워');
  await page.getByRole('button', { name: '보내기' }).click();
  await expect.poll(() => starts).toEqual([null, 's-early']);
});
