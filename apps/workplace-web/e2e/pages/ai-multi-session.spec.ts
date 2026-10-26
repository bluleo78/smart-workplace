// 메인 AI 채팅 멀티 세션(WP-190) E2E — 브라우저 XHR 시간 제한(10초)을 실제로 기다리는 1건만 남긴다(@platform: page.clock 으로 당길 수 없다).
// 대화를 옮겨도 생성이 이어짐·■ 정지·칩/목록/헤더 상태·삭제 순서·동시 답변 상한·409·중단 표시·생성 중 복원·다른 창 답변·SSE 재연결·
// 이력 읽는 중 전송 잠금은 페이지 테스트 src/components/ai/aiChatPanelLive.test.tsx 가 지킨다(WP-966).
import { msg, openChatPanel, sessionItem, setupLiveChat, summary, TITLE_A } from '../fixtures/ai-live-chat'
import { expect, test } from '../fixtures/auth.fixture'

test('이력 복원의 확인 카드 조회가 응답하지 않아도 시간 제한 뒤 보내기 잠금이 풀린다 (WP-268)', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  test.slow() // 복원 요청 시간 제한(10초)을 실제로 기다린다 — 브라우저 XHR 타임아웃이라 page.clock 으로 당길 수 없다.
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  // 확인 카드 조회만 영영 응답하지 않는다(요청은 받되 fulfill 하지 않음).
  await page.route((u) => u.pathname === '/api/v1/home/sessions/s-a/proposals', () => {})
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await page.getByTestId('chat-input').fill('이어서 물어볼게')
  const send = page.getByTestId('chat-panel').getByRole('button', { name: '보내기' })
  await expect(send).toBeDisabled()
  await expect(send).toBeEnabled({ timeout: 20_000 })
})
