// WP-139 모바일 후속 질문 — 칩은 36px·14px(터치 기기), 칩 아래 여백(터치 영역 확장)을 탭해도 그 칩이 눌리고, 가로 넘침이 없다.
import { ask, setupLiveChat } from '../../fixtures/ai-live-chat'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'
import { stableBox } from '../../fixtures/wait'

const ITEMS = ['내일 회의 준비할 것 정리해줘', '참석자 일정 알려줘', 'WP-12 상태 알려줘']

test('칩 바로 아래 6px 를 탭해도 그 칩으로 보낸다(터치 영역 40px 이상)', async ({ authenticatedPage: page }) => {
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
  const chip = page.getByTestId('chat-followup').last()
  await expect(chip).toBeVisible()
  await expectNoHorizontalOverflow(page)
  const box = await stableBox(chip)
  // UI 리뷰 #4 — 터치 기기의 칩은 시안 휴대폰 칩 크기(36px·14px 글자), 데스크톱(26px·12px)보다 크다.
  expect(Math.round(box.height)).toBe(36)
  expect(await chip.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px')
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height + 6)
  await live.starts.waitFor(2)
  expect(live.starts.lastBody()).toMatchObject({ query: ITEMS[2] })
})

// 칩이 여러 줄로 줄바꿈될 때 — 아랫줄 칩의 위쪽 터치 확장이 윗줄 칩 아래 여백을 가로채지 않는다(줄 간격 ≥ 위아래 확장 합).
const WRAPPING = ['내일 디자인 리뷰 회의 안건 정리해줘', '참석자들의 다음 주 빈 시간 알려줘', 'WP-12 이슈의 최근 변경 내역 알려줘']

test('줄바꿈된 윗줄 칩 바로 아래 6px 를 탭해도 아랫줄이 아닌 그 칩으로 보낸다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-a' })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await ask(page, live, '내일 일정')
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '내일 10시 리뷰가 있어요.' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: WRAPPING })
  const chips = page.getByTestId('chat-followup')
  await expect(chips).toHaveText(WRAPPING)
  const first = await stableBox(chips.first())
  const second = await stableBox(chips.nth(1))
  expect(second.y, '둘째 칩이 다음 줄로 내려가야 한다(전제)').toBeGreaterThan(first.y + first.height)
  await page.touchscreen.tap(first.x + first.width / 2, first.y + first.height + 6)
  await live.starts.waitFor(2)
  expect(live.starts.lastBody()).toMatchObject({ query: WRAPPING[0] })
})
