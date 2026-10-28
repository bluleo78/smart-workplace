// 팀 공간 「멤버」 창의 이름 레이아웃(WP-1096) — 노트·드라이브가 함께 쓰는 SpaceMemberDialog 를 드라이브로 띄워 잰다.
// 휴대폰 폭에서는 역할 select·「제거」가 행 폭을 먼저 차지해, 자르는(truncate) 조직·사람 이름이 「경...」처럼 한두 글자만 남아 누구·어느 조직인지
// 알 수 없었다. 이름이 잘리지 않고 다 보이는지(자리가 모자라면 역할·제거가 다음 줄로), 인원 수·「조직」 배지가 select 와 겹치지 않는지는 jsdom 이 잴 수 없는 기하라
// E2E(@layout)로 본다.
import type { Locator, Page } from '@playwright/test'

import type { DriveMember, DriveMemberGroup } from '../../../src/types/drive'
import { createSpace, personalSpace } from '../../factories/drive.factory'
import { expect, test } from '../../fixtures/auth.fixture'

test.use({ viewport: { width: 390, height: 844 } })

const TEAM = createSpace({ id: 2, name: '기획팀' })
// 띄어쓰기 없는 사람 이름 — 예전엔 「Wo...」처럼 잘렸다. 내 행(1)은 「(나)」가 붙는다.
const members: DriveMember[] = [
  { userId: 1, name: 'Work Loop Admin', role: 'OWNER' },
  { userId: 7, name: 'Christopher-Montgomery', role: 'EDITOR' },
]
// 짧은 이름(띄어쓰기 없음)과 띄어쓰기 있는 긴 이름 — 둘 다 이슈에서 한두 글자만 보였다.
const groups: DriveMemberGroup[] = [
  { groupId: 11, name: '경영지원본부', role: 'EDITOR', memberCount: 2 },
  { groupId: 12, name: '디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀', role: 'VIEWER', memberCount: 14 },
]

/** 드라이브 목록·쿼터·항목과 팀 공간 멤버(사람·조직) 조회 모킹. */
async function mockDrive(page: Page) {
  await page.route((u) => u.pathname === '/api/v1/drive/quota', (r) => r.fulfill({ json: { usedBytes: 0, quotaBytes: 1024 ** 3 } }))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [personalSpace({ id: 1 }), TEAM] }) : r.fallback())
  await page.route((u) => /\/api\/v1\/drive\/spaces\/\d+\/items$/.test(u.pathname), (r) => r.fulfill({ json: { folders: [], files: [] } }))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces/2/members', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: members }) : r.fallback()))
  await page.route((u) => u.pathname === '/api/v1/drive/spaces/2/member-groups', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: groups }) : r.fallback()))
}

/** 잘림 없음 — 글자가 칸보다 넓지 않고 말줄임이 아니다(예전 truncate 는 scrollWidth > clientWidth). */
async function expectNotClipped(el: Locator, label: string) {
  const clip = await el.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, overflow: getComputedStyle(n).textOverflow }))
  expect(clip.sw, label).toBeLessThanOrEqual(clip.cw + 1)
  expect(clip.overflow, label).not.toBe('ellipsis')
}

/** 두 요소가 겹치지 않는다 — 역할 select 는 이름 오른쪽에 있거나, 이름 칸이 모자라 다음 줄로 내려간다. */
async function expectApart(el: Locator, select: Locator, label: string) {
  const a = (await el.boundingBox())!
  const b = (await select.boundingBox())!
  const leftOf = a.x + a.width <= b.x + 0.5
  const above = a.y + a.height <= b.y + 0.5
  expect(leftOf || above, label).toBe(true)
}

test.describe('팀 공간 멤버 창 — 이름 레이아웃 (WP-1096)', () => {
  test('휴대폰 폭에서 조직·사람 이름이 잘리지 않고, 인원 수·조직 배지·역할 select 가 서로 겹치지 않는다', { tag: '@layout' }, async ({ authenticatedPage: page }) => {
    await mockDrive(page)
    await page.goto('/drive')
    await page.getByTestId('drive-space-menu-2').click()
    await page.getByTestId('drive-space-members-2').click()
    await expect(page.getByTestId('drive-members-dialog')).toBeVisible()

    for (const g of groups) {
      const box = page.getByTestId(`drive-member-group-name-${g.groupId}`)
      const select = page.getByTestId(`drive-member-group-role-select-${g.groupId}`)
      const name = box.getByText(g.name, { exact: true })
      await expect(name).toBeVisible()
      await expectNotClipped(name, g.name)
      // 짧은 이름(「경영지원본부」)은 한 줄에 다 보인다 — 칸이 좁아 단어 중간에서 끊기지 않는다(이름 칸 최소 9rem).
      if (!g.name.includes(' ')) expect((await name.boundingBox())!.height, g.name).toBeLessThan(24)
      // 인원 수·「조직」 배지도 보이고 select 와 겹치지 않는다(자리가 모자라면 다음 줄로 내려간다).
      for (const part of [name, box.getByText(`· ${g.memberCount}명`), box.getByText('조직', { exact: true })]) {
        await expect(part).toBeVisible()
        await expectApart(part, select, g.name)
      }
    }
    for (const m of members) {
      const name = page.getByTestId(`drive-member-name-${m.userId}`)
      await expect(name).toContainText(m.name)
      await expectNotClipped(name, m.name)
      await expectApart(name, page.getByTestId(`drive-member-role-select-${m.userId}`), m.name)
    }
    // 목록 안에서 가로로 넘치지 않는다 — 대화상자는 고정 위치라 문서 폭이 아니라 목록 스크롤러를 잰다.
    const list = await page.getByTestId('drive-member-list').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }))
    expect(list.sw).toBeLessThanOrEqual(list.cw)
  })
})
