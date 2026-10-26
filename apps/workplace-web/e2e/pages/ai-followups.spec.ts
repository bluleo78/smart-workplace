// WP-139 AI 답 뒤 후속 질문(데스크톱) E2E — 브라우저가 있어야 판정되는 것만 남긴다:
// 라우트 → AI 패널 → 채팅 API·SSE → 후속 질문 클릭 전송의 대표 배선(@wiring)과 빈 대화 추천과 같은 행 모양·정렬·누르는 폭(@layout).
// 이력의 마지막 답만·확인 카드가 있으면 숨김·추천 꺼짐 숨김과 클릭 전송 payload·초안 유지는
// 페이지 테스트 src/components/ai/aiChatPanelLive.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import { ask, openChatPanel, setupLiveChat, summary, TITLE_A } from '../fixtures/ai-live-chat'
import { expect, test } from '../fixtures/auth.fixture'
import { expectStartAligned } from '../fixtures/layout'
import { expectStays, stableBox } from '../fixtures/wait'

const ITEMS = ['내일 회의 준비할 것 정리해줘', '참석자 일정 알려줘', 'WP-12 상태 알려줘']
const followups = (page: Page) => page.getByTestId('chat-followup')

test('답이 끝나고 후속 질문이 오면 마지막 답 아래에 보이고, 누르면 이어서 묻는다', { tag: ['@wiring', '@smoke'] }, async ({ authenticatedPage: page }) => {
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

// WP-398 — 후속 질문은 빈 대화 추천과 같은 모양이다: "이어서 물어보기" 머리말 + ✦ 행, 같은 행 높이·글자 크기.
test('후속 질문은 빈 대화 추천과 같은 머리말·행 모양으로 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
  expect(starterLook.icon).toBe(1)
  expect(await look(followups(page).first())).toEqual(starterLook)
  // 한 줄에 하나씩 — 행이 세로로 쌓이고 시작점이 같다.
  const boxes = await Promise.all((await followups(page).all()).map((c) => stableBox(c)))
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].y).toBeGreaterThanOrEqual(boxes[i - 1].y + boxes[i - 1].height - 0.5)
    await expectStartAligned(followups(page).nth(i), followups(page).first())
  }
  // 행은 문구 폭만큼만 누른다 — 짧은 문구 오른쪽 빈 곳을 눌러도 질문이 나가지 않는다.
  const group = await stableBox(page.getByTestId('chat-followups'))
  expect(boxes[1].width).toBeLessThan(group.width - 40)
  await page.mouse.click(boxes[1].x + boxes[1].width + 20, boxes[1].y + boxes[1].height / 2)
  await expectStays(page, () => live.starts.count(), 1)
})
