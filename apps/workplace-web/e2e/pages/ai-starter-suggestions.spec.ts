// WP-139 빈 AI 대화 추천 질문(데스크톱 사이드 패널) E2E — 브라우저가 있어야 판정되는 것만 남긴다:
// 포인터·키보드 포커스가 목록 안에 있으면 교체를 미루는 것(@input), 40자 두 줄 감김·가운데 배치·짧은 창 safe center(@layout).
// 고정 문구 → AI 교체·저장 결과 재사용·지난 날짜 갱신·클릭 전송·화면 맞춤과 × 전환·실패·꺼짐·enabled:false·응답 대기 중 전송·
// 이력 읽는 중 숨김·동시 답변 상한 비활성은 페이지 테스트 src/components/ai/aiStarterSuggestions.test.tsx 가 지킨다(WP-966).
import type { Page } from '@playwright/test'

import { openChatPanel } from '../fixtures/ai-live-chat'
import { mockStarterSuggestions } from '../fixtures/ai-suggestions-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { mockHomeChatGeneration } from '../fixtures/home-chat-mock'
import { mockIssueDetail } from '../fixtures/issue-detail-mock'
import { boxOf, expectStartAligned } from '../fixtures/layout'
import { expectStays, gate } from '../fixtures/wait'

const GENERAL = ['오늘 일정 요약해줘', '나를 멘션한 메시지 정리해줘', '내 작업 우선순위 정리해줘', '답장이 필요한 메일 알려줘']
const AI = ['3분기 매출 보고서 진행 알려줘', '오늘 오후 회의 안건 정리해줘', '어제 받은 메일 중 급한 것 알려줘', '내 리뷰 대기 이슈 보여줘']

const rows = (page: Page) => page.getByTestId('starter-suggestion')
const texts = async (page: Page) => rows(page).allTextContents()

test('포인터가 목록 위에 있으면 교체를 미루고, 벗어나면 바꾼다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

test('키보드 포커스가 목록 안에 있으면 교체를 미루고, 벗어나면 바꾼다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

test('칩을 눌러 목록이 사라진 뒤에도 보류가 남지 않아, 새 대화에서 받은 추천이 바로 바뀐다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
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

// UI 리뷰 #2 — 스펙 §4.3 최대 40자 문구가 380px 패널에서 말줄임으로 잘리지 않고 두 줄까지 감겨 끝까지 보인다.
const LONG40 = '지난주 디자인 리뷰 회의록에서 결정된 사항과 담당자별 할일 모두 정리해줘'

test('40자 추천은 두 줄로 감겨 끝까지 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
test('추천은 가운데 안내 바로 아래에 가운데 덩어리로 놓인다(사이드 패널·전체화면)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await openChatPanel(page)
  await expect(rows(page)).toHaveCount(4)
  await expect(page.getByTestId('ai-composer').getByTestId('starter-suggestions')).toHaveCount(0)
  const layout = async () => {
    const empty = page.getByTestId('ai-chat-empty-state')
    return Promise.all([boxOf(empty.getByText('무엇이든 질문해 보세요')), boxOf(empty.getByTestId('starter-suggestions'))])
  }
  for (const mode of ['side', 'fullscreen'] as const) {
    if (mode === 'fullscreen') {
      await page.getByTestId('ai-mode-fullscreen').click()
      await expect(page.getByTestId('ai-fullscreen')).toBeVisible()
    }
    const [sub, list] = await layout()
    expect(list.y, `${mode}: 목록이 안내 아래`).toBeGreaterThan(sub.y + sub.height)
    expect(Math.abs(list.x + list.width / 2 - (sub.x + sub.width / 2)), `${mode}: 안내와 가운데 정렬`).toBeLessThanOrEqual(2)
    expect(list.width, `${mode}: 가로로 늘어지지 않음`).toBeLessThanOrEqual(448)
    for (let i = 1; i < 4; i++) await expectStartAligned(rows(page).nth(i), rows(page).first())
  }
})

// UI 리뷰 #1 — 빈 대화 안내(+ 추천 목록, WP-398)는 공간이 넉넉하면 가운데, 영역이 안내보다 낮아지면(짧은 창) 위가 잘리지 않고 위에서부터 놓인다(safe center).
test('빈 대화 안내는 가운데 놓이고, 영역이 낮아져도 위쪽이 잘리지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
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
