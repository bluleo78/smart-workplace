// 태스크 보드·목록의 검색·필터·카드 표시·빈 열·종료 이슈 숨김 — 페이지 테스트(WP-980).
// 쿼리 파라미터·URL 동기화·배지/라벨 문구·조건부 렌더·생성 payload 는 브라우저 없이 판정되므로
// e2e/pages/projects/board.spec.ts 에서 옮겼다. 드래그·호버·키보드 놓기 포커스(@input), 폭·스크롤·무한 스크롤(@layout),
// 보드 대표 진입(@wiring)은 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, bodyOf, columnStatusOf, ISSUES, issueSearch, KEY, projectMeta } from '@/test/kits/projects/listBoard'
import { PAGE_LOAD_TIMEOUT, renderPage } from '@/test/renderPage'
import type { IssueResponse } from '@/types/issue'

import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'

/** 프로젝트 메타 + 이슈 검색(respond). 검색 URL 은 search.urls 에 쌓인다. */
function open(path: string, respond: Parameters<typeof issueSearch>[0] = () => [], extra: ReturnType<typeof http.get>[] = []) {
  const search = issueSearch(respond)
  const page = renderPage(path, {
    handlers: [...extra, ...projectMeta(), http.get(`${API}/projects/${KEY}/views`, () => HttpResponse.json([])), search.handler],
  })
  return { ...page, search }
}

/** 첫 화면(필터 바)이 뜰 때까지. */
const searchBox = () => screen.findByLabelText('태스크 검색', {}, { timeout: PAGE_LOAD_TIMEOUT })
const firstCard = (n: number) => screen.findByTestId(`issue-card-${n}`, {}, { timeout: PAGE_LOAD_TIMEOUT })

/** 상태 facet 에서 값을 고른다(「＋ 필터」 → 상태 범주 → 값). */
async function pickStatus(user: ReturnType<typeof renderPage>['user'], ...values: string[]) {
  await user.click(screen.getByTestId('add-filter-trigger'))
  await user.click(await screen.findByTestId('add-filter-facet-status'))
  for (const v of values) await user.click(await screen.findByTestId(`facet-value-status-${v}`))
}

describe('목록 검색·필터·뷰 전환', () => {
  test('검색 입력 → debounce 뒤 q 쿼리 + URL 동기화, 긴 글은 200자로 잘려 요청된다 (WP-732)', async () => {
    const { user, search, location } = open(`/projects/${KEY}`)
    const box = await searchBox()
    fireEvent.change(box, { target: { value: 'login' } })

    await waitFor(() => expect(search.urls.some((u) => u.searchParams.get('q') === 'login')).toBe(true))
    await waitFor(() => expect(location()).toMatch(/q=login/))

    // 입력 상한(maxLength) — 붙여넣은 9000자가 200자로 잘리고 그대로 요청된다.
    await user.clear(box)
    // 지운 검색어가 debounce 뒤 URL 로 반영(q 제거)되기를 기다린다 — 붙여넣은 뒤에 도착하면 URL → 입력 동기화가 칸을 비웠다(부하 시).
    await waitFor(() => expect(location()).not.toMatch(/q=/))
    await user.click(box)
    await user.paste('a'.repeat(9000))
    expect(box).toHaveValue('a'.repeat(200))
    await waitFor(() => expect(search.urls.some((u) => u.searchParams.get('q') === 'a'.repeat(200))).toBe(true))
  })

  test('상태 필터 → URL + API status 파라미터, 칩 제거 → URL 에서 빠진다', async () => {
    const { user, search, location } = open(`/projects/${KEY}`)
    await searchBox()
    await pickStatus(user, 'IN_PROGRESS')
    expect(await screen.findByTestId('filter-chip-status')).toBeInTheDocument()
    await user.keyboard('{Escape}')

    await waitFor(() => expect(location()).toMatch(/status=IN_PROGRESS/))
    await waitFor(() => expect(search.urls.some((u) => u.searchParams.get('status') === 'IN_PROGRESS')).toBe(true))

    await user.click(screen.getByTestId('filter-chip-status-remove'))
    await waitFor(() => expect(location()).not.toMatch(/status=IN_PROGRESS/))
  })

  // #657 — 아이콘 aria-label 과 옵션 라벨이 겹쳐 「상태: 상태: 할 일 할 일」처럼 중복 낭독되던 회귀.
  test('상태 필터 칩의 접근성 이름은 중복 없이 「상태 범주: 할 일 +1」', async () => {
    const { user } = open(`/projects/${KEY}`)
    await searchBox()
    await pickStatus(user, 'TODO', 'IN_PROGRESS')
    await user.keyboard('{Escape}')
    const chip = within(await screen.findByTestId('filter-chip-status')).getAllByRole('button')[0]
    // 범주 facet 의 칩 prefix 는 「상태 범주」다(WP-808 — 개별 「상태」 facet 과 분리).
    // jsdom 은 flex 항목 사이에 공백을 넣지 않아 사이 공백만 느슨하게 본다 — 아이콘 aria-label(「상태: 할 일」)이 끼면 실패한다.
    expect(chip).toHaveAccessibleName(/^상태 범주:\s*할 일\s*\+1$/)
  })

  test('뷰 토글 리스트 ↔ 보드 → URL view 동기화, 버튼엔 native title 이 없다(#269)', async () => {
    const { user, location } = open(`/projects/${KEY}`)
    await searchBox()
    const group = screen.getByRole('group', { name: '뷰 전환' })
    // native title 대신 shadcn Tooltip — 툴팁 표시(호버)는 E2E(@input).
    expect(within(group).getByRole('button', { name: '리스트' })).not.toHaveAttribute('title')
    expect(within(group).getByRole('button', { name: '보드' })).not.toHaveAttribute('title')

    await user.click(within(group).getByRole('button', { name: '보드' }))
    await waitFor(() => expect(location()).toMatch(/view=board/))
    await user.click(within(screen.getByRole('group', { name: '뷰 전환' })).getByRole('button', { name: '리스트' }))
    await waitFor(() => expect(location()).not.toMatch(/view=board/))
  })
})

describe('보드 카드 표시', () => {
  test('마감 지난 미완료 카드만 마감일이 빨간색 + 「마감 지남」 (WP-649)', async () => {
    open(`/projects/${KEY}?view=board`, (url) =>
      [
        createIssue({ id: 1, number: 1, title: '지난 마감', status: 'TODO', dueDate: '2020-01-15' }),
        createIssue({ id: 2, number: 2, title: '완료된 지난 마감', status: 'DONE', dueDate: '2020-01-15' }),
      ].filter((i) => !columnStatusOf(url) || i.status === columnStatusOf(url)),
    )
    await firstCard(1)
    const overdue = screen.getByTestId('issue-card-1-due')
    expect(overdue).toHaveTextContent('마감 지남')
    expect(overdue).toHaveClass('text-destructive')
    const done = await screen.findByTestId('issue-card-2-due')
    expect(done).not.toHaveClass('text-destructive')
    expect(done).not.toHaveTextContent('마감 지남')
  })

  // #199 — 마커 존재만 보면 누구에게나 마커가 새는 회귀를 못 잡으므로 AGENT·HUMAN 을 한 카드에 나란히 둬 대조한다.
  test('AGENT 담당자는 AI 마커(ai-accent 토큰)와 「(에이전트)」 이름으로 사람과 구분된다', async () => {
    open(`/projects/${KEY}?view=board`, (url) =>
      columnStatusOf(url) === 'TODO'
        ? [
            createIssue({
              id: 1, number: 1, title: 'AI 위임 이슈', status: 'TODO',
              assignees: [
                { id: 10, username: 'my-ai', name: 'My AI', kind: 'AGENT' },
                { id: 11, username: 'ydh', name: '양동희', kind: 'HUMAN' },
              ],
            }),
          ]
        : [],
    )
    const card = within(await firstCard(1))
    const agent = card.getByTestId('user-avatar-10')
    const marker = card.getByTestId('user-avatar-10-agent-marker')
    expect(agent).toHaveAttribute('aria-label', 'My AI (에이전트)')
    expect(agent).toHaveAttribute('data-agent', 'true')
    // #208: AGENT 표식 색은 ai-accent 토큰(raw purple 회귀 방지).
    expect(agent.className).toMatch(/ring-ai-accent/)
    expect(agent.className).not.toMatch(/ring-purple/)
    expect(marker.className).toMatch(/bg-ai-accent/)
    expect(marker.className).not.toMatch(/bg-purple/)

    const human = card.getByTestId('user-avatar-11')
    expect(card.queryByTestId('user-avatar-11-agent-marker')).not.toBeInTheDocument()
    expect(human).toHaveAttribute('aria-label', '양동희')
    expect(human).not.toHaveAttribute('data-agent')
  })
})

describe('보드 빈 열·열 쿼리', () => {
  // #309 — 빈 열이 헤더만 보여 첫 이슈를 어떻게 등록하는지 알 수 없었다.
  test('빈 열은 안내(숨김 열은 숨김 안내)와 「이슈 추가」를 보이고, 누르면 생성 대화상자가 열린다', async () => {
    const { user } = open(`/projects/${KEY}?view=board`, (url) =>
      columnStatusOf(url) === 'TODO' ? [createIssue({ id: 1, number: 1, title: '할 일 이슈', status: 'TODO' })] : [],
    )
    const card = await firstCard(1)
    expect(within(screen.getByTestId('board-col-1')).getByTestId('issue-card-1')).toBe(card)
    expect(screen.queryByTestId('board-col-empty-1')).not.toBeInTheDocument()

    const doneEmpty = await screen.findByTestId('board-col-empty-3')
    expect(doneEmpty).toHaveTextContent('이슈 없음')
    // 완료 열은 기본 범위가 종료 이슈를 숨겨 숨김 안내(WP-606), 숨기지 않는 열은 드래그 안내.
    expect(doneEmpty).toHaveTextContent('활성 사이클 밖에서 끝난 이슈는 이 화면에서 숨겨집니다')
    expect(screen.getByTestId('board-col-empty-2')).toHaveTextContent('드래그하거나 새 이슈를 추가하세요')
    // #812 — 로딩 스피너로 오인되는 circle-dashed 아이콘을 쓰지 않는다.
    expect(doneEmpty.querySelector('.lucide-circle-dashed')).toBeNull()
    expect(screen.getByTestId('board-col-empty-4')).toBeInTheDocument()

    await user.click(screen.getByTestId('board-col-add-3'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  // WP-464 — 열 CTA 가 상태 없이 대화상자를 열어 「완료」 열에서 눌러도 할 일로 만들어졌다.
  test('빈 열의 「이슈 추가」는 그 열 상태(statusId)로 만들고, 헤더 「+ 새 태스크」는 상태 없이 만든다', async () => {
    const posted: Record<string, unknown>[] = []
    const create = http.post(ISSUES, async ({ request }) => {
      posted.push((await bodyOf(request)) as Record<string, unknown>)
      return HttpResponse.json(createIssue({ id: 9, number: 9, title: '새 이슈', status: 'DONE' }), { status: 201 })
    })
    const { user } = open(`/projects/${KEY}?view=board`, () => [], [create])
    await user.click(await screen.findByTestId('board-col-add-3', {}, { timeout: PAGE_LOAD_TIMEOUT }))
    let dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByTestId('create-status-note')).toHaveTextContent('상태: 완료')
    await user.click(dialog.getByLabelText(/^제목/))
    await user.paste('완료로 만든 이슈')
    await user.click(dialog.getByRole('button', { name: '생성' }))
    // 열의 프로젝트 상태 id 로 만든다(WP-808).
    await waitFor(() => expect(posted[0]?.statusId).toBe(3))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // 헤더 버튼은 기본(할 일) — 앞서 고른 열 상태가 남지 않는다.
    await user.click(screen.getByRole('button', { name: '+ 새 태스크' }))
    dialog = within(await screen.findByRole('dialog'))
    expect(dialog.queryByTestId('create-status-note')).not.toBeInTheDocument()
    await user.click(dialog.getByLabelText(/^제목/))
    await user.paste('기본 이슈')
    await user.click(dialog.getByRole('button', { name: '생성' }))
    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[1]?.statusId).toBeUndefined()
    expect(posted[1]?.status).toBeUndefined()
  })

  // #875 — 제외 열에 빈 상태 목록을 흘리면 API 가 「전체 상태」로 해석해 다른 상태 카드를 받아왔다.
  test('보드 상태 필터 — 필터에서 제외된 상태 열은 요청하지 않고 그 열로 데이터가 새지 않는다', async () => {
    const { search } = open(`/projects/${KEY}?view=board&status=TODO`, (url) =>
      // 할 일은 다음 페이지가 남은 상태(hasMore) — 제외 열로 새면 「0+」·더 보기가 보이게 된다.
      columnStatusOf(url) === 'TODO'
        ? { items: [createIssue({ id: 1, number: 1, title: 'A', status: 'TODO' })], next: 'MORE' }
        : [],
    )
    const card = await firstCard(1)
    expect(within(screen.getByTestId('board-col-1')).getByTestId('issue-card-1')).toBe(card)
    expect(screen.getByTestId('board-col-empty-3')).toBeInTheDocument()
    // 보드 요청은 할 일 열(statusId 1) 하나뿐.
    expect(search.urls.every((u) => u.searchParams.get('statusId') === '1')).toBe(true)
    for (const s of [2, 3, 4]) {
      expect(screen.getByTestId(`board-col-count-${s}`)).toHaveTextContent(/^0$/)
      expect(screen.queryByTestId(`board-col-more-${s}`)).not.toBeInTheDocument()
    }
  })

  // #875 — 그룹 열은 동적이라 열별 쿼리가 불가 → 단일 쿼리를 끝까지 순차 로드한다(2페이지 상한 제거).
  test('그룹(담당자) 보드 — 마지막 페이지까지 자동으로 모두 로드한다', async () => {
    const pages: IssueResponse[][] = [
      [createIssue({ id: 1, number: 1, title: 'P1', status: 'TODO' })],
      [createIssue({ id: 2, number: 2, title: 'P2', status: 'DONE' })],
      [createIssue({ id: 3, number: 3, title: 'P3', status: 'IN_PROGRESS' })],
    ]
    // 응답을 조금 늦춘다 — 다음 페이지 효과는 isFetching 이 참→거짓으로 바뀌는 것을 보고 다시 돈다. MSW 가 같은 렌더 틱 안에
    // 답하면 참 상태가 한 번도 그려지지 않아 셋째 페이지를 부르지 않는다(실제 네트워크에선 생기지 않는 지연 0 응답).
    open(`/projects/${KEY}?view=board&group=assignee`, async (url) => {
      await delay(30)
      const idx = Number(url.searchParams.get('cursor') ?? 0)
      return HttpResponse.json(createIssueSearchResponse(pages[idx], idx + 1 < pages.length ? String(idx + 1) : null))
    })
    // 3번째 페이지(옛 상한 밖)의 카드까지 그려지고, 로딩 안내는 사라진다.
    await firstCard(3)
    expect(screen.getByTestId('issue-card-1')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('board-loading-more')).not.toBeInTheDocument())
  })
})

// #876 — 활성 사이클 밖 종료(완료·취소) 이슈 숨김 + 「완료 모두 보기」.
describe('종료 이슈 숨김 (#876)', () => {
  // 숨김 해제 판정(overridesClosedHiding)은 issueFilters.test.ts 가 맡는다 — 여기선 요청·토글 UI 반영을 본다.
  test('목록에서 상태 필터를 명시하면 숨김 파라미터를 보내지 않고 토글이 눌린 채 비활성화된다', async () => {
    const { search } = open(`/projects/${KEY}?status=DONE`, () => [createIssue({ id: 1, number: 7 })])
    const toggle = await screen.findByTestId('show-all-closed-toggle', {}, { timeout: PAGE_LOAD_TIMEOUT })
    await waitFor(() => expect(search.last()?.searchParams.get('status')).toBe('DONE'))
    expect(search.last()!.searchParams.get('hideInactiveClosed')).toBeNull()
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  // WP-606 — 숨김을 알리지 않으면 빈 완료·취소 열이 「이슈가 없어졌다」로 보였다.
  test('빈 완료·취소 열은 숨김 안내와 「완료 모두 보기」를 보이고, 누르면 숨김을 해제한다', async () => {
    const { user, location } = open(`/projects/${KEY}?view=board`, (url) => {
      const showAll = url.searchParams.get('hideInactiveClosed') == null
      const status = columnStatusOf(url)
      return [
        createIssue({ id: 1, number: 7, title: '진행 중 작업', status: 'IN_PROGRESS' }),
        ...(showAll ? [createIssue({ id: 2, number: 8, title: '지난 사이클에 끝난 작업', status: 'DONE' })] : []),
      ].filter((i) => !status || i.status === status)
    })
    const doneEmpty = await screen.findByTestId('board-col-empty-3', {}, { timeout: PAGE_LOAD_TIMEOUT })
    expect(doneEmpty).toHaveTextContent('활성 사이클 밖에서 끝난 이슈는 이 화면에서 숨겨집니다')
    expect(screen.getByTestId('board-col-empty-4')).toHaveTextContent('활성 사이클 밖에서 끝난 이슈는')
    // 숨기지 않는 열은 기존 안내 그대로.
    expect(screen.getByTestId('board-col-empty-1')).toHaveTextContent('드래그하거나 새 이슈를 추가하세요')
    expect(screen.queryByTestId('board-col-show-closed-1')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('board-col-show-closed-3'))
    await waitFor(() => expect(location()).toMatch(/closed=all/))
    expect(location()).toMatch(/view=board/)
    expect(await screen.findByTestId('issue-card-8')).toBeInTheDocument()
    expect(screen.getByTestId('show-all-closed-toggle')).toHaveAttribute('aria-pressed', 'true')
    // 숨김을 끈 뒤 빈 취소 열은 다시 기존 안내.
    expect(screen.queryByTestId('board-col-show-closed-4')).not.toBeInTheDocument()
  })

  test('모든 이슈가 숨겨져 빈 목록이면 숨김 안내와 「완료 모두 보기」를 보이고, 누르면 숨긴 이슈가 나온다', async () => {
    const { user, location } = open(`/projects/${KEY}`, (url) =>
      url.searchParams.get('hideInactiveClosed') == null ? [createIssue({ id: 2, number: 8, title: '지난 사이클에 끝난 작업', status: 'DONE' })] : [],
    )
    expect(await screen.findByTestId('empty-no-issues', {}, { timeout: PAGE_LOAD_TIMEOUT })).toHaveTextContent(
      '활성 사이클 밖에서 끝난 이슈는 이 화면에서 숨겨집니다',
    )
    await user.click(screen.getByTestId('empty-show-closed'))
    await waitFor(() => expect(location()).toMatch(/closed=all/))
    expect(await screen.findByTestId('issue-row-8')).toBeInTheDocument()
  })
})
