// 모바일 AI 시트(WP-191) — 보던 화면 위 바텀 시트, 진입 버튼 생성 중·완료 표시, 목록 화면 컨텍스트(대화 전환 확인창은 WP-190 에서 제거 — 옮겨도 생성이 이어진다).
import type { Page } from '@playwright/test'

import { wikiPageSummary, wikiSpace } from '../../factories/wiki.factory'
import { mockApi } from '../../fixtures/api-mock'
import { mockHomeChatGeneration, mockStreamingHomeChat } from '../../fixtures/home-chat-mock'
import { expect, expectOnTop, stubChat, test } from '../../fixtures/mobile.fixture'
import type { HomeMessage, HomeSessionPage } from '../../../src/types/home'

/** 생성 지연 게이트 — release() 전까지 SSE 프레임을 보류한다. */
function gate() {
  let release!: () => void
  const p = new Promise<void>((r) => (release = r))
  return { p, release }
}

test('닫힌 탭바 ✦: 생성 중이면 pending, 닫힌 사이 끝나면 완료 점, 열면 해제', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const g = gate()
  await mockHomeChatGeneration(page, {
    gate: g.p,
    frames: [{ event: 'delta', data: { text: '요약했어요' } }, { event: 'done', data: { sessionId: 's-1' } }],
  })
  await page.goto('/chat')
  const tab = page.getByTestId('mobile-tab-ai')
  await expect(tab).toHaveAttribute('data-ai-activity', 'idle')
  await tab.click()
  await page.getByTestId('chat-input').fill('요약해줘')
  await page.getByRole('button', { name: '보내기' }).click()
  // 열려 있는 동안엔 표시하지 않는다.
  await expect(tab).toHaveAttribute('data-ai-activity', 'idle')
  await tab.click() // AI 칸 토글로 닫는다(시트의 × 로도 닫힌다)
  await expect(tab).toHaveAttribute('data-ai-activity', 'pending')
  await expect(tab).toHaveAttribute('aria-label', 'AI 비서, 답변 생성 중')
  g.release()
  await expect(tab).toHaveAttribute('data-ai-activity', 'done')
  await expect(tab.getByTestId('ai-trigger-dot')).toBeVisible()
  await tab.click()
  await expect(page.getByTestId('chat-panel')).toContainText('요약했어요')
  await tab.click()
  await expect(tab).toHaveAttribute('data-ai-activity', 'idle')
})

test('헤더 ✦(채팅방)도 같은 표시를 쓴다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const g = gate()
  await mockHomeChatGeneration(page, { gate: g.p, frames: [{ event: 'done', data: { sessionId: 's-2' } }] })
  await page.goto('/chat/channels/1')
  const btn = page.getByTestId('mobile-back-ai')
  await btn.click()
  await page.getByTestId('chat-input').fill('질문')
  // 채널 화면 뒤에도 메시지 작성기의 보내기가 있어 AI 패널 안으로 범위를 좁힌다.
  await page.getByTestId('chat-panel').getByRole('button', { name: '보내기' }).click()
  await page.getByTestId('ai-panel-close').click()
  await expect(btn).toHaveAttribute('data-ai-activity', 'pending')
  g.release()
  await expect(btn).toHaveAttribute('data-ai-activity', 'done')
})

test('동작 줄이기: 생성 중에도 회전·반짝임 없이 고정 점', async ({ authenticatedPage: page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await stubChat(page)
  const g = gate()
  await mockHomeChatGeneration(page, { gate: g.p, frames: [{ event: 'done', data: { sessionId: 's-3' } }] })
  await page.goto('/chat')
  const tab = page.getByTestId('mobile-tab-ai')
  await tab.click()
  await page.getByTestId('chat-input').fill('질문')
  await page.getByRole('button', { name: '보내기' }).click()
  await tab.click()
  await expect(tab).toHaveAttribute('data-ai-activity', 'pending')
  await expect(tab.getByTestId('ai-trigger-dot')).toBeVisible()
  const capsule = page.getByTestId('mobile-tab-ai-capsule')
  expect(await capsule.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('none')
  expect(await capsule.locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toBe('none')
  g.release()
})

test('동작 줄이기가 아니면 생성 중 캡슐 링은 회전, 아이콘은 반짝인다', async ({ authenticatedPage: page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await stubChat(page)
  const g = gate()
  await mockHomeChatGeneration(page, { gate: g.p, frames: [{ event: 'done', data: { sessionId: 's-4' } }] })
  await page.goto('/chat')
  const tab = page.getByTestId('mobile-tab-ai')
  await tab.click()
  await page.getByTestId('chat-input').fill('질문')
  await page.getByRole('button', { name: '보내기' }).click()
  await tab.click()
  await expect(tab).toHaveAttribute('data-ai-activity', 'pending')
  const capsule = page.getByTestId('mobile-tab-ai-capsule')
  expect(await capsule.evaluate((el) => getComputedStyle(el, '::before').animationName)).toBe('ai-ring-spin')
  expect(await capsule.locator('svg').evaluate((el) => getComputedStyle(el).animationName)).toBe('ai-twinkle')
  g.release()
})

test('AI 를 열어도 보던 탭 강조가 유지되고 AI 칸은 열림 상태만 갖는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('mobile-tab-chat')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('mobile-tab-ai')).not.toHaveAttribute('aria-current', /.*/)
  // 다시 누르면 닫힌다(토글).
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('mobile-tab-ai')).toHaveAttribute('aria-expanded', 'false')
})

test('탭 루트에서 연 시트: 보던 화면이 위로 비치고 탭바는 보이며, × 로 닫으면 ✦ 로 포커스가 돌아온다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  const trigger = page.getByTestId('mobile-tab-ai')
  await trigger.click()
  const sheet = page.getByTestId('ai-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('ai-fullscreen')).toHaveCount(0)
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  const top = (await sheet.boundingBox())!.y
  expect(top).toBeGreaterThanOrEqual(96) // 헤더(56)+한 줄(40) 위는 보던 화면
  const sheetBottom = (await sheet.boundingBox())!
  const bar = (await page.getByTestId('mobile-tabbar').boundingBox())!
  expect(Math.round(sheetBottom.y + sheetBottom.height)).toBeLessThanOrEqual(Math.round(bar.y) + 1)
  await expect(sheet.getByTestId('ai-sheet-session-switcher')).toBeVisible()
  // 닫기 × 는 터치 타깃 최소 44×44
  const closeBox = (await sheet.getByTestId('ai-panel-close').boundingBox())!
  expect(closeBox.width).toBeGreaterThanOrEqual(44)
  expect(closeBox.height).toBeGreaterThanOrEqual(44)
  await sheet.getByTestId('ai-panel-close').click()
  await expect(sheet).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('시트 닫기: 딤 탭 · 아래로 끌기 · 다른 탭', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  const sheet = page.getByTestId('ai-sheet')
  await page.getByTestId('mobile-tab-ai').click()
  await page.getByTestId('ai-sheet-backdrop').click({ position: { x: 20, y: 40 } })
  await expect(sheet).toHaveCount(0)
  await page.getByTestId('mobile-tab-ai').click()
  const h = (await page.getByTestId('ai-sheet-handle').boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2, h.y + 160, { steps: 8 })
  await page.mouse.up()
  await expect(sheet).toHaveCount(0)
  await page.getByTestId('mobile-tab-ai').click()
  await page.getByTestId('mobile-tab-home').click()
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/\/$/)
})

test('조금만 끌면 닫히지 않고 제자리로 돌아온다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  const sheet = page.getByTestId('ai-sheet')
  const before = (await sheet.boundingBox())!.y
  const h = (await page.getByTestId('ai-sheet-handle').boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + 2)
  await page.mouse.down()
  await page.mouse.move(h.x + h.width / 2, h.y + 30, { steps: 4 })
  await page.mouse.up()
  await expect(sheet).toBeVisible()
  await expect.poll(async () => Math.round((await sheet.boundingBox())!.y)).toBe(Math.round(before))
})

test('채팅방 헤더 ✦ 도 같은 시트를 열고, 탭바가 없으니 하단 안전영역을 시트가 비운다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('mobile-back-ai').click()
  const sheet = page.getByTestId('ai-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  // Chromium 은 안전영역 0 — 패딩 규칙이 적용됐는지는 클래스 계산값 대신 하단이 화면 끝에 닿는지로 본다.
  const b = (await sheet.boundingBox())!
  expect(Math.round(b.y + b.height)).toBe(page.viewportSize()!.height)
})

test.describe('키보드', () => {
  type FakeViewport = EventTarget & { height: number; offsetTop: number; scale: number }
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => {
      let override: number | null = null
      const vv = Object.assign(new EventTarget(), { offsetTop: 0, scale: 1 })
      Object.defineProperty(vv, 'height', { get: () => override ?? window.innerHeight, set: (v: number) => { override = v } })
      Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
      ;(window as unknown as { __vv: typeof vv }).__vv = vv
    })
  })
  async function setKeyboard(page: Page, open: boolean, px = 300): Promise<number> {
    return page.evaluate(([isOpen, kb]) => {
      const vv = (window as unknown as { __vv: FakeViewport }).__vv
      vv.height = isOpen ? window.innerHeight - (kb as number) : window.innerHeight
      vv.dispatchEvent(new Event('resize'))
      return vv.height
    }, [open, px] as const)
  }

  test('키보드가 열리면 시트가 보이는 영역을 채우고(헤더 56px 만 남김) 탭바를 덮는다', async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await page.goto('/chat')
    await page.getByTestId('mobile-tab-ai').click()
    await page.getByTestId('chat-input').focus()
    const visible = await setKeyboard(page, true)
    const sheet = page.getByTestId('ai-sheet')
    await expect.poll(async () => Math.round((await sheet.boundingBox())!.y)).toBe(56)
    const b = (await sheet.boundingBox())!
    expect(Math.round(b.y + b.height)).toBe(visible)
    const input = (await page.getByTestId('chat-input').boundingBox())!
    expect(input.y + input.height).toBeLessThanOrEqual(visible)
    // 탭바는 시트 아래에 깔린다(누를 수 없음).
    const tab = (await page.getByTestId('mobile-tab-home').boundingBox())!
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="ai-sheet-layer"]') != null, [tab.x + tab.width / 2, tab.y + tab.height / 2] as const)
    expect(hit).toBe(true)
  })
})

test('시트 대화 목록의 삭제 확인창도 시트 위에 뜬다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/home/sessions', {
    items: [{ id: 's-del', title: '지울 대화', lastMessageAt: '2026-06-10T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  })
  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await page.getByTestId('ai-sheet-session-switcher').click()
  await page.getByRole('menu', { name: '대화 목록' }).getByTestId('chat-session-delete').click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toBeVisible()
  await expectOnTop(page, confirm.getByRole('button', { name: '취소' }), '[role="alertdialog"]')
  // 확인창의 딤도 시트 위 — 시트(헤더 영역)를 덮어 흐린다.
  await expectOnTop(page, page.getByTestId('ai-sheet-session-switcher'), '[data-slot="alert-dialog-overlay"]')
  await confirm.getByRole('button', { name: '취소' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
})

// ── 목록 화면 컨텍스트(WP-191) — 탭 루트 목록에서 연 시트도 "지금 보는 목록" 칩을 보인다.
for (const [path, label] of [
  ['/chat', '채팅 목록'],
  ['/tasks', '작업 목록'],
  ['/drive', '드라이브 공간 목록'],
] as const) {
  test(`${path} 목록에서 연 시트에 화면 참고 칩: ${label}`, async ({ authenticatedPage: page }) => {
    await stubChat(page)
    await page.goto(path)
    await page.getByTestId('mobile-tab-ai').click()
    await expect(page.getByTestId('ai-sheet').getByTestId('chat-context-chip')).toContainText(label)
  })
}

test('홈에서 연 시트에 화면 참고 칩: 홈 대시보드', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  // 위젯 본문은 비워 둔 최소 레이아웃 — 칩은 레이아웃 해석만으로 등록된다.
  await page.route((u) => u.pathname === '/api/v1/me/dashboard', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: { widgets: [] } }) : r.fallback())
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet').getByTestId('chat-context-chip')).toContainText('홈 대시보드')
})

test('노트 공간 목록에서 연 시트에 화면 참고 칩: 위키 스페이스 이름', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) =>
    r.fulfill({ json: [wikiSpace({ id: 1, type: 'PERSONAL', name: '내 위키', role: 'OWNER' })] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/1/pages', (r) =>
    r.fulfill({ json: [wikiPageSummary({ id: 101, title: '개인 메모' })] }))
  await page.goto('/wiki/spaces/1')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet').getByTestId('chat-context-chip')).toContainText('위키 스페이스 내 위키')
})

test('앱 목록에서 연 시트엔 칩이 없다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect(page.getByTestId('chat-context-chip')).toHaveCount(0)
})

test('시트 대화 바닥에서 손가락이 살짝 끌렸지만 스크롤되지 않았으면(탭·길게 누르기) 스트리밍을 계속 따라간다 (WP-234)', async ({ authenticatedPage: page }) => {
  // 회귀 가드: 아래로 끄는 터치 이동만으로 하단 고정을 푸는데, 터치 슬롭 안의 작은 끌림(탭·길게 누르기)은 스크롤을 일으키지 않아
  // scroll 이벤트가 오지 않고 고정이 풀린 채 남았다 — 이후 응답이 화면 아래로 밀려나 따라가지 않는다.
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/home/sessions', {
    items: [{ id: 's-touch', title: '터치 대화', lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }],
    nextCursor: null,
  } satisfies HomeSessionPage)
  const messages: HomeMessage[] = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
    content: `메시지 ${i + 1}`,
    widgets: null,
    toolCalls: null,
    createdAt: '2026-10-06T00:00:00Z',
  }))
  await mockApi(page, 'GET', '/api/v1/home/sessions/s-touch/messages', messages)
  const { delta } = await mockStreamingHomeChat(page)

  await page.goto('/chat')
  await page.getByTestId('mobile-tab-ai').click()
  await page.getByTestId('ai-sheet-session-switcher').click()
  await page.getByTestId('chat-session-select').first().click()
  await expect(page.getByTestId('ai-sheet')).toContainText('메시지 30')
  const scroll = page.getByTestId('chat-scroll')
  const dist = () => scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
  await page.getByTestId('chat-input').fill('길게 답해 줘')
  await page.getByTestId('chat-panel').getByTestId('chat-send').tap()
  await delta('앞부분')
  await expect(page.getByTestId('ai-sheet')).toContainText('앞부분')
  await expect.poll(dist).toBeLessThanOrEqual(2)

  // 손가락이 3px 아래로 끌렸다 떨어진다 — 합성 터치라 채팅 영역은 움직이지 않는다.
  await scroll.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const at = (y: number) => new Touch({ identifier: 1, target: el, clientX: r.left + 20, clientY: y })
    const y0 = r.top + r.height / 2
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [at(y0)], changedTouches: [at(y0)], bubbles: true }))
    el.dispatchEvent(new TouchEvent('touchmove', { touches: [at(y0 + 3)], changedTouches: [at(y0 + 3)], bubbles: true }))
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [at(y0 + 3)], bubbles: true }))
  })
  for (let i = 0; i < 10; i++) {
    await delta(`\n\n이어지는 줄 ${i}`)
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  }
  await expect(page.getByTestId('ai-sheet')).toContainText('이어지는 줄 9')
  await expect.poll(dist).toBeLessThanOrEqual(2)
})
