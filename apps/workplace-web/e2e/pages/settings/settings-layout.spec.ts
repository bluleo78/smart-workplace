import { createPageResponse, mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

test.describe('@smoke 설정 레이아웃 일관성', () => {
  test('프로필 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const header = page.getByTestId('page-header')
    await expect(header).toBeVisible()
    await expect(header).toContainText('프로필')
  })
  // 페이지 제목은 사이드바 메뉴 라벨과 동일해야 한다(#651)
  test('AI 비서 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/assistant')
    await expect(page.getByTestId('page-header')).toContainText('AI 비서')
  })
  test('메일 계정 페이지가 공용 PageHeader 를 렌더한다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/mail')
    await expect(page.getByTestId('page-header')).toContainText('메일 계정')
  })
  // API 토큰 — 구성원/역할/감사 로그와 동일한 풀폭 목록 레이아웃(#655) + 헤더 액션으로 발급 모달 오픈
  test('API 토큰 페이지가 공용 PageHeader + 풀폭 목록 + 발급 액션을 렌더한다', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/users/me/api-tokens', [])
    await page.goto('/settings/tokens')
    await expect(page.getByTestId('page-header')).toContainText('API 토큰')
    await expect(page.getByTestId('token-issue-open')).toBeVisible()

    await page.getByTestId('token-issue-open').click()
    await expect(page.getByTestId('token-issue-form-dialog')).toBeVisible()
  })

  // 긴 폐기 일시 문자열이 상태 컬럼을 밀어내 테이블이 컨테이너 밖으로 넘치고
  // 폐기 버튼이 잘려 보이지 않던 회귀(#655) — Badge + 짧은 날짜 표기로 방지.
  test('API 토큰 목록이 길어도 페이지가 가로로 넘치지 않고 폐기 버튼이 보인다', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/users/me/api-tokens', [
      {
        id: 1,
        name: 'explorer-check-1783157174',
        tokenPrefix: 'swp_MdYlgHTZaaaaaaaaaaaa',
        tenantId: 1,
        expiresAt: null,
        createdAt: '2026-07-01T00:00:00Z',
        lastUsedAt: null,
        revokedAt: '2026-07-04T09:26:59Z',
      },
      {
        id: 2,
        name: 'explorer-test-1783153352',
        tokenPrefix: 'swp_YaPUv4MVbbbbbbbbbbbb',
        tenantId: 1,
        expiresAt: '2026-10-02T09:26:59Z',
        createdAt: '2026-07-01T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ])
    await page.goto('/settings/tokens')

    const table = page.getByRole('table', { name: 'API 토큰 목록' })
    await expect(table).toBeVisible()

    // 폐기된 토큰: 상태 Badge 만 노출(전체 일시는 title 툴팁으로 이동), 폐기 버튼 없음
    const revokedRow = page.getByTestId('token-row-1')
    await expect(revokedRow.getByText('폐기됨', { exact: true })).toBeVisible()
    await expect(revokedRow.getByTestId('token-revoke-1')).toHaveCount(0)

    // 활성 토큰: 폐기 버튼이 실제로 보여야 한다(#655 재발 방지)
    const revokeBtn = page.getByTestId('token-revoke-2')
    await expect(revokeBtn).toBeVisible()

    // 페이지 전체가 가로 스크롤을 유발하지 않는지 확인
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  // 구성원 관리 — SettingsPage 전환 후 PageHeader + 액션 버튼 검증
  test('구성원 페이지가 공용 PageHeader + 액션을 렌더한다', async ({ adminPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/users', createPageResponse([]))
    await page.goto('/settings/users')
    await expect(page.getByTestId('page-header')).toContainText('구성원')
    // 액션 버튼이 PageHeader 로 이동해도 동일 testid 로 노출
    await expect(page.getByTestId('add-member-button')).toBeVisible()
  })
})
