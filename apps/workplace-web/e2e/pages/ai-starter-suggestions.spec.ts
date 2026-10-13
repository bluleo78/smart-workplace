// WP-139 빈 AI 대화 추천 질문(데스크톱 사이드 패널) — 고정 문구 → AI 교체, 저장 결과 재사용, 교체 보류, 클릭 전송, 화면 맞춤·× 전환, 실패, 꺼짐이면 목록 없음, 이력 로딩·전송 막힘.
// 목록은 추천 설정 응답 뒤에 그려진다(꺼짐 사용자에게 한 번도 보이지 않게) — 즉시 단언 전에 목록 가시성을 먼저 기다린다.
import type { Page } from '@playwright/test'

import { openChatPanel, msg, sessionItem, setupLiveChat, summary, TITLE_A } from '../fixtures/ai-live-chat'
import { gate, mockAiPreferences, mockStarterSuggestions } from '../fixtures/ai-suggestions-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { mockIssueDetail } from '../fixtures/issue-detail-mock'
import { expectStays } from '../fixtures/wait'

const GENERAL = ['오늘 일정 요약해줘', '나를 멘션한 메시지 정리해줘', '내 작업 우선순위 정리해줘', '답장이 필요한 메일 알려줘']
const AI = ['3분기 매출 보고서 진행 알려줘', '오늘 오후 회의 안건 정리해줘', '어제 받은 메일 중 급한 것 알려줘', '내 리뷰 대기 이슈 보여줘']

const rows = (page: Page) => page.getByTestId('starter-suggestion')
const texts = async (page: Page) => rows(page).allTextContents()

test('빈 대화는 일반 고정 문구를 즉시 보이고, AI 결과가 오면 한 번 바꾼다', { tag: '@smoke' }, async ({ authenticatedPage: page }) => {
  const g = gate()
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }], gate: g.p })
  await openChatPanel(page)
  await expect(page.getByTestId('starter-suggestions')).toContainText('추천 질문')
  expect(await texts(page)).toEqual(GENERAL)
  await calls.waitFor(1)
  // /projects(프로젝트 목록)는 화면 참고를 등록하지 않는다 — 일반 추천이라 본문이 비어 있다.
  expect(calls.lastBody()).toEqual({})
  g.release()
  await expect.poll(() => texts(page)).toEqual(AI)
  // 중앙 안내는 그대로 남는다.
  await expect(page.getByTestId('chat-panel')).toContainText('AI 어시스턴트에게 물어보세요')
})

test('다시 열면 저장된 AI 결과가 즉시 보이고, 오늘 것이면 다시 부르지 않는다', async ({ authenticatedPage: page }) => {
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }] })
  await openChatPanel(page)
  await expect.poll(() => texts(page)).toEqual(AI)
  await page.reload()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('starter-suggestions')).toBeVisible()
  expect(await texts(page)).toEqual(AI) // 고정 문구를 거치지 않는다
  await expectStays(page, calls.count, 1, { ms: 800 }) // 디바운스(300ms)보다 길게 지켜본다
})

test('저장 날짜가 지났으면 저장 결과를 먼저 보이고 뒤에서 새로 받아 바꾼다', async ({ authenticatedPage: page }) => {
  const NEXT = ['새로 만든 추천 하나 알려줘', '새로 만든 추천 둘 알려줘', '새로 만든 추천 셋 알려줘', '새로 만든 추천 넷 알려줘']
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }, { items: NEXT, enabled: true }] })
  await openChatPanel(page)
  await expect.poll(() => texts(page)).toEqual(AI)
  // 저장된 모든 항목의 날짜를 과거로 돌린다(키를 몰라도 접두로 찾는다).
  await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (!k.startsWith('ai-starter:v1:')) continue
      const map = JSON.parse(localStorage.getItem(k)!) as Record<string, { date: string }>
      Object.values(map).forEach((e) => (e.date = '2000-01-01'))
      localStorage.setItem(k, JSON.stringify(map))
    }
  })
  await page.reload()
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('starter-suggestions')).toBeVisible()
  expect(await texts(page)).toEqual(AI)
  await calls.waitFor(2)
  await expect.poll(() => texts(page)).toEqual(NEXT)
})

test('포인터가 목록 위에 있으면 교체를 미루고, 벗어나면 바꾼다', async ({ authenticatedPage: page }) => {
  const g = gate()
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }], gate: g.p })
  await openChatPanel(page)
  await calls.waitFor(1)
  await rows(page).first().hover()
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/ai/suggestions'))
  g.release()
  await response
  await expectStays(page, () => texts(page), GENERAL, { ms: 500 })
  await page.getByTestId('chat-input').hover()
  await expect.poll(() => texts(page)).toEqual(AI)
})

test('추천을 누르면 그 문구로 바로 보내고 쓰던 초안은 그대로 둔다', async ({ authenticatedPage: page }) => {
  const chat = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-1' } }] })
  await openChatPanel(page)
  await page.getByTestId('chat-input').fill('쓰던 초안')
  await rows(page).filter({ hasText: '답장이 필요한 메일 알려줘' }).click()
  await expect.poll(chat.count).toBe(1)
  expect(chat.lastBody<HomeChatStartBody>()).toMatchObject({ sessionId: null, query: '답장이 필요한 메일 알려줘' })
  await expect(page.getByTestId('chat-input')).toHaveValue('쓰던 초안')
  await expect(page.getByTestId('starter-suggestions')).toHaveCount(0) // 대화가 생겨 목록이 사라진다
})

test('이슈 상세는 화면 맞춤 3개, × 로 빼면 일반 추천으로 바뀌고 요청에서도 빠진다', async ({ authenticatedPage: page }) => {
  const calls = await mockStarterSuggestions(page, { replies: [{ items: [], enabled: true }] })
  const chat = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-2' } }] })
  await mockIssueDetail(page)
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await expect(page.getByTestId('starter-suggestions')).toContainText('이 이슈에 대해')
  expect(await texts(page)).toEqual(['이 이슈 관련 작업 정리해줘', '비슷한 이슈 찾아줘', '이 이슈를 막고 있는 이슈 상태 알려줘'])
  await calls.waitFor(1)
  expect(calls.lastBody<{ screenContext: { focus: { refs: Record<string, string> } } }>()?.screenContext.focus.refs).toEqual({ issueKey: 'WP-12' })

  await page.getByTestId('chat-context-remove').click()
  await expect(page.getByTestId('starter-suggestions')).toContainText('추천 질문')
  expect(await texts(page)).toEqual(GENERAL)
  await calls.waitFor(2)
  expect(calls.lastBody()).toEqual({})

  // × 상태에서 누르면 화면 정보 없이 보낸다(전송 규칙과 같다).
  await rows(page).first().click()
  await expect.poll(chat.count).toBe(1)
  expect(chat.lastBody<HomeChatStartBody>()).not.toHaveProperty('screenContext')
})

test('이슈 상세에서 누르면 화면 정보가 함께 실린다', async ({ authenticatedPage: page }) => {
  const chat = await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-3' } }] })
  await mockIssueDetail(page)
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await rows(page).filter({ hasText: '비슷한 이슈 찾아줘' }).click()
  await expect.poll(chat.count).toBe(1)
  expect(chat.lastBody<HomeChatStartBody>()).toMatchObject({
    query: '비슷한 이슈 찾아줘',
    screenContext: { focus: { type: '이슈', refs: { issueKey: 'WP-12' } } },
  })
})

test('추천 생성이 실패하면 고정 문구를 그대로 두고 오류를 띄우지 않는다', async ({ authenticatedPage: page }) => {
  const calls = await mockStarterSuggestions(page, { replies: [{ status: 502 }] })
  await openChatPanel(page)
  await calls.waitFor(1)
  await expectStays(page, () => texts(page), GENERAL, { ms: 500 })
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
})

/** 켜져 있을 때 저장된 결과를 흉내 — fixtures 는 활성 워크스페이스를 두지 않으므로 소유자 키는 `<userId>:0` 이다. */
async function seedStoredStarter(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ai-starter:v1:1:0', JSON.stringify({ general: { items: ['저장된 추천 알려줘'], date: '2999-01-01', at: 1 } }))
    } catch { /* 저장소를 못 쓰면 저장 결과 없이 검증 */ }
  })
}

test('시드한 저장소 키(1:0)는 추천이 켜져 있으면 실제로 보인다 — 꺼짐 검증이 공허하지 않다는 근거', async ({ authenticatedPage: page }) => {
  // 시드 날짜(2999)는 "오늘"이 아니라 새로 받기는 하지만, 응답을 붙잡아 두면 그 전까지 저장 결과가 고정 문구 자리에 보인다.
  const g = gate()
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }], gate: g.p })
  await seedStoredStarter(page)
  await openChatPanel(page)
  await expect(page.getByTestId('starter-suggestions')).toBeVisible()
  expect(await texts(page)).toEqual(['저장된 추천 알려줘'])
  await calls.waitFor(1)
  g.release()
  await expect.poll(() => texts(page)).toEqual(AI)
})

test('추천을 끈 사용자에게는 목록(저장·고정 문구 포함)이 없고 생성 요청도 없다', async ({ authenticatedPage: page }) => {
  await mockAiPreferences(page, false)
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }] })
  // 켜져 있을 때 저장된 결과가 있어도 보이지 않아야 한다 — 먼저 저장소를 채운다(위 양성 테스트가 같은 키가 읽힘을 보인다).
  await seedStoredStarter(page)
  await openChatPanel(page)
  await expect(page.getByTestId('chat-panel')).toContainText('AI 어시스턴트에게 물어보세요')
  await expectStays(page, () => page.getByTestId('starter-suggestions').count(), 0, { ms: 800 })
  expect(calls.count()).toBe(0)
})

test('서버가 enabled:false 를 돌려주면 이후 다시 부르지 않는다', async ({ authenticatedPage: page }) => {
  const calls = await mockStarterSuggestions(page, { replies: [{ items: [], enabled: false }] })
  await mockIssueDetail(page)
  // 화면 참고 칩이 있는 이슈 상세에서 시작해야 × 로 다른 키(일반)를 만들 수 있다 — /projects 는 화면 참고가 없다.
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await calls.waitFor(1)
  // 설정 캐시가 꺼짐으로 바뀌어 목록이 사라진다(스펙 §10.6).
  await expect(page.getByTestId('starter-suggestions')).toHaveCount(0)
  await page.getByTestId('chat-context-remove').click() // 다른 키(일반)로 바뀌어도
  await expectStays(page, calls.count, 1, { ms: 800 })
  await expect(page.getByTestId('starter-suggestions')).toHaveCount(0)
})

test('기존 대화를 여는 동안에는 추천이 보이지 않는다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setSessions([summary('s-a', TITLE_A, 1)])
  live.setMessages('s-a', [msg(1, 'USER', TITLE_A), msg(2, 'ASSISTANT', '요약본입니다')])
  await openChatPanel(page)
  await expect(page.getByTestId('starter-suggestions')).toBeVisible()
  const release = live.holdMessages('s-a')
  await page.getByTestId('chat-session-switcher').click()
  await sessionItem(page, TITLE_A).getByTestId('chat-session-select').click()
  await expectStays(page, () => page.getByTestId('starter-suggestions').count(), 0, { ms: 500 })
  release()
  await expect(page.getByTestId('chat-panel')).toContainText('요약본입니다')
  await expect(page.getByTestId('starter-suggestions')).toHaveCount(0)
})

test('전송이 막힌 상태(동시 답변 상한)면 추천을 누를 수 없다', async ({ authenticatedPage: page }) => {
  const live = await setupLiveChat(page)
  live.setActive([
    { sessionId: 's-1', correlationId: 'c-1', startedAt: '2026-10-13T00:00:00Z' },
    { sessionId: 's-2', correlationId: 'c-2', startedAt: '2026-10-13T00:00:00Z' },
    { sessionId: 's-3', correlationId: 'c-3', startedAt: '2026-10-13T00:00:00Z' },
  ])
  await openChatPanel(page)
  await expect(page.getByTestId('chat-limit-notice')).toBeVisible()
  await expect(rows(page).first()).toBeDisabled()
})
