// 설정 › 내 공유 · 앱 설정 › 노트(WP-579, WP-887 에서 「워크스페이스 관리 › 노트 공유」를 옮김) — 스페이스를 가로지르는 공유 목록에서 해제·일괄 해제·거르기와
// 외부 공유 스위치(끄기 확인 → PUT)가 실제 API 배선으로 도는지 본다. 서버는 상태를 가진 모킹으로 대신한다 —
// 해제·정책 변경이 다음 GET 에 반영돼 화면이 서버 응답을 따르는지 확인한다.
// 표·확인창의 조건부 렌더 경우의 수는 여기서 늘리지 않는다(화면별 실제 배선만).
// 빈 목록·거르기·가려진 줄 제외·외부 공유 끄기 확인(수·최소 N개·모름·확인 없음)·정책 실패 잠금·500건 안내·재조회 뒤 선택 비우기는
// src/pages/settings/wikiSharing.test.tsx, 옛 주소 이동·일반 사용자 차단은 src/pages/settings/settingsNav.test.tsx 로 옮겼다(WP-985).
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
  test('내 공유에서 해제하면 확인 후 DELETE 한다', { tag: '@wiring' }, async ({ authenticatedPage: page }) => {
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
})

test.describe('앱 설정 › 노트(노트 공유)', () => {
  test('관리자는 여러 개를 골라 일괄 해제한다', { tag: '@wiring' }, async ({ adminPage: page }) => {
    const server: Server = { mine: [...MINE], all: [...ALL], externalShareEnabled: true }
    await mockServer(page, server)
    const revokes = trackRequests(page, 'POST', '/api/v1/admin/wiki/shares/revoke')

    await page.goto('/settings/apps/wiki')
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
})
