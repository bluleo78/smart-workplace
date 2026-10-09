// 모바일 UI/UX 마감 U3(WP-121) — 코드 리뷰(C1–C3)·UI/UX 재검토(R1–R14) 반영을 고정한다.
// 노트 AI 표식·AI 작성 메뉴, ⋯ 메뉴(포털 키 이벤트·한 항목 인라인·menuitem·포커스), 뒤로가기 바 규격, 탭 루트 헤더 구분선,
// AI 탭 루트 헤더, 이슈 ⋯ 문구·색, 📌 터치 영역, 탭 편집 저장 조건, 캘린더 도구 줄, 빈 상태 규격, 메일 ☰, 연락처 구분선, 목록 머리말.
import type { Page } from '@playwright/test'

import type { WikiPageDetail, WikiRole, WikiSpace } from '../../../src/types/wiki'
import { member, page as makeContactPage } from '../../factories/contacts.factory'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { mailAccount, summary } from '../../factories/mail.factory'
import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { tokenColor } from '../../fixtures/contrast'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

const KEY = 'WP'
const NUM = 2

/** 이슈 상세 최소 스텁(headers-nav.spec 과 같다). */
async function stubIssueDetail(page: Page, watchers: { userId: number }[] = []) {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject() }))
  await page.route(`**/api/v1/projects/${KEY}/members`, (r) => r.fulfill({ json: [] }))
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/${NUM}`, (r) =>
    r.request().method() === 'GET'
      ? r.fulfill({
        json: createIssueDetail({
          summary: createIssue({ id: NUM, number: NUM, title: '하단 탭바 도입 검토' }),
          body: '본문',
          comments: [],
          history: [],
        }),
      })
      : r.fallback())
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/${NUM}/watchers`, (r) => r.fulfill({ json: watchers }))
  for (const sub of ['labels', 'attachments', 'children']) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/${NUM}/${sub}`, (r) => r.fulfill({ json: [] }))
  }
}

function wikiSpace(role: WikiRole): WikiSpace {
  return { id: 1, type: 'PERSONAL', name: '내 위키', ownerId: 1, role, createdAt: '2026-06-01T00:00:00Z' }
}
const WIKI_PAGE: WikiPageDetail = {
  id: 100, spaceId: 1, parentId: null, title: '모바일 개편 메모', body: '', version: 1,
  updatedBy: 1, updatedAt: '2026-06-01T00:00:00Z', aiLastUsedAt: '2026-06-01T00:00:00Z', aiLastAction: 'draft',
}
async function stubWiki(page: Page, role: WikiRole = 'OWNER') {
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces', (r) => r.fulfill({ json: [wikiSpace(role)] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/spaces/1/pages', (r) =>
    r.fulfill({ json: [{ id: 100, parentId: null, title: WIKI_PAGE.title, position: 0, aiLastUsedAt: WIKI_PAGE.aiLastUsedAt }] }))
  await page.route((u) => u.pathname === '/api/v1/wiki/pages/100', (r) => r.fulfill({ json: WIKI_PAGE }))
}

test('C1·R1 노트: "AI 생성" 표식이 메뉴 없이 제목 뒤에 보이고, 헤더 AI 아이콘은 ✦ 하나(AI ▾ 없음)', async ({ authenticatedPage: page }) => {
  await stubWiki(page)
  await page.goto('/wiki/spaces/1/pages/100')
  const header = page.getByTestId('wiki-page-header')
  const badge = header.getByTestId('wiki-page-ai-attribution-badge')
  await expect(badge).toBeVisible()
  await expect(badge).toContainText('AI 생성')
  // 제목 텍스트·높이는 그대로(표식은 h1 밖).
  await expect(header.getByTestId('mobile-back-title')).toHaveText(WIKI_PAGE.title)
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(57)
  // 표식은 제목 바로 뒤(8px 이내).
  const t = (await header.getByTestId('mobile-back-title').boundingBox())!
  const b = (await badge.boundingBox())!
  expect(b.x - (t.x + t.width)).toBeLessThanOrEqual(8)
  // 헤더 안 AI 아이콘은 ✦(어시스턴트)뿐 — AI ▾ 생성 버튼·표식 아이콘 없음.
  await expect(header.getByTestId('wiki-ai-header-button')).toHaveCount(0)
  await expect(badge.locator('svg')).toHaveCount(0)
  await expect(header.getByTestId('mobile-back-ai')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('R1 노트: 페이지 ⋯ 메뉴 맨 위 "AI 작성" 묶음 — 편집 권한이면 활성, 읽기 전용이면 사유가 글자로', async ({ authenticatedPage: page }) => {
  await stubWiki(page)
  await page.goto('/wiki/spaces/1/pages/100')
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByText('AI 작성')).toBeVisible()
  const first = menu.getByRole('menuitem').first()
  await expect(first).toHaveAttribute('data-testid', 'wiki-ai-header-draft')
  await expect(first).not.toHaveAttribute('data-disabled', /.*/)
  await expect(page.getByTestId('wiki-ai-header-draft')).toBeVisible()
  await expect(page.getByTestId('wiki-ai-menu-reason')).toHaveCount(0)
  // 기존 항목(소스·삭제)은 그 아래에 그대로.
  await expect(page.getByTestId('wiki-menu-source')).toBeVisible()
})

test('R1 노트(읽기 전용): AI 작성 항목은 비활성, 사유는 흐리지 않은 글자로 보인다', async ({ authenticatedPage: page }) => {
  await stubWiki(page, 'VIEWER')
  await page.goto('/wiki/spaces/1/pages/100')
  await page.getByTestId('wiki-page-header').getByRole('button', { name: '페이지 메뉴' }).click()
  const reason = page.getByTestId('wiki-ai-menu-reason')
  await expect(reason).toContainText('읽기 전용')
  expect(await reason.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  await expect(page.getByTestId('wiki-ai-header-draft')).toHaveAttribute('data-disabled', '')
})

test('C2 ⋯ 메뉴 항목이 연 다이얼로그 안의 ↓ 키는 메뉴가 가로채지 않는다(preventDefault 없음)', async ({ authenticatedPage: page }) => {
  await stubIssueDetail(page)
  await page.goto(`/projects/${KEY}/issues/${NUM}`)
  await page.getByTestId('mobile-header-more').click()
  await page.getByTestId('issue-delete').click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect.poll(() => dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true)
  // dispatchEvent 는 누군가 preventDefault 하면 false 를 돌려준다.
  const notPrevented = await page.evaluate(() =>
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
  expect(notPrevented).toBe(true)
})

test('C3·R13 프로젝트 ⋯: 항목은 링크 하나씩(버튼 중첩 없음)·role=menuitem, 탭으로 열면 첫 항목에 포커스하지 않는다', async ({ authenticatedPage: page }) => {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject() }))
  await page.goto(`/projects/${KEY}`)
  await page.getByTestId('mobile-header-more').click()
  const menu = page.getByTestId('mobile-header-more-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toHaveAttribute('role', 'menu')
  await expect(menu.getByRole('menuitem')).toHaveCount(3)
  // 링크 안에 버튼이 없다 — 항목당 포커스 한 번.
  await expect(menu.locator('a button')).toHaveCount(0)
  await expect(menu.locator('a[role="menuitem"]')).toHaveCount(3)
  // 메뉴 항목 모양(44px·좌측 정렬·테두리 없음).
  const item = menu.getByRole('menuitem', { name: '사이클' })
  expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  expect(await item.evaluate((el) => getComputedStyle(el).borderTopWidth)).toBe('0px')
  // 포인터로 열었으니 포커스는 메뉴 항목으로 옮겨가지 않는다.
  expect(await menu.evaluate((m) => m.contains(document.activeElement))).toBe(false)
  await menu.getByRole('menuitem', { name: '설정' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/settings$`))
})

test('R2 헤더 없는 화면(/settings 목록)의 뒤로가기 바는 병합 상세 헤더와 같은 규격(56px·17px semibold h1)', async ({ authenticatedPage: page }) => {
  await page.goto('/settings')
  const title = page.getByTestId('mobile-back-title')
  await expect(title).toBeVisible()
  expect(await title.evaluate((el) => el.tagName)).toBe('H1')
  expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('17px')
  expect(await title.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600')
  const bar = title.locator('xpath=..')
  expect(Math.round((await bar.boundingBox())!.height)).toBe(56)
  await expect(bar.getByTestId('mobile-back-ai')).toBeVisible()
})

test('R3 탭 루트 헤더는 하단 구분선이 없다(PageHeader 탭 루트 = MobileListHeader)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  const home = page.getByTestId('canvas-header')
  await expect(home).toBeVisible()
  expect(await home.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('0px')
  await page.goto('/chat')
  const list = page.getByTestId('mobile-list-header')
  await expect(list).toBeVisible()
  expect(await list.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('0px')
})

// WP-191: 탭 루트 큰 제목 헤더(ai-fs-root-header) 대신 시트 헤더 — "AI" 제목 + [대화 목록 ▾][＋][×].
test('R4 탭바에서 연 AI 시트: "AI" 제목 + [대화 목록 ▾][＋] 44px, × 하나, 입력 포커스 링은 AI 보라', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/')
  await page.getByTestId('mobile-tab-ai').click()
  const header = page.getByTestId('ai-sheet')
  await expect(header).toBeVisible()
  await expect(header.getByText('AI', { exact: true })).toBeVisible()
  const switcher = header.getByTestId('ai-sheet-session-switcher')
  await expect(switcher).toHaveText('대화 목록')
  expect(Math.round((await switcher.boundingBox())!.height)).toBeGreaterThanOrEqual(44)
  const add = header.getByTestId('ai-sheet-new-session')
  expect((await add.boundingBox())!.width).toBeGreaterThanOrEqual(44)
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // ＋ 가 대화 목록 오른쪽(그 뒤에 × 하나).
  expect((await switcher.boundingBox())!.x).toBeLessThan((await add.boundingBox())!.x)
  await expect(page.getByTestId('ai-panel-close')).toHaveCount(1)
  const input = page.getByTestId('chat-input')
  await input.focus()
  const accent = await tokenColor(page, '--ai-accent')
  await expect.poll(() => input.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(accent)
  await switcher.click()
  await expect(page.getByRole('menu', { name: '대화 목록' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('R6 이슈 ⋯: 삭제는 빨간 글자, 구독 항목은 "구독하기" / "구독 중 · n명"', async ({ authenticatedPage: page }) => {
  await stubIssueDetail(page)
  await page.goto(`/projects/${KEY}/issues/${NUM}`)
  await page.getByTestId('mobile-header-more').click()
  const menu = page.getByTestId('mobile-header-more-menu')
  const del = menu.getByTestId('issue-delete')
  await expect(del).toBeVisible()
  expect(await del.evaluate((el) => getComputedStyle(el).color)).toBe(await tokenColor(page, '--destructive'))
  const watch = menu.getByTestId('watch-toggle')
  await expect(watch).toHaveText('구독하기')
  await expect(watch).toHaveAccessibleName('구독하기')
  // 토글 항목은 체크 메뉴 항목으로 알린다.
  await expect(watch).toHaveAttribute('role', 'menuitemcheckbox')
  await expect(watch).toHaveAttribute('aria-checked', 'false')
})

test('R6 이슈 ⋯(구독 중): "구독 중 · n명"', async ({ authenticatedPage: page }) => {
  // authenticatedPage 사용자 id 는 1 — 구독자 목록에 넣으면 구독 중.
  await stubIssueDetail(page, [{ userId: 1 }, { userId: 7 }])
  await page.goto(`/projects/${KEY}/issues/${NUM}`)
  await page.getByTestId('mobile-header-more').click()
  const watch = page.getByTestId('mobile-header-more-menu').getByTestId('watch-toggle')
  await expect(watch).toHaveText('구독 중 · 2명')
  await expect(watch).toHaveAttribute('aria-checked', 'true')
})

test('R7 ⋯ 에 담길 항목이 하나뿐이면 ⋯ 없이 헤더에 바로 둔다(메일 설정 "계정 추가")', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [])
  await page.goto('/settings/mail')
  const header = page.getByTestId('page-header')
  await expect(header.getByTestId('mobile-back-title')).toBeVisible()
  await expect(header.getByTestId('mobile-header-more')).toHaveCount(0)
  const add = header.getByTestId('mail-add-trigger')
  await expect(add).toBeVisible()
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  // 메뉴 의미(role) 없이 일반 버튼.
  await expect(add).not.toHaveAttribute('role', /.*/)
  await add.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('R7 여러 항목·검색 입력 메뉴는 그대로 ⋯/🔍 로 남는다(이슈 상세·메일)', async ({ authenticatedPage: page }) => {
  await stubIssueDetail(page)
  await page.goto(`/projects/${KEY}/issues/${NUM}`)
  await expect(page.getByTestId('mobile-header-more')).toBeVisible()
  // 메일: 메뉴 내용이 검색 입력 하나 — 입력은 인라인 대상이 아니므로 🔍 트리거가 남는다.
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [summary()])
  await page.goto('/mail')
  const search = page.getByTestId('mobile-header-more')
  await expect(search).toHaveAccessibleName('메일 검색')
  await search.click()
  await expect(page.getByTestId('mobile-header-more-menu').locator('input')).toBeVisible()
})

test('R1 노트: AI 작성 실행 중에는 헤더에 생성 중 스피너가 남는다(AI ▾ 가 메뉴로 들어간 뒤에도)', async ({ authenticatedPage: page }) => {
  await stubWiki(page)
  // 응답을 끝내지 않아 생성 중 상태를 유지한다.
  await page.route('**/api/v1/wiki/pages/*/ai', () => {})
  await page.goto('/wiki/spaces/1/pages/100')
  const header = page.getByTestId('wiki-page-header')
  await expect(header.getByTestId('wiki-ai-header-busy')).toHaveCount(0)
  await header.getByRole('button', { name: '페이지 메뉴' }).click()
  await page.getByTestId('wiki-ai-header-continue').click()
  await expect(header.getByTestId('wiki-ai-header-busy')).toBeVisible()
})

test('R8 📌 배지 터치 영역은 44px — 위·오른쪽으로만 넓어지고 아이콘(앱 열기) 영역은 가리지 않는다', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps')
  const badge = page.getByTestId('apps-pinned-chat')
  const tile = page.getByTestId('apps-app-chat')
  const bb = (await badge.boundingBox())!
  const size = await badge.evaluate((el) => {
    const s = getComputedStyle(el, '::after')
    return [s.width, s.height]
  })
  expect(size).toEqual(['44px', '44px'])
  const hit = (x: number, y: number) =>
    page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid]')?.getAttribute('data-testid'), [x, y])
  // 배지의 왼쪽 아래 모서리 기준 44px 정사각형 — 오른쪽 위 끝도 배지.
  expect(await hit(bb.x + 42, bb.y + bb.height - 42)).toBe('apps-pinned-chat')
  // 아이콘 가운데는 여전히 앱 열기.
  const icon = (await tile.locator('span').first().boundingBox())!
  expect(await hit(icon.x + icon.width / 2, icon.y + icon.height / 2)).toBe('apps-app-chat')
  // 아이콘 왼쪽 아래(배지에서 먼 쪽)도 앱.
  expect(await hit(icon.x + 6, icon.y + icon.height - 6)).toBe('apps-app-chat')
  await expectNoHorizontalOverflow(page)
})

test('R9 탭 편집: ✦ 없음, [저장]은 바뀐 것이 있을 때만 활성(되돌리면 다시 비활성)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/apps/tabs')
  const header = page.getByTestId('tab-edit-header')
  await expect(header).toBeVisible()
  await expect(page.getByTestId('mobile-back-ai')).toHaveCount(0)
  const save = header.getByTestId('tab-edit-save')
  await expect(save).toBeDisabled()
  await page.getByTestId('tab-edit-down-0').click()
  await expect(save).toBeEnabled()
  await page.getByTestId('tab-edit-up-1').click()
  await expect(save).toBeDisabled()
})

test('R10 캘린더 도구 줄: ‹ › 도 [오늘]·보기 선택과 같은 테두리 버튼(≥44px)', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/calendars', [])
  await page.goto('/calendar')
  const toolbar = page.getByTestId('calendar-mobile-toolbar')
  await expect(toolbar).toBeVisible()
  const border = (id: string) => toolbar.getByTestId(id).evaluate((el) => getComputedStyle(el).borderTopWidth)
  const today = await border('calendar-today')
  expect(today).not.toBe('0px')
  for (const id of ['calendar-prev', 'calendar-next']) {
    expect(await border(id), id).toBe(today)
    const b = (await toolbar.getByTestId(id).boundingBox())!
    expect(b.width, id).toBeGreaterThanOrEqual(44)
    expect(b.height, id).toBeGreaterThanOrEqual(44)
  }
})

/** 빈 상태 묶음(아이콘~설명)의 세로 중심이 화면 영역 가운데보다 위(0~80px)에 있는지 + 제목 규격. */
async function expectEmptyStateSpec(page: Page, testId: string) {
  const empty = page.getByTestId(testId)
  await expect(empty).toBeVisible()
  const box = (await empty.boundingBox())!
  const icon = (await empty.locator('svg').first().boundingBox())!
  const lastP = (await empty.locator('p').last().boundingBox())!
  const contentMid = (icon.y + lastP.y + lastP.height) / 2
  const areaMid = box.y + box.height / 2
  expect(areaMid - contentMid).toBeGreaterThan(0)
  expect(areaMid - contentMid).toBeLessThanOrEqual(80)
  expect(Math.round(icon.width)).toBe(48)
  expect(await empty.locator('p').first().evaluate((el) => getComputedStyle(el).fontSize)).toBe('17px')
  return areaMid - contentMid
}

test('R11 빈 상태 규격 공유: 알림 없음·메일 계정 없음이 같은 크기·같은 위치(가운데보다 살짝 위)', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/notifications')
  const a = await expectEmptyStateSpec(page, 'inbox-empty')
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [])
  await page.goto('/mail')
  const b = await expectEmptyStateSpec(page, 'mail-empty-accounts')
  // 같은 오프셋 규칙(pb-16) — 내용 높이 차(버튼 유무)만큼만 다르다.
  expect(Math.abs(a - b)).toBeLessThanOrEqual(40)
})

test('R12 메일 계정 없음: ☰(폴더 시트) 트리거를 두지 않는다', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [])
  await page.goto('/mail')
  await expect(page.getByTestId('mail-empty-accounts')).toBeVisible()
  await expect(page.getByTestId('mobile-sidebar-trigger')).toHaveCount(0)
  await expect(page.getByTestId('page-header').getByTestId('mobile-bell')).toBeVisible()
})

test('R14 연락처 목록: 전체폭 목록 끝에 우측 구분선이 없다', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill({ json: makeContactPage([member()]) }))
  await page.goto('/contacts')
  const list = page.getByTestId('contact-list')
  await expect(list).toBeVisible()
  expect(await list.evaluate((el) => getComputedStyle(el).borderRightWidth)).toBe('0px')
})

test('R5 목록 머리말: 노트 "페이지"·드라이브 "공간" 이 채팅 "채널" 과 같은 왼쪽 선, ＋ 는 본문색 16px 급', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat')
  const list = page.getByTestId('mobile-module-list')
  const labelX = async (text: string) => Math.round((await list.getByText(text, { exact: true }).boundingBox())!.x)
  const chatX = await labelX('채널')
  const fg = await tokenColor(page, '--foreground')
  await stubWiki(page)
  await page.goto('/wiki')
  await expect(list.getByText('페이지', { exact: true })).toBeVisible()
  expect(await labelX('페이지')).toBe(chatX)
  const plus = list.getByRole('button', { name: '새 페이지' })
  expect(await plus.evaluate((el) => getComputedStyle(el).color)).toBe(fg)
  expect(Math.round((await plus.boundingBox())!.width)).toBe(24)
  await mockApi(page, 'GET', '/api/v1/drive/spaces', [])
  await page.goto('/drive')
  await expect(list.getByText('공간', { exact: true })).toBeVisible()
  expect(await labelX('공간')).toBe(chatX)
  expect(await list.getByRole('button', { name: '팀 공간 만들기' }).evaluate((el) => getComputedStyle(el).color)).toBe(fg)
  const att = list.getByTestId('drive-nav-attachments')
  expect(await att.evaluate((el) => getComputedStyle(el).color)).toBe(fg)
  expect(await att.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px')
  await expectNoHorizontalOverflow(page)
})
