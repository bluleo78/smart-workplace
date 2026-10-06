// 가상 키보드 대응(WP-154) — iOS 는 키보드가 올라와도 100dvh 를 줄이지 않고 페이지를 위로 밀어, 헤더가 화면 밖으로 사라지고
// 본문이 상태바 아래로 들어갔다. 셸은 visualViewport 높이에 맞춰 줄어들어 헤더는 제자리, 입력창은 키보드 바로 위에 있어야 한다.
// Chromium 은 가상 키보드가 없으므로 visualViewport 를 가짜 객체로 바꿔 키보드 열림/닫힘을 흉내 낸다.
import type { Locator, Page } from '@playwright/test'

import { mailAccount, summary } from '../../factories/mail.factory'
import { createChannel, createMessage } from '../../factories/messaging.factory'
import { mockApi } from '../../fixtures/api-mock'
import { json, stubChannelMessages } from '../../fixtures/mobile-chat'
import { expect, test } from '../../fixtures/mobile.fixture'

const KEYBOARD_PX = 300

type FakeViewport = EventTarget & { height: number; offsetTop: number; scale: number }

test.beforeEach(async ({ authenticatedPage: page }) => {
  // 앱 스크립트보다 먼저 실행돼야 훅이 가짜 visualViewport 를 구독한다.
  await page.addInitScript(() => {
    // height 는 덮어쓰기 전엔 현재 innerHeight 를 따른다 — init 시점 innerHeight 는 레이아웃 전 값(1669 등)이라 고정하면 기준 높이가 틀어진다.
    let override: number | null = null
    const vv = Object.assign(new EventTarget(), { offsetTop: 0, scale: 1 })
    Object.defineProperty(vv, 'height', {
      get: () => override ?? window.innerHeight,
      set: (v: number) => {
        override = v
      },
    })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
    ;(window as unknown as { __vv: typeof vv }).__vv = vv
  })
})

/**
 * 가짜 visualViewport 높이·배율을 바꾸고 resize 를 알린다 — 키보드 높이만큼 줄이면 '열림'.
 * 키보드 위로 보이는 높이(px)를 돌려준다.
 */
async function setKeyboard(page: Page, open: boolean, { px = KEYBOARD_PX, scale = 1, offsetTop = 0 } = {}): Promise<number> {
  return page.evaluate(
    ([isOpen, kb, s, top]) => {
      const vv = (window as unknown as { __vv: FakeViewport }).__vv
      vv.height = isOpen ? window.innerHeight - (kb as number) : window.innerHeight
      vv.scale = s as number
      vv.offsetTop = isOpen ? (top as number) : 0
      vv.dispatchEvent(new Event('resize'))
      return vv.height
    },
    [open, px, scale, offsetTop] as const,
  )
}

/** 키보드 열림으로 판정되지 않았음을 확인한다 — 이벤트 처리 후 한 프레임 기다린 뒤 :root 속성 부재를 본다. */
async function expectKeyboardClosed(page: Page) {
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard-open', 'true')
}

/**
 * 컨테이너 안에 임시 입력칸을 넣고 포커스한다 — 판정이 '편집 요소 포커스'를 요구하는데 입력칸이 없는 시트용.
 * 모달(Radix)은 포커스를 내부에 가두므로 반드시 컨테이너 안에 넣는다. 레이아웃에 영향 없도록 화면 밖 fixed 로 둔다.
 */
async function focusTemporaryInput(container: Locator) {
  await container.evaluate((el) => {
    const input = document.createElement('input')
    input.style.cssText = 'position:fixed;top:0;left:-9999px'
    el.appendChild(input)
    input.focus()
  })
}

/** 메일 목록에서 모바일 사이드바(하단 시트)를 연다. */
async function openMailSidebar(page: Page): Promise<Locator> {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail')
  await page.getByTestId('mobile-sidebar-trigger').click()
  const sheet = page.getByTestId('mobile-sidebar-sheet')
  await expect(sheet).toBeVisible()
  return sheet
}

test('키보드가 열리면 셸이 보이는 높이로 줄어 헤더는 제자리, 입력창은 키보드 바로 위에 남는다', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  await page.goto('/chat/channels/1')
  const shell = page.getByTestId('mobile-shell')
  const input = page.getByTestId('message-composer-input')
  await expect(input).toBeVisible()
  const innerHeight = await page.evaluate(() => window.innerHeight)

  await input.click()
  const visible = await setKeyboard(page, true)
  await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', 'true')
  await expect.poll(async () => (await shell.boundingBox())?.height).toBe(visible)

  // 헤더는 화면 위쪽 안(밀려 올라가지 않음), 입력창 하단은 키보드 위(보이는 영역 안).
  const header = await page.getByTestId('channel-header').boundingBox()
  expect(header?.y).toBeGreaterThanOrEqual(0)
  const box = await input.boundingBox()
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(visible)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  // 키보드가 닫히면 100dvh 로 복귀한다.
  await setKeyboard(page, false)
  await expectKeyboardClosed(page)
  await expect.poll(async () => (await shell.boundingBox())?.height).toBe(innerHeight)
})

test('iOS 가 보이는 영역을 아래로 옮겨도(offsetTop>0) 셸이 그 위치를 따라가 헤더가 보이는 영역 맨 위에 남는다', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  await page.goto('/chat/channels/1')
  const shell = page.getByTestId('mobile-shell')
  await page.getByTestId('message-composer-input').click()
  // 실기기 관찰(WP-154): kb=true 인데도 밀림 — scrollY 는 0 이고 보이는 영역만 레이아웃 아래로 이동한 상황을 흉내 낸다.
  const visible = await setKeyboard(page, true, { offsetTop: 200 })
  await expect.poll(async () => (await shell.boundingBox())?.y).toBe(200)
  expect((await shell.boundingBox())?.height).toBe(visible)
  // 헤더는 보이는 영역의 위쪽 끝(offsetTop) 이상에 있다.
  expect((await page.getByTestId('channel-header').boundingBox())!.y).toBeGreaterThanOrEqual(200)
  // 키보드가 닫히면 고정이 풀려 원래 자리(0)로 돌아온다.
  await setKeyboard(page, false)
  await expect.poll(async () => (await shell.boundingBox())?.y).toBe(0)
})

test('주소창 높이 변화 정도(임계값 미만)로는 키보드 열림으로 보지 않는다', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('message-composer-input').click()
  await setKeyboard(page, true, { px: 80 })
  await expectKeyboardClosed(page)
})

test('핀치 줌으로 보이는 영역이 줄어든 것은 키보드 열림으로 보지 않는다(입력 포커스가 있어도)', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('message-composer-input').click()
  await setKeyboard(page, true, { scale: 1.5 })
  await expectKeyboardClosed(page)
})

test('편집 요소에 포커스가 없으면 보이는 영역이 줄어도 키보드 열림으로 보지 않는다', async ({ authenticatedPage: page }) => {
  await page.goto('/')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await setKeyboard(page, true)
  await expectKeyboardClosed(page)
})

// 셸 밖(portal)에 그려지는 fixed 요소 — 셸 높이와 무관하므로 index.css·도크가 :root 의 키보드 값으로 보이는 영역 안에 둔다.
test('키보드가 열리면 다이얼로그가 보이는 영역 안(키보드 위)에 들어온다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [])
  await page.goto('/settings/mail')
  await page.getByTestId('page-header').getByTestId('mail-add-trigger').click()
  const dialog = page.locator('[data-slot="dialog-content"]')
  await expect(dialog).toBeVisible()
  // 다이얼로그 안 첫 입력칸에 포커스(실사용과 같은 경로).
  await dialog.locator('input').first().focus()
  const visible = await setKeyboard(page, true)
  await expect.poll(async () => {
    const box = (await dialog.boundingBox())!
    return box.y >= 0 && box.y + box.height <= visible
  }).toBe(true)
})

test('키보드가 열리면 하단 시트가 키보드 바로 위로 올라온다', async ({ authenticatedPage: page }) => {
  const sheet = await openMailSidebar(page)
  await focusTemporaryInput(sheet)
  const visible = await setKeyboard(page, true)
  await expect.poll(async () => {
    const box = (await sheet.boundingBox())!
    return Math.round(box.y + box.height)
  }).toBe(visible)
  expect((await sheet.boundingBox())!.y).toBeGreaterThanOrEqual(0)
})

test('키보드가 열리면 메일 작성 도크가 탭바 위·키보드 위에 남는다', async ({ authenticatedPage: page }) => {
  const sheet = await openMailSidebar(page)
  await sheet.getByTestId('mail-compose-new').click()
  const dock = page.getByTestId('mail-compose-dock')
  await expect(dock).toBeVisible()
  // 작성을 눌러도 시트는 열린 채이므로 Esc 로 닫아 탭바를 드러낸다.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await dock.locator('input').first().focus()
  await setKeyboard(page, true)
  const bar = page.getByTestId('mobile-tabbar')
  // 셸이 줄어 탭바가 키보드 바로 위로 오고, 도크는 그 탭바 위에 붙는다(상단은 화면 안).
  await expect.poll(async () => {
    const d = (await dock.boundingBox())!
    const b = (await bar.boundingBox())!
    return Math.round(d.y + d.height) <= Math.round(b.y) && d.y >= 0
  }).toBe(true)
})

test('홈 화면 앱처럼 innerHeight 도 키보드와 함께 줄어도 키보드 열림으로 판정한다(지금까지 본 최대 높이 기준)', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  await page.goto('/chat/channels/1')
  await page.getByTestId('message-composer-input').click()
  // iOS standalone·Android: innerHeight 가 보이는 높이와 같이 줄어든다 — innerHeight 대비 비교로는 차이가 0 이다.
  await page.evaluate((kb) => {
    const shrunk = window.innerHeight - kb
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => shrunk })
    const vv = (window as unknown as { __vv: EventTarget & { height: number } }).__vv
    vv.height = shrunk
    vv.dispatchEvent(new Event('resize'))
  }, KEYBOARD_PX)
  await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', 'true')
})

test('목록 바닥을 보던 중 키보드가 열려 목록이 줄어도 바닥(최신 메시지)에 그대로 붙어 있다', async ({ authenticatedPage: page }) => {
  await stubChannelMessages(page)
  // 스크롤이 생기도록 메시지를 넉넉히 — 나중에 등록한 라우트가 우선한다.
  const items = Array.from({ length: 40 }, (_, i) =>
    createMessage({ id: 100 + i, channelId: 1, authorId: 20, authorName: '동료', body: `메시지 ${i}`, createdAt: `2026-09-30T04:${String(i).padStart(2, '0')}:00Z` }),
  ).reverse()
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1/messages', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json({ items, nextCursor: null, hasMore: false })) : r.fallback())
  // 다 읽은 방 — 미읽음이 있으면 진입 시 캐치업 카드 윗변으로 앵커돼(WP-256) "바닥을 보던 중" 전제가 깨진다.
  await page.route((u) => u.pathname === '/api/v1/messaging/channels/1', (r) =>
    r.request().method() === 'GET' ? r.fulfill(json(createChannel({ id: 1, name: '모바일-개편', lastReadMessageId: 139 }))) : r.fallback())
  await page.goto('/chat/channels/1')
  const area = page.getByTestId('message-scroll-area')
  const distFromBottom = () => area.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
  await expect(page.getByText('메시지 39')).toBeVisible()
  await expect.poll(distFromBottom).toBeLessThanOrEqual(1)

  await page.getByTestId('message-composer-input').click()
  await setKeyboard(page, true)
  await expect(page.locator('html')).toHaveAttribute('data-keyboard-open', 'true')
  // 목록 높이가 키보드만큼 줄어도 바닥에 붙어 있고, 마지막 메시지가 보인다.
  await expect.poll(distFromBottom).toBeLessThanOrEqual(1)
  await expect(page.getByText('메시지 39')).toBeInViewport()
})
