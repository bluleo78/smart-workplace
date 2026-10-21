// 설정 › 내 공유 · 워크스페이스 관리 › 노트 공유(WP-579) — 스페이스를 가로지르는 공유 목록에서 해제·일괄 해제·거르기와
// 외부 공유 스위치(끄기 확인 → PUT)가 실제 API 배선으로 도는지 본다. 서버는 상태를 가진 모킹으로 대신한다 —
// 해제·정책 변경이 다음 GET 에 반영돼 화면이 서버 응답을 따르는지 확인한다.
// 표·확인창의 조건부 렌더 경우의 수는 여기서 늘리지 않는다(화면별 실제 배선만).
import type { Page } from '@playwright/test'

import type { WikiShareListItem } from '../../../src/types/wiki'
import { expect, test } from '../../fixtures/auth.fixture'
import { trackRequests } from '../../fixtures/requests'
import { expectStays } from '../../fixtures/wait'

const ME = { userId: 1, name: '나' }
const MINJI = { userId: 2, name: '김민지' }
const SEOJUN = { userId: 3, name: '박서준' }
/** 아주 먼 미래 — 「만료됨」으로 보이지 않게(실행 날짜와 무관하게 결정적). */
const FAR = '2099-01-01T00:00:00Z'

function share(over: Partial<WikiShareListItem> & Pick<WikiShareListItem, 'pageId' | 'title'>): WikiShareListItem {
  return {
    audience: 'WORKSPACE',
    permission: 'VIEW',
    includeChildren: false,
    peopleCount: 0,
    createdBy: ME,
    updatedAt: '2026-10-20T00:00:00Z',
    expiresAt: null,
    lastAccessedAt: null,
    viewCount: 0,
    spaceId: 1,
    spaceName: '내 노트',
    token: `wsh_${over.pageId}`,
    ...over,
  }
}

const MINE: WikiShareListItem[] = [
  share({ pageId: 11, title: '제품 로드맵', includeChildren: true }),
  share({ pageId: 12, title: '온보딩 가이드', audience: 'PUBLIC', expiresAt: FAR }),
]
const ALL: WikiShareListItem[] = [
  ...MINE,
  share({ pageId: 31, title: '고객사 A 킥오프', audience: 'PUBLIC', expiresAt: FAR, createdBy: MINJI, spaceId: 2, spaceName: '영업팀' }),
  share({ pageId: 32, title: '채용 면접 질문', audience: 'PEOPLE', permission: 'EDIT', peopleCount: 3, createdBy: SEOJUN, spaceId: 3, spaceName: '인사팀' }),
  share({ pageId: 33, title: '분기 OKR', createdBy: SEOJUN, spaceId: 3, spaceName: '인사팀' }),
]

/** 서버가 가진 공유 목록·정책 — 해제·정책 변경이 여기 반영돼 다음 GET 에 돌아온다. */
interface Server {
  mine: WikiShareListItem[]
  all: WikiShareListItem[]
  externalShareEnabled: boolean
}

async function mockServer(page: Page, server: Server) {
  await page.route((u) => u.pathname === '/api/v1/wiki/shares/mine', (r) => r.fulfill({ json: server.mine }))
  await page.route((u) => u.pathname === '/api/v1/admin/wiki/shares', (r) => r.fulfill({ json: server.all }))
  await page.route((u) => u.pathname === '/api/v1/admin/wiki/share-policy', (r) => {
    if (r.request().method() === 'PUT') {
      const body = r.request().postDataJSON() as { externalShareEnabled: boolean }
      server.externalShareEnabled = body.externalShareEnabled
      // 끄면 외부 공개 공유가 모두 지워진다(서버 동작을 흉내).
      if (!body.externalShareEnabled) {
        server.all = server.all.filter((i) => i.audience !== 'PUBLIC')
        server.mine = server.mine.filter((i) => i.audience !== 'PUBLIC')
      }
    }
    return r.fulfill({ json: { externalShareEnabled: server.externalShareEnabled } })
  })
  await page.route((u) => /^\/api\/v1\/wiki\/pages\/\d+\/share$/.test(u.pathname), (r) => {
    if (r.request().method() !== 'DELETE') return r.fallback()
    const id = Number(new URL(r.request().url()).pathname.split('/')[5])
    server.mine = server.mine.filter((i) => i.pageId !== id)
    server.all = server.all.filter((i) => i.pageId !== id)
    return r.fulfill({ status: 204, body: '' })
  })
  await page.route((u) => u.pathname === '/api/v1/admin/wiki/shares/revoke', (r) => {
    const { pageIds } = r.request().postDataJSON() as { pageIds: number[] }
    server.all = server.all.filter((i) => !pageIds.includes(i.pageId))
    server.mine = server.mine.filter((i) => !pageIds.includes(i.pageId))
    return r.fulfill({ status: 204, body: '' })
  })
}

const rowOf = (page: Page, pageId: number) => page.getByTestId(`wiki-share-row-${pageId}`)

test.describe('설정 › 내 공유', () => {
  test('내 공유에서 해제하면 확인 후 DELETE 한다', async ({ authenticatedPage: page }) => {
    const server: Server = { mine: [...MINE], all: [...ALL], externalShareEnabled: true }
    await mockServer(page, server)
    const deletes = trackRequests(page, 'DELETE', '/api/v1/wiki/pages/12/share')

    await page.goto('/settings/my-shares')
    await expect(rowOf(page, 12)).toContainText('온보딩 가이드')
    await expect(rowOf(page, 12)).toContainText('외부 공개')
    // 내 공유는 모두 내 것이라 만든 사람 칸·일괄 선택이 없다.
    await expect(page.getByRole('columnheader', { name: '만든 사람' })).toHaveCount(0)
    await expect(page.getByRole('checkbox')).toHaveCount(0)

    await rowOf(page, 12).getByRole('button', { name: '해제' }).click()
    const dialog = page.getByTestId('wiki-revoke-shares-dialog')
    await expect(dialog).toBeVisible()
    // 확인 전에는 요청이 가지 않는다.
    await expectStays(page, deletes.count, 0)

    // 취소하면 아무 일도 없다.
    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(dialog).toBeHidden()
    await expectStays(page, deletes.count, 0)

    await rowOf(page, 12).getByRole('button', { name: '해제' }).click()
    await page.getByTestId('wiki-revoke-shares-dialog').getByRole('button', { name: '해제' }).click()
    await deletes.waitFor(1)
    await expect(rowOf(page, 12)).toHaveCount(0)
    await expect(rowOf(page, 11)).toBeVisible()
    await expectStays(page, deletes.count, 1)
  })

  test('공유가 없으면 안내를 보인다', async ({ authenticatedPage: page }) => {
    await page.route((u) => u.pathname === '/api/v1/wiki/shares/mine', (r) => r.fulfill({ json: [] }))
    await page.goto('/settings/my-shares')
    await expect(page.getByTestId('wiki-share-table')).toContainText('공유 중인 페이지가 없습니다')
  })
})

test.describe('워크스페이스 관리 › 노트 공유', () => {
  test('관리자는 여러 개를 골라 일괄 해제한다', async ({ adminPage: page }) => {
    const server: Server = { mine: [...MINE], all: [...ALL], externalShareEnabled: true }
    await mockServer(page, server)
    const revokes = trackRequests(page, 'POST', '/api/v1/admin/wiki/shares/revoke')

    await page.goto('/settings/wiki-sharing')
    await expect(rowOf(page, 31)).toContainText('김민지')

    await page.getByRole('checkbox', { name: '고객사 A 킥오프 고르기' }).click()
    await page.getByRole('checkbox', { name: '분기 OKR 고르기' }).click()
    await page.getByTestId('wiki-share-table-revoke-selected').click()

    const dialog = page.getByTestId('wiki-revoke-shares-dialog')
    await expect(dialog).toContainText('공유 2개를 해제할까요?')
    await expectStays(page, revokes.count, 0)
    await dialog.getByRole('button', { name: '해제' }).click()

    await revokes.waitFor(1)
    expect(revokes.requests()[0].postDataJSON()).toEqual({ pageIds: [31, 33] })
    await expect(rowOf(page, 31)).toHaveCount(0)
    await expect(rowOf(page, 33)).toHaveCount(0)
    await expect(rowOf(page, 32)).toBeVisible()
    // 해제된 줄이 사라진 뒤 선택 버튼도 없다.
    await expect(page.getByTestId('wiki-share-table-revoke-selected')).toHaveCount(0)
  })

  test('거르기(범위·스페이스·검색)가 목록에 반영된다', async ({ adminPage: page }) => {
    await mockServer(page, { mine: [], all: [...ALL], externalShareEnabled: true })
    await page.goto('/settings/wiki-sharing')
    await expect(page.getByTestId('wiki-share-table').getByRole('row')).toHaveCount(ALL.length + 1)

    // 범위 — 외부 공개만.
    await page.getByRole('combobox', { name: '범위' }).click()
    await page.getByRole('option', { name: '외부 공개' }).click()
    await expect(rowOf(page, 12)).toBeVisible()
    await expect(rowOf(page, 31)).toBeVisible()
    await expect(rowOf(page, 11)).toHaveCount(0)
    await expect(rowOf(page, 32)).toHaveCount(0)

    // 스페이스 — 영업팀만(범위 조건과 함께 적용).
    await page.getByRole('combobox', { name: '스페이스' }).click()
    await page.getByRole('option', { name: '영업팀' }).click()
    await expect(rowOf(page, 31)).toBeVisible()
    await expect(rowOf(page, 12)).toHaveCount(0)

    // 조건에 맞는 것이 없으면 안내.
    await page.getByRole('combobox', { name: '범위' }).click()
    await page.getByRole('option', { name: '지정한 사람' }).click()
    await expect(page.getByTestId('wiki-share-table')).toContainText('조건에 맞는 공유가 없습니다')

    // 범위·스페이스를 풀고 검색 — 만든 사람 이름으로도 찾는다.
    await page.getByRole('combobox', { name: '범위' }).click()
    await page.getByRole('option', { name: '모든 범위' }).click()
    await page.getByRole('combobox', { name: '스페이스' }).click()
    await page.getByRole('option', { name: '모든 스페이스' }).click()
    await page.getByRole('textbox', { name: '공유 찾기' }).fill('박서준')
    await expect(rowOf(page, 32)).toBeVisible()
    await expect(rowOf(page, 33)).toBeVisible()
    await expect(rowOf(page, 11)).toHaveCount(0)
  })

  test('거르기로 가려진 줄은 일괄 해제에 들어가지 않는다', async ({ adminPage: page }) => {
    const server: Server = { mine: [], all: [...ALL], externalShareEnabled: true }
    await mockServer(page, server)
    const revokes = trackRequests(page, 'POST', '/api/v1/admin/wiki/shares/revoke')
    await page.goto('/settings/wiki-sharing')

    await page.getByRole('checkbox', { name: '고객사 A 킥오프 고르기' }).click()
    await page.getByRole('checkbox', { name: '분기 OKR 고르기' }).click()
    await page.getByRole('textbox', { name: '공유 찾기' }).fill('OKR')
    await expect(rowOf(page, 31)).toHaveCount(0)
    await page.getByTestId('wiki-share-table-revoke-selected').click()
    await page.getByTestId('wiki-revoke-shares-dialog').getByRole('button', { name: '해제' }).click()
    await revokes.waitFor(1)
    expect(revokes.requests()[0].postDataJSON()).toEqual({ pageIds: [33] })
  })

  test('외부 공유를 끄면 막히는 수를 알리고 PUT 한다', async ({ adminPage: page }) => {
    const server: Server = { mine: [], all: [...ALL], externalShareEnabled: true }
    await mockServer(page, server)
    const puts = trackRequests(page, 'PUT', '/api/v1/admin/wiki/share-policy')

    await page.goto('/settings/wiki-sharing')
    const sw = page.getByTestId('wiki-external-share-switch')
    await expect(sw).toBeChecked()
    await expect(rowOf(page, 31)).toBeVisible()

    await sw.click()
    const dialog = page.getByTestId('wiki-external-share-off-dialog')
    // 외부 공개 2개(12·31)가 막히고, 다시 켜도 되살아나지 않는다고 알린다.
    await expect(dialog).toContainText('2개가 바로 막힙니다')
    await expect(dialog).toContainText('되살아나지 않')
    await expectStays(page, puts.count, 0)

    // 취소하면 그대로 켜져 있다.
    await dialog.getByRole('button', { name: '취소' }).click()
    await expect(dialog).toBeHidden()
    await expect(sw).toBeChecked()
    await expectStays(page, puts.count, 0)

    await sw.click()
    await page.getByTestId('wiki-external-share-off-dialog').getByRole('button', { name: '끄기' }).click()
    await puts.waitFor(1)
    expect(puts.requests()[0].postDataJSON()).toEqual({ externalShareEnabled: false })
    await expect(sw).not.toBeChecked()
    // 서버가 지운 외부 공개 공유가 목록에서도 사라진다.
    await expect(rowOf(page, 31)).toHaveCount(0)
    await expect(rowOf(page, 12)).toHaveCount(0)
    await expect(rowOf(page, 11)).toBeVisible()

    // 막을 외부 링크가 없으니 다시 켤 때는 확인 없이 바로 PUT.
    await sw.click()
    await puts.waitFor(2)
    expect(puts.requests()[1].postDataJSON()).toEqual({ externalShareEnabled: true })
    await expect(page.getByTestId('wiki-external-share-off-dialog')).toHaveCount(0)
  })

  test('막을 외부 링크가 없으면 확인 없이 바로 끈다', async ({ adminPage: page }) => {
    const server: Server = { mine: [], all: ALL.filter((i) => i.audience !== 'PUBLIC'), externalShareEnabled: true }
    await mockServer(page, server)
    const puts = trackRequests(page, 'PUT', '/api/v1/admin/wiki/share-policy')
    await page.goto('/settings/wiki-sharing')
    await expect(rowOf(page, 11)).toBeVisible()
    await page.getByTestId('wiki-external-share-switch').click()
    await puts.waitFor(1)
    expect(puts.requests()[0].postDataJSON()).toEqual({ externalShareEnabled: false })
    await expect(page.getByTestId('wiki-external-share-off-dialog')).toHaveCount(0)
  })

  test('이미 만료된 외부 링크만 있으면 막히는 것이 없으니 확인 없이 끈다', async ({ adminPage: page }) => {
    const expired = share({ pageId: 41, title: '지난 행사 안내', audience: 'PUBLIC', expiresAt: '2020-01-01T00:00:00Z' })
    await mockServer(page, { mine: [], all: [expired], externalShareEnabled: true })
    const puts = trackRequests(page, 'PUT', '/api/v1/admin/wiki/share-policy')
    await page.goto('/settings/wiki-sharing')
    await expect(rowOf(page, 41)).toContainText('만료됨')
    await page.getByTestId('wiki-external-share-switch').click()
    await puts.waitFor(1)
    expect(puts.requests()[0].postDataJSON()).toEqual({ externalShareEnabled: false })
    await expect(page.getByTestId('wiki-external-share-off-dialog')).toHaveCount(0)
  })

  test('목록을 못 불러왔으면 몇 개인지 모른 채로도 끄기 전에 확인을 받는다', async ({ adminPage: page }) => {
    await mockServer(page, { mine: [], all: [], externalShareEnabled: true })
    await page.route((u) => u.pathname === '/api/v1/admin/wiki/shares', (r) => r.fulfill({ status: 500, json: { message: '오류' } }))
    const puts = trackRequests(page, 'PUT', '/api/v1/admin/wiki/share-policy')
    await page.goto('/settings/wiki-sharing')
    await expect(page.getByTestId('wiki-share-table')).toContainText('목록을 불러오지 못했습니다')
    await page.getByTestId('wiki-external-share-switch').click()
    const dialog = page.getByTestId('wiki-external-share-off-dialog')
    await expect(dialog).toContainText('외부에 공개된 링크가 모두 바로 막힙니다')
    await expectStays(page, puts.count, 0)
  })

  test('외부 공유 설정을 못 불러오면 꺼진 것처럼 보이지 않고 스위치를 잠근다', async ({ adminPage: page }) => {
    await mockServer(page, { mine: [], all: [...ALL], externalShareEnabled: true })
    await page.route((u) => u.pathname === '/api/v1/admin/wiki/share-policy', (r) => r.fulfill({ status: 500, json: { message: '오류' } }))
    await page.goto('/settings/wiki-sharing')
    await expect(page.getByTestId('wiki-external-share-error')).toBeVisible()
    await expect(page.getByTestId('wiki-external-share-switch')).toBeDisabled()
  })

  test('목록이 500건이면 최신 500건만 보인다고 알린다', async ({ adminPage: page }) => {
    const many = Array.from({ length: 500 }, (_, i) => share({ pageId: 1000 + i, title: `페이지 ${i}` }))
    await mockServer(page, { mine: [], all: many, externalShareEnabled: true })
    await page.goto('/settings/wiki-sharing')
    await expect(page.getByTestId('wiki-share-cap-note')).toContainText('최근 500개')
  })

  test('목록이 500건으로 잘렸으면 끄기 확인은 정확한 수 대신 「최소 N개」로 알린다', async ({ adminPage: page }) => {
    const many = Array.from({ length: 500 }, (_, i) =>
      share({ pageId: 1000 + i, title: `페이지 ${i}`, audience: i < 2 ? 'PUBLIC' : 'WORKSPACE', expiresAt: i < 2 ? FAR : null }),
    )
    await mockServer(page, { mine: [], all: many, externalShareEnabled: true })
    const puts = trackRequests(page, 'PUT', '/api/v1/admin/wiki/share-policy')
    await page.goto('/settings/wiki-sharing')
    await expect(page.getByTestId('wiki-share-cap-note')).toBeVisible()
    await page.getByTestId('wiki-external-share-switch').click()
    const dialog = page.getByTestId('wiki-external-share-off-dialog')
    await expect(dialog).toContainText('최소 2개')
    await expect(dialog).not.toContainText('링크 2개가')
    await expectStays(page, puts.count, 0)
  })

  test('해제·재조회 뒤 사라진 줄의 선택은 비워진다(같은 줄이 다시 나와도 체크돼 있지 않다)', async ({ adminPage: page }) => {
    const server: Server = { mine: [], all: [...ALL], externalShareEnabled: true }
    await mockServer(page, server)
    await page.goto('/settings/wiki-sharing')
    await page.getByRole('checkbox', { name: '고객사 A 킥오프 고르기' }).click()
    await expect(page.getByTestId('wiki-share-table-revoke-selected')).toBeVisible()

    // 그 줄을 행 버튼으로 해제 — 줄이 사라진다.
    await rowOf(page, 31).getByRole('button', { name: '해제' }).click()
    await page.getByTestId('wiki-revoke-shares-dialog').getByRole('button', { name: '해제' }).click()
    await expect(rowOf(page, 31)).toHaveCount(0)

    // 같은 페이지가 다시 공유돼 다음 조회에 돌아온다(다른 줄을 해제해 재조회를 일으킨다).
    server.all = [...server.all, ALL.find((i) => i.pageId === 31)!]
    await rowOf(page, 32).getByRole('button', { name: '해제' }).click()
    await page.getByTestId('wiki-revoke-shares-dialog').getByRole('button', { name: '해제' }).click()
    await expect(rowOf(page, 32)).toHaveCount(0)
    await expect(rowOf(page, 31)).toBeVisible()
    await expect(page.getByRole('checkbox', { name: '고객사 A 킥오프 고르기' })).not.toBeChecked()
    await expect(page.getByTestId('wiki-share-table-revoke-selected')).toHaveCount(0)
  })

  test('500건 미만이면 안내가 없다', async ({ adminPage: page }) => {
    await mockServer(page, { mine: [], all: [...ALL], externalShareEnabled: true })
    await page.goto('/settings/wiki-sharing')
    await expect(rowOf(page, 11)).toBeVisible()
    await expectStays(page, () => page.getByTestId('wiki-share-cap-note').count(), 0)
  })

  test('일반 사용자는 관리자 화면에 들어갈 수 없고 사이드바에도 없다', async ({ authenticatedPage: page }) => {
    await mockServer(page, { mine: [...MINE], all: [...ALL], externalShareEnabled: true })
    await page.goto('/settings/my-shares')
    await expect(page.getByTestId('settings-sidebar').getByRole('link', { name: '내 공유' })).toBeVisible()
    await expect(page.getByTestId('settings-sidebar').getByRole('link', { name: '노트 공유' })).toHaveCount(0)

    // 주소를 직접 쳐도 막힌다 — AdminRoute 가 홈으로 돌려보내고 관리자 화면은 그려지지 않는다.
    await page.goto('/settings/wiki-sharing')
    await expect.poll(() => new URL(page.url()).pathname).not.toBe('/settings/wiki-sharing')
    await expect(page.getByTestId('wiki-sharing-admin-page')).toHaveCount(0)
  })
})
