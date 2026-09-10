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

  // 메일 계정 — 리스트/스캔 목적 화면이라 구성원/역할/토큰과 동일한 풀폭 목록 레이아웃(#674).
  // 헤더 액션(계정 추가)으로 다이얼로그 오픈 + 계정이 여러 개여도 가로 오버플로가 없어야 한다.
  test('메일 계정 페이지가 풀폭 목록 + 헤더 액션을 렌더한다(#674)', async ({
    authenticatedPage: page,
  }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [
      {
        id: 1,
        provider: 'IMAP',
        emailAddress: 'work@example.com',
        displayName: '업무용',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecurity: 'SSL_TLS',
        imapUsername: 'work@example.com',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 587,
        smtpSecurity: 'STARTTLS',
        smtpUsername: 'work@example.com',
        aiEnabled: true,
        lastSyncedAt: '2026-09-10T00:00:00Z',
        lastTestedAt: '2026-09-10T00:00:00Z',
        createdAt: '2026-06-01T00:00:00Z',
        updatedAt: '2026-06-01T00:00:00Z',
      },
      {
        id: 2,
        provider: 'M365_GRAPH',
        emailAddress: 'outlook-account-with-a-fairly-long-address@example.com',
        displayName: null,
        imapHost: '',
        imapPort: 993,
        imapSecurity: 'SSL_TLS',
        imapUsername: '',
        smtpHost: '',
        smtpPort: 587,
        smtpSecurity: 'STARTTLS',
        smtpUsername: '',
        aiEnabled: false,
        lastSyncedAt: null,
        lastTestedAt: null,
        createdAt: '2026-06-02T00:00:00Z',
        updatedAt: '2026-06-02T00:00:00Z',
      },
      {
        id: 3,
        provider: 'IMAP',
        emailAddress: 'personal@example.com',
        displayName: '개인',
        imapHost: 'imap.naver.com',
        imapPort: 993,
        imapSecurity: 'SSL_TLS',
        imapUsername: 'personal@example.com',
        smtpHost: 'smtp.naver.com',
        smtpPort: 587,
        smtpSecurity: 'STARTTLS',
        smtpUsername: 'personal@example.com',
        aiEnabled: false,
        lastSyncedAt: '2026-09-09T00:00:00Z',
        lastTestedAt: '2026-09-09T00:00:00Z',
        createdAt: '2026-06-03T00:00:00Z',
        updatedAt: '2026-06-03T00:00:00Z',
      },
    ])
    await page.goto('/settings/mail')

    await expect(page.getByTestId('page-header')).toContainText('메일 계정')
    // "계정 추가" 액션은 헤더로 이동(테이블 안 X) — 동일 testid 유지
    await expect(page.getByTestId('mail-add-trigger')).toBeVisible()

    const table = page.getByRole('table', { name: '메일 계정 목록' })
    await expect(table).toBeVisible()
    await expect(page.getByTestId('mail-account-row-1')).toContainText('work@example.com')
    await expect(page.getByTestId('mail-account-row-2')).toContainText('Outlook')
    await expect(page.getByTestId('mail-account-row-3')).toContainText('personal@example.com')

    // 페이지 전체가 가로 스크롤을 유발하지 않는지 확인(긴 이메일 주소 포함)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
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
