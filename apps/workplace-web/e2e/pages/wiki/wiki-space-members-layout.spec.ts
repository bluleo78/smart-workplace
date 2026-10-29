// 노트 스페이스 멤버 창 — 부서 행 펼침의 사람 줄 모양(WP-1094).
// 부서를 펼치면 하위 부서 사람 옆에 소속 경로가 붙는데, 경로가 길면 이름이 한두 글자로 줄어 누군지 알 수 없었다.
// 공유 창 부서 펼침은 WP-1068 에서 고쳤지만 멤버 창은 다른 사본을 써서 남아 있었다. 말줄임 폭은 jsdom 이 잴 수 없어 실제 브라우저로 본다.
import type { UserGroupMemberHit } from '../../../src/types/userGroup'
import type { WikiMember, WikiMemberGroup } from '../../../src/types/wiki'
import { wikiSpace } from '../../factories/wiki.factory'
import { mockApi } from '../../fixtures/api-mock'
import { expect, test } from '../../fixtures/auth.fixture'

const SPACE_ID = 9
const LONG_PATH = ['개발본부', '플랫폼개발실', '클라우드인프라운영팀', '데이터파이프라인파트', '실시간처리스쿼드']

const hit = (targetId: number, name: string, groupPath: string[]): UserGroupMemberHit => ({
  targetType: 'MEMBER', targetId, name, email: null, title: null, organization: null, groupId: 10, groupPath,
})

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`부서를 펼치면 긴 소속 경로가 있어도 사람 이름은 다 보이고 경로가 먼저 줄어든다(${viewport.width}px, WP-1094)`, { tag: '@layout' }, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize(viewport)
    await mockApi(page, 'GET', '/api/v1/wiki/spaces', [wikiSpace({ id: SPACE_ID, name: '제품팀 노트', ownerId: 1, role: 'OWNER' })])
    await mockApi(page, 'GET', `/api/v1/wiki/spaces/${SPACE_ID}/pages`, [])
    const members: WikiMember[] = [{ userId: 1, name: '나', role: 'OWNER' }]
    await mockApi(page, 'GET', `/api/v1/wiki/spaces/${SPACE_ID}/members`, members)
    const groups: WikiMemberGroup[] = [{ groupId: 10, name: '개발본부', role: 'EDITOR', memberCount: 2 }]
    await mockApi(page, 'GET', `/api/v1/wiki/spaces/${SPACE_ID}/member-groups`, groups)
    // 직속 한지수와, 다섯 단계 아래 하위 부서의 김민수(경로가 줄 폭보다 길다).
    await mockApi(page, 'GET', '/api/v1/user-groups/10/members/search', [hit(7, '한지수', []), hit(9, '김민수', LONG_PATH)])

    await page.goto(`/wiki/spaces/${SPACE_ID}`)
    await page.getByTestId('wiki-space-menu').click()
    await page.getByTestId('wiki-space-members').click()
    await page.getByTestId('wiki-member-group-toggle-10').click()
    const list = page.getByTestId('wiki-member-group-members-10')
    const name = list.getByText('김민수', { exact: true })
    await expect(name).toBeVisible()

    // 이름은 잘리지 않는다(글자 폭 그대로) — 고치기 전에는 경로에 밀려 「김…」처럼 줄었다.
    await expect.poll(() => name.evaluate((el: HTMLElement) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    // 대신 경로가 줄 안에서 말줄임된다(잘린 채 보임), 줄은 목록 폭을 넘지 않는다.
    const path = list.getByText(LONG_PATH.slice(1).join(' › '), { exact: true })
    await expect(path).toBeVisible()
    // 창이 열리는 동안(확대 애니메이션) 잰 폭은 다를 수 있어 둘 다 다시 재며 기다린다.
    await expect.poll(() => path.evaluate((el: HTMLElement) => el.scrollWidth > el.clientWidth)).toBe(true)
    // 목록 자신의 scrollWidth 는 줄이 넘쳐도 늘지 않을 수 있어(자식이 truncate) 회귀를 못 잡았다(WP-1142) —
    // 경로 줄의 오른쪽 끝이 목록 안에 있는지 위치로 본다(줄이 넘치면 목록 밖까지 뻗는다).
    await expect.poll(async () => {
      const [p, l] = [await path.boundingBox(), await list.boundingBox()]
      return p!.x + p!.width - (l!.x + l!.width)
    }).toBeLessThanOrEqual(0.5)
  })
}
