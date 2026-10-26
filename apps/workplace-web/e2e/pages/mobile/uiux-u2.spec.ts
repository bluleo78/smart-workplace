// 모바일 UI/UX 보정 U2(WP-121) — 앱 목록 길게 누르기(스크림·들림·코치마크·📌 배지), 탭 편집 헤더,
// AI 탭 캡슐·풀스크린 입력, 목록 밀도, 캘린더 도구 줄, 노트 헤더 병합, ⋯ 메뉴 키보드, 알림 푸시 화면을 고정한다.
// 브라우저가 있어야 판정되는 것(길게 누르기·키보드 탐색 @input, 크기·겹침·계산 스타일 @layout, 새로고침 뒤 유지 @platform,
// 앱 목록 → 알림 → ‹ 흐름 @flow)만 남긴다. 📌 배지 교체 메뉴·탭 편집 꽉 참 안내·저장 반영·‹ 복귀는
// 페이지 테스트 src/pages/mobile/uiuxU2.test.tsx, 상세 ✦ AI 시트(탭바 없음·× 닫기)는 src/pages/mobile/moduleLayout.test.tsx 가 지킨다(WP-981).
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiSpace } from '../../../src/types/wiki'
import { member, page as makeContactPage } from '../../factories/contacts.factory'
import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test, toCalendarMonthView } from '../../fixtures/mobile.fixture'
import { dismissByOutsideClick } from '../../fixtures/wait'

/** 실제 마우스로 길게 누른다 — 메뉴가 뜰 때까지 누른 채 기다렸다가 뗀다(떼는 click 이 이동을 일으키지 않는지도 함께). */
async function longPress(page: Page, testId: string) {
  await page.getByTestId(testId).hover()
  await page.mouse.down()
  await expect(page.getByTestId('apps-menu')).toBeVisible()
  await page.mouse.up()
}

test('앱 길게 누르기: 스크림이 깔리고 누른 칸이 들리며, 메뉴는 칸(이름 포함) 바로 아래에 뜬다', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  const tile = page.getByTestId('apps-app-drive')
  await longPress(page, 'apps-app-drive')
  await expect(page).toHaveURL(/\/apps$/)
  const scrim = page.getByTestId('apps-scrim')
  await expect(scrim).toBeVisible()
  // 스크림은 화면 전체(탭바 포함)를 덮는 반투명 검정.
  const sb = (await scrim.boundingBox())!
  const vp = page.viewportSize()!
  expect(sb.width).toBeGreaterThanOrEqual(vp.width)
  expect(sb.height).toBeGreaterThanOrEqual(vp.height)
  expect(await scrim.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(/(rgba\(0, 0, 0, 0\.35\)|oklab\(0 0 0 \/ 0\.35\))/)
  // 누른 칸은 1.08배로 들리고 스크림보다 위(z-index)에 있다.
  const wrapper = tile.locator('xpath=..')
  expect(await wrapper.evaluate((el) => getComputedStyle(el).scale)).toBe('1.08')
  const z = await wrapper.evaluate((el) => Number(getComputedStyle(el).zIndex))
  expect(z).toBeGreaterThan(await scrim.evaluate((el) => Number(getComputedStyle(el).zIndex)))
  // 들린 칸이 실제로 스크림 위에서 눌린다(elementFromPoint).
  const tb = (await tile.boundingBox())!
  const topId = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), [tb.x + tb.width / 2, tb.y + tb.height / 2])
  expect(topId).toBe('apps-app-drive')
  // 메뉴는 칸(아이콘+이름) 아래에 붙어 이름을 가리지 않는다.
  const menu = page.getByTestId('apps-menu')
  const mb = (await menu.boundingBox())!
  expect(mb.y).toBeGreaterThanOrEqual(tb.y + tb.height - 1)
  await expectNoHorizontalOverflow(page)
  // 스크림을 누르면 닫히고 이동하지 않는다.
  // 열린 직후의 클릭이 무시될 수 있어 메뉴가 닫힐 때까지 스크림을 다시 누른다(WP-225).
  await dismissByOutsideClick(page, menu, { x: 20, y: 780 })
  // 숨김에 그치지 않고 DOM 에서 빠진다(헬퍼의 toBeHidden 보다 강한 단언).
  await expect(menu).toHaveCount(0)
  await expect(scrim).toHaveCount(0)
  await expect(page).toHaveURL(/\/apps$/)
})

test('앱 칸: iOS 콜아웃·텍스트 선택 억제 스타일', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  const tile = page.getByTestId('apps-app-calendar')
  expect(await tile.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none')
  // -webkit-touch-callout 은 iOS WebKit 전용 속성이라 Chromium 계산 스타일엔 없다 → 클래스 적용 여부로 확인.
  await expect(tile).toHaveClass(/\[-webkit-touch-callout:none\]/)
})

test('코치마크 "길게 눌러 탭바에 고정" 은 처음 한 번만 — 새로고침하면 사라지고, 닫기로 즉시 숨길 수 있다', { tag: '@platform' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  const coach = page.getByTestId('apps-coach')
  await expect(coach).toContainText('길게 눌러 탭바에 고정')
  await expect.poll(() => page.evaluate(() => localStorage.getItem('apps-coach-seen'))).toBe('1')
  await page.getByTestId('apps-coach-dismiss').click()
  await expect(coach).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('apps-app-home')).toBeVisible()
  await expect(coach).toHaveCount(0)
  // 탭바 순서 편집 진입로는 그대로 남는다.
  await expect(page.getByTestId('apps-edit-tabs')).toBeVisible()
})

test('📌 배지는 28px 이상 누를 수 있는 크기다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  const bb = (await page.getByTestId('apps-pinned-chat').boundingBox())!
  expect(bb.width).toBeGreaterThanOrEqual(28)
})

test('탭 편집: 저장이 한 줄 헤더 안에 있고, ↑·↓·−·＋ 편집 버튼이 44×44 이상이며 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps/tabs')
  await expect(page.getByTestId('tab-edit-header').getByTestId('tab-edit-save')).toBeVisible()
  for (const id of ['tab-edit-up-1', 'tab-edit-down-1', 'tab-edit-remove-1', 'tab-edit-add-tasks']) {
    const b = (await page.getByTestId(id).boundingBox())!
    expect(b.width).toBeGreaterThanOrEqual(44)
    expect(b.height).toBeGreaterThanOrEqual(44)
  }
  await expectNoHorizontalOverflow(page)
})

test('AI 탭 캡슐: 닫힘 = 옅은 틴트(그라데이션 없음), 열림 = 그라데이션', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  const capsule = page.getByTestId('mobile-tab-ai-capsule')
  const bgImage = () => capsule.evaluate((el) => getComputedStyle(el).backgroundImage)
  expect(await bgImage()).toBe('none')
  expect(await capsule.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await page.getByTestId('mobile-tab-ai').click()
  await expect(page.getByTestId('ai-sheet')).toBeVisible()
  await expect.poll(bgImage).toContain('gradient')
})

// WP-191: 탭 루트 시트에도 × 가 있다(구 U2-3 "× 없음" 대체) — × 와 탭 전환 모두 닫기.
test('모바일 AI 시트(탭 루트): × 있음·⌘K 힌트 없음·40px 원형 보내기, 탭 전환으로도 닫힌다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  const fs = page.getByTestId('ai-sheet')
  await expect(fs).toBeVisible()
  await expect(fs.getByTestId('ai-panel-close')).toBeVisible()
  const input = page.getByTestId('chat-input')
  await expect(input).toHaveAttribute('placeholder', 'AI 에게 요청…')
  // 포커스 링은 단일(오프셋 띠 없음).
  await input.focus()
  expect(await input.evaluate((el) => getComputedStyle(el).getPropertyValue('--tw-ring-offset-width'))).toMatch(/^0(px)?$/)
  const send = fs.getByRole('button', { name: '보내기' })
  const sb = (await send.boundingBox())!
  expect(Math.round(sb.width)).toBe(40)
  expect(Math.round(sb.height)).toBe(40)
  expect(await send.evaluate((el) => getComputedStyle(el).borderRadius)).not.toBe('0px')
  await expectNoHorizontalOverflow(page)
  // 다른 탭을 누르면 닫히고 그 탭으로 간다.
  await page.getByTestId('mobile-tab-chat').click()
  await expect(fs).toHaveCount(0)
  await expect(page).toHaveURL(/\/chat$/)
})

test('목록 밀도(/chat): 행 44~56px·본문색, 섹션 머리말 ≤36px, 머리말 아이콘 터치 영역 확장, 미읽음 행 굵게', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await stubChat(page, { unread: 3 })
  await page.goto('/chat')
  const list = page.getByTestId('mobile-module-list')
  for (const id of ['sidebar-threads-link', 'channel-link-1', 'dm-self-link']) {
    const h = (await list.getByTestId(id).boundingBox())!.height
    expect(h, id).toBeGreaterThanOrEqual(44)
    expect(h, id).toBeLessThanOrEqual(72) // 대화 행은 미리보기 2줄 구성(WP-135) — 56px 이상
  }
  // 행 글자는 본문색(흐린 muted 아님).
  const fg = await page.evaluate(() => getComputedStyle(document.body).color)
  expect(await list.getByTestId('dm-self-link').evaluate((el) => getComputedStyle(el).color)).toBe(fg)
  // 섹션 머리말(채널 ＋🔍)이 44px 로 부풀지 않는다.
  const header = list.getByTestId('channel-create-btn').locator('xpath=../..')
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(36)
  // 아이콘 버튼 자체는 작아도 ::after 로 사방 10px 터치 영역.
  const after = await list.getByTestId('channel-create-btn').evaluate((el) => {
    const cs = getComputedStyle(el, '::after')
    return { pos: cs.position, top: cs.top, content: cs.content }
  })
  expect(after.pos).toBe('absolute')
  expect(after.top).toBe('-10px')
  // 미읽음 배지가 있는 채널 행은 이름이 굵게(WP-135: 행 전체가 아니라 이름 요소).
  expect(Number(await list.getByTestId('conv-name-1').evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600)
  expect(Number(await list.getByTestId('conv-name-self').evaluate((el) => getComputedStyle(el).fontWeight))).toBeLessThan(600)
  await expectNoHorizontalOverflow(page)
})

test('목록 밀도(/tasks·/settings): 행 44~56px, 설정 행만 끝에 › 셰브런', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.goto('/tasks')
  const rows = page.getByTestId('mobile-module-list').locator('nav a')
  await expect(rows.first()).toBeVisible()
  for (const b of await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
    expect(b).toBeGreaterThanOrEqual(44)
    expect(b).toBeLessThanOrEqual(56)
  }
  // 작업 목록엔 셰브런 없음(설정 전용).
  expect(await rows.first().evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none')
  await page.goto('/settings')
  const link = page.getByTestId('mobile-module-list').locator('a[href="/settings/profile"]')
  expect(await link.evaluate((el) => getComputedStyle(el, '::after').content)).toBe('"›"')
  const lb = (await link.boundingBox())!
  expect(lb.height).toBeGreaterThanOrEqual(44)
  expect(lb.height).toBeLessThanOrEqual(56)
  await expectNoHorizontalOverflow(page)
})

test('캘린더: 헤더엔 제목만(잘림 없음), 도구 줄의 오늘·‹·› 는 44×44 이상이고 뷰 전환 select 가 동작', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  // 오늘 = 2027-01 — 월 보기에서 지난해 12월로 가면 가장 긴 제목('2026년 12월' + ▾, WP-136: 다른 해면 'yyyy년 M월')이 된다.
  await page.clock.setFixedTime(new Date('2027-01-15T10:00:00'))
  await mockApi(page, 'GET', '/api/v1/calendars', [])
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await page.goto('/calendar')
  const header = page.getByTestId('page-header')
  const h1 = header.locator('h1')
  // 같은 해면 'M월'(제목이 미니 달력 버튼「1월 ▾」, ▾ 는 아이콘).
  await expect(h1).toHaveText('1월')
  // 헤더엔 이동 버튼·⋯ 가 없다(도구 줄로 이동).
  await expect(header.getByTestId('calendar-today')).toHaveCount(0)
  await expect(header.getByTestId('mobile-header-more')).toHaveCount(0)
  const toolbar = page.getByTestId('calendar-mobile-toolbar')
  // 모바일 첫 보기(일정 목록)는 ‹ › 를 숨긴다 — 이동 버튼이 있는 월 보기에서 크기·동작을 본다.
  const select = toolbar.getByTestId('calendar-view-select')
  await toCalendarMonthView(page, toolbar)
  for (const id of ['calendar-today', 'calendar-prev', 'calendar-next']) {
    const b = (await toolbar.getByTestId(id).boundingBox())!
    expect(b.width, id).toBeGreaterThanOrEqual(44)
    expect(b.height, id).toBeGreaterThanOrEqual(44)
  }
  await toolbar.getByTestId('calendar-prev').click()
  // 다른 해로 넘어가면 'yyyy년 M월' — 가장 긴 제목도 잘리지 않고 좌측 16px 에서 시작한다.
  await expect(h1).toHaveText('2026년 12월')
  expect(await h1.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
  expect(await page.getByTestId('calendar-title').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
  expect(Math.round((await h1.boundingBox())!.x)).toBe(16)
  await toolbar.getByTestId('calendar-today').click()
  await expect(h1).toHaveText('1월')
  await select.selectOption('agenda')
  await expect(page.getByTestId('calendar-view-agenda')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('연락처: 헤더 주 액션은 ＋ 아이콘 하나(aria-label "새 외부 연락처")', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill({ json: makeContactPage([member()]) }))
  await page.goto('/contacts')
  const create = page.getByTestId('contact-create')
  await expect(create).toHaveCount(1)
  await expect(create).toHaveAccessibleName('새 외부 연락처')
  const b = (await create.boundingBox())!
  expect(b.width).toBeGreaterThanOrEqual(44)
})

test('알림: 앱 목록의 🔔 로 열면 탭바 없는 푸시 화면, 알림을 고정하면 탭바가 있다', { tag: '@flow' }, async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/apps')
  await page.getByTestId('mobile-bell').click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByTestId('notifications-header')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/apps$/)
  await page.evaluate(() => localStorage.setItem('mobile-tabs', JSON.stringify(['home', 'notifications', 'mail'])))
  await page.goto('/notifications')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
})

const SPACE: WikiSpace = { id: 1, type: 'PERSONAL', name: '내 위키', ownerId: 1, role: 'OWNER', createdAt: '2026-06-01T00:00:00Z' }
const WIKI_PAGE: WikiPageDetail = {
  id: 100, spaceId: 1, parentId: null, title: '모바일 개편 메모', body: '', version: 1,
  updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: null, aiLastAction: null,
}

test('노트 페이지: ‹·페이지 제목·⋯·✦ 가 한 줄 헤더(레이아웃 뒤로가기 바와 두 줄로 쌓이지 않음)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [SPACE] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/1/pages', (r) =>
    r.fulfill({ json: [{ id: 100, parentId: null, title: WIKI_PAGE.title, position: 0, aiLastUsedAt: null }] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/pages/100', (r) => r.fulfill({ json: WIKI_PAGE }))
  await page.goto('/wiki/spaces/1/pages/100')
  const header = page.getByTestId('wiki-page-header')
  await expect(header).toBeVisible()
  await expect(page.getByTestId('mobile-back')).toHaveCount(1)
  await expect(header.getByTestId('mobile-back')).toBeVisible()
  await expect(header.getByTestId('mobile-back-title')).toHaveText(WIKI_PAGE.title)
  // AI 작성(▾)은 헤더가 아니라 ⋯ 메뉴 안(U3-R1) — 헤더의 AI 진입점은 ✦ 하나.
  await expect(header.getByTestId('wiki-ai-header-button')).toHaveCount(0)
  await expect(header.getByTestId('mobile-back-ai')).toBeVisible()
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(57)
  // 페이지 메뉴는 44px 터치 타깃이고 소스 보기 항목이 열린다.
  const menu = header.getByRole('button', { name: '페이지 메뉴' })
  expect((await menu.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await menu.click()
  await expect(page.getByTestId('wiki-menu-source')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('⋯ 메뉴 키보드: 열면 첫 항목 포커스, ↓↑ 로 이동, Esc 로 닫고 ⋯ 로 포커스 복귀', { tag: '@input' }, async ({ authenticatedPage: page }) => {
  await page.route('**/api/v1/projects/WP', (r) => r.fulfill({ json: createProject() }))
  await page.goto('/projects/WP')
  const trigger = page.getByTestId('mobile-header-more')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByTestId('mobile-header-more-menu')
  await expect(panel).toBeVisible()
  const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
  const items = await panel.locator('button:not(:disabled), a[href]').allTextContents()
  expect(items.length).toBeGreaterThan(1)
  await expect.poll(focusedText).toBe(items[0].trim())
  await page.keyboard.press('ArrowDown')
  await expect.poll(focusedText).toBe(items[1].trim())
  await page.keyboard.press('ArrowUp')
  await expect.poll(focusedText).toBe(items[0].trim())
  // 처음에서 ↑ 는 마지막으로 순환.
  await page.keyboard.press('ArrowUp')
  await expect.poll(focusedText).toBe(items[items.length - 1].trim())
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(trigger).toBeFocused()
})
