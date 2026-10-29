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
  // 짧은 이름 — 이름 칸이 늘 최소 9rem 을 잡던 때는 「QA」도 역할·제거가 다음 줄로 내려가 행이 두 줄이 됐다(WP-1155).
  { userId: 8, name: 'QA', role: 'VIEWER' },
]
// 짧은 이름(띄어쓰기 없음)과 띄어쓰기 있는 긴 이름 — 둘 다 이슈에서 한두 글자만 보였다.
const groups: DriveMemberGroup[] = [
  { groupId: 11, name: '경영지원본부', role: 'EDITOR', memberCount: 2 },
  { groupId: 12, name: '디지털전환추진본부 클라우드플랫폼사업부 인프라운영팀', role: 'VIEWER', memberCount: 14 },
  { groupId: 13, name: '법무', role: 'VIEWER', memberCount: 1 },
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

/**
 * 이름이 역할·제거와 한 줄에 들어가는가 — 이름의 제 글자 폭(max-content) + 간격 + 역할·제거 폭과 줄 폭을 그 환경에서 잰다(WP-1155 의 flex-auto).
 * 글꼴마다 글자 폭이 달라(한글 글꼴이 나눔고딕뿐인 Linux 게이트에서 「법무 · 1명 조직」 행이 감겼다, WP-1214) 미리 정하지 않는다.
 * - 이름 폭은 살아 있는 노드를 건드리지 않고, 줄 안에 흐름 밖(absolute)으로 붙인 복제본에 최소 폭을 풀고 잰다 — 이름 칸이 최소 폭을 다시 잡는 회귀면
 *   「들어간다」로 재어지는데 실제로는 감겨 단언이 깨진다.
 * - 역할·제거 칸은 역할 select 에서 거슬러 찾는다(자리 순서에 기대지 않는다).
 * - 줄 폭과 1px 안으로 붙은 경계는 브라우저의 반올림에 따라 갈릴 수 있어 판정하지 않는다(`fits: null`).
 */
async function measureFit(name: Locator, select: Locator) {
  const handle = await select.elementHandle()
  return name.evaluate((n, sel) => {
    const controls = (sel as HTMLElement).closest('div.ml-auto') as HTMLElement
    const wrap = controls.parentElement!
    if (!wrap.contains(n)) throw new Error('이름과 역할·제거가 같은 줄 안에 있지 않다')
    const clone = n.cloneNode(true) as HTMLElement
    clone.style.cssText = 'position:absolute;visibility:hidden;flex:none;width:max-content;min-width:0;max-width:none'
    wrap.appendChild(clone)
    const nameW = clone.getBoundingClientRect().width
    clone.remove()
    const gap = parseFloat(getComputedStyle(wrap).columnGap) || 0
    const controlsW = controls.getBoundingClientRect().width
    const lineW = wrap.getBoundingClientRect().width
    const need = nameW + gap + controlsW
    return {
      fits: need <= lineW - 1 ? true : need >= lineW + 1 ? false : null,
      detail: `이름 ${nameW} + 간격 ${gap} + 역할·제거 ${controlsW} vs 줄 ${lineW}`,
    }
  }, handle)
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
      // 띄어쓰기 없는 이름(「경영지원본부」)은 한 줄에 다 보인다 — 칸이 좁아 단어 중간에서 끊기지 않는다(역할·제거가 대신 다음 줄로).
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
    // 짧은 이름 행은 들어가면 한 줄이다 — 이름과 역할 select 가 같은 줄(세로 가운데가 같다)에 선다(WP-1155). 들어가지 않는 글꼴에서는 select 가 다음 줄로
    // 내려간다(WP-1214). 「QA」 사람 행은 어느 글꼴로도 들어가므로 늘 한 줄이어야 한다. 이름 칸이 최소 폭을 다시 잡으면, 재는 폭(최소 폭 없이)으로는 들어가는데
    // 실제로는 감겨 사람·조직 행 모두 여기서 깨진다(최소 폭이 줄에 들어갈 만큼 작으면 감기지 않아 잡히지 않는다).
    const center = (b: { y: number; height: number }) => b.y + b.height / 2
    const shortMember = members.find((m) => m.name === 'QA')!
    const shortGroup = groups.find((g) => g.name === '법무')!
    const rows = [
      { name: page.getByTestId(`drive-member-name-${shortMember.userId}`), select: page.getByTestId(`drive-member-role-select-${shortMember.userId}`), mustFit: true },
      { name: page.getByTestId(`drive-member-group-name-${shortGroup.groupId}`), select: page.getByTestId(`drive-member-group-role-select-${shortGroup.groupId}`), mustFit: false },
    ]
    for (const { name, select, mustFit } of rows) {
      const fit = await measureFit(name, select)
      if (mustFit) expect(fit.fits, fit.detail).toBe(true)
      const [a, b] = [(await name.boundingBox())!, (await select.boundingBox())!]
      if (fit.fits === true) expect(Math.abs(center(a) - center(b)), `한 줄이어야 함 — 이름 y ${a.y} vs select y ${b.y} (${fit.detail})`).toBeLessThanOrEqual(2)
      else if (fit.fits === false) expect(b.y, `다음 줄이어야 함 — 이름 아래 ${a.y + a.height} vs select y ${b.y} (${fit.detail})`).toBeGreaterThanOrEqual(a.y + a.height - 0.5)
    }
    // 역할·제거가 다음 줄로 내려간 행에서도 아바타·조직 아이콘은 이름 첫 줄(높이 32px) 옆에 선다 — 두 줄 사이에 뜨지 않는다.
    const longMember = members.find((m) => m.name === 'Christopher-Montgomery')!
    const wrappedGroup = groups.find((g) => g.name === '경영지원본부')!
    for (const [lead, name] of [
      [page.getByTestId(`drive-member-row-${longMember.userId}`).locator(':scope > span').first(), page.getByTestId(`drive-member-name-${longMember.userId}`)],
      [page.getByTestId(`drive-member-group-row-${wrappedGroup.groupId}`).locator('span[aria-hidden="true"]').first(), page.getByTestId(`drive-member-group-name-${wrappedGroup.groupId}`)],
    ]) {
      const [l, n] = [(await lead.boundingBox())!, (await name.boundingBox())!]
      expect(Math.abs(center(l) - (n.y + 16)), `아이콘 가운데 ${center(l)} vs 이름 첫 줄 ${n.y + 16}`).toBeLessThanOrEqual(2)
    }
    // 목록 안에서 가로로 넘치지 않는다 — 대화상자는 고정 위치라 문서 폭이 아니라 목록 스크롤러를 잰다.
    const list = await page.getByTestId('drive-member-list').evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth }))
    expect(list.sw).toBeLessThanOrEqual(list.cw)
  })
})
