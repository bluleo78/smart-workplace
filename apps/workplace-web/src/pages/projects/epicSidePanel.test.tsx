// 왼쪽 에픽 패널 — 페이지 테스트(WP-971).
// 목록·진행률, 선택 → parent/topLevel 검색 파라미터와 URL, 빈 상태, 에픽 만들기 프리셋, 종료된 에픽 구역(접힘·배지·자동 다음 페이지),
// 진행 중 사이클 소속 종료 에픽(WP-389)은 브라우저 없이 판정되므로 e2e/pages/projects/epic-side-panel.spec.ts 에서 옮겼다.
// 패널 높이·sticky 스크롤·선택 배경색·토글 폭(@layout), 호버·키보드 포커스로 보이는 ↗(@input), 새로고침 뒤 열림 유지(@platform)는 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, issueDetailScreen, projectScreen } from '@/test/kits/projects/projectScreens'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueResponse, IssueStatus } from '@/types/issue'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { serverEpicFilter } from '../../../e2e/fixtures/epic-search'

const KEY = 'WP'
const EPIC_TYPE_ID = String(makeEpicType().id)

function epic(number: number, title: string, done: number, total: number, status?: IssueStatus): IssueResponse {
  return createIssue({ id: number, number, title, type: makeEpicType(), childCount: total, childDoneCount: done, ...(status ? { status } : {}) })
}

const isEpicSearch = (url: URL) => url.searchParams.get('type') === EPIC_TYPE_ID

/**
 * 프로젝트 화면을 열고 에픽 패널 토글을 누른다. epicSearch: 에픽 조회(type=EPIC) 응답, 본문 검색은 빈 목록.
 * types: 프로젝트 유형(기본 시스템 유형 — EPIC 포함).
 */
async function openPanel({
  epicSearch = () => [] as IssueResponse[],
  path = `/projects/${KEY}`,
  types = systemTypes(),
}: { epicSearch?: (url: URL) => IssueResponse[] | ReturnType<typeof createIssueSearchResponse>; path?: string; types?: ReturnType<typeof systemTypes> } = {}) {
  const api = projectScreen(KEY, {
    project: createProject({ key: KEY, type: 'TEAM' }),
    search: (url) => (isEpicSearch(url) ? epicSearch(url) : []),
  })
  // ↗ 로 들어가는 에픽 상세(12) — 이동 뒤 화면이 부르는 조회.
  const details = [12].flatMap((n) => issueDetailScreen(KEY, n))
  const view = renderPage(path, { handlers: [http.get(`${API}/projects/${KEY}/types`, () => HttpResponse.json(types)), ...details, ...api.handlers] })
  const toggle = await screen.findByTestId('epic-panel-toggle', {}, { timeout: PAGE_LOAD_TIMEOUT })
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(screen.queryByTestId('epic-side-panel')).not.toBeInTheDocument()
  await view.user.click(toggle)
  await screen.findByTestId('epic-side-panel')
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const lastBody = () => [...api.searches].reverse().find((u) => !isEpicSearch(u))
  return { ...view, api, lastBody }
}

const twoEpics = () => [epic(10, '결제 리뉴얼', 6, 10), epic(11, '알림 개편', 8, 10)]

describe('에픽 패널 목록·선택', () => {
  // 목록은 제목·done/total·진행바(aria 값), 누르면 parent=10 검색·눌림, 다시 누르면 해제.
  test('에픽 목록과 진행률이 보이고, 누르면 parent=10 으로 검색하며 다시 누르면 해제된다', async () => {
    const { user, lastBody } = await openPanel({ epicSearch: twoEpics })
    const e10 = await screen.findByTestId('epic-filter-10')
    expect(e10).toHaveTextContent('결제 리뉴얼')
    expect(e10).toHaveTextContent('6/10')
    expect(screen.getByTestId('epic-filter-11')).toHaveTextContent('8/10')
    expect(within(e10).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '60')

    await user.click(e10)
    await waitFor(() => expect(lastBody()?.searchParams.get('parent')).toBe('10'))
    expect(screen.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByTestId('epic-filter-10'))
    await waitFor(() => expect(lastBody()?.searchParams.get('parent')).toBeNull())
    expect(screen.getByTestId('epic-filter-10')).toHaveAttribute('aria-pressed', 'false')
  })

  // WP-246·WP-389: 사이클 밖 완료·취소 에픽은 위쪽 목록에 없다 — hideInactiveClosed 로 조회하므로.
  test('사이클 밖의 완료·취소 에픽은 위쪽 목록에 나오지 않고 개수는 진행 중만 센다', async () => {
    const all = [epic(10, '진행 중 에픽', 1, 4, 'IN_PROGRESS'), epic(11, '할 일 에픽', 0, 2, 'TODO'), epic(12, '완료된 에픽', 3, 3, 'DONE'), epic(13, '취소된 에픽', 0, 1, 'CANCELED')]
    await openPanel({ epicSearch: (url) => serverEpicFilter(url, all) })
    expect(await screen.findByTestId('epic-filter-10')).toBeInTheDocument()
    expect(screen.getByTestId('epic-filter-11')).toBeInTheDocument()
    expect(screen.queryByTestId('epic-filter-12')).not.toBeInTheDocument()
    expect(screen.queryByTestId('epic-filter-13')).not.toBeInTheDocument()
    expect(screen.getByTestId('epic-panel-count')).toHaveTextContent(/^2$/)
  })

  // #874: 「에픽 미할당」은 topLevel+excludeEpics 로 검색하고 유형 필터는 건드리지 않는다.
  test('「에픽 미할당」을 누르면 topLevel=true·excludeEpics=true 로 검색하고 URL 에도 남는다', async () => {
    const { user, lastBody, location } = await openPanel({ epicSearch: () => [epic(10, '결제 리뉴얼', 6, 10)] })
    await user.click(await screen.findByTestId('epic-filter-unassigned'))
    await waitFor(() => expect(lastBody()?.searchParams.get('topLevel')).toBe('true'))
    expect(lastBody()!.searchParams.get('excludeEpics')).toBe('true')
    expect(lastBody()!.searchParams.get('type')).toBeNull()
    expect(location()).toMatch(/topLevel=true/)
    expect(screen.getByTestId('epic-filter-unassigned')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('epic-filter-all')).toHaveAttribute('aria-pressed', 'false')
  })

  // #878: 에픽 선택·해제 뒤에도 group=none(그룹 없음 명시)이 URL 에 남는다.
  test('group=none 은 에픽 선택·미할당 전환 뒤에도 URL 에 남는다', async () => {
    const { user, location } = await openPanel({ epicSearch: () => [epic(10, '결제 리뉴얼', 6, 10)], path: `/projects/${KEY}?group=none` })
    await user.click(await screen.findByTestId('epic-filter-10'))
    await waitFor(() => expect(location()).toMatch(/parent=10/))
    expect(location()).toMatch(/group=none/)
    await user.click(screen.getByTestId('epic-filter-unassigned'))
    await waitFor(() => expect(location()).toMatch(/topLevel=true/))
    expect(location()).toMatch(/group=none/)
  })

  // WP-227: 행(제목)을 누르면 필터, ↗ 를 누르면 필터 없이 에픽 상세로 간다. ↗ 는 접근 이름이 「{제목} 상세 열기」.
  // ↗ 를 눌러 상세로 가는 것은 호버 E2E(@input)와 아래 종료 에픽 테스트가 본다.
  test('에픽 행 제목을 누르면 상세가 아니라 필터로 가고, ↗ 는 「{제목} 상세 열기」로 읽힌다', async () => {
    const { user, location } = await openPanel({ epicSearch: twoEpics })
    await user.click(within(await screen.findByTestId('epic-filter-11')).getByText('알림 개편'))
    await waitFor(() => expect(location()).toMatch(/parent=11/))
    expect(location()).not.toMatch(/\/issues\//)
    expect(screen.getByTestId('epic-filter-11')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('epic-open-10')).toHaveAccessibleName('결제 리뉴얼 상세 열기')
  })
})

describe('빈 상태·만들기', () => {
  test('에픽이 없으면 「진행 중인 에픽이 없습니다」와 개수 0', async () => {
    await openPanel()
    expect(await screen.findByTestId('epic-panel-empty')).toHaveTextContent('진행 중인 에픽이 없습니다')
    expect(screen.getByTestId('epic-panel-count')).toHaveTextContent(/^0$/)
  })

  test('EPIC 유형이 없는 프로젝트도 빈 상태를 보이고 「에픽 미할당」은 없다', async () => {
    await openPanel({ types: systemTypes().filter((t) => t.name !== 'EPIC') })
    expect(await screen.findByTestId('epic-panel-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('epic-filter-unassigned')).not.toBeInTheDocument()
  })

  test('「＋ 에픽 만들기」는 유형이 에픽으로 정해진 생성 다이얼로그를 연다', async () => {
    const { user } = await openPanel()
    await user.click(await screen.findByTestId('epic-create-button'))
    await waitFor(() => expect(screen.getByTestId('create-type-select')).toHaveTextContent('에픽'))
  })
})

describe('종료된 에픽 구역 (WP-245·WP-389)', () => {
  const all = [epic(10, '결제 리뉴얼', 6, 10, 'IN_PROGRESS'), epic(11, '알림 개편', 8, 10, 'TODO'), epic(12, '팀 채팅 1차', 5, 5, 'DONE'), epic(13, '음성 메모', 0, 3, 'CANCELED')]
  const open = (epics = all, path?: string, activeCycle: number[] = []) => openPanel({ epicSearch: (url) => serverEpicFilter(url, epics, activeCycle), path })

  // 기본 접힘 + 개수, 펼치면 종료 에픽이 완료·취소 배지와 함께(취소는 취소선).
  test('기본은 접혀 개수만 보이고, 펼치면 완료·취소 배지와 취소선이 보인다', async () => {
    const { user } = await open()
    const toggle = await screen.findByTestId('epic-closed-toggle')
    expect(toggle).toHaveTextContent('종료된 에픽')
    await waitFor(() => expect(toggle).toHaveTextContent('2'))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('epic-closed-filter-12')).not.toBeInTheDocument()
    expect(screen.getByTestId('epic-panel-count')).toHaveTextContent(/^2$/)
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByTestId('epic-closed-filter-12')).toHaveTextContent('완료')
    expect(screen.getByTestId('epic-closed-filter-13')).toHaveTextContent('취소')
    expect(within(screen.getByTestId('epic-closed-filter-13')).getByText('음성 메모')).toHaveClass('line-through')
  })

  test('종료 에픽을 누르면 그 에픽으로 거르고, ↗ 는 상세로 간다', async () => {
    const { user, location } = await open()
    await user.click(await screen.findByTestId('epic-closed-toggle'))
    await user.click(await screen.findByTestId('epic-closed-filter-12'))
    await waitFor(() => expect(location()).toMatch(/parent=12/))
    expect(screen.getByTestId('epic-closed-filter-12')).toHaveAttribute('aria-pressed', 'true')
    // ↗ 는 호버 때만 포인터를 받는다(pointer-events) — 보이는 조건은 E2E(@input)가 보고 여기서는 fireEvent 로 누른다.
    fireEvent.click(screen.getByTestId('epic-closed-open-12'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues/12`))
  })

  test('URL 로 종료 에픽에 들어오면 구역이 펼쳐져 있고 머리 행으로 접을 수 있다', async () => {
    const { user } = await open(all, `/projects/${KEY}?parent=13`)
    const toggle = await screen.findByTestId('epic-closed-toggle')
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
    expect(await screen.findByTestId('epic-closed-filter-13')).toHaveAttribute('aria-pressed', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('epic-closed-filter-13')).not.toBeInTheDocument()
  })

  // WP-389: 진행 중 사이클 소속 종료 에픽은 위쪽 목록 끝에 종료 배지·진행률·흐린 제목으로 남고, 종료 구역에서는 빠진다.
  test('진행 중 사이클 소속 종료 에픽은 위쪽 목록에 종료 배지와 남고 종료 구역에서는 빠진다', async () => {
    const { user, location, api } = await open(all, undefined, [12])
    const list = await screen.findByTestId('epic-panel-list')
    await waitFor(() => expect(list.querySelectorAll('[data-testid^="epic-filter-"]')).toHaveLength(3))
    // 위쪽 목록 조회는 EPIC 유형 + hideInactiveClosed, 상태 조건 없음.
    const panelSearch = api.searches.find((u) => isEpicSearch(u) && u.searchParams.get('hideInactiveClosed') === 'true')!
    expect(panelSearch.searchParams.get('status')).toBeNull()
    expect(list.querySelectorAll('[data-testid^="epic-filter-"]')[2]).toHaveAttribute('data-testid', 'epic-filter-12')
    const item = screen.getByTestId('epic-filter-12')
    expect(within(item).getByTestId('closed-status-badge')).toHaveTextContent('완료')
    expect(within(item).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    expect(within(item).getByText('팀 채팅 1차')).toHaveClass('text-muted-foreground')
    expect(screen.getByTestId('epic-panel-count')).toHaveTextContent(/^3$/)

    const toggle = screen.getByTestId('epic-closed-toggle')
    await waitFor(() => expect(toggle).toHaveTextContent('1'))
    await user.click(toggle)
    expect(await screen.findByTestId('epic-closed-filter-13')).toBeInTheDocument()
    expect(screen.queryByTestId('epic-closed-filter-12')).not.toBeInTheDocument()

    await user.click(item)
    await waitFor(() => expect(location()).toMatch(/parent=12/))
    expect(screen.getByTestId('epic-filter-12')).toHaveAttribute('aria-pressed', 'true')
    // ↗ 는 호버 때만 포인터를 받는다 — fireEvent 로 누른다.
    fireEvent.click(screen.getByTestId('epic-open-12'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues/12`))
  })

  test('진행 중 에픽이 없어도 사이클에 걸린 종료 에픽이 있으면 빈 상태 대신 그 에픽을 보인다', async () => {
    await open(all.slice(2), undefined, [13])
    const e13 = await screen.findByTestId('epic-filter-13')
    expect(within(e13).getByText('음성 메모')).toHaveClass('line-through')
    expect(screen.queryByTestId('epic-panel-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('epic-panel-count')).toHaveTextContent(/^1$/)
  })

  test('종료 에픽이 없으면 구역이 없다', async () => {
    await open(all.slice(0, 2))
    expect(await screen.findByTestId('epic-filter-10')).toBeInTheDocument()
    expect(screen.queryByTestId('epic-closed-section')).not.toBeInTheDocument()
  })

  // 종료 에픽이 100개를 넘으면 다음 페이지(cursor)를 자동으로 불러 개수·목록에 더한다.
  test('종료 에픽이 100개를 넘으면 다음 페이지를 자동으로 불러 101개가 된다', async () => {
    const active = [epic(1, '진행 에픽', 1, 1, 'IN_PROGRESS'), epic(2, '진행 에픽 2', 2, 2, 'IN_PROGRESS')]
    const page1 = Array.from({ length: 100 }, (_, i) => epic(100 + i, `종료 에픽 ${i + 1}`, 1, 1, 'DONE'))
    const page2 = [epic(200, '마지막 종료 에픽', 1, 1, 'DONE')]
    const { user } = await openPanel({
      epicSearch: (url) => {
        const statuses = (url.searchParams.get('status') ?? '').split(',').filter(Boolean)
        if (statuses.length === 0) return active
        return url.searchParams.get('cursor') ? createIssueSearchResponse(page2, null) : createIssueSearchResponse(page1, 'nextPage')
      },
    })
    const toggle = await screen.findByTestId('epic-closed-toggle')
    await waitFor(() => expect(toggle).toHaveTextContent('101'))
    await user.click(toggle)
    expect(await screen.findByTestId('epic-closed-filter-200')).toHaveTextContent('마지막 종료 에픽')
  })
})
