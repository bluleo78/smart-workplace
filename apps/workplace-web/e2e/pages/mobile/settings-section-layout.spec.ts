// 설정 폼 주석 섹션 — 모바일은 제목·설명 아래로 입력이 쌓이고 가로 넘침이 없다(WP-397).
import { createRole, createUserDetail } from '../../factories/auth.factory'
import { createMember } from '../../factories/project.factory'
import { setupAdminAuth } from '../../fixtures/admin.fixture'
import { memoryItem, mockAiMemories } from '../../fixtures/ai-memory-mock'
import { mockApi } from '../../fixtures/api-mock'
import { expectEndAligned, expectStacked, settingsSection } from '../../fixtures/layout'
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
  // 팀 프로젝트는 사람·조직 선택 창(WP-1057)이 뜬다.
  const pop = (await page.getByTestId('project-member-picker-search').boundingBox())!
  expect(pop.x).toBeGreaterThanOrEqual(15)
  expect(pop.x + pop.width).toBeLessThanOrEqual(390 - 15)
})

// WP-1130: 이름이 긴 조직 행이 말줄임되지 않고 표를 화면보다 넓혀, 모든 행의 「제거」와 조직의 인원 수·역할이 화면 밖으로 밀렸다.
test('프로젝트 설정: 이름이 긴 조직이 있어도 표가 넓어지지 않고 모든 행의 제거·조직 인원 수·역할이 화면 안에 보인다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockProjectSettings(page, [
    createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
    createMember({ userId: 2, username: 'member@example.com', name: '김멤버', role: 'MEMBER' }),
  ])
  await mockApi(page, 'GET', '/api/v1/projects/WP/member-groups', [
    { groupId: 7, name: '디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀', role: 'MEMBER', memberCount: 12 },
  ])
  await page.goto('/projects/WP/settings')
  const row = page.getByTestId('member-group-row-7')
  await expect(row).toBeVisible()
  // 멤버 표는 설정 화면 아래쪽 — 세로로 스크롤해 둔 뒤 가로로 화면 안인지 본다(가로 스크롤은 없어야 한다).
  await row.scrollIntoViewIfNeeded()
  // 조직 이름은 말줄임되고, 뒤의 「· N명」·「조직」·역할·제거는 화면 안에 다 보인다.
  const name = row.getByTitle('디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀')
  const { sw, cw } = await name.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  expect(sw, `조직 이름 scrollWidth ${sw} > clientWidth ${cw} — 말줄임`).toBeGreaterThan(cw)
  await expect(page.getByTestId('member-group-count-7')).toBeInViewport({ ratio: 1 })
  // 좁은 본문에서는 인원 수·「조직」이 이름 아래 줄로 내려가 이름이 칸 폭을 쓴다 — 이름이 한두 글자로 줄지 않는다.
  expect((await name.boundingBox())!.width, '조직 이름 보이는 폭').toBeGreaterThanOrEqual(96)
  await expect(row.getByText('조직', { exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.getByTestId('member-group-role-7')).toBeInViewport({ ratio: 1 })
  for (const tid of ['member-group-remove-7', 'member-remove-2']) {
    await expect(page.getByTestId(tid)).toBeInViewport({ ratio: 1 })
  }
  // 조직 행의 「제거」가 사람 행의 「제거」와 같은 열에 선다 — 숨은 이메일 열을 colSpan 이 세어 한 칸 밀리지 않는다.
  await expectEndAligned(page.getByTestId('member-group-remove-7'), page.getByTestId('member-remove-2'))
  const table = page.getByRole('table').first()
  const { tw, pw } = await table.evaluate((el) => ({ tw: el.scrollWidth, pw: el.parentElement!.clientWidth }))
  expect(tw, `표 scrollWidth ${tw} vs 부모 ${pw}`).toBeLessThanOrEqual(pw + 1)
  await expectBodyNoHorizontalOverflow(page)
})
