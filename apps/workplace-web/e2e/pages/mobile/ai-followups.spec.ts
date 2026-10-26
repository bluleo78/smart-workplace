// WP-139·WP-398 모바일 후속 질문 — 빈 대화 추천과 같은 행 목록: "이어서 물어보기" 머리말, 행 44px 이상·14px 글자, 탭하면 전송, 가로 넘침 없음.
import { ask, setupLiveChat } from '../../fixtures/ai-live-chat'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { stableBox } from '../../fixtures/wait'

// 390px 시트에서 두 줄로 감길 만한 긴 문구를 섞는다.
const ITEMS = ['내일 디자인 리뷰 회의 안건과 참석자별 준비물 정리해줘', '참석자 일정 알려줘', 'WP-12 상태 알려줘']

test('후속 질문 행은 44px 이상·14px 글자이고, 탭하면 그 문구로 보내며 가로로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-a' })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, '내일 일정')
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '내일 10시 리뷰가 있어요.' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: ITEMS })
  const rows = page.getByTestId('chat-followup')
  await expect(rows).toHaveText(ITEMS)
  await expect(page.getByRole('group', { name: '이어서 물어보기' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
  for (const row of await rows.all()) {
    expect((await stableBox(row)).height).toBeGreaterThanOrEqual(44)
    expect(await row.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px')
  }
  await rows.last().tap()
  await live.starts.waitFor(2)
  expect(live.starts.lastBody()).toMatchObject({ query: ITEMS[2] })
})
