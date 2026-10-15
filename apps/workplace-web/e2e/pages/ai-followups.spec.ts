// WP-139 AI 답 뒤 후속 질문(데스크톱) — done 뒤 도착 시 마지막 답 아래 후속 질문 목록(WP-398 빈 대화 추천과 같은 모양), 클릭 전송, 새 질문 시 사라짐·늦게 온 것 버림, 이력 표시(마지막 답만), 꺼짐 숨김.
import type { Page } from '@playwright/test'

import { ask, msg, openChatPanel, sessionItem, setupLiveChat, summary, TITLE_A } from '../fixtures/ai-live-chat'
import { mockAiPreferences } from '../fixtures/ai-suggestions-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { expectStays, stableBox } from '../fixtures/wait'

const ITEMS = ['내일 회의 준비할 것 정리해줘', '참석자 일정 알려줘', 'WP-12 상태 알려줘']
const followups = (page: Page) => page.getByTestId('chat-followup')

test('답이 끝나고 후속 질문이 오면 마지막 답 아래에 보이고, 누르면 이어서 묻는다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  live.queueStart({ correlationId: 'corr-b', sessionId: 's-a' })
  live.setSessions([summary('s-a', TITLE_A, 1)])
  await openChatPanel(page)
  await ask(page, live, TITLE_A)
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '내일 10시 디자인 리뷰가 있어요.' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await expect(followups(page)).toHaveCount(0) // 생성 중 안내 없음
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: ITEMS })
  await expect(followups(page)).toHaveText(ITEMS)

  await page.getByTestId('chat-input').fill('쓰던 초안')
  await followups(page).filter({ hasText: '참석자 일정 알려줘' }).click()
  await live.starts.waitFor(2)
  expect(live.starts.lastBody()).toMatchObject({ sessionId: 's-a', query: '참석자 일정 알려줘' })
  await expect(page.getByTestId('chat-input')).toHaveValue('쓰던 초안')
  await expect(followups(page)).toHaveCount(0) // 새 질문으로 마지막 턴이 아니게 됨
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
  await expectStays(page, () => followups(page).count(), 0)
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
  await expect(followups(page)).toHaveText(ITEMS)
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
  await expect(followups(page)).toHaveCount(0)
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
  await expectStays(page, () => followups(page).count(), 0)
})

// WP-398 — 후속 질문은 빈 대화 추천과 같은 모양이다: "이어서 물어보기" 머리말 + ✦ 행, 같은 행 높이·글자 크기.
test('후속 질문은 빈 대화 추천과 같은 머리말·행 모양으로 보인다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.queueStart({ correlationId: 'corr-a', sessionId: 's-a' })
  await openChatPanel(page)
  const starter = page.getByTestId('starter-suggestion').first()
  await expect(starter).toBeVisible()
  const look = async (row: ReturnType<Page['getByTestId']>) => ({
    height: Math.round((await stableBox(row)).height),
    fontSize: await row.evaluate((el) => getComputedStyle(el).fontSize),
    icon: await row.locator('svg').count(),
  })
  const starterLook = await look(starter)

  await ask(page, live, '내일 일정')
  await live.push('delta', { correlationId: 'corr-a', sessionId: 's-a', text: '내일 10시 리뷰가 있어요.' })
  await live.push('done', { correlationId: 'corr-a', sessionId: 's-a', widgets: null })
  await live.push('followups', { correlationId: 'corr-a', sessionId: 's-a', messageId: 2, items: ITEMS })
  await expect(followups(page)).toHaveText(ITEMS)
  await expect(page.getByRole('group', { name: '이어서 물어보기' })).toBeVisible()
  expect(await look(followups(page).first())).toEqual({ ...starterLook, icon: 1 })
  // 한 줄에 하나씩 — 행이 세로로 쌓이고 시작점이 같다.
  const boxes = await Promise.all((await followups(page).all()).map((c) => stableBox(c)))
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 0.5)
    expect(Math.round(boxes[i].x)).toBe(Math.round(boxes[0].x))
  }
  // 행은 문구 폭만큼만 누른다 — 짧은 문구 오른쪽 빈 곳을 눌러도 질문이 나가지 않는다.
  const group = await stableBox(page.getByTestId('chat-followups'))
  expect(boxes[1].width).toBeLessThan(group.width - 40)
  await page.mouse.click(boxes[1].x + boxes[1].width + 20, boxes[1].y + boxes[1].height / 2)
  await expectStays(page, () => live.starts.count(), 1)
})
