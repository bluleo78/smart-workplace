// 프로젝트 「개요」 탭(WP-1478) 화면 테스트 — 응답 → 위젯(셀 단위 값), 살펴볼 이슈 타일 전환, 빈 상태, 관리자만 보는 안내,
// 링크 주소, 실패·다시 시도, 그리고 「n건 더 — 이슈 탭에서 보기」로 넘어간 이슈 탭이 stale/waiting 을 검색 API 쿼리로 보내고 칩으로 보이는지.
// 탭 레이아웃(머리줄·탭 줄) 아래에 개요(overview)와 이슈 탭(index)을 함께 두어 App 과 같은 길로 띄운다(renderRoutesScreen).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { formatDateOnlyMonthDay } from '@/lib/formatters'
import ProjectDetailPage from '@/pages/projects/ProjectDetailPage'
import ProjectOverviewTab from '@/pages/projects/tabs/ProjectOverviewTab'
import { ProjectTabsLayout } from '@/pages/projects/tabs/ProjectTabsLayout'
import { projectScreen } from '@/test/kits/projects/projectScreens'
import { renderRoutesScreen, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import type { ProjectOverviewResponse } from '@/types/projectOverview'

import { makeIssueType } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import {
  createAttentionItem,
  createEmptyProjectOverview,
  createProjectOverview,
  createTrendProgress,
} from '../../../e2e/factories/projectOverview.factory'

const KEY = 'WP'
/** 팩토리 응답의 에픽 유형 id(progress.epics.epicTypeId). */
const EPIC_TYPE_ID = 7
/** 열린 이슈 조건 — 이슈 탭과 같은 직렬화(filtersToParams)라 쉼표가 %2C 로 인코딩된다. */
const OPEN = 'status=TODO%2CIN_PROGRESS'

/** 탭 레이아웃 아래 이슈 탭(index)·개요 — App 라우트와 같은 모양. */
const routes = (
  <Route path="/projects/:key" element={<ProjectTabsLayout />}>
    <Route index element={<ProjectDetailPage />} />
    <Route path="overview" element={<ProjectOverviewTab />} />
  </Route>
)

/** 개요 응답(또는 실패 상태 코드)을 주고 path 에서 띄운다. 이슈 검색 요청 URL 은 searches 에 쌓인다. */
function open(path: string, overview: ProjectOverviewResponse | number = createProjectOverview()) {
  const screenKit = projectScreen(KEY, { project: createProject({ key: KEY, name: '워크플레이스' }) })
  let overviewCalls = 0
  const view = renderRoutesScreen(routes, path, {
    handlers: [
      ...screenKit.handlers,
      http.get(`/api/v1/projects/${KEY}/overview`, () => {
        overviewCalls++
        return typeof overview === 'number'
          ? HttpResponse.json({ status: overview, message: '서버 오류' }, { status: overview })
          : HttpResponse.json(overview)
      }),
      http.get(`/api/v1/projects/${KEY}/types`, () =>
        HttpResponse.json([makeIssueType({ id: 1, name: 'TASK' }), makeIssueType({ id: EPIC_TYPE_ID, name: 'EPIC', isSystem: true })]),
      ),
    ],
  })
  return { ...view, searches: screenKit.searches, overviewCalls: () => overviewCalls }
}

const widgets = () => screen.findByTestId('project-overview-widgets', {}, { timeout: SCREEN_LOAD_TIMEOUT })
const href = (el: HTMLElement) => el.getAttribute('href')

describe('프로젝트 개요 — 위젯', () => {
  test('응답 값이 숫자 카드·진행 중·에픽·열린 이슈·살펴볼 이슈·작업량·최근 활동 칸마다 그대로 보인다', async () => {
    open(`/projects/${KEY}/overview`)
    await widgets()

    // 숫자 카드 넷 — 값과 아랫줄.
    expect(screen.getByTestId('card-completed-value')).toHaveTextContent('96')
    expect(screen.getByTestId('card-completed-meta')).toHaveTextContent('그 전 7일 81건')
    expect(screen.getByTestId('card-created-value')).toHaveTextContent('118')
    expect(screen.getByTestId('card-created-meta')).toHaveTextContent('그 전 7일 92건')
    expect(screen.getByTestId('card-due-soon-value')).toHaveTextContent('9')
    expect(screen.getByTestId('card-due-soon-meta')).toHaveTextContent('담당자 없음 2')
    expect(screen.getByTestId('card-overdue-value')).toHaveTextContent('14')
    expect(screen.getByTestId('card-overdue-value')).toHaveClass('text-destructive')
    expect(screen.getByTestId('card-overdue-meta')).toHaveTextContent('가장 오래된 것 21일')

    // 진행 중 — 사이클 이름·D-n·완료/범위·예상, 그래프 선 셋과 종료선.
    expect(screen.getByTestId('progress-name')).toHaveTextContent('11/10~11/23')
    expect(screen.getByTestId('progress-meta')).toHaveTextContent('D-12')
    expect(screen.getByTestId('progress-count')).toHaveTextContent('18 / 41')
    expect(screen.getByTestId('progress-projection')).toHaveTextContent('예상 완료 11월 21일 · 종료 전 가능')
    for (const id of ['progress-scope-line', 'progress-done-line', 'progress-projected-line', 'progress-end-line']) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    expect(screen.getByRole('img', { name: /11\/10~11\/23 진행 그래프 — 18 \/ 41/ })).toBeInTheDocument()

    // 에픽 — 진행 중/전체, 줄마다 자식 완료/전체.
    const epics = screen.getByTestId('progress-epics')
    expect(epics).toHaveTextContent('진행 중 9 / 전체 31')
    expect(screen.getByTestId('progress-epic-WP-1')).toHaveTextContent('통합 검색')
    expect(screen.getByTestId('progress-epic-WP-1-value')).toHaveTextContent('6 / 9')
    expect(screen.getByTestId('progress-epic-WP-2-value')).toHaveTextContent('1 / 4')

    // 열린 이슈 — 합계·범주·담당자 없음.
    const openCard = screen.getByTestId('project-overview-open')
    expect(within(openCard).getByRole('heading')).toHaveTextContent('열린 이슈162')
    expect(screen.getByTestId('open-todo-value')).toHaveTextContent('71')
    expect(screen.getByTestId('open-in-progress-value')).toHaveTextContent('91')
    expect(screen.getByTestId('open-unassigned-value')).toHaveTextContent('24')

    // 살펴볼 이슈 — 합계, 타일 숫자, 처음은 기한 지남 목록(오래 지난 순)과 「12건 더」.
    const attention = screen.getByTestId('project-overview-attention')
    expect(within(attention).getByRole('heading')).toHaveTextContent('살펴볼 이슈46')
    expect(screen.getByTestId('attention-tile-overdue')).toHaveTextContent('14')
    expect(screen.getByTestId('attention-tile-overdue')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('attention-tile-stale')).toHaveTextContent('23')
    expect(screen.getByTestId('attention-tile-waiting')).toHaveTextContent('9')
    const rows = within(screen.getByTestId('attention-list')).getAllByRole('link')
    expect(rows[0]).toHaveTextContent('WP-1188매뉴얼 그림 재촬영 — 드라이브 장21일 지남')
    expect(rows[1]).toHaveTextContent('WP-1347')
    expect(within(rows[1]).getByTestId('user-avatar-6')).toHaveAttribute('data-agent', 'true')
    expect(screen.getByTestId('attention-more')).toHaveTextContent('12건 더 — 이슈 탭에서 보기')

    // 작업량 — 사람·AI(아바타 AI 표식), 담당자 없음, 그 외.
    expect(screen.getByTestId('workload-user-1')).toHaveTextContent('양동희')
    expect(screen.getByTestId('workload-user-1-value')).toHaveTextContent('31')
    expect(within(screen.getByTestId('workload-user-6')).getByTestId('user-avatar-6')).toHaveAttribute('data-agent', 'true')
    expect(screen.getByTestId('workload-unassigned-value')).toHaveTextContent('24')
    expect(screen.getByTestId('workload-others')).toHaveTextContent('그 외 6명 · 59건')

    // 최근 활동 — 묶음 문구, 한 건이면 이슈 키·제목과 이슈 상세 링크.
    const activity = within(screen.getByTestId('activity-list')).getAllByRole('listitem')
    expect(activity[0]).toHaveTextContent('AI 개발자1 · 이슈 4건 상태 변경')
    expect(within(activity[0]).queryByRole('link')).not.toBeInTheDocument()
    expect(activity[1]).toHaveTextContent('양동희 · WP-77 라벨 변경 검색 결과 정렬')
    expect(href(within(activity[1]).getByRole('link'))).toBe('/projects/WP/issues/77')
  })

  test('타일을 누르면 그 묶음의 상위 이슈·일수 문구와 「n건 더」 주소로 바뀌고, 다시 부르지 않는다', async () => {
    const { user, overviewCalls } = open(`/projects/${KEY}/overview`)
    await widgets()
    await user.click(screen.getByTestId('attention-tile-stale'))
    expect(screen.getByTestId('attention-tile-stale')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('attention-list')).toHaveTextContent('WP-1300오래 멈춘 작업9일 멈춤')
    expect(screen.getByTestId('attention-more')).toHaveTextContent('22건 더 — 이슈 탭에서 보기')
    expect(href(screen.getByTestId('attention-more'))).toBe('/projects/WP?stale=true')

    await user.click(screen.getByTestId('attention-tile-waiting'))
    expect(screen.getByTestId('attention-list')).toHaveTextContent('WP-1400AI 가 답을 기다리는 작업3일 기다림')
    expect(href(screen.getByTestId('attention-more'))).toBe('/projects/WP?waiting=true')
    expect(overviewCalls()).toBe(1)
  })

  test('링크 — 진행 중·에픽·숫자 카드·열린 이슈·작업량·최근 활동이 같은 조건의 이슈 탭(쿼리 있는 주소)으로 간다', async () => {
    open(`/projects/${KEY}/overview`)
    await widgets()
    expect(screen.getByTestId('progress-link')).toHaveTextContent('사이클 보기')
    expect(href(screen.getByTestId('progress-link'))).toBe('/projects/WP?cycle=3')
    // 에픽 유형 id 는 응답(progress.epics.epicTypeId)이 준다.
    expect(href(screen.getByTestId('progress-epics-all'))).toBe(`/projects/WP?${OPEN}&type=${EPIC_TYPE_ID}`)
    expect(href(screen.getByTestId('progress-epic-WP-1'))).toBe('/projects/WP/issues/1')
    expect(href(screen.getByTestId('card-due-soon-link'))).toBe(`/projects/WP?${OPEN}&dueFrom=2026-11-11&dueTo=2026-11-17`)
    expect(href(screen.getByTestId('card-overdue-link'))).toBe(`/projects/WP?${OPEN}&dueTo=2026-11-10`)
    expect(href(screen.getByTestId('attention-more'))).toBe(`/projects/WP?${OPEN}&dueTo=2026-11-10`)
    expect(href(screen.getByTestId('open-todo'))).toBe('/projects/WP?status=TODO')
    expect(href(screen.getByTestId('open-unassigned'))).toBe(`/projects/WP?${OPEN}&assignee=null`)
    expect(href(screen.getByTestId('workload-user-6'))).toBe(`/projects/WP?${OPEN}&assignee=6`)
    expect(href(screen.getByTestId('activity-all'))).toBe('/projects/WP?sort=updatedAt&direction=desc')
  })

  test('빈 프로젝트 — 숫자 0, 위젯마다 빈 문구, 관리자에게만 「사이클 만들기」 안내', async () => {
    const view = open(`/projects/${KEY}/overview`, createEmptyProjectOverview({ canManage: true }))
    await widgets()
    expect(screen.getByTestId('card-completed-value')).toHaveTextContent('0')
    expect(screen.getByTestId('card-overdue-value')).not.toHaveClass('text-destructive')
    expect(screen.getByTestId('card-overdue-meta')).toHaveTextContent('기한 지난 이슈가 없어요')
    expect(screen.getByTestId('open-empty')).toHaveTextContent('열린 이슈가 없어요')
    expect(screen.getByTestId('attention-empty')).toHaveTextContent('살펴볼 이슈가 없어요')
    expect(screen.queryByTestId('attention-tile-overdue')).not.toBeInTheDocument()
    expect(screen.getByTestId('workload-empty')).toHaveTextContent('맡은 열린 이슈가 없어요')
    expect(screen.getByTestId('activity-empty')).toHaveTextContent('아직 활동이 없어요')
    // 진행 중 — 전체 추이(그대로), 에픽 칸 없음, 관리자 안내.
    expect(screen.getByTestId('progress-name')).toHaveTextContent('프로젝트 전체')
    expect(screen.getByTestId('progress-count')).toHaveTextContent('열림 0')
    expect(screen.getByTestId('progress-projection')).toHaveTextContent('8주 동안 그대로')
    expect(screen.queryByTestId('progress-epics')).not.toBeInTheDocument()
    const guide = screen.getByTestId('progress-guide')
    expect(guide).toHaveTextContent('사이클·버전·에픽을 쓰면 여기서 진행률을 볼 수 있어요.')
    expect(href(within(guide).getByRole('link', { name: '사이클 만들기' }))).toBe('/projects/WP/cycles')
    view.unmount()
  })

  test('사이클·버전·에픽이 없어도 관리자가 아니면 안내를 보이지 않는다 — 전체 추이 링크는 열린 이슈', async () => {
    open(`/projects/${KEY}/overview`, createProjectOverview({ canManage: false, progress: createTrendProgress() }))
    await widgets()
    expect(screen.getByTestId('progress-projection')).toHaveTextContent('8주 동안 +14 · 늘어나는 중')
    expect(screen.getByTestId('progress-count')).toHaveTextContent('열림 38')
    expect(href(screen.getByTestId('progress-link'))).toBe(`/projects/WP?${OPEN}`)
    expect(screen.queryByTestId('progress-guide')).not.toBeInTheDocument()
  })

  test('살펴볼 이슈 — 고른 묶음이 비면 「해당하는 이슈가 없어요」, 건수가 다 보이면 「n건 더」가 없다', async () => {
    const { user } = open(
      `/projects/${KEY}/overview`,
      createProjectOverview({
        attention: {
          total: 1,
          overdue: { total: 0, items: [] },
          stale: { total: 1, items: [createAttentionItem(5, '하나뿐인 멈춤', 7)] },
          waiting: { total: 0, items: [] },
        },
      }),
    )
    await widgets()
    // 처음은 건수 있는 첫 묶음(오래 멈춤).
    expect(screen.getByTestId('attention-tile-stale')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('attention-more')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('attention-tile-waiting'))
    expect(screen.getByText('해당하는 이슈가 없어요')).toBeInTheDocument()
  })

  test('불러오기에 실패하면 안내와 다시 시도 — 누르면 다시 부른다', async () => {
    const { user, overviewCalls } = open(`/projects/${KEY}/overview`, 500)
    expect(await screen.findByText('개요를 불러오지 못했습니다', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(overviewCalls()).toBe(2))
  })
})

describe('이슈 탭 — 개요가 여는 조건(오래 멈춤·기다리는 중·마감)', () => {
  test('개요 링크로 연 조건(고정 날짜)은 이슈 탭에 보이되 기억한 조건을 덮지 않는다 — 나중에 조건 없이 이슈 탭에 오면 원래 기억이 돌아온다', async () => {
    // 사용자가 전에 이슈 탭에서 고른 조건(우선순위 높음)을 기억해 두었다(useRememberedIssueQuery 의 실제 저장 키).
    const queryKey = `issue-list-query:${KEY}:1:-`
    window.localStorage.setItem(queryKey, 'priority=HIGH')
    const { user, location } = open(`/projects/${KEY}/overview`)
    await widgets()

    // 「기한 지남」 카드 → 개요의 조건(열린 상태·마감 ~어제)으로 이슈 탭이 열린다.
    await user.click(screen.getByTestId('card-overdue-link'))
    await waitFor(() => expect(location()).toBe(`/projects/WP?${OPEN}&dueTo=2026-11-10`))
    expect(await screen.findByTestId('condition-chip-due')).toHaveTextContent(`마감 ~ ${formatDateOnlyMonthDay('2026-11-10')}`)
    // 기억은 그대로 — 개요의 조건(고정 날짜)이 기억을 덮지 않는다.
    expect(window.localStorage.getItem(queryKey)).toBe('priority=HIGH')

    // 개요로 갔다가 이슈 탭을 조건 없이 다시 누르면 원래 기억한 조건이 되살아난다.
    const tabLink = (label: string) => within(screen.getByRole('navigation', { name: '프로젝트 탭' })).getByRole('link', { name: label })
    await user.click(tabLink('개요'))
    await widgets()
    await user.click(tabLink('이슈'))
    await waitFor(() => expect(location()).toBe('/projects/WP?priority=HIGH'))
    expect(screen.queryByTestId('condition-chip-due')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(queryKey)).toBe('priority=HIGH')
  })

  test('「n건 더」로 오래 멈춤을 열면 검색 API 에 stale=true 가 실리고 칩 「오래 멈춤」이 보이며, × 로 지우면 조건 없이 다시 찾는다', async () => {
    const { user, location, searches } = open(`/projects/${KEY}/overview`)
    await widgets()
    await user.click(screen.getByTestId('attention-tile-stale'))
    await user.click(screen.getByTestId('attention-more'))
    await waitFor(() => expect(location()).toBe('/projects/WP?stale=true'))
    const chip = await screen.findByTestId('condition-chip-stale')
    expect(chip).toHaveTextContent('오래 멈춤')
    await waitFor(() => expect(searches.some((u) => u.searchParams.get('stale') === 'true')).toBe(true))
    expect(screen.getByTestId('quick-filter-clear-all')).toBeInTheDocument()

    const before = searches.length
    await user.click(screen.getByRole('button', { name: '오래 멈춤 조건 지우기' }))
    // 조건을 지워 주소가 비어도(REPLACE) 개요로 되돌아가지 않고 이슈 탭에 머문다.
    await waitFor(() => expect(location()).toBe('/projects/WP'))
    expect(screen.queryByTestId('condition-chip-stale')).not.toBeInTheDocument()
    await waitFor(() => expect(searches.length).toBeGreaterThan(before))
    expect(searches[searches.length - 1].searchParams.get('stale')).toBeNull()
  })

  test('기다리는 중·마감 조건이 걸린 주소는 waiting=true·dueTo 를 검색에 싣고 칩 둘을 보인다 — 마감 칩만 지우면 기다리는 중은 남는다', async () => {
    const { user, location, searches } = open(`/projects/${KEY}?waiting=true&status=TODO,IN_PROGRESS&dueTo=2026-11-10`)
    expect(await screen.findByTestId('condition-chip-waiting', {}, { timeout: SCREEN_LOAD_TIMEOUT })).toHaveTextContent('기다리는 중')
    // 날짜 글은 올해가 아니면 연도까지 붙는다(공용 포매터) — 같은 포매터로 기대값을 만든다.
    const dueLabel = `마감 ~ ${formatDateOnlyMonthDay('2026-11-10')}`
    expect(screen.getByTestId('condition-chip-due')).toHaveTextContent(dueLabel)
    // 목록 검색(에픽 패널 조회 등 다른 검색은 이 조건을 싣지 않는다)이 세 조건을 함께 싣는다.
    await waitFor(() =>
      expect(
        searches.some(
          (u) =>
            u.searchParams.get('waiting') === 'true' &&
            u.searchParams.get('dueTo') === '2026-11-10' &&
            u.searchParams.get('status') === 'TODO,IN_PROGRESS',
        ),
      ).toBe(true),
    )
    const before = searches.length
    await user.click(screen.getByRole('button', { name: `${dueLabel} 조건 지우기` }))
    await waitFor(() => expect(location()).toBe('/projects/WP?status=TODO%2CIN_PROGRESS&waiting=true'))
    expect(screen.getByTestId('condition-chip-waiting')).toBeInTheDocument()
    await waitFor(() =>
      expect(searches.slice(before).some((u) => u.searchParams.get('waiting') === 'true' && u.searchParams.get('dueTo') == null)).toBe(true),
    )
  })
})
