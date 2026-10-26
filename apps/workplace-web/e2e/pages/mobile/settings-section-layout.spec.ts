// 설정 폼 주석 섹션 — 모바일은 제목·설명 아래로 입력이 쌓이고 가로 넘침이 없다(WP-397).
import { createRole, createUserDetail } from '../../factories/auth.factory'
import { createMember } from '../../factories/project.factory'
import { setupAdminAuth } from '../../fixtures/admin.fixture'
import { memoryItem, mockAiMemories } from '../../fixtures/ai-memory-mock'
import { mockApi } from '../../fixtures/api-mock'
import { expectStacked, settingsSection } from '../../fixtures/layout'
import { expect, expectBodyNoHorizontalOverflow, expectNoHorizontalOverflow, test } from '../../fixtures/mobile.fixture'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'
import { installPushManagerStub, mockPushApis } from '../../fixtures/push-mock'

/** 긴 실데이터 — 공백 없는 40자+ 이메일·긴 이름(내부 스크롤러 가로 넘침을 드러내는 값). */
const LONG_EMAIL = 'very.long.account.name.for.layout.check@subsidiary.example-company.co.kr'
const LONG_NAME = '김수한무거북이와두루미삼천갑자동방삭치치카포사리사리센타'

test('프로필: 세로 스택 + 가로 넘침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await page.goto('/settings/profile')
  await expect(settingsSection(page, '프로필 정보')).toBeVisible()
  await expectStacked(settingsSection(page, '프로필 정보'))
  await expectNoHorizontalOverflow(page)
})

test('AI 비서: 세로 스택 + 가로 넘침 없음', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockAiMemories(page, [memoryItem(1, { content: '가'.repeat(300) })])
  await page.goto('/settings/assistant')
  await expectStacked(settingsSection(page, '메모리'))
  await expectNoHorizontalOverflow(page)
})

test.describe('알림', () => {
  test.use({ serviceWorkers: 'allow' })
  test('알림: 세로 스택 + 가로 넘침 없음', { tag: '@layout' }, async ({ authenticatedPage: page, context }) => {
    await context.grantPermissions(['notifications'])
    await installPushManagerStub(page)
    await mockPushApis(page)
    await page.goto('/settings/notifications')
    await expectStacked(settingsSection(page, '알림 종류'))
    await expectNoHorizontalOverflow(page)
    // 스위치(18px 높이)는 보이는 크기는 그대로, 터치 영역만 40px 이상 — 스위치 위 16px 지점을 눌러도 스위치가 받는다(10-accessibility §I).
    const sw = page.getByRole('switch', { name: '이 기기에서 푸시 받기' })
    const box = (await sw.boundingBox())!
    expect(box.height).toBeLessThan(24)
    const hit = await sw.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const after = getComputedStyle(el, '::after')
      const target = document.elementFromPoint(r.x + r.width / 2, r.y - 10)
      return { h: parseFloat(after.height), w: parseFloat(after.width), owned: target === el }
    })
    expect(hit.h).toBeGreaterThanOrEqual(40)
    expect(hit.w).toBeGreaterThanOrEqual(40)
    expect(hit.owned).toBe(true)
  })
})

test('사용자 상세: 긴 아이디·이메일·역할 설명도 본문이 가로로 넘치지 않는다', { tag: '@layout' }, async ({ adminPage: page }) => {
  await setupAdminAuth(page)
  await mockApi(page, 'GET', '/api/v1/users/1', createUserDetail({ id: 1, name: LONG_NAME, username: LONG_EMAIL, email: LONG_EMAIL }))
  await mockApi(page, 'GET', '/api/v1/roles', [
    createRole({ id: 1, name: 'PROJECT_PORTFOLIO_MANAGER', description: '여러 프로젝트의 일정·인력·예산을 한꺼번에 조정하고 보고서를 만드는 관리자 역할', isSystem: true }),
    createRole({ id: 2, name: 'ADMIN', description: '시스템 관리자', isSystem: true }),
  ])
  await page.goto('/settings/users/1')
  await expect(page.getByText(LONG_NAME).first()).toBeVisible()
  await expectStacked(settingsSection(page, '기본 정보'))
  await expectBodyNoHorizontalOverflow(page)
  await expectNoHorizontalOverflow(page)
  // 뒤로가기는 모바일 상세 헤더 ‹ 하나뿐 — 데스크톱 제목 앞 ← 는 모바일에서 그리지 않는다(WP-397 디자인 리뷰).
  await expect(page.getByTestId('mobile-back')).toBeVisible()
  await expect(page.getByRole('button', { name: '목록으로 돌아가기' })).toHaveCount(0)
})

test('프로젝트 설정: 긴 이름·이메일 멤버도 본문이 가로로 넘치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockProjectSettings(page, [
    createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
    createMember({ userId: 2, username: LONG_EMAIL, name: LONG_NAME, role: 'MEMBER' }),
  ])
  await page.goto('/projects/WP/settings')
  await expect(page.getByTestId('member-remove-2')).toBeVisible()
  await expectBodyNoHorizontalOverflow(page)
  // 이름이 한 글자 폭으로 세로로 쌓이지 않는다 — 이름 셀이 최소 6rem 이상.
  const nameCell = page.getByRole('row').filter({ has: page.getByTestId('member-remove-2') }).getByRole('cell').first()
  expect((await nameCell.boundingBox())!.width).toBeGreaterThanOrEqual(96)
  // 멤버 추가 팝오버가 화면 가장자리에 붙지 않는다 — 좌우 16px 여백(WP-397 D3).
  await page.getByTestId('member-add-trigger').click()
  const pop = (await page.getByTestId('member-search-popover').boundingBox())!
  expect(pop.x).toBeGreaterThanOrEqual(15)
  expect(pop.x + pop.width).toBeLessThanOrEqual(390 - 15)
})
