// WP-139 빈 AI 대화 추천 질문(데스크톱 사이드 패널) — 고정 문구 → AI 교체, 저장 결과 재사용, 교체 보류, 클릭 전송, 화면 맞춤·× 전환, 실패, 꺼짐이면 목록 없음, 이력 로딩·전송 막힘.
// 목록은 추천 설정 응답 뒤에 그려진다(꺼짐 사용자에게 한 번도 보이지 않게) — 즉시 단언 전에 목록 가시성을 먼저 기다린다.
import type { Page } from '@playwright/test'

import { openChatPanel, msg, sessionItem, setupLiveChat, summary, TITLE_A } from '../fixtures/ai-live-chat'
import { mockAiPreferences, mockStarterSuggestions } from '../fixtures/ai-suggestions-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { type HomeChatStartBody, mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { mockIssueDetail } from '../fixtures/issue-detail-mock'
import { expectStays, gate } from '../fixtures/wait'

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
  // 둘째 응답은 붙잡아 두었다가 "저장 결과가 먼저 보인다"를 확인한 뒤 푼다 — 부하로 응답이 일찍 반영돼도 첫 단언이 NEXT 를 읽지 않게.
  const second = gate()
  const calls = await mockStarterSuggestions(page, {
    replies: [{ items: AI, enabled: true }, { items: NEXT, enabled: true }],
    gates: [undefined, second.p],
  })
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
  second.release()
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
  // 설정 응답(꺼짐)이 반영된 뒤에 부재를 지켜본다 — 응답 전에 재면 "아직 안 그려졌을 뿐"인 거짓 통과가 된다.
  const prefsResponse = page.waitForResponse((r) => r.url().endsWith('/users/me/ai-preferences') && r.request().method() === 'GET')
  await openChatPanel(page)
  await prefsResponse
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

test('키보드 포커스가 목록 안에 있으면 교체를 미루고, 벗어나면 바꾼다', async ({ authenticatedPage: page }) => {
  const g = gate()
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }], gate: g.p })
  await openChatPanel(page)
  await calls.waitFor(1)
  await rows(page).first().focus()
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/ai/suggestions'))
  g.release()
  await response
  await expectStays(page, () => texts(page), GENERAL, { ms: 500 })
  await page.getByTestId('chat-input').focus()
  await expect.poll(() => texts(page)).toEqual(AI)
})

test('칩을 눌러 목록이 사라진 뒤에도 보류가 남지 않아, 새 대화에서 받은 추천이 바로 바뀐다', async ({ authenticatedPage: page }) => {
  // 이슈 상세(화면 맞춤) → 칩 클릭(포인터가 목록 위) → 새 대화 → × 로 일반 키(추천을 새로 받아야 하는 키)로 바꾼다.
  const calls = await mockStarterSuggestions(page, { replies: [{ items: [], enabled: true }, { items: AI, enabled: true }] })
  await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-h' } }] })
  await mockIssueDetail(page)
  await page.goto('/projects/WP/issues/12')
  await page.getByTestId('chat-launcher').click()
  await calls.waitFor(1)
  await rows(page).first().click()
  await expect(page.getByTestId('starter-suggestions')).toHaveCount(0)
  await page.getByTestId('chat-new-session').click()
  await expect(page.getByTestId('starter-suggestions')).toBeVisible()
  await page.getByTestId('chat-context-remove').click()
  await page.getByTestId('chat-input').hover() // 포인터를 목록 밖으로 — 남은 보류가 있으면 풀 이벤트가 없다
  await calls.waitFor(2)
  await expect.poll(() => texts(page)).toEqual(AI)
})

test('응답을 기다리는 중 다른 질문을 보내 목록이 사라져도, 새 대화에서는 그 저장 결과가 보인다', async ({ authenticatedPage: page }) => {
  const g = gate()
  const calls = await mockStarterSuggestions(page, { replies: [{ items: AI, enabled: true }], gate: g.p })
  await mockHomeChatGeneration(page, { frames: [{ event: 'done', data: { sessionId: 's-r' } }] })
  await openChatPanel(page)
  await calls.waitFor(1)
  await page.getByTestId('chat-input').fill('직접 쓴 질문')
  await page.getByTestId('chat-panel').getByRole('button', { name: '보내기' }).click()
  await expect(page.getByTestId('starter-suggestions')).toHaveCount(0)
  const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/ai/suggestions'))
  g.release()
  await response
  await page.getByTestId('chat-new-session').click()
  await expect(page.getByTestId('starter-suggestions')).toBeVisible()
  await expect.poll(() => texts(page)).toEqual(AI) // 오늘 받은 저장 결과 — 고정 문구로 되돌아가지 않는다
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

// UI 리뷰 #2 — 스펙 §4.3 최대 40자 문구가 380px 패널에서 말줄임으로 잘리지 않고 두 줄까지 감겨 끝까지 보인다.
const LONG40 = '지난주 디자인 리뷰 회의록에서 결정된 사항과 담당자별 할일 모두 정리해줘'

test('40자 추천은 두 줄로 감겨 끝까지 보인다', async ({ authenticatedPage: page }) => {
  expect([...LONG40].length).toBe(40)
  await mockStarterSuggestions(page, { replies: [{ items: [LONG40, ...AI.slice(1)], enabled: true }] })
  await openChatPanel(page)
  await expect(rows(page).first()).toHaveText(LONG40)
  const text = rows(page).first().locator('span')
  const m = await text.evaluate((el) => ({
    lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
    clippedY: el.scrollHeight > el.clientHeight,
    clippedX: el.scrollWidth > el.clientWidth,
  }))
  expect(m).toEqual({ lines: 2, clippedY: false, clippedX: false })
})

// WP-398 — 추천은 입력 영역이 아닌 가운데 안내 바로 아래에 안내와 한 덩어리로 가운데 놓이고, 행은 왼쪽 정렬로 같은 시작점을 쓴다.
// 넓은 전체화면에서도 목록이 화면 가로로 늘어지지 않는다(최대 28rem).
test('추천은 가운데 안내 바로 아래에 가운데 덩어리로 놓인다(사이드 패널·전체화면)', async ({ authenticatedPage: page }) => {
  await openChatPanel(page)
  await expect(rows(page)).toHaveCount(4)
  await expect(page.getByTestId('ai-composer').getByTestId('starter-suggestions')).toHaveCount(0)
  const layout = async () => {
    const empty = page.getByTestId('ai-chat-empty-state')
    const sub = (await empty.getByText('무엇이든 질문해 보세요').boundingBox())!
    const list = (await empty.getByTestId('starter-suggestions').boundingBox())!
    const xs = await Promise.all((await rows(page).all()).map(async (r) => (await r.boundingBox())!.x))
    return { sub, list, xs }
  }
  for (const mode of ['side', 'fullscreen'] as const) {
    if (mode === 'fullscreen') {
      await page.getByTestId('ai-mode-fullscreen').click()
      await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
    }
    const { sub, list, xs } = await layout()
    expect(list.y, `${mode}: 목록이 안내 아래`).toBeGreaterThan(sub.y + sub.height)
    expect(Math.abs(list.x + list.width / 2 - (sub.x + sub.width / 2)), `${mode}: 안내와 가운데 정렬`).toBeLessThanOrEqual(2)
    expect(list.width, `${mode}: 가로로 늘어지지 않음`).toBeLessThanOrEqual(448)
    expect(new Set(xs.map(Math.round)).size, `${mode}: 행 시작점이 같다`).toBe(1)
  }
})

// UI 리뷰 #1 — 빈 대화 안내(+ 추천 목록, WP-398)는 공간이 넉넉하면 가운데, 영역이 안내보다 낮아지면(짧은 창) 위가 잘리지 않고 위에서부터 놓인다(safe center).
test('빈 대화 안내는 가운데 놓이고, 영역이 낮아져도 위쪽이 잘리지 않는다', async ({ authenticatedPage: page }) => {
  await openChatPanel(page)
  await expect(rows(page)).toHaveCount(4)
  const scroll = page.getByTestId('chat-scroll')
  const empty = page.getByTestId('ai-chat-empty-state')
  const guide = async () => {
    const s = (await scroll.boundingBox())!
    const icon = (await empty.locator('svg').first().boundingBox())!
    const list = (await empty.getByTestId('starter-suggestions').boundingBox())!
    return { s, top: icon.y, bottom: list.y + list.height }
  }
  const wide = await guide()
  expect(Math.abs((wide.top + wide.bottom) / 2 - (wide.s.y + wide.s.height / 2))).toBeLessThanOrEqual(2)

  // 대화 영역이 안내+목록 높이보다 낮아지는 창 높이 — 가운데 정렬이면 아이콘이 영역 위로 밀려 스크롤로도 못 본다.
  await page.setViewportSize({ width: 1280, height: 320 })
  await expect.poll(async () => (await guide()).s.height).toBeLessThan(wide.bottom - wide.top)
  // 스크롤 내용 좌표로 본다 — 넘치면 안내 영역이 스스로 스크롤하므로(WP-398), 화면 좌표가 아니라 "위로 스크롤하면 닿는가"가 기준이다.
  const iconOffset = await empty.evaluate((el) => {
    const icon = el.querySelector('svg')!
    return icon.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
  })
  expect(iconOffset).toBeGreaterThanOrEqual(0)
})
