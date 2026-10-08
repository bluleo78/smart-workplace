// 페이지 틀(Page) 정렬 E2E — 헤더 제목과 본문 첫 요소가 같은 16px 축에서 시작하는지, reading 폭이 왼쪽 정렬·768px 이하인지.
import type { Page } from '@playwright/test'

import { createChatThread } from '../../factories/chat.factory'
import { external, externalDetail, page as contactPage } from '../../factories/contacts.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../factories/issue.factory'
import { mailAccount, summary as mailSummary } from '../../factories/mail.factory'
import { createProject } from '../../factories/project.factory'
import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { DESKTOP_WIDTHS, boxOf, expectHeaderBottomAt56, expectStartAligned } from '../../fixtures/layout'
import { measureBox } from '../../fixtures/wait'

for (const width of DESKTOP_WIDTHS) {
  test.describe(`Page 정렬 @${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    test('프로젝트 목록(full) — 헤더 제목과 목록이 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([createProject({ key: 'EX', name: '예제' })]))
      await page.goto('/projects')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      await expectStartAligned(
        header.getByRole('heading', { level: 1 }),
        page.getByRole('list', { name: '프로젝트 목록' }),
      )
    })

    test('사이클(reading) — 본문 왼쪽 정렬, 폭 ≤ 768', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP' }))
      await mockApi(page, 'GET', '/api/v1/projects/WP/cycles', [])
      await mockApi(page, 'GET', '/api/v1/projects/WP/cycles/progress', [])
      await page.goto('/projects/WP/cycles')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      const body = page.getByTestId('page-body-content')
      // 헤더의 ← 버튼과 본문 첫 요소(사이클 목록) 시작 x 일치(둘 다 16px 축).
      // page-body-content 자신의 상자는 여백(px-4)을 포함해 16px 앞에서 시작하므로 첫 자식으로 비교한다.
      await expectStartAligned(header.getByRole('button', { name: '프로젝트로 돌아가기' }), body.locator('> *').first())
      expect((await boxOf(body)).width).toBeLessThanOrEqual(768)
    })

    test('이슈 상세(자체 레이아웃 본문) — ← 버튼과 제목이 같은 x', async ({ authenticatedPage: page }) => {
      const issue = createIssue({ id: 1, number: 7, projectKey: 'WP', title: '정렬 확인' })
      const base = '/api/v1/projects/WP/issues/7'
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP' }))
      await mockApi(page, 'GET', base, createIssueDetail({ summary: issue }))
      for (const sub of ['watchers', 'labels', 'attachments', 'drive-links']) await mockApi(page, 'GET', `${base}/${sub}`, [])
      await mockApi(page, 'GET', `${base}/chat/thread`, createChatThread({ threadId: 999, recentMessages: [] }))
      for (const path of ['/api/v1/projects/WP/members', '/api/v1/projects/WP/labels', '/api/v1/drive/spaces']) await mockApi(page, 'GET', path, [])
      await page.goto('/projects/WP/issues/7')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      // 본문은 @container 스크롤 div 를 화면이 소유(padded=false)하지만 여백은 같은 pageGutterClass 축.
      await expectStartAligned(page.getByTestId('issue-back'), page.getByTestId('issue-title-heading'))
    })

    test('프로젝트 상세(팀, 자체 레이아웃 본문) — 헤더 제목과 툴바 첫 요소가 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
      await page.goto('/projects/WP')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      // 본문(보드/목록)은 화면이 소유(padded=false)하지만 행 여백은 같은 pageGutterClass 축.
      await expectStartAligned(header.getByRole('heading', { level: 1 }), page.getByTestId('view-chip-bar').locator('> *').first())
    })

    test('타임라인 — 헤더 ← 버튼과 일정 미정 섹션이 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/projects/WP', createProject())
      // 일정 없는 이슈 1건 — 간트 막대 대신 일정 미정 섹션에 노출된다.
      await mockApi(page, 'GET', '/api/v1/projects/WP/issues', createIssueSearchResponse([createIssue({ number: 1, projectKey: 'WP', title: '일정 없음' })]))
      await page.goto('/projects/WP/timeline?period=all')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      // 헤더 첫 요소(←, icon 슬롯)와 일정 미정 summary 시작 x 가 같은 16px 축.
      await expectStartAligned(
        header.getByRole('button', { name: '프로젝트로 돌아가기' }),
        page.getByTestId('unscheduled-section').locator('summary'),
      )
    })
  })
}

// 메일·연락처·캘린더·홈(마스터-디테일·그리드 본문) — Page 틀로 옮긴 뒤에도 헤더와 본문 행이 같은 16px 축.
for (const width of DESKTOP_WIDTHS) {
  test.describe(`Page 정렬(메일·연락처·캘린더·홈) @${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })

    test('메일 — 헤더 제목과 첫 메일 행 내용이 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/mail/accounts', [mailAccount()])
      // seen: true — 안 읽음 막대(absolute)가 첫 자식이 되지 않게.
      await mockApi(page, 'GET', '/api/v1/mail/accounts/1/messages', [mailSummary({ id: 7, seen: true })])
      await page.goto('/mail/1')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      // 행 상자는 px-4 를 포함해 왼쪽 끝에서 시작하므로 행의 첫 내용(발신자 줄)으로 비교한다.
      await expectStartAligned(header.getByRole('heading', { level: 1 }), page.getByTestId('mail-row-7').locator('> *').first())
    })

    test('연락처 — 헤더 제목과 첫 행 내용이 같은 x, 상세 오른쪽 끝이 헤더 액션 오른쪽 끝과 같다', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/contacts', contactPage([external()]))
      await mockApi(page, 'GET', '/api/v1/contacts/external/100', externalDetail())
      await page.goto('/contacts')
      const header = page.getByTestId('page-header')
      await expectHeaderBottomAt56(header)
      const row = page.getByTestId('contact-row-EXTERNAL-100')
      await expectStartAligned(header.getByRole('heading', { level: 1 }), row.locator('> *').first())
      await row.locator('> button').first().click()
      // 상세 패널 여백도 페이지 여백(16px) — 상세 수정·삭제 버튼 오른쪽 끝 = 헤더 액션(새 외부 연락처) 오른쪽 끝.
      const del = await boxOf(page.getByTestId('contact-delete'))
      const action = await boxOf(header.getByTestId('contact-create'))
      expect(Math.abs(del.x + del.width - (action.x + action.width))).toBeLessThanOrEqual(1)
    })

    test('캘린더 — 헤더 하단선 56', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/calendar/events', [])
      await page.goto('/calendar')
      await expectHeaderBottomAt56(page.getByTestId('page-header'))
    })

    test('홈 — 헤더 첫 요소(홈 아이콘)와 첫 위젯이 같은 x', async ({ authenticatedPage: page }) => {
      await mockApi(page, 'GET', '/api/v1/me/dashboard', { widgets: [{ id: 'notifications', type: 'notifications', count: 5, hidden: false }] })
      await mockApi(page, 'GET', '/api/v1/notifications', [])
      await page.goto('/')
      const header = page.getByTestId('canvas-header')
      await expectHeaderBottomAt56(header)
      // 홈은 제목 앞에 아이콘이 있어 헤더 첫 요소(아이콘)로 본문 축을 비교한다.
      await expectStartAligned(header.locator('svg').first(), page.getByTestId('dashboard').locator('> *').first())
    })
  })
}

// AI 칩(fixed) 과 헤더 좌측 그룹 — 칩 위치(레일 펼침·AI 옆 패널 폭에 따라 이동)를 실측해 좌측 그룹 폭을 클램프한다.
// 겹치지 않을 것(제목 우측 ≤ 칩 좌측) + 과하게 자르지 않을 것(남는 자리보다 24px 넘게 좁지 않음)을 함께 본다.
const CHIP_GAP = 16

async function expectHeaderFitsBeforeChip(page: Page) {
  const title = page.getByTestId('page-header').getByRole('heading', { level: 1 })
  const group = title.locator('..')
  // 우측 액션 그룹 — 좌측 그룹은 칩뿐 아니라 액션 앞(gap 8px)에서도 멈추므로 남는 자리는 둘 중 좁은 쪽.
  const actions = group.locator('xpath=following-sibling::div[1]')
  const chip = page.getByTestId('chat-launcher')
  await expect(title).toBeVisible()
  await expect(chip).toBeVisible()
  // 레일·패널 변경 직후엔 관찰자 콜백 전일 수 있어 측정+단언을 재시도한다(WP-225).
  await expect(async () => {
    const [t, g, c, a] = [await measureBox(title), await measureBox(group), await measureBox(chip), await measureBox(actions)]
    expect(t.x + t.width, '제목 우측 ≤ 칩 좌측').toBeLessThanOrEqual(c.x)
    expect(g.x + g.width, '좌측 그룹 우측 ≤ 칩 좌측').toBeLessThanOrEqual(c.x)
    const room = Math.min(c.x - CHIP_GAP, a.x - 8)
    expect(g.x + g.width, '남는 자리 대비 과도한 자름 없음').toBeGreaterThanOrEqual(room - 24)
  }).toPass()
}

async function gotoLongProject(page: Page) {
  const longName = '아주 긴 프로젝트 이름 '.repeat(8)
  await mockApi(page, 'GET', '/api/v1/projects/WP', createProject({ key: 'WP', name: longName }))
  await mockApi(page, 'GET', '/api/v1/home/sessions', { items: [], nextCursor: null })
  await page.goto('/projects/WP')
}

test.describe('긴 제목도 AI 칩과 겹치지 않고 남는 자리까지 보인다', () => {
  test('1440 — 레일 접힘', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoLongProject(page)
    await expectHeaderFitsBeforeChip(page)
  })

  test('1440 — 레일 펼침(152px)', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => window.localStorage.setItem('app-rail-expanded', 'true'))
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoLongProject(page)
    await expect(page.getByTestId('app-rail')).toHaveCSS('width', '152px')
    await expectHeaderFitsBeforeChip(page)
  })

  test('레일 토글 중에도 다시 맞춘다(접힘 → 펼침)', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoLongProject(page)
    await expectHeaderFitsBeforeChip(page)
    await page.getByTestId('app-rail').getByRole('button', { name: '사이드바 펼치기' }).click()
    await expect(page.getByTestId('app-rail')).toHaveCSS('width', '152px')
    await expectHeaderFitsBeforeChip(page)
  })

  test('1440 — AI 옆 패널(600px) 열림', async ({ authenticatedPage: page }) => {
    await page.addInitScript(() => window.localStorage.setItem('ai-side-width', '600'))
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoLongProject(page)
    await page.getByTestId('chat-launcher').click()
    await expect(page.getByTestId('ai-side-panel')).toBeVisible()
    await expectHeaderFitsBeforeChip(page)
  })
})

// 캘린더 @1024 — 헤더 icon 슬롯의 이동 컨트롤(오늘·‹·›)은 줄지 않고 모두 보이며 칩과 겹치지 않는다(제목이 먼저 잘린다).
test('캘린더 1024 — 오늘·이전·다음 버튼이 다 보이고 AI 칩과 겹치지 않는다', async ({ authenticatedPage: page }) => {
  await page.setViewportSize({ width: 1024, height: 800 })
  await mockApi(page, 'GET', '/api/v1/calendar/events', [])
  await page.goto('/calendar')
  const chip = page.getByTestId('chat-launcher')
  await expect(chip).toBeVisible()
  for (const id of ['calendar-today', 'calendar-prev', 'calendar-next']) {
    const btn = page.getByTestId(id)
    await expect(btn).toBeVisible()
    await expect(async () => {
      const [b, c] = [await measureBox(btn), await measureBox(chip)]
      expect(b.x + b.width, `${id} 우측 ≤ 칩 좌측`).toBeLessThanOrEqual(c.x)
      // 줄어 잘리지 않음 — 자기 내용 폭(scrollWidth) 그대로.
      expect(await btn.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }).toPass()
  }
})
