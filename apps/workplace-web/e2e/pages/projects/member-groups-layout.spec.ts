// 프로젝트 설정 멤버 표의 조직 행(WP-1057) — 데스크톱에서도 이름이 긴 조직이 표를 칸보다 넓혀 「제거」를 밀어내지 않는다(WP-1130).
// 조직을 펼친 구성원 줄(WP-1094)도 같은 표 안에서 모양을 지킨다(WP-1142) — 펼침 칸은 손 확인만 하던 곳이다.
import type { UserGroupMemberHit } from '../../../src/types/userGroup'
import { createMember } from '../../factories/project.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expectEndAligned } from '../../fixtures/layout'
import { expect, test } from '../../fixtures/auth.fixture'
import { mockProjectSettings } from '../../fixtures/project-settings-mocks'

const LONG_DEPT = '디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀 차세대데이터센터구축TF 운영지원파트'

test.describe('조직 행', () => {
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
})

const LONG_PATH = ['개발본부', '플랫폼개발실', '클라우드인프라운영팀', '데이터파이프라인파트', '실시간처리스쿼드']
const hit = (targetId: number, name: string, groupPath: string[]): UserGroupMemberHit => ({
  targetType: 'MEMBER', targetId, name, email: null, title: null, organization: null, groupId: 7, groupPath,
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`조직 펼침 줄 ${viewport.width}px`, () => {
    test.use({ viewport })

    test('펼친 구성원 줄은 조직 이름 아래에 들여 놓이고, 긴 소속 경로는 이름을 줄이지 않고 표를 넓히지 않는다 (WP-1142)', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
      await mockProjectSettings(page, [
        createMember({ userId: 1, username: 'testuser', name: '테스트 사용자', role: 'OWNER' }),
        createMember({ userId: 2, username: 'member@example.com', name: '김멤버', role: 'MEMBER' }),
      ])
      await mockApi(page, 'GET', '/api/v1/projects/WP/member-groups', [{ groupId: 7, name: '개발본부', role: 'MEMBER', memberCount: 2 }])
      // 직속 한지수와, 다섯 단계 아래 하위 부서의 김민수(경로가 줄 폭보다 길다).
      await mockApi(page, 'GET', '/api/v1/user-groups/7/members/search', [hit(8, '한지수', []), hit(9, '김민수', LONG_PATH)])
      await page.goto('/projects/WP/settings')
      await page.getByTestId('member-group-toggle-7').click()
      const list = page.getByTestId('member-group-members-7')
      const name = list.getByText('김민수', { exact: true })
      await expect(name).toBeVisible()
      await list.scrollIntoViewIfNeeded()

      // 이름은 잘리지 않는다. 휴대폰 폭에서는 경로가 줄 폭보다 길어 경로가 대신 말줄임된다(넓은 화면은 경로가 다 들어간다).
      await expect.poll(() => name.evaluate((el: HTMLElement) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
      const path = list.getByText(LONG_PATH.slice(1).join(' › '), { exact: true })
      if (viewport.width < 640) {
        await expect.poll(() => path.evaluate((el: HTMLElement) => el.scrollWidth > el.clientWidth)).toBe(true)
      }

      // 펼친 줄이 표를 옆으로 늘리지 않는다 — 표 폭은 부모 칸 안, 사람 행·조직 행의 「제거」는 화면 안.
      const table = page.getByRole('table').first()
      const { tw, pw } = await table.evaluate((el) => ({ tw: el.scrollWidth, pw: el.parentElement!.clientWidth }))
      expect(tw, `표 scrollWidth ${tw} vs 부모 ${pw}`).toBeLessThanOrEqual(pw + 1)
      for (const tid of ['member-group-remove-7', 'member-remove-2']) await expect(page.getByTestId(tid)).toBeInViewport({ ratio: 1 })
      // 경로 줄의 오른쪽 끝이 펼침 칸 안에 있다(넘쳐 잘리면 칸 밖까지 뻗는다).
      const cell = page.locator('td', { has: list })
      const [pathBox, cellBox] = [await path.boundingBox(), await cell.boundingBox()]
      expect(pathBox!.x + pathBox!.width).toBeLessThanOrEqual(cellBox!.x + cellBox!.width + 0.5)

      // 구성원 이름은 조직 이름 아래로 들여 놓인다 — 펼침 줄 여백(ml-14)이 조직 행의 아이콘 뒤 이름 자리와 맞는다.
      const deptName = page.getByTestId('member-group-row-7').getByTitle('개발본부')
      const [deptBox, nameBox] = [await deptName.boundingBox(), await name.boundingBox()]
      expect(Math.abs(nameBox!.x - deptBox!.x), `구성원 이름 x ${nameBox!.x} vs 조직 이름 x ${deptBox!.x}`).toBeLessThanOrEqual(6)
    })
  })
}
