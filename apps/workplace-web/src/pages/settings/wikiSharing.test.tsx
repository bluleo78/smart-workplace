// 설정 › 내 공유(MySharesPage)·앱 설정 › 노트(WikiSharingPage) — 화면 컴포넌트 테스트(WP-579, WP-887, WP-971, WP-995).
// 해제 확인(취소·확정)·빈 목록, 거르기(범위·스페이스·검색)와 가려진 줄의 일괄 해제 제외, 외부 공유 끄기 확인(막히는 수·최소 N개·모름)과 PUT,
// 확인이 필요 없는 경우(외부 공개 없음·만료만), 정책 조회 실패 잠금, 500건 안내, 재조회 뒤 선택 비우기는 브라우저 없이 판정되므로
// e2e/pages/settings/wiki-sharing.spec.ts 에서 옮겼다. 옛 주소 이동·일반 사용자 차단은 settingsNav.test.tsx 가 본다.
// 서버는 상태를 가진 MSW 목으로 대신해 해제·정책 변경이 다음 GET 에 반영되는지까지 본다. 화면 배선(@wiring)은 E2E 에 남는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import WikiSharingPage from '@/pages/admin/WikiSharingPage'
import { renderScreen } from '@/test/renderScreen'
import type { WikiShareListItem } from '@/types/wiki'

import MySharesPage from './MySharesPage'

const ADMIN = { isAdmin: true, hasRole: (r: string) => r === 'ADMIN' }
const ME = { userId: 1, name: '나' }
const MINJI = { userId: 2, name: '김민지' }
const SEOJUN = { userId: 3, name: '박서준' }
/** 아주 먼 미래 — 「만료됨」으로 보이지 않게. */
const FAR = '2099-01-01T00:00:00Z'

function share(over: Partial<WikiShareListItem> & Pick<WikiShareListItem, 'pageId' | 'title'>): WikiShareListItem {
  return {
    audience: 'WORKSPACE', permission: 'VIEW', includeChildren: false, peopleCount: 0, createdBy: ME,
    updatedAt: '2026-10-20T00:00:00Z', expiresAt: null, lastAccessedAt: null, viewCount: 0,
    spaceId: 1, spaceName: '내 노트', token: `wsh_${over.pageId}`, ...over,
  }
}

const MINE = [
  share({ pageId: 11, title: '제품 로드맵', includeChildren: true }),
  share({ pageId: 12, title: '온보딩 가이드', audience: 'PUBLIC', expiresAt: FAR }),
]
const ALL = [
  ...MINE,
  share({ pageId: 31, title: '고객사 A 킥오프', audience: 'PUBLIC', expiresAt: FAR, createdBy: MINJI, spaceId: 2, spaceName: '영업팀' }),
  share({ pageId: 32, title: '채용 면접 질문', audience: 'PEOPLE', permission: 'EDIT', peopleCount: 3, createdBy: SEOJUN, spaceId: 3, spaceName: '인사팀' }),
  share({ pageId: 33, title: '분기 OKR', createdBy: SEOJUN, spaceId: 3, spaceName: '인사팀' }),
]

/**
 * 상태를 가진 공유 서버 — 해제·정책 변경이 목록에 반영돼 다음 GET 에 돌아온다(e2e mockServer 와 같은 동작).
 * fail 로 목록·정책 조회를 500 으로 바꾼다. 쓰기 요청 본문은 deletes·revokes·puts 에 모은다.
 */
function shareServer(init: { mine?: WikiShareListItem[]; all?: WikiShareListItem[]; external?: boolean; fail?: 'list' | 'policy' } = {}) {
  const s = { mine: [...(init.mine ?? [])], all: [...(init.all ?? [])], external: init.external ?? true }
  const deletes: number[] = []
  const revokes: unknown[] = []
  const puts: unknown[] = []
  const drop = (ids: number[]) => {
    s.mine = s.mine.filter((i) => !ids.includes(i.pageId))
    s.all = s.all.filter((i) => !ids.includes(i.pageId))
  }
  const handlers = [
    http.get('/api/v1/wiki/shares/mine', () => HttpResponse.json(s.mine)),
    http.get('/api/v1/admin/wiki/shares', () =>
      init.fail === 'list' ? HttpResponse.json({ message: '오류' }, { status: 500 }) : HttpResponse.json(s.all),
    ),
    http.get('/api/v1/admin/wiki/share-policy', () =>
      init.fail === 'policy' ? HttpResponse.json({ message: '오류' }, { status: 500 }) : HttpResponse.json({ externalShareEnabled: s.external }),
    ),
    http.put('/api/v1/admin/wiki/share-policy', async ({ request }) => {
      const body = (await request.json()) as { externalShareEnabled: boolean }
      puts.push(body)
      s.external = body.externalShareEnabled
      // 끄면 외부 공개 공유가 모두 지워진다(서버 동작을 흉내).
      if (!body.externalShareEnabled) drop(s.all.filter((i) => i.audience === 'PUBLIC').map((i) => i.pageId))
      return HttpResponse.json({ externalShareEnabled: s.external })
    }),
    http.delete('/api/v1/wiki/pages/:id/share', ({ params }) => {
      deletes.push(Number(params.id))
      drop([Number(params.id)])
      return new HttpResponse(null, { status: 204 })
    }),
    http.post('/api/v1/admin/wiki/shares/revoke', async ({ request }) => {
      const body = (await request.json()) as { pageIds: number[] }
      revokes.push(body)
      drop(body.pageIds)
      return new HttpResponse(null, { status: 204 })
    }),
  ]
  return { s, handlers, deletes, revokes, puts }
}

const row = (pageId: number) => screen.queryByTestId(`wiki-share-row-${pageId}`)

describe('설정 › 내 공유', () => {
  test('해제는 확인 전·취소에는 요청하지 않고, 확인하면 DELETE 후 줄이 사라진다', async () => {
    const api = shareServer({ mine: MINE, all: ALL })
    const { user } = renderScreen(<MySharesPage />, { path: '/settings/my-shares', handlers: api.handlers })
    expect(await screen.findByTestId('wiki-share-row-12')).toHaveTextContent('온보딩 가이드')
    expect(row(12)).toHaveTextContent('외부 공개')
    // 내 공유는 모두 내 것이라 만든 사람 칸·일괄 선택이 없다.
    expect(screen.queryByRole('columnheader', { name: '만든 사람' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    await user.click(within(row(12)!).getByRole('button', { name: '해제' }))
    const dialog = await screen.findByTestId('wiki-revoke-shares-dialog')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('wiki-revoke-shares-dialog')).not.toBeInTheDocument())
    expect(api.deletes).toEqual([])

    await user.click(within(row(12)!).getByRole('button', { name: '해제' }))
    await user.click(within(await screen.findByTestId('wiki-revoke-shares-dialog')).getByRole('button', { name: '해제' }))
    await waitFor(() => expect(row(12)).not.toBeInTheDocument())
    expect(api.deletes).toEqual([12])
    expect(row(11)).toBeInTheDocument()
  })

  test('공유가 없으면 안내를 보인다', async () => {
    renderScreen(<MySharesPage />, { path: '/settings/my-shares', handlers: shareServer().handlers })
    await waitFor(() => expect(screen.getByTestId('wiki-share-table')).toHaveTextContent('공유 중인 페이지가 없습니다'))
  })
})

describe('앱 설정 › 노트(노트 공유)', () => {
  /** 관리자 노트 공유 화면을 띄우고 목록이 오기를 기다린다. */
  async function openAdmin(api: ReturnType<typeof shareServer>, waitRow: number | null = ALL[0].pageId) {
    const view = renderScreen(<WikiSharingPage />, { path: '/settings/apps/wiki', auth: ADMIN, handlers: api.handlers })
    if (waitRow != null) await screen.findByTestId(`wiki-share-row-${waitRow}`)
    return view
  }

  test('거르기(범위·스페이스·검색)가 목록에 반영되고, 맞는 것이 없으면 안내한다', async () => {
    const { user } = await openAdmin(shareServer({ all: ALL }))
    const table = screen.getByTestId('wiki-share-table')
    expect(within(table).getAllByRole('row')).toHaveLength(ALL.length + 1)
    expect(row(31)).toHaveTextContent('김민지')

    const pick = async (combo: string, option: string) => {
      await user.click(screen.getByRole('combobox', { name: combo }))
      await user.click(await screen.findByRole('option', { name: option }))
    }
    // 범위 — 외부 공개만.
    await pick('범위', '외부 공개')
    await waitFor(() => expect(row(11)).not.toBeInTheDocument())
    expect(row(12)).toBeInTheDocument()
    expect(row(31)).toBeInTheDocument()
    expect(row(32)).not.toBeInTheDocument()
    // 스페이스 — 영업팀만(범위 조건과 함께).
    await pick('스페이스', '영업팀')
    await waitFor(() => expect(row(12)).not.toBeInTheDocument())
    expect(row(31)).toBeInTheDocument()
    // 조건에 맞는 것이 없으면 안내.
    await pick('범위', '지정한 사람')
    await waitFor(() => expect(table).toHaveTextContent('조건에 맞는 공유가 없습니다'))
    // 범위·스페이스를 풀고 검색 — 만든 사람 이름으로도 찾는다.
    await pick('범위', '모든 범위')
    await pick('스페이스', '모든 스페이스')
    await user.click(screen.getByRole('textbox', { name: '공유 찾기' }))
    await user.paste('박서준')
    await waitFor(() => expect(row(11)).not.toBeInTheDocument())
    expect(row(32)).toBeInTheDocument()
    expect(row(33)).toBeInTheDocument()
  })

  test('거르기로 가려진 줄은 일괄 해제에 들어가지 않는다', async () => {
    const api = shareServer({ all: ALL })
    const { user } = await openAdmin(api)
    await user.click(screen.getByRole('checkbox', { name: '고객사 A 킥오프 고르기' }))
    await user.click(screen.getByRole('checkbox', { name: '분기 OKR 고르기' }))
    await user.click(screen.getByRole('textbox', { name: '공유 찾기' }))
    await user.paste('OKR')
    await waitFor(() => expect(row(31)).not.toBeInTheDocument())
    await user.click(screen.getByTestId('wiki-share-table-revoke-selected'))
    await user.click(within(await screen.findByTestId('wiki-revoke-shares-dialog')).getByRole('button', { name: '해제' }))
    await waitFor(() => expect(api.revokes).toEqual([{ pageIds: [33] }]))
  })

  test('외부 공유를 끄면 막히는 수를 알리고(취소는 그대로) PUT 하며, 다시 켤 때는 확인 없이 PUT 한다', async () => {
    const api = shareServer({ all: ALL })
    const { user } = await openAdmin(api)
    const sw = screen.getByTestId('wiki-external-share-switch')
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))

    await user.click(sw)
    const dialog = await screen.findByTestId('wiki-external-share-off-dialog')
    // 외부 공개 2개(12·31)가 막히고, 다시 켜도 되살아나지 않는다고 알린다.
    expect(dialog).toHaveTextContent('2개가 바로 막힙니다')
    expect(dialog).toHaveTextContent('되살아나지 않')
    await user.click(within(dialog).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(screen.queryByTestId('wiki-external-share-off-dialog')).not.toBeInTheDocument())
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(api.puts).toEqual([])

    await user.click(sw)
    await user.click(within(await screen.findByTestId('wiki-external-share-off-dialog')).getByRole('button', { name: '끄기' }))
    await waitFor(() => expect(api.puts).toEqual([{ externalShareEnabled: false }]))
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'))
    // 서버가 지운 외부 공개 공유가 목록에서도 사라진다.
    await waitFor(() => expect(row(31)).not.toBeInTheDocument())
    expect(row(12)).not.toBeInTheDocument()
    expect(row(11)).toBeInTheDocument()

    // 막을 외부 링크가 없으니 다시 켤 때는 확인 없이 바로 PUT.
    await waitFor(() => expect(sw).not.toHaveAttribute('aria-busy', 'true'))
    await user.click(sw)
    await waitFor(() => expect(api.puts).toEqual([{ externalShareEnabled: false }, { externalShareEnabled: true }]))
    expect(screen.queryByTestId('wiki-external-share-off-dialog')).not.toBeInTheDocument()
  })

  test.each([
    ['막을 외부 링크가 없으면', ALL.filter((i) => i.audience !== 'PUBLIC'), 11],
    ['이미 만료된 외부 링크만 있으면', [share({ pageId: 41, title: '지난 행사 안내', audience: 'PUBLIC', expiresAt: '2020-01-01T00:00:00Z' })], 41],
  ])('%s 확인 없이 바로 끈다', async (_name, all, first) => {
    const api = shareServer({ all })
    const { user } = await openAdmin(api, first)
    if (first === 41) expect(row(41)).toHaveTextContent('만료됨')
    const sw = screen.getByTestId('wiki-external-share-switch')
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    await user.click(sw)
    await waitFor(() => expect(api.puts).toEqual([{ externalShareEnabled: false }]))
    expect(screen.queryByTestId('wiki-external-share-off-dialog')).not.toBeInTheDocument()
  })

  test('목록을 못 불러왔으면 몇 개인지 모른 채로도 끄기 전에 확인을 받는다', async () => {
    const api = shareServer({ fail: 'list' })
    const { user } = await openAdmin(api, null)
    await waitFor(() => expect(screen.getByTestId('wiki-share-table')).toHaveTextContent('목록을 불러오지 못했습니다'))
    const sw = screen.getByTestId('wiki-external-share-switch')
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    await user.click(sw)
    expect(await screen.findByTestId('wiki-external-share-off-dialog')).toHaveTextContent('외부에 공개된 링크가 모두 바로 막힙니다')
    expect(api.puts).toEqual([])
  })

  test('외부 공유 설정을 못 불러오면 꺼진 것처럼 보이지 않고 스위치를 잠근다', async () => {
    await openAdmin(shareServer({ all: ALL, fail: 'policy' }))
    expect(await screen.findByTestId('wiki-external-share-error')).toBeInTheDocument()
    expect(screen.getByTestId('wiki-external-share-switch')).toBeDisabled()
  })

  test('500건 미만이면 안내가 없고, 500건이면 최신 500건만 보인다고 알리며 끄기 확인은 「최소 N개」로 알린다', async () => {
    // 500건 미만 — 안내 없음.
    const few = await openAdmin(shareServer({ all: ALL }))
    expect(screen.queryByTestId('wiki-share-cap-note')).not.toBeInTheDocument()
    few.unmount()

    const many = Array.from({ length: 500 }, (_, i) =>
      share({ pageId: 1000 + i, title: `페이지 ${i}`, audience: i < 2 ? 'PUBLIC' : 'WORKSPACE', expiresAt: i < 2 ? FAR : null }),
    )
    const api = shareServer({ all: many })
    const { user } = await openAdmin(api, 1000)
    expect(screen.getByTestId('wiki-share-cap-note')).toHaveTextContent('최근 500개')
    const sw = screen.getByTestId('wiki-external-share-switch')
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'))
    await user.click(sw)
    const dialog = await screen.findByTestId('wiki-external-share-off-dialog')
    expect(dialog).toHaveTextContent('최소 2개')
    expect(dialog).not.toHaveTextContent('링크 2개가')
    expect(api.puts).toEqual([])
  })

  test('해제·재조회 뒤 사라진 줄의 선택은 비워진다(같은 줄이 다시 나와도 체크돼 있지 않다)', async () => {
    const api = shareServer({ all: ALL })
    const { user } = await openAdmin(api)
    const revokeRow = async (id: number) => {
      await user.click(within(row(id)!).getByRole('button', { name: '해제' }))
      await user.click(within(await screen.findByTestId('wiki-revoke-shares-dialog')).getByRole('button', { name: '해제' }))
      await waitFor(() => expect(row(id)).not.toBeInTheDocument())
    }
    await user.click(screen.getByRole('checkbox', { name: '고객사 A 킥오프 고르기' }))
    expect(screen.getByTestId('wiki-share-table-revoke-selected')).toBeInTheDocument()
    // 그 줄을 행 버튼으로 해제 — 줄이 사라진다.
    await revokeRow(31)
    // 같은 페이지가 다시 공유돼 다음 조회에 돌아온다(다른 줄을 해제해 재조회를 일으킨다).
    api.s.all = [...api.s.all, ALL.find((i) => i.pageId === 31)!]
    await revokeRow(32)
    await screen.findByTestId('wiki-share-row-31')
    expect(screen.getByRole('checkbox', { name: '고객사 A 킥오프 고르기' })).not.toBeChecked()
    expect(screen.queryByTestId('wiki-share-table-revoke-selected')).not.toBeInTheDocument()
  })
})
