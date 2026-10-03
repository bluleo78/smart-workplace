// 모바일 헤더·내비게이션 UI/UX 보정(U1, WP-121) — 상세 헤더 병합(한 줄), 헤더 액션 ⋯ 접기,
// 탭 루트 헤더 규격 통일, 메일 계정 없음 빈 상태, 탭바 활성 폴백·알림 푸시 화면을 고정한다.
import type { Page } from '@playwright/test'

import { external, externalDetail, member, memberDetail, page as makeContactPage } from '../../factories/contacts.factory'
import { detail as mailDetail, mailAccount, summary as mailSummary } from '../../factories/mail.factory'
import { createIssue, createIssueDetail } from '../../factories/issue.factory'
import { createProject } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, expectNoHorizontalOverflow, stubChat, test } from '../../fixtures/mobile.fixture'

const KEY = 'WP'
const NUM = 2

/** 이슈 상세 최소 스텁(issue-delete.spec 과 같은 엔드포인트). */
async function stubIssueDetail(page: Page) {
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
  for (const sub of ['watchers', 'labels', 'attachments', 'children']) {
    await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/${NUM}/${sub}`, (r) => r.fulfill({ json: [] }))
  }
}

/** 헤더가 정확히 한 줄(56px)이고 ‹·제목이 그 안에 있는지 — 레이아웃 뒤로가기 바와 두 줄로 쌓이지 않음. */
async function expectSingleMergedHeader(page: Page, headerTestId: string) {
  const header = page.getByTestId(headerTestId)
  await expect(header).toBeVisible()
  // 뒤로가기는 화면 전체에 하나뿐이고 그 헤더 안에 있다.
  await expect(page.getByTestId('mobile-back')).toHaveCount(1)
  await expect(header.getByTestId('mobile-back')).toBeVisible()
  await expect(header.getByTestId('mobile-back-ai')).toBeVisible()
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(57)
  const title = header.getByTestId('mobile-back-title')
  await expect(title).toBeVisible()
  expect((await title.boundingBox())!.width).toBeGreaterThanOrEqual(80)
  expect(await title.evaluate((el) => getComputedStyle(el).fontSize)).toBe('17px')
}

test('이슈 상세: ‹·이슈 키·⋯·✦ 가 한 줄 헤더에 있고 액션은 ⋯ 메뉴에 담긴다', async ({ authenticatedPage: page }) => {
  await stubIssueDetail(page)
  await page.goto(`/projects/${KEY}/issues/${NUM}`)
  await expectSingleMergedHeader(page, 'page-header')
  await expect(page.getByTestId('mobile-back-title')).toContainText(`${KEY}-${NUM}`)
  // 제목이 잘리지 않는다.
  expect(await page.getByTestId('mobile-back-title').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(false)
  // 삭제(파괴적)·구독 등은 인라인에 없고 ⋯ 를 열어야 보인다.
  await expect(page.getByTestId('issue-delete')).toBeHidden()
  await page.getByTestId('mobile-header-more').click()
  await expect(page.getByTestId('mobile-header-more-menu').getByTestId('issue-delete')).toBeVisible()
  await expect(page.getByTestId('mobile-header-more-menu').getByTestId('watch-toggle')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('이슈 상세: ⋯ → 삭제 → 확인 다이얼로그 → 삭제 API 호출 후 프로젝트로 이동', async ({ authenticatedPage: page }) => {
  await stubIssueDetail(page)
  let deleted = false
  await page.route((u) => u.pathname === `/api/v1/projects/${KEY}/issues/${NUM}`, (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
    deleted = true
    return r.fulfill({ status: 204, body: '' })
  })
  await page.goto(`/projects/${KEY}/issues/${NUM}`)
  await page.getByTestId('mobile-header-more').click()
  await page.getByTestId('issue-delete').click()
  // 메뉴는 닫히고, 메뉴 항목이 연 다이얼로그는 살아 있다.
  await expect(page.getByTestId('mobile-header-more-menu')).toBeHidden()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '삭제' }).click()
  await expect.poll(() => deleted).toBe(true)
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`))
})

test('⋯ 메뉴는 바깥을 누르거나 Esc 로 닫힌다', async ({ authenticatedPage: page }) => {
  await stubIssueDetail(page)
  await page.goto(`/projects/${KEY}/issues/${NUM}`)
  const menu = page.getByTestId('mobile-header-more-menu')
  await page.getByTestId('mobile-header-more').click()
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await page.getByTestId('mobile-header-more').click()
  await expect(menu).toBeVisible()
  await page.mouse.click(200, 500)
  await expect(menu).toBeHidden()
})

test('프로젝트 상세: ＋ 새 태스크는 인라인, 사이클·타임라인·설정은 ⋯ 메뉴', async ({ authenticatedPage: page }) => {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject() }))
  await page.goto(`/projects/${KEY}`)
  await expectSingleMergedHeader(page, 'page-header')
  await expect(page.getByTestId('mobile-new-issue')).toBeVisible()
  await expect(page.getByRole('button', { name: '사이클' })).toBeHidden()
  await page.getByTestId('mobile-header-more').click()
  const menu = page.getByTestId('mobile-header-more-menu')
  // 메뉴 항목은 링크 하나씩(role=menuitem, U3-C3·R13).
  await expect(menu.getByRole('menuitem', { name: '사이클' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: '타임라인' })).toBeVisible()
  await menu.getByRole('menuitem', { name: '설정' }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}/settings$`))
  await expectNoHorizontalOverflow(page)
})

test('프로젝트 하위(사이클) 딥링크: ‹ 는 그 프로젝트로 돌아간다(“프로젝트로 돌아가기” 아이콘 대체)', async ({ authenticatedPage: page }) => {
  await page.route(`**/api/v1/projects/${KEY}`, (r) => r.fulfill({ json: createProject() }))
  await page.route(`**/api/v1/projects/${KEY}/cycles`, (r) => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fallback())
  await page.route(`**/api/v1/projects/${KEY}/cycles/progress`, (r) => r.fulfill({ json: [] }))
  await page.goto(`/projects/${KEY}/cycles`)
  await expectSingleMergedHeader(page, 'page-header')
  // 병합 헤더에선 페이지 icon(←) 을 그리지 않아 뒤로가기가 두 개가 되지 않는다.
  await expect(page.getByRole('button', { name: '프로젝트로 돌아가기' })).toHaveCount(0)
  await expect(page.getByTestId('cycle-new')).toBeVisible()
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(new RegExp(`/projects/${KEY}$`))
})

test('채널 상세: 채널 헤더가 ‹·✦ 를 품은 한 줄 헤더이고, 항목이 파일 하나면 ⋯ 없이 인라인', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await page.goto('/chat/channels/1')
  await expectSingleMergedHeader(page, 'channel-header')
  await expect(page.getByTestId('channel-header-name')).toHaveText('모바일-개편')
  await expect(page.getByTestId('channel-members-btn')).toBeVisible()
  // 관리 권한이 없으면 남는 항목은 "파일" 하나 — ⋯ 없이 헤더에 바로 둔다(U3-R7).
  await expect(page.getByTestId('mobile-header-more')).toHaveCount(0)
  await expect(page.getByTestId('channel-header').getByTestId('channel-files-button')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('설정 상세: 설정 페이지 제목이 병합 헤더 제목이 된다', async ({ authenticatedPage: page }) => {
  await page.goto('/settings/notifications')
  await expectSingleMergedHeader(page, 'page-header')
  await expect(page.getByTestId('mobile-back-title')).toHaveText('알림')
})

test('헤더가 없는 상세 화면(드라이브 첨부 모아보기)은 뒤로가기 바(병합 헤더와 같은 규격)를 둔다', async ({ authenticatedPage: page }) => {
  await page.goto('/drive/attachments')
  await expect(page.getByTestId('mobile-back')).toHaveCount(1)
  await expect(page.getByTestId('mobile-back-ai')).toBeVisible()
})

test('메일 본문: 목록 헤더(업무·동기화) 대신 ‹·메일 제목·✦ 한 줄 헤더, ‹ 로 목록 복귀', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
  await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [mailSummary()])
  await mockApi(page, 'GET', '/api/v1/mail/messages/10', mailDetail({ subject: '10월 배포 일정 안내' }))
  await page.goto('/mail/1')
  await page.getByTestId('mail-row-10').click()
  // 채팅·노트와 같은 규칙 — 상세 헤더 제목은 지금 보는 항목(메일 제목).
  await expectSingleMergedHeader(page, 'mail-back')
  await expect(page.getByTestId('mobile-back-title')).toHaveText('10월 배포 일정 안내')
  // 목록 전용 요소(폴더명 헤더·🔍·동기화 줄)는 상세에서 보이지 않는다.
  await expect(page.getByTestId('page-header')).toHaveCount(0)
  await expect(page.getByTestId('mail-sync')).toHaveCount(0)
  await expect(page.getByTestId('mail-detail')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  // ‹ → 목록과 폴더 헤더 복귀(URL 은 그대로 탭 루트).
  await page.getByTestId('mobile-back').click()
  await expect(page.getByTestId('mail-list')).toBeVisible()
  await expect(page.getByTestId('page-header')).toContainText('업무')
  await expect(page.getByTestId('mail-sync')).toBeVisible()
  await expect(page).toHaveURL(/\/mail\/1$/)
})

test('연락처 상세: 목록 헤더 대신 ‹·연락처 이름·✦ 한 줄 헤더, ‹ 로 목록 복귀', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill({ json: makeContactPage([member()]) }))
  await page.route((u) => u.pathname === '/api/v1/contacts/members/1', (r) => r.fulfill({ json: memberDetail() }))
  await page.goto('/contacts')
  await page.getByTestId('contact-row-MEMBER-1').click()
  await expectSingleMergedHeader(page, 'contact-back')
  await expect(page.getByTestId('mobile-back-title')).toHaveText('김멤버')
  // "연락처" 목록 헤더와 ＋(새 외부 연락처)는 목록에서만.
  await expect(page.getByTestId('page-header')).toHaveCount(0)
  await expect(page.getByTestId('contact-create')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await page.getByTestId('mobile-back').click()
  await expect(page.getByTestId('contact-list')).toBeVisible()
  await expect(page.getByTestId('page-header')).toContainText('연락처')
})

test('연락처: 새 외부 연락처는 ＋ 아이콘 하나로 인라인 — 입력 → POST payload → 다이얼로그 닫힘 → 목록 반영', async ({ authenticatedPage: page }) => {
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) => r.fulfill({ json: makeContactPage([member()]) }))
  let posted: Record<string, unknown> | null = null
  await page.route((u) => u.pathname === '/api/v1/contacts/external', (r) => {
    posted = r.request().postDataJSON()
    return r.fulfill({ status: 201, json: externalDetail({ id: 200, name: '신규연락처' }) })
  })
  await page.goto('/contacts')
  await expect(page.getByTestId('mobile-header-more')).toHaveCount(0)
  const create = page.getByTestId('contact-create')
  await expect(create).toHaveCount(1)
  await create.click()
  await expect(page.getByTestId('external-contact-dialog')).toBeVisible()
  await page.getByTestId('c-name').fill('신규연락처')
  await page.getByTestId('c-email').fill('new@corp.com')
  // 저장 뒤 재조회되는 목록엔 신규 행 포함(마지막 등록 라우트 우선).
  await page.route((u) => u.pathname === '/api/v1/contacts', (r) =>
    r.fulfill({ json: makeContactPage([member(), external({ id: 200, name: '신규연락처' })]) }))
  await page.getByTestId('c-save').click()
  await expect.poll(() => posted).not.toBeNull()
  expect(posted!.name).toBe('신규연락처')
  expect(posted!.email).toBe('new@corp.com')
  await expect(page.getByTestId('external-contact-dialog')).toHaveCount(0)
  await expect(page.getByTestId('contact-row-EXTERNAL-200')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('탭 루트 헤더 규격이 홈·채팅·캘린더에서 같다(높이 56, 제목 22px bold, ☰ 는 🔔 앞)', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  const measure = async (headerTestId: string) => {
    const header = page.getByTestId(headerTestId)
    const h1 = header.locator('h1')
    await expect(h1).toBeVisible()
    return {
      height: Math.round((await header.boundingBox())!.height),
      titleX: Math.round((await h1.boundingBox())!.x),
      font: await h1.evaluate((el) => `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}`),
    }
  }
  await page.goto('/')
  const home = await measure('canvas-header')
  // 홈의 장식 아이콘은 모바일에서 생략 — 제목이 좌측 16px 에서 시작한다.
  expect(home.titleX).toBe(16)
  await page.goto('/chat')
  const chat = await measure('mobile-list-header')
  await page.goto('/calendar')
  const cal = await measure('page-header')
  // 높이(보더 1px 차 허용)·글꼴이 같다.
  for (const m of [chat, cal]) {
    expect(Math.abs(m.height - home.height)).toBeLessThanOrEqual(1)
    expect(m.font).toBe(home.font)
  }
  expect(home.font).toBe('22px/700')
  expect(chat.titleX).toBe(16)
  // 캘린더: ☰ 는 오른쪽 클러스터(🔔 바로 앞).
  const trigger = (await page.getByTestId('mobile-sidebar-trigger').boundingBox())!
  const bell = (await page.getByTestId('mobile-bell').boundingBox())!
  expect(trigger.x).toBeLessThan(bell.x)
  expect(bell.x - trigger.x).toBeLessThanOrEqual(48)
  expect(trigger.x).toBeGreaterThan(280)
  await expectNoHorizontalOverflow(page)
})

test('메일 계정 없음: "메일" 헤더·🔔 와 가운데 빈 상태, 연결 버튼은 메일 설정으로', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/mail/accounts', [])
  await page.goto('/mail')
  const header = page.getByTestId('page-header')
  await expect(header.locator('h1')).toHaveText('메일')
  await expect(header.getByTestId('mobile-bell')).toBeVisible()
  await expect(page.getByTestId('mail-empty-accounts')).toContainText('연결된 메일 계정이 없습니다')
  const cta = page.getByTestId('mail-connect-account')
  expect((await cta.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await cta.click()
  await expect(page).toHaveURL(/\/settings\/mail$/)
})

test('탭바 활성 폴백: 고정하지 않은 캘린더에선 앱 탭이 활성, 고정하면 캘린더 탭이 활성', async ({ authenticatedPage: page }) => {
  await page.goto('/calendar')
  await expect(page.getByTestId('mobile-tab-apps')).toHaveAttribute('aria-current', 'page')
  await page.evaluate(() => localStorage.setItem('mobile-tabs', JSON.stringify(['home', 'chat', 'calendar'])))
  await page.reload()
  await expect(page.getByTestId('mobile-tab-calendar')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('mobile-tab-apps')).not.toHaveAttribute('aria-current', 'page')
})

test('알림(탭 미고정): 🔔 로 여는 푸시 화면 — ‹ 알림 헤더·모두 읽음, 탭바 없음, ‹ 는 이전 화면으로', async ({ authenticatedPage: page }) => {
  await stubChat(page)
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/chat')
  await page.getByTestId('mobile-bell').click()
  await expect(page).toHaveURL(/\/notifications$/)
  const header = page.getByTestId('notifications-header')
  await expect(header.getByTestId('mobile-back-title')).toHaveText('알림')
  // '모두 읽음' 은 헤더 안(별도 한 줄 없음).
  await expect(header.getByTestId('inbox-mark-all')).toBeVisible()
  await expect(page.getByTestId('mobile-tabbar')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
  await header.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/chat$/)
})

test('알림 딥링크(탭 미고정): ‹ 는 홈으로', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/notifications')
  await page.getByTestId('mobile-back').click()
  await expect(page).toHaveURL(/\/$/)
})

test('알림을 탭바에 고정하면 탭 루트 — 큰 제목 헤더(모두 읽음 포함)와 탭바', async ({ authenticatedPage: page }) => {
  await mockApi(page, 'GET', '/api/v1/notifications', [])
  await mockApi(page, 'GET', '/api/v1/notifications/unread-count', { count: 0 })
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('mobile-tabs', JSON.stringify(['home', 'notifications', 'mail'])))
  await page.goto('/notifications')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await expect(page.getByTestId('mobile-tab-notifications')).toHaveAttribute('aria-current', 'page')
  const header = page.getByTestId('mobile-list-header')
  await expect(header.locator('h1')).toHaveText('알림')
  await expect(header.getByTestId('inbox-mark-all')).toBeVisible()
  await expect(page.getByTestId('mobile-back')).toHaveCount(0)
})

test('작업 탭 루트 제목은 탭 라벨과 같은 "작업"', async ({ authenticatedPage: page }) => {
  await page.goto('/tasks')
  await expect(page.getByTestId('mobile-list-header').locator('h1')).toHaveText('작업')
})
