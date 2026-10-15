// 설정 폼 주석 섹션 레이아웃(WP-397) — 1024px 왼쪽 정렬 상한, 헤더 시작선 일치, 본문 768px 기준 2단↔세로 스택.
import { setupAdminAuth, setupRoleDetailMocks, setupUserDetailMocks } from '../../fixtures/admin.fixture'
import { memoryItem, mockAiMemories } from '../../fixtures/ai-memory-mock'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'
import { boxOf, expectSettingsBodyCapped, expectSideBySide, expectStacked, expectStartAligned, settingsSection } from '../../fixtures/layout'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'
import { installPushManagerStub, mockPushApis } from '../../fixtures/push-mock'

// 기본 화면 폭 1920 — 다른 폭이 필요한 테스트만 setViewportSize 로 바꾼다.
test.use({ viewport: { width: 1920, height: 1080 } })

test.describe('설정 레이아웃 — 공통 틀', () => {
  test('목록형(메일 계정)은 전체 폭이고 헤더 제목과 본문 시작선이 같다', async ({ authenticatedPage: page }) => {
    await mockApi(page, 'GET', '/api/v1/mail/accounts', [])
    await page.goto('/settings/mail')
    const body = page.getByTestId('page-body-content')
    // 전체 폭: 1920 - 레일 56 - 사이드바 224 = 1640 → 1024 상한이 걸리지 않는다.
    expect((await boxOf(body)).width).toBeGreaterThan(1024)
    await expectStartAligned(
      page.getByTestId('page-header').getByRole('heading', { level: 1 }),
      body.locator(':scope > *').first(),
    )
  })

  test('폼형(프로필) 본문은 1024px 이하·왼쪽 정렬이다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    const body = page.getByTestId('page-body-content')
    const b = await boxOf(body)
    expect(b.width).toBeLessThanOrEqual(1024)
    // 왼쪽 정렬: 본문 박스가 헤더 바의 왼쪽 끝에서 시작(mx-auto 가운데 정렬 아님).
    const header = await boxOf(page.getByTestId('page-header'))
    expect(Math.abs(b.x - header.x)).toBeLessThanOrEqual(1)
  })
})

test.describe('설정 레이아웃 — 프로필', () => {
  test('1920: 섹션이 2단이고 입력은 448px 이하, 시작선이 헤더와 같다', async ({ authenticatedPage: page }) => {
    await page.goto('/settings/profile')
    await expectSettingsBodyCapped(page)
    const info = settingsSection(page, '프로필 정보')
    await expectSideBySide(info)
    await expectSideBySide(settingsSection(page, '비밀번호 변경'))
    const inputs = await Promise.all((await info.locator('input').all()).map(boxOf))
    for (const b of inputs) expect(b.width).toBeLessThanOrEqual(448)
  })

  test('1024: 본문이 768px 미만(712px)이라 세로로 쌓인다', async ({ authenticatedPage: page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/settings/profile')
    await expectStacked(settingsSection(page, '프로필 정보'))
  })
})

test.describe('설정 레이아웃 — AI 비서', () => {
  test('1920: 추천 질문·메모리 섹션이 2단, 토글이 입력 열 오른쪽 끝, 긴 메모리도 넘치지 않는다', async ({ authenticatedPage: page }) => {
    await mockAiMemories(page, [memoryItem(1, { content: '가'.repeat(300) })])
    await page.goto('/settings/assistant')
    await expectSettingsBodyCapped(page)
    const suggest = settingsSection(page, '추천 질문')
    await expectSideBySide(suggest)
    await expectSideBySide(settingsSection(page, '메모리'))
    // 토글은 입력 열 오른쪽 끝에 붙는다.
    const content = await boxOf(suggest.locator('[data-slot="settings-section-content"]'))
    const toggle = await boxOf(page.getByTestId('ai-suggestions-toggle'))
    expect(Math.abs(content.x + content.width - (toggle.x + toggle.width))).toBeLessThanOrEqual(2)
    // 300자 메모리가 입력 열 안에서 줄바꿈된다.
    const area = await boxOf(page.getByTestId('ai-memory-list-area'))
    expect(area.x + area.width).toBeLessThanOrEqual(content.x + content.width + 1)
  })
})

test.describe('설정 레이아웃 — 알림', () => {
  test.use({ serviceWorkers: 'allow' })
  test('1920: 이 기기·알림 종류가 2단이고 토글 4개가 행으로 오른쪽 끝에 있다', async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    await mockPushApis(page)
    await page.goto('/settings/notifications')
    await expectSettingsBodyCapped(page)
    await expectSideBySide(settingsSection(page, '이 기기'))
    const kinds = settingsSection(page, '알림 종류')
    await expectSideBySide(kinds)
    const content = await boxOf(kinds.locator('[data-slot="settings-section-content"]'))
    const toggles = await Promise.all(['DM', 'MENTION', 'ISSUE', 'CALENDAR'].map((key) => boxOf(page.getByTestId(`push-pref-${key}`))))
    for (const b of toggles) expect(Math.abs(content.x + content.width - (b.x + b.width))).toBeLessThanOrEqual(2)
  })
})

test.describe('설정 레이아웃 — SSO', () => {
  test('1920: 긴 관리자 동의 링크도 입력 열 안에 있고 스위치는 토글 행이다', async ({ adminPage: page }) => {
    await setupAdminAuth(page)
    await mockApi(page, 'GET', '/api/v1/admin/sso', {
      enabled: true,
      available: true,
      passwordlessMemberCount: 0,
      adminConsentUrl: 'https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=' + 'a'.repeat(120),
    })
    await page.goto('/settings/sso')
    await expectSettingsBodyCapped(page)
    const toggleSec = settingsSection(page, 'SSO 로그인')
    await expectSideBySide(toggleSec)
    const linkSec = settingsSection(page, '관리자 동의 링크')
    const content = await boxOf(linkSec.locator('[data-slot="settings-section-content"]'))
    const input = await boxOf(page.getByRole('textbox', { name: '관리자 동의 링크' }))
    expect(input.x + input.width).toBeLessThanOrEqual(content.x + content.width + 1)
  })
})

test.describe('설정 레이아웃 — 단독 토글 행 간격', () => {
  test('SSO 미가용: 토글 행과 안내 문단 사이가 섹션 간격(16px)과 같다', async ({ adminPage: page }) => {
    await setupAdminAuth(page)
    await mockApi(page, 'GET', '/api/v1/admin/sso', { enabled: false, available: false, passwordlessMemberCount: 0, adminConsentUrl: null })
    await page.goto('/settings/sso')
    // 단독 토글 행에 행 아래 여백이 남으면 space-y-4 와 더해져 28px 로 벌어진다(WP-397 D4).
    // 행 박스는 패딩을 포함하므로, 행 안 내용(라벨 열·스위치 열)의 아래 끝에서 안내 문단까지를 잰다.
    const cols = settingsSection(page, 'SSO 로그인').locator('[data-slot="settings-toggle-row"] > div')
    const [label, control] = await Promise.all([boxOf(cols.nth(0)), boxOf(cols.nth(1))])
    const contentBottom = Math.max(label.y + label.height, control.y + control.height)
    const hint = await boxOf(page.getByText('SSO 를 사용하려면 운영자 설정이 필요합니다.'))
    expect(Math.round(hint.y - contentBottom)).toBe(16)
  })
})

test.describe('설정 레이아웃 — 관리 상세', () => {
  test('역할 상세(시스템 역할): 역할 정보·권한 할당이 2단, 이름 입력 448px 이하', async ({ adminPage: page }) => {
    await setupAdminAuth(page)
    await setupRoleDetailMocks(page, 1, true)
    await page.goto('/settings/roles/1')
    await expectSettingsBodyCapped(page)
    await expectSideBySide(settingsSection(page, '역할 정보'))
    await expectSideBySide(settingsSection(page, '권한 할당'))
    expect((await boxOf(page.getByRole('textbox', { name: '역할 이름' }))).width).toBeLessThanOrEqual(448)
  })

  test('사용자 상세: 기본 정보·활성 상태·역할 할당이 2단', async ({ adminPage: page }) => {
    await setupAdminAuth(page)
    await setupUserDetailMocks(page, 1)
    await page.goto('/settings/users/1')
    await expectSettingsBodyCapped(page)
    for (const t of ['기본 정보', '활성 상태', '역할 할당']) await expectSideBySide(settingsSection(page, t))
    // 데스크톱은 제목 앞 ← 로 목록 복귀(모바일은 ‹ 가 대신해 숨김).
    await expect(page.getByRole('button', { name: '목록으로 돌아가기' })).toBeVisible()
    // 섹션 제목은 heading-group 위계(16/24px semibold, 02-typography §2.1).
    const h2 = settingsSection(page, '기본 정보').getByRole('heading', { level: 2 })
    expect(await h2.evaluate((el) => [getComputedStyle(el).fontSize, getComputedStyle(el).lineHeight, getComputedStyle(el).fontWeight])).toEqual(['16px', '24px', '600'])
  })
})

test.describe('설정 레이아웃 — 프로젝트 설정', () => {
  test('1920: 시작선 일치·1024 상한(가운데 정렬 아님), 기본 정보·멤버·라벨이 2단', async ({ authenticatedPage: page }) => {
    await mockProjectSettings(page)
    await page.goto('/projects/WP/settings')
    await expectSettingsBodyCapped(page)
    const header = await boxOf(page.getByTestId('page-header'))
    expect(Math.abs((await boxOf(page.getByTestId('page-body-content'))).x - header.x)).toBeLessThanOrEqual(1)
    for (const t of ['기본 정보', '멤버', '라벨', '위험 구역']) await expectSideBySide(settingsSection(page, t))
  })

  test('1920: 인라인 추가 줄(라벨·이슈 유형·필드)의 필드 라벨이 같은 기준선에 선다', async ({ authenticatedPage: page }) => {
    await mockProjectSettings(page)
    await page.goto('/projects/WP/settings')
    // 색상 견본 줄이 입력(h-9)보다 낮으면 items-end 정렬에서 '색상' 라벨이 ~10px 아래로 밀렸다(WP-397 디자인 리뷰).
    const form = page.getByTestId('label-create-form')
    const [name, color] = await Promise.all([boxOf(form.getByText('이름', { exact: true })), boxOf(form.getByText('색상', { exact: true }))])
    expect(Math.abs(name.y - color.y)).toBeLessThanOrEqual(1)
    const typeForm = page.getByTestId('issue-type-create-form')
    // 아이콘 열은 입력 열 폭(712px)에서 다음 줄로 감긴다 — 같은 줄의 이름·색상만 비교.
    const [tName, tColor] = await Promise.all([boxOf(typeForm.getByText('이름', { exact: true })), boxOf(typeForm.getByText('색상', { exact: true }))])
    expect(Math.abs(tName.y - tColor.y)).toBeLessThanOrEqual(1)
    const fieldForm = page.getByTestId('custom-field-create-form')
    const [fName, fType] = await Promise.all([boxOf(fieldForm.getByText('이름', { exact: true })), boxOf(fieldForm.getByText('타입', { exact: true }))])
    expect(Math.abs(fName.y - fType.y)).toBeLessThanOrEqual(1)
  })
})
