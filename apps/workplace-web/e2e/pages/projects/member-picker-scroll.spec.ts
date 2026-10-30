// 프로젝트 멤버 추가 창의 사람 이어 받기(WP-1225) — 검색어 없이 후보 목록을 끝까지 내리면 다음 20명씩 이어 받아 마지막 구성원(AI 개발자)에 닿는다.
// @layout: 후보 목록(자체 스크롤 영역)을 실제로 내려야 끝 sentinel 이 IntersectionObserver(root = 목록)에 걸린다 — jsdom 은 교차를 잴 수 없다.
// 이어 받은 행·탭 수(「N+」 → 정확한 수)·이미 추가된 사람의 비활성 줄은 페이지 테스트(MemberManagementDepartments.test.tsx)가 본다.
import type { MemberSummary } from '../../../src/types/member'
import { createMember as createDirectoryMember } from '../../factories/auth.factory'
import { createMember } from '../../factories/project.factory'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'

/** 디렉터리 45명 — 나(1, 이미 멤버) + 사람 43명 + 맨 끝 AI 개발자(900). 20명씩 3페이지. */
const DIRECTORY: MemberSummary[] = [
  createDirectoryMember({ userId: 1, username: 'testuser', name: '테스트 사용자' }),
  ...Array.from({ length: 43 }, (_, i) => createDirectoryMember({ userId: 100 + i, username: `p${100 + i}`, name: `구성원${100 + i}` })),
  createDirectoryMember({ userId: 900, username: 'ai-dev9', name: 'AI 개발자9', kind: 'AGENT' }),
]

test.describe('멤버 추가 창 사람 이어 받기', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('검색어 없이 후보 목록을 끝까지 내리면 다음 페이지를 이어 받아 마지막 AI 구성원에 닿고 탭 수가 정확해진다 (WP-1225)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockProjectSettings(page, [createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' })])
    // 디렉터리는 page·size 대로 잘라 준다(백엔드 offset 페이지와 같은 모양) — 받은 page 번호를 모은다.
    const pagesRequested: number[] = []
    await page.route(
      (url) => url.pathname === '/api/v1/members',
      (route) => {
        const sp = new URL(route.request().url()).searchParams
        const n = Number(sp.get('page') ?? 0)
        const size = Number(sp.get('size') ?? 20)
        pagesRequested.push(n)
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            content: DIRECTORY.slice(n * size, (n + 1) * size),
            page: n,
            size,
            totalElements: DIRECTORY.length,
            totalPages: Math.ceil(DIRECTORY.length / size),
          }),
        })
      },
    )
    await page.goto('/projects/WP/settings')
    await page.getByTestId('member-add-trigger').click()
    const list = page.getByRole('listbox', { name: '사람·팀 후보' })
    await expect(page.getByTestId('project-member-picker-person-100')).toBeVisible()
    // 첫 화면 — 목록 끝이 멀어 다음 페이지를 미리 받지 않는다(sentinel root 가 목록이라 뷰포트 기준으로 연쇄 로드하지 않는다).
    await expect(page.getByTestId('project-member-picker-tab-people')).toHaveText('사람20+')
    expect(pagesRequested).toEqual([0])

    // 휠로 끝까지 내린다 — 끝에 닿을 때마다 다음 20명이 붙고, 마지막 AI 개발자9 가 보일 때까지.
    const last = page.getByTestId('project-member-picker-person-900')
    await list.hover()
    await expect(async () => {
      await page.mouse.wheel(0, 3000)
      await expect(last).toBeInViewport({ timeout: 500 })
    }).toPass()
    expect(pagesRequested).toEqual([0, 1, 2])
    // 다 받았다 — 탭 수는 정확한 수, 이미 멤버인 나는 서버 순서 자리에 비활성 줄로 남아 있다.
    await expect(page.getByTestId('project-member-picker-tab-people')).toHaveText('사람45')
    await expect(page.getByTestId('project-member-picker-people-more')).toHaveCount(0)
    await expect(page.getByTestId('project-member-picker-person-1')).toHaveAttribute('aria-disabled', 'true')
  })
})
