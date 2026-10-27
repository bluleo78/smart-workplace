// 타임라인 에픽 계층 트리(#649) — 페이지 테스트(WP-971, WP-980).
// 그리드 행 구성(에픽 그룹·진행률·에픽 없음 롤업·SUBTASK 제외)·접기/펼치기와 localStorage 저장·복원·그룹 행 클릭 이동·
// 미정 하위의 자리(에픽 아래 행, 일정 미정 섹션 아님)·#656 크래시·상태색 주입(접미사 충돌)은 SVAR 그리드 DOM 과 JS 로 판정되므로
// e2e/pages/projects/timeline-epic-tree.spec.ts 에서 옮겼다. CSS 로 숨기는 막대(요약·미정 막대)의 보임 여부는 E2E(@layout)에 남는다.
// 타임라인 화면(TimelinePage)만 renderScreen 으로 띄운다 — 앱 셸·인증 부팅은 건너뛴다(WP-1002). 상세 이동은 주소(location())로만 본다.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import TimelinePage from '@/pages/projects/timeline/TimelinePage'
import { atRoute } from '@/test/kits/projects/atRoute'
import { KEY, stubCanvas, timelineApi } from '@/test/kits/projects/timeline'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'

import { createIssue } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType } from '../../../e2e/factories/issueType.factory'

stubCanvas()

const EPIC = makeEpicType()
const SUBTASK = makeSubtaskType()
const under = (number: number, title: string) => ({ number, title, type: EPIC })

/** E2E setupStubs — 에픽 40(1/2) + 하위 41(일정)·42(미정) + 에픽 없는 18 + SUBTASK 50. */
const TREE = [
  createIssue({ number: 40, title: '온보딩 개편', type: EPIC, childCount: 2, childDoneCount: 1 }),
  createIssue({ number: 41, title: '가입 플로우', parent: under(40, '온보딩 개편'), startDate: '2026-07-01', dueDate: '2026-07-05', status: 'DONE' }),
  createIssue({ number: 42, title: '온보딩 미정 하위', parent: under(40, '온보딩 개편') }),
  createIssue({ number: 18, title: '에픽 없는 이슈', dueDate: '2026-07-08' }),
  createIssue({ number: 50, title: '하위 태스크 이슈', type: SUBTASK, parent: { number: 41, title: '가입 플로우', type: { ...EPIC, name: 'TASK' } }, dueDate: '2026-07-05' }),
]

const grid = () => document.querySelector<HTMLElement>('.timeline-gantt-root .wx-grid')!
const rowOf = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('.timeline-gantt-root .wx-grid .wx-row')].find((r) => r.textContent?.includes(text))

/** 그룹 행의 토글 아이콘을 누른다(행 클릭은 상세 이동). SVAR 는 detail>1(더블클릭)을 무시하므로 한 번 클릭(detail 1)으로 보낸다. */
function toggleGroup(title: string) {
  const icon = rowOf(title)!.querySelector<HTMLElement>('.wx-toggle-icon, [class*="toggle"]')!
  fireEvent.click(icon, { detail: 1 })
}

async function open(issues = TREE, extra: RequestHandler[] = []) {
  const api = timelineApi({ issues })
  const view = renderScreen(atRoute('/projects/:key/timeline', <TimelinePage />), {
    path: `/projects/${KEY}/timeline?period=all`,
    handlers: [...extra, ...api.handlers, ...shellHandlers],
  })
  await screen.findByTestId('timeline-gantt')
  await waitFor(() => expect(grid()).toBeTruthy())
  return view
}

describe('타임라인 에픽 트리', () => {
  // 에픽 그룹 행(진행률)·에픽 없음 가상 그룹(개수·하위 마감일 롤업 #662)이 기본 접힘으로 그려지고 SUBTASK 는 어디에도 없다.
  test('에픽 그룹·에픽 없음 그룹 — 기본 접힘, 펼치면 하위, SUBTASK 제외', async () => {
    await open()
    await waitFor(() => expect(grid()).toHaveTextContent('온보딩 개편'))
    expect(grid()).toHaveTextContent('(1/2)')
    expect(grid()).toHaveTextContent('에픽 없음 (1)')
    expect(grid()).not.toHaveTextContent('가입 플로우')
    expect(grid()).not.toHaveTextContent('에픽 없는 이슈')
    expect(rowOf('에픽 없음')).toHaveTextContent('2026-07-08')
    toggleGroup('온보딩 개편')
    await waitFor(() => expect(grid()).toHaveTextContent('가입 플로우'))
    expect(grid()).not.toHaveTextContent('하위 태스크 이슈')
  })

  // 「펼친 것만 저장」 — 펼친 그룹 key 가 localStorage 에 담기고, 저장된 값으로 다시 열면 펼친 채 시작한다.
  test('펼침은 localStorage 에 저장되고, 저장된 펼침으로 다시 열면 복원된다', async () => {
    const view = await open()
    await waitFor(() => expect(grid()).toHaveTextContent('온보딩 개편'))
    toggleGroup('온보딩 개편')
    await waitFor(() => expect(grid()).toHaveTextContent('가입 플로우'))
    const stored = JSON.parse(window.localStorage.getItem(`timeline-expanded:${KEY}`) ?? '[]') as string[]
    expect(stored).toContain('epic-40')

    view.unmount()
    window.localStorage.setItem(`timeline-expanded:${KEY}`, JSON.stringify(stored))
    await open()
    await waitFor(() => expect(grid()).toHaveTextContent('가입 플로우'))
  })

  // 미정 에픽 자식(42)은 에픽 아래 그리드 행으로 가고 「일정 미정」 섹션에는 없다(중복 제거).
  test('미정 에픽 자식은 에픽 아래 행이고 일정 미정 섹션에 없다', async () => {
    await open()
    await waitFor(() => expect(grid()).toHaveTextContent('온보딩 개편'))
    toggleGroup('온보딩 개편')
    await waitFor(() => expect(grid()).toHaveTextContent('온보딩 미정 하위'))
    expect(screen.queryByTestId('unscheduled-row-42')).not.toBeInTheDocument()
  })

  // 에픽 그룹 행을 누르면 그 에픽 상세로 간다 — 이동한 주소만 본다(상세 화면은 그리지 않는다).
  test('에픽 그룹 행 클릭 → 에픽 이슈 상세', async () => {
    const { location } = await open(TREE)
    await waitFor(() => expect(rowOf('온보딩 개편')).toBeTruthy())
    fireEvent.click(rowOf('온보딩 개편')!.querySelector('[data-col-id=":start"]')!, { detail: 1 })
    await waitFor(() => expect(location()).toMatch(new RegExp(`^/projects/${KEY}/issues/40`)))
  })

  // #656 — 하위가 모두 미정인 에픽만 있어도(자식 없는 summary) 펼칠 때 SVAR 트리 빌더가 크래시하지 않는다.
  test('하위가 모두 미정인 에픽을 펼쳐도 크래시하지 않는다 (#656)', async () => {
    await open([
      createIssue({ number: 60, title: '탐색 EPIC 테스트', type: EPIC, startDate: '2026-07-05', dueDate: '2026-07-12', childCount: 2, childDoneCount: 0 }),
      createIssue({ number: 61, title: '미정 하위 1', parent: under(60, '탐색 EPIC 테스트') }),
      createIssue({ number: 62, title: '미정 하위 2', parent: under(60, '탐색 EPIC 테스트') }),
    ])
    await waitFor(() => expect(grid()).toHaveTextContent('탐색 EPIC 테스트'))
    toggleGroup('탐색 EPIC 테스트')
    await waitFor(() => expect(grid()).toHaveTextContent('미정 하위 2'))
    expect(grid()).toHaveTextContent('미정 하위 1')
    expect(screen.queryByText('페이지를 불러오는 중 문제가 발생했습니다')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unscheduled-row-61')).not.toBeInTheDocument()
    expect(screen.queryByTestId('unscheduled-row-62')).not.toBeInTheDocument()
  })

  // 상태색 주입이 번호를 정확히 매칭하는지 — 5 는 25 의 접미사라 접미사 매칭이면 같은 막대를 번갈아 덮어써 프리즈했다.
  test('번호 접미사가 겹쳐도(5 vs 25) 막대마다 제 상태색을 갖는다', async () => {
    await open([
      createIssue({ number: 10, title: '인증 에픽', type: EPIC, childCount: 1, childDoneCount: 1 }),
      createIssue({ number: 25, title: '완료 하위', status: 'DONE', startDate: '2026-07-06', dueDate: '2026-07-10', parent: under(10, '인증 에픽') }),
      createIssue({ number: 5, title: '진행중 루트', status: 'IN_PROGRESS', startDate: '2026-06-10', dueDate: '2026-06-18' }),
    ])
    await waitFor(() => expect(grid()).toHaveTextContent('인증 에픽'))
    toggleGroup('인증 에픽')
    toggleGroup('에픽 없음')
    const color = (n: number) =>
      document.querySelector<HTMLElement>(`.timeline-gantt-root .wx-bar[data-task-id="${n}"]`)?.style.getPropertyValue('--wx-gantt-task-color')
    await waitFor(() => expect(color(25)).toBe('var(--success)'))
    await waitFor(() => expect(color(5)).toBe('var(--primary)'))
  })

  // 에픽 아래 미정 하위 행은 시작일 칸이 「미정」, 시작일만 있으면 그 날짜(WP-484). 에픽 없는 시작일만 이슈는 일정 미정 섹션에 「M월 D일 ~」.
  test('미정 하위 행의 시작일 칸 — 「미정」 또는 시작일, 다시 접으면 숨는다', async () => {
    const { user } = await open([
      createIssue({ number: 10, title: '온보딩 개편', type: EPIC, startDate: '2026-07-01', dueDate: '2026-07-20', childCount: 2, childDoneCount: 1 }),
      createIssue({ number: 11, title: '가입 플로우', parent: under(10, '온보딩 개편'), startDate: '2026-07-02', dueDate: '2026-07-06', status: 'DONE' }),
      createIssue({ number: 12, title: '백엔드 설계', parent: under(10, '온보딩 개편') }),
      createIssue({ number: 13, title: '시작일만 하위', parent: under(10, '온보딩 개편'), startDate: '2026-07-10' }),
      createIssue({ number: 14, title: '시작일만 단독', startDate: '2026-07-15' }),
    ])
    await waitFor(() => expect(grid()).toHaveTextContent('온보딩 개편'))
    expect(grid()).not.toHaveTextContent('백엔드 설계')
    toggleGroup('온보딩 개편')
    await waitFor(() => expect(grid()).toHaveTextContent('백엔드 설계'))
    expect(grid()).toHaveTextContent('가입 플로우')
    const undatedRow = (n: number) => document.querySelector<HTMLElement>(`.timeline-gantt-root .wx-grid .wx-row[data-id*='undated-${n}']`)!
    expect(undatedRow(12)).toHaveTextContent('미정')
    expect(undatedRow(13)).toHaveTextContent('2026-07-10')
    expect(undatedRow(13)).not.toHaveTextContent('미정')
    expect(screen.queryByTestId('unscheduled-row-12')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('unscheduled-section').querySelector('summary')!)
    expect(screen.getByTestId('unscheduled-row-14')).toHaveTextContent('7월 15일 ~')
    toggleGroup('온보딩 개편')
    await waitFor(() => expect(grid()).not.toHaveTextContent('백엔드 설계'))
    expect(grid()).not.toHaveTextContent('가입 플로우')
  })
})
