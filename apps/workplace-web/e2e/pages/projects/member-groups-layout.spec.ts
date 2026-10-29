// 프로젝트 설정 멤버 표의 조직 행(WP-1057) — 데스크톱에서도 이름이 긴 조직이 표를 칸보다 넓혀 「제거」를 밀어내지 않는다(WP-1130).
import { createMember } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expectEndAligned } from '../../fixtures/layout'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'

const LONG_DEPT = '디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀 차세대데이터센터구축TF 운영지원파트'

test.use({ viewport: { width: 1440, height: 900 } })

test('이름이 아주 긴 조직이 있어도 멤버 표가 칸을 넘지 않고 모든 행의 제거가 화면 안에 보인다 (WP-1130)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
  await mockProjectSettings(page, [
    createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
    createMember({ userId: 2, username: 'member@example.com', name: '김멤버', role: 'MEMBER' }),
  ])
  await mockApi(page, 'GET', '/api/v1/projects/WP/member-groups', [
    { groupId: 7, name: LONG_DEPT, role: 'MEMBER', memberCount: 3 },
  ])
  await page.goto('/projects/WP/settings')
  const row = page.getByTestId('member-group-row-7')
  await row.scrollIntoViewIfNeeded()
  const table = page.getByRole('table').first()
  const { tw, pw } = await table.evaluate((el) => ({ tw: el.scrollWidth, pw: el.parentElement!.clientWidth }))
  expect(tw, `표 scrollWidth ${tw} vs 부모 ${pw}`).toBeLessThanOrEqual(pw + 1)
  for (const tid of ['member-group-remove-7', 'member-remove-2']) {
    await expect(page.getByTestId(tid)).toBeInViewport({ ratio: 1 })
  }
  await expect(row.getByText('· 3명')).toBeInViewport({ ratio: 1 })
  await expect(row.getByText('조직', { exact: true })).toBeInViewport({ ratio: 1 })
  // 이름은 칸 안에서 말줄임되고, 전체 이름은 title 로 볼 수 있다.
  const name = row.getByTitle(LONG_DEPT)
  const { sw, cw } = await name.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  expect(sw).toBeGreaterThan(cw)
  // 조직 행의 「제거」가 사람 행의 「제거」와 같은 열에 선다.
  await expectEndAligned(page.getByTestId('member-group-remove-7'), page.getByTestId('member-remove-2'))
})
