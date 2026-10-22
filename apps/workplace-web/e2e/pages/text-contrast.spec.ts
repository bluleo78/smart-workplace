// 보조 글자·캘린더 칩의 글자 대비(WP-736) — WCAG 2.2 AA 일반 글자 4.5:1. 라이트·다크 모두 실제로 칠해진 색으로 잰다(textContrast).
// 미달이던 곳: 보조 글자를 투명도로 더 흐리게 한 변형(text-muted-foreground/60·/70 — 약 2.5~3:1),
// 다크에서 카드가 두 겹 깔린 곳의 12px 보조 글자(4.23:1), 흰 글자를 -500 배경에 얹은 캘린더 칩(파랑 3.76:1).
import type { UserGroupTree } from '../../src/types/userGroup'
import { calendarEvent } from '../factories/calendar.factory'
import { createProject } from '../factories/project.factory'
import { createPageResponse, mockApi } from '../fixtures/api-mock'
import { expect, test } from '../fixtures/auth.fixture'
import { expectTheme, textContrast, withTheme } from '../fixtures/contrast'

const AA = 4.5

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme}`, () => {
    test('캘린더 월 보기 — 파랑 일정 칩의 흰 글자', async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      await page.clock.setFixedTime(new Date('2026-06-10T03:00:00Z'))
      await page.route((u) => u.pathname.startsWith('/api/v1/calendar/events'), (r) =>
        r.fulfill({
          json: [calendarEvent({ id: 7, title: '주간 회의', startsAt: '2026-06-10T01:00:00Z', endsAt: '2026-06-10T02:00:00Z' })],
        }))
      await page.goto('/calendar')
      await expectTheme(page, theme)
      const chip = page.getByTestId('calendar-cell-2026-06-10').getByTestId('calendar-event-7')
      await expect(chip).toBeVisible()
      expect(await textContrast(chip)).toBeGreaterThanOrEqual(AA)
    })

    test('설정 사이드바 — 「개인 설정」 묶음 제목', async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      await page.goto('/settings/notifications')
      await expectTheme(page, theme)
      expect(await textContrast(page.getByText('개인 설정', { exact: true }))).toBeGreaterThanOrEqual(AA)
    })

    test('연락처 — 「조직도」 제목과 「조직도가 없습니다」', async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      const tree: UserGroupTree = { shared: [], personal: [] }
      await mockApi(page, 'GET', '/api/v1/user-groups', tree)
      await page.goto('/contacts')
      await expectTheme(page, theme)
      expect(await textContrast(page.getByText('조직도', { exact: true }))).toBeGreaterThanOrEqual(AA)
      expect(await textContrast(page.getByText('조직도가 없습니다'))).toBeGreaterThanOrEqual(AA)
    })

    test('프로젝트 목록 — 이슈가 없는 프로젝트의 「이슈 없음」', async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      await mockApi(page, 'GET', '/api/v1/projects', createPageResponse([
        createProject({ key: 'EMP', name: '빈 프로젝트', type: 'TEAM', issueTotal: 0, issueDone: 0 }),
      ]))
      await page.goto('/projects')
      await expectTheme(page, theme)
      const label = page.getByTestId('project-row-EMP').getByText('이슈 없음')
      expect(await textContrast(label)).toBeGreaterThanOrEqual(AA)
    })

    test('홈 요약 — 「오늘 마감」 칸 이름(카드 안 카드)', async ({ authenticatedPage: page }) => {
      await withTheme(page, theme)
      await page.route((u) => u.pathname === '/api/v1/me/dashboard', (r) =>
        r.request().method() === 'GET'
          ? r.fulfill({ json: { widgets: [{ id: 'synthesis', type: 'synthesis', count: 3, hidden: false, collapsed: false }] } })
          : r.fallback())
      await page.goto('/')
      await expectTheme(page, theme)
      const label = page.getByText('오늘 마감', { exact: true }).first()
      await expect(label).toBeVisible()
      expect(await textContrast(label)).toBeGreaterThanOrEqual(AA)
    })
  })
}
