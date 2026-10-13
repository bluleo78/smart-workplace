// WP-139 AI 답 뒤 후속 질문(데스크톱) — done 뒤 도착 시 마지막 답 아래 칩, 클릭 전송, 새 질문 시 사라짐·늦게 온 것 버림, 이력 표시(마지막 답만), 꺼짐 숨김.
import type { Page } from '@playwright/test'

import { ask, msg, openChatPanel, sessionItem, setupLiveChat, summary, TITLE_A } from '../fixtures/ai-live-chat'
import { mockAiPreferences } from '../fixtures/ai-suggestions-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { expectStays, stableBox } from '../fixtures/wait'

const ITEMS = ['내일 회의 준비할 것 정리해줘', '참석자 일정 알려줘', 'WP-12 상태 알려줘']
const chips = (page: Page) => page.getByTestId('chat-followup')

test('답이 끝나고 후속 질문이 오면 마지막 답 아래에 보이고, 누르면 이어서 묻는다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 1)])
  await openChatPanel(page)
  await ask(page, live, TITLE_A)
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '내일 10시 디자인 리뷰가 있어요.' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(chips(page)).toHaveCount(0) // 생성 중 안내 없음
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: ITEMS })
  await expect(chips(page)).toHaveText(ITEMS)

  await page.getByTestId('chat-input').fill('쓰던 초안')
  await chips(page).filter({ hasText: '참석자 일정 알려줘' }).click()
  await live.starts.waitFor(2)
  expect(live.starts.lastBody()).toMatchObject({ sessionId: 's-a', query: '참석자 일정 알려줘' })
  await expect(page.getByTestId('chat-input')).toHaveValue('쓰던 초안')
  await expect(chips(page)).toHaveCount(0) // 새 질문으로 마지막 턴이 아니게 됨
})

test('후속 질문이 새 질문 뒤에 오면 붙지 않는다 (Review Focus 1)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '첫 질문')
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '첫 답' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await ask(page, live, '둘째 질문')
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: ITEMS })
  await live.push('delta', { correlationId: 'corr-b', sessionId: 's-a', text: '둘째 답' })
  await live.push('done', { correlationId: 'corr-b', sessionId: 's-a', widgets: null })
  await expect(page.getByTestId('chat-panel')).toContainText('둘째 답')
  await expectStays(page, () => chips(page).count(), 0)
})

test('이력의 마지막 답 후속 질문만 보인다 (Review Focus 5)', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [
    msg(1, 'USER', '첫 질문'),
    { ...msg(2, 'ASSISTANT', '첫 답'), followups: ['옛 후속 질문 알려줘'] },
    msg(3, 'USER', '둘째 질문'),
    { ...msg(4, 'ASSISTANT', '둘째 답'), followups: ITEMS },
  ])
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(page.getByTestId('chat-panel')).toContainText('둘째 답')
  await expect(chips(page)).toHaveText(ITEMS)
  await expect(page.getByTestId('chat-panel')).not.toContainText('옛 후속 질문 알려줘')
})

test('확인 카드가 있으면 후속 질문을 보이지 않는다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', '회의 잡아줘'), { ...msg(2, 'ASSISTANT', '준비했어요'), followups: ITEMS }])
  await page.route((u) => u.pathname === '/api/v1/home/sessions/s-a/proposals', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 9, actionType: 'calendar.create_event', summary: '회의 잡기', params: {} }]) }))
  await openChatPanel(page)
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expect(page.getByTestId('pending-action-card')).toBeVisible()
  await expect(chips(page)).toHaveCount(0)
})

test('추천을 끈 사용자는 라이브 후속 질문도 보지 않는다 (Review Focus 2)', async ({ authenticatedPage: page }) => {
  await mockAiPreferences(page, false)
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '질문')
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '답' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: ITEMS })
  await expectStays(page, () => chips(page).count(), 0)
})

// UI 리뷰 #3·#4 — 마우스 환경(데스크톱)은 시안대로 칩 26px·줄 간격 6px. 넓은 줄 간격·터치 확장은 터치 기기(모바일 스펙)에서만.
const WRAPPING = ['내일 디자인 리뷰 회의 안건 정리해줘', '참석자들의 다음 주 빈 시간 알려줘', 'WP-12 이슈의 최근 변경 내역 알려줘']

test('데스크톱 후속 칩은 26px 높이에 줄바꿈 간격 6px 이다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  await ask(page, live, '내일 일정')
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '내일 10시 리뷰가 있어요.' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: WRAPPING })
  await expect(chips(page)).toHaveText(WRAPPING)
  const first = await stableBox(chips(page).first())
  const second = await stableBox(chips(page).nth(1))
  expect(Math.round(first.height)).toBe(26)
  expect(second.y, '둘째 칩이 다음 줄로 내려가야 한다(전제)').toBeGreaterThan(first.y + first.height)
  expect(Math.round(second.y - (first.y + first.height))).toBe(6)
  // 터치 확장(::after)이 없다 — 마우스에선 칩 아래 여백이 비어 있다.
  const after = await chips(page).first().evaluate((el) => getComputedStyle(el, '::after').position)
  expect(after).not.toBe('absolute')
})
