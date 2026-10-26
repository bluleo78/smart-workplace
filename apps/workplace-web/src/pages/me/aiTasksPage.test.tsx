// AI 위임 작업(WP-377) 데스크톱 — 화면 테스트(WP-971, WP-995).
// 서버 순서 그대로의 행·AI 진행 배지·최근 보고·진행률·에이전트 유형·마지막 보고, 범위·빠른 필터 칩 → URL·요청 파라미터,
// 칩 건수(counts), 완료 칩 배지 톤, 빈 상태·조건 빈 상태·필터 초기화, 첫 페이지 실패·다시 시도, 에픽·프로젝트 묶음,
// 다음 회차 대기 라벨은 API 응답이 화면 문구·순서·주소로 바뀌는 것이라 브라우저 없이 판정되므로
// e2e/pages/me/ai-tasks.spec.ts 에서 옮겼다. 폭에 따른 접기·헤더 정렬·표 넘침(@layout)·다시 시도 초점(@input)·
// 대표 행 구조(@wiring)는 E2E 에 남는다.
// 페이지 컴포넌트(AiDelegatedTasksPage)를 renderScreen 으로 띄운다 — 앱 셸·라우트가 필요 없다(빈 상태 「AI 배정하기」 이동은 location() 으로 본다).
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { renderScreen } from '@/test/renderScreen'
import type { IssueResponse } from '@/types/issue'
import type { UserSummary } from '@/types/user'

import {
  agentWorker as agent,
  createAgentWork,
  createAiTaskCounts,
  createScheduledIssue,
  KST_1430,
  minutesAgo,
} from '../../../e2e/factories/agentWork.factory'
import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { GROUPED_ROWS } from '../../../e2e/fixtures/ai-tasks-groups'
import { projectRows } from '../../../e2e/fixtures/ai-tasks-projects'
import AiDelegatedTasksPage from './AiDelegatedTasksPage'

const human: UserSummary = { id: 1, username: 'kim', name: '김사람', kind: 'HUMAN' }
const LIST = '/api/v1/me/ai-tasks'
const COUNTS = '/api/v1/me/ai-tasks/counts'
const STALE_TOOLTIP = '2시간 넘게 보고가 없어요'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// 서버가 급한 순으로 준 행 — 화면은 이 순서를 그대로 그린다(클라이언트 재정렬 금지). E2E 와 같은 데이터.
const ROWS: IssueResponse[] = [
  createIssue({
    id: 412, number: 412, title: '로그인 실패 시 재시도 제한', status: 'IN_PROGRESS', priority: 'HIGH', assignees: [agent, human],
    agentWork: [
      createAgentWork({ worker: agent, state: 'INPUT_REQUIRED', note: '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?', updatedAt: minutesAgo(90) }),
      createAgentWork({ worker: human, state: 'WORKING', updatedAt: minutesAgo(10) }),
    ],
  }),
  createIssue({
    id: 416, number: 416, title: 'GitHub 연동 권한 확인', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'AUTH_REQUIRED', note: 'GitHub 토큰 권한이 필요해요', updatedAt: minutesAgo(40) })],
  }),
  createIssue({
    id: 415, number: 415, title: '이슈 목록 CSV 내보내기', status: 'IN_PROGRESS', assignees: [agent],
    agentWork: [createAgentWork({ state: 'REVIEW', note: 'PR #512 올렸어요 — 리뷰 부탁드려요', progress: 100 })],
  }),
  createIssue({
    id: 377, number: 377, title: 'AI 도구 작업 기록 표시', status: 'IN_PROGRESS', assignees: [human],
    agentWork: [createAgentWork({ worker: human, state: 'WORKING', note: 'MCP 헤더 처리 중', stepsDone: 3, stepsTotal: 5 })],
  }),
  createIssue({
    id: 380, number: 380, title: '알림 설정 화면 다크모드 대비', status: 'IN_PROGRESS', assignees: [human],
    agentWork: [createAgentWork({ worker: human, state: 'WORKING', updatedAt: minutesAgo(190), stale: true })],
  }),
  createIssue({
    id: 420, number: 420, title: '검색 인덱스 재생성', status: 'TODO', assignees: [agent],
    agentWork: [createAgentWork({ state: 'SUBMITTED', tool: null, updatedAt: minutesAgo(15) })],
  }),
  createIssue({ id: 418, number: 418, title: '위키 내보내기 PDF 여백', status: 'TODO', assignees: [agent] }),
]

/** 목록·건수 응답 + 두 요청의 검색 파라미터 기록. list 는 함수로 주면 요청마다 고른다. */
function aiHandlers(
  list: IssueResponse[] | ((sp: URLSearchParams) => Response) = ROWS,
  counts = createAiTaskCounts({ all: 6, inputRequired: 7, review: 1, blocked: 3, working: 2 }),
) {
  const seen = { list: [] as URLSearchParams[], counts: [] as URLSearchParams[] }
  const handlers = [
    http.get(LIST, ({ request }) => {
      const sp = new URL(request.url).searchParams
      seen.list.push(sp)
      return typeof list === 'function' ? list(sp) : HttpResponse.json(createIssueSearchResponse(list))
    }),
    http.get(COUNTS, ({ request }) => {
      seen.counts.push(new URL(request.url).searchParams)
      return HttpResponse.json(counts)
    }),
  ]
  return { seen, handlers }
}

function renderAiTasks(path = '/me/ai-tasks', ...args: Parameters<typeof aiHandlers>) {
  const { seen, handlers } = aiHandlers(...args)
  return { ...renderScreen(<AiDelegatedTasksPage />, { path, handlers }), seen }
}

/** 표 안 행 testid 순서(ai-row-N / ai-epic-N 만). */
function rowOrder(root: HTMLElement = document.body, pattern = /^ai-row-\d+$/) {
  return [...root.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')!).filter((t) => pattern.test(t))
}

describe('AI 위임 작업 표', () => {
  // 서버 순서·상태 배지·최근 보고 title·진행률·도구·마지막 보고·담당자 아바타(+1)·제목 링크·답변 필요 칩 링크가 응답 그대로 그려지는지 지킨다.
  test('행에 AI 진행·최근 보고·진행률·담당자·에이전트 유형·마지막 보고를 서버 순서대로 보인다', async () => {
    renderAiTasks()
    await screen.findByTestId('ai-row-418')
    expect(rowOrder()).toEqual(['ai-row-412', 'ai-row-416', 'ai-row-415', 'ai-row-377', 'ai-row-380', 'ai-row-420', 'ai-row-418'])

    expect(screen.getByTestId('ai-row-412-state')).toHaveTextContent('답변 필요')
    expect(screen.getByTestId('ai-row-416-state')).toHaveTextContent('인증 필요')
    expect(screen.getByTestId('ai-row-415-state')).toHaveTextContent('검토 필요')
    expect(screen.getByTestId('ai-row-377-state')).toHaveTextContent('작업 중')
    expect(screen.getByTestId('ai-row-418-state')).toHaveTextContent('시작 전')
    expect(screen.getByTestId('ai-row-420-state')).toHaveTextContent(/^시작 전$/)

    // 최근 보고 — 전체 문구는 title. 보고가 없으면 —.
    const note = screen.getByTestId('ai-row-412-note')
    expect(note).toHaveTextContent(/^잠금 시간을 5분\/30분 중 어느 쪽으로 할까요\?$/)
    expect(note).toHaveAttribute('title', '잠금 시간을 5분/30분 중 어느 쪽으로 할까요?')
    expect(screen.getByTestId('ai-row-380-note')).toHaveTextContent(/^—$/)

    // 진행률 — 단계 3/5, progress 만 있으면 퍼센트, 없으면 —.
    expect(screen.getByTestId('ai-row-377-progress')).toHaveTextContent('3/5')
    expect(screen.getByTestId('ai-row-415-progress')).toHaveTextContent('100%')
    expect(screen.getByTestId('ai-row-412-progress')).toHaveTextContent(/^—$/)

    // 에이전트 유형 — claude-code → Claude Code, 작업 없는 행·도구 null 행은 —(9번째 칸), null 글자 없음.
    expect(screen.getByTestId('ai-row-412-tool')).toHaveTextContent(/^Claude Code$/)
    expect(screen.queryByTestId('ai-row-418-tool')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-row-420-tool')).not.toBeInTheDocument()
    const startRow = screen.getByTestId('ai-row-420')
    const startCells = startRow.querySelectorAll('td')
    expect(startCells[8]).toHaveTextContent(/^—$/)
    expect(startRow).not.toHaveTextContent('null')
    // 시작 전은 마지막 보고도 —(10번째 칸).
    expect(screen.queryByTestId('ai-row-420-last')).not.toBeInTheDocument()
    expect(startCells[9]).toHaveTextContent(/^—$/)

    // 마지막 보고 — 90분 전 → 1시간 전, 무소식 툴팁은 아니다.
    expect(screen.getByTestId('ai-row-412-last')).toHaveTextContent(/^1시간 전$/)
    expect(screen.getByTestId('ai-row-412-last')).not.toHaveAttribute('title', STALE_TOOLTIP)

    // 담당자 — 대표 작업 작업자(AI 표식) + 진행 중 작업 2건이면 +1. 시작 전 행은 첫 AI 담당자.
    const row = screen.getByTestId('ai-row-412')
    expect(within(row).getByTestId(`user-avatar-${agent.id}`)).toBeInTheDocument()
    expect(within(row).getByTestId(`user-avatar-${agent.id}-agent-marker`)).toBeInTheDocument()
    expect(within(row).queryByTestId(`user-avatar-${human.id}`)).not.toBeInTheDocument()
    expect(row).toHaveTextContent('+1')
    expect(within(screen.getByTestId('ai-row-418')).getByTestId(`user-avatar-${agent.id}`)).toBeInTheDocument()

    // 제목은 이슈 상세 링크, 답변 필요 칩만 이슈 챗 링크.
    expect(within(row).getByRole('link', { name: '로그인 실패 시 재시도 제한' })).toHaveAttribute('href', '/projects/WP/issues/412')
    expect(screen.getByTestId('ai-row-412-state')).toHaveAttribute('href', '/projects/WP/issues/412?chat=1')
    expect(screen.getByTestId('ai-row-416-state')).not.toHaveAttribute('href')
    expect(screen.getByTestId('ai-row-415-state')).not.toHaveAttribute('href')
    // 좁은 폭에서 담당자 툴팁이 유형을 대신 알린다(숨김 여부는 @layout E2E) — 도구를 모르는 행은 이름만.
    expect(screen.getByTestId('ai-row-412-assignee')).toHaveAttribute('title', `${agent.name} (에이전트) · Claude Code`)
    expect(screen.getByTestId('ai-row-420-assignee')).toHaveAttribute('title', `${agent.name} (에이전트)`)
  })

  // 무소식(stale) 작업은 마지막 보고에 경고 아이콘과 툴팁을 단다.
  test('무소식 행은 마지막 보고에 경고 아이콘과 툴팁', async () => {
    renderAiTasks()
    const last = await screen.findByTestId('ai-row-380-last')
    expect(last).toHaveTextContent(/^3시간 전$/)
    expect(last).toHaveAttribute('title', STALE_TOOLTIP)
    expect(last.querySelector('svg')).not.toBeNull()
  })

  // 범위·빠른 필터 칩이 URL 과 목록 요청(scope·agentState)에 실리고, 건수 요청엔 빠른 필터가 실리지 않는다. 칩 건수는 counts 값.
  test('전체 범위·빠른 필터 칩이 URL 과 요청에 반영되고, 칩 건수는 counts 값', async () => {
    const { user, location, seen } = renderAiTasks()
    await screen.findByTestId('ai-row-412')
    expect(screen.getByTestId('ai-quick-count-all')).toHaveTextContent(/^6$/)
    expect(screen.getByTestId('ai-quick-count-inputRequired')).toHaveTextContent(/^7$/)
    expect(screen.getByTestId('ai-quick-count-review')).toHaveTextContent(/^1$/)
    expect(screen.getByTestId('ai-quick-count-blocked')).toHaveTextContent(/^3$/)
    expect(screen.getByTestId('ai-quick-count-working')).toHaveTextContent(/^2$/)
    expect(screen.getByTestId('ai-quick-inputRequired')).toHaveTextContent('답변 필요')
    expect(screen.getByTestId('ai-quick-all')).toHaveTextContent('미완료')

    await user.click(screen.getByTestId('ai-scope-all'))
    await waitFor(() => expect(location()).toMatch(/[?&]scope=all/))
    expect(screen.getByTestId('ai-scope-all')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(seen.list.at(-1)?.get('scope')).toBe('ALL'))
    await waitFor(() => expect(seen.counts.at(-1)?.get('scope')).toBe('ALL'))

    await user.click(screen.getByTestId('ai-quick-inputRequired'))
    await waitFor(() => expect(location()).toMatch(/[?&]state=INPUT_REQUIRED/))
    expect(screen.getByTestId('ai-quick-inputRequired')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(seen.list.at(-1)?.get('agentState')).toBe('INPUT_REQUIRED'))
    expect(seen.list.at(-1)?.get('scope')).toBe('ALL')
    expect(seen.counts.every((sp) => !sp.has('agentState'))).toBe(true)

    // 미완료 칩 → state 제거, 나와 관련 → scope 제거.
    await user.click(screen.getByTestId('ai-quick-all'))
    await waitFor(() => expect(screen.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'true'))
    expect(new URL(location(), 'http://x').searchParams.has('state')).toBe(false)
    await user.click(screen.getByTestId('ai-scope-mine'))
    await waitFor(() => expect(screen.getByTestId('ai-scope-mine')).toHaveAttribute('aria-pressed', 'true'))
    expect(new URL(location(), 'http://x').searchParams.has('scope')).toBe(false)
  })

  // WP-396: 완료 칩 — 칩 순서, 종료 상태 넷을 쉼표 목록으로 요청, 결과별 배지 톤, 시간 칸은 종료 시각(endedAt 없으면 마지막 보고 툴팁).
  test('완료 칩은 종료 상태로 요청하고 done 건수, 행 배지는 결과별 톤', async () => {
    const DONE_ROWS: IssueResponse[] = [
      createIssue({
        id: 501, number: 501, title: '결제 웹훅 재시도 정책 정리', status: 'DONE', assignees: [agent],
        agentWork: [createAgentWork({ state: 'COMPLETED', note: 'PR #530 병합 완료', progress: 100, updatedAt: minutesAgo(3 * 24 * 60), endedAt: minutesAgo(20) })],
      }),
      createIssue({
        id: 502, number: 502, title: '대용량 첨부 미리보기 생성 실패 원인 조사', status: 'IN_PROGRESS', assignees: [agent],
        agentWork: [createAgentWork({ state: 'FAILED', note: '샌드박스 메모리 한도 초과로 중단', updatedAt: minutesAgo(90), endedAt: minutesAgo(90) })],
      }),
      createIssue({
        id: 503, number: 503, title: '구 알림 설정 마이그레이션', status: 'CANCELED', assignees: [agent],
        agentWork: [createAgentWork({ state: 'CANCELED', updatedAt: minutesAgo(200), endedAt: minutesAgo(200) })],
      }),
      createIssue({
        id: 505, number: 505, title: '재시작된 작업', status: 'IN_PROGRESS', assignees: [agent],
        agentWork: [createAgentWork({ state: 'WORKING', updatedAt: minutesAgo(5) })],
      }),
      createIssue({
        id: 504, number: 504, title: '외부 저장소 권한 없는 작업', status: 'TODO', assignees: [human],
        agentWork: [createAgentWork({ worker: human, state: 'REJECTED', note: '권한 밖 저장소라 맡지 않아요', updatedAt: minutesAgo(300), endedAt: minutesAgo(300) })],
      }),
    ]
    const { user, location, seen } = renderAiTasks('/me/ai-tasks', DONE_ROWS, createAiTaskCounts({ all: 6, done: 4 }))
    await screen.findByTestId('ai-row-501')
    const chipIds = [...screen.getByTestId('ai-quick-chips').querySelectorAll('button')].map((e) => e.getAttribute('data-testid'))
    expect(chipIds).toEqual(['ai-quick-all', 'ai-quick-inputRequired', 'ai-quick-review', 'ai-quick-blocked', 'ai-quick-working', 'ai-quick-scheduled', 'ai-quick-done'])
    expect(screen.getByTestId('ai-quick-scheduled')).toHaveTextContent('다음 회차 대기')
    expect(screen.getByTestId('ai-quick-done')).toHaveTextContent('완료')
    expect(screen.getByTestId('ai-quick-count-done')).toHaveTextContent(/^4$/)

    await user.click(screen.getByTestId('ai-quick-done'))
    await waitFor(() => expect(location()).toMatch(/[?&]state=DONE/))
    expect(screen.getByTestId('ai-quick-done')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'false')
    await waitFor(() => expect(seen.list.at(-1)?.get('agentState')).toBe('COMPLETED,FAILED,CANCELED,REJECTED'))
    expect(seen.counts.every((sp) => !sp.has('agentState'))).toBe(true)

    // 결과별 배지 — 완료 success·실패 옅은 위험 tint(진한 채움 아님)·취소·반려 중립 윤곽.
    await waitFor(() => expect(screen.getByTestId('ai-tasks-table').querySelector('th:last-child')).toHaveTextContent(/^종료$/))
    expect(screen.getByTestId('ai-row-501-state')).toHaveTextContent(/^완료$/)
    expect(screen.getByTestId('ai-row-501-state')).toHaveAttribute('data-variant', 'success')
    expect(screen.getByTestId('ai-row-502-state')).toHaveTextContent(/^실패$/)
    expect(screen.getByTestId('ai-row-502-state')).toHaveClass('bg-destructive/10')
    expect(screen.getByTestId('ai-row-502-state')).not.toHaveAttribute('data-variant', 'destructive')
    expect(screen.getByTestId('ai-row-503-state')).toHaveTextContent(/^취소$/)
    expect(screen.getByTestId('ai-row-503-state')).toHaveAttribute('data-variant', 'outline')
    expect(screen.getByTestId('ai-row-504-state')).toHaveTextContent(/^반려$/)
    expect(screen.getByTestId('ai-row-504-state')).toHaveAttribute('data-variant', 'outline')

    // 시간 칸은 종료 시각(3일 전 보고가 아니라 20분 전 종료), endedAt 없는 행은 마지막 보고임을 툴팁으로 밝힌다.
    expect(screen.getByTestId('ai-row-501-last')).toHaveTextContent(/^20분 전$/)
    expect(screen.getByTestId('ai-row-501-last')).toHaveAttribute('title', '종료 20분 전')
    expect(screen.getByTestId('ai-row-505-last')).toHaveAttribute('title', '마지막 보고 5분 전')
  })

  // WP-450: 다음 회차 대기 칩 → agentState=SCHEDULED, 행은 배지 + 예정 시각 라벨(최근 보고 앞, DOM 순서) + 예정 title. 기준 시각 고정.
  test('다음 회차 대기 칩은 SCHEDULED 로 요청하고, 행은 배지와 예정 시각을 최근 보고 앞에 보인다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(KST_1430))
    const rows = [
      createScheduledIssue(601, '주간 리포트 생성', { note: '다른 작업에 양보했어요' }),
      createScheduledIssue(602, '로그 정리', { note: '예정 없이 양보', nextRunAt: null }),
    ]
    const { user, location, seen } = renderAiTasks('/me/ai-tasks', rows, createAiTaskCounts({ all: 5, scheduled: 2 }))
    await screen.findByTestId('ai-row-601')
    expect(screen.getByTestId('ai-quick-count-scheduled')).toHaveTextContent(/^2$/)

    await user.click(screen.getByTestId('ai-quick-scheduled'))
    await waitFor(() => expect(location()).toMatch(/[?&]state=SCHEDULED/))
    expect(screen.getByTestId('ai-quick-scheduled')).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(seen.list.at(-1)?.get('agentState')).toBe('SCHEDULED'))

    expect(screen.getByTestId('ai-row-601-state')).toHaveTextContent(/^다음 회차 대기$/)
    const next = screen.getByTestId('ai-row-601-next-run')
    expect(next).toHaveTextContent(/^내일 09:00 이후$/)
    expect(next).toHaveAttribute('title', '예정 2026-10-19 09:00')
    const note = screen.getByTestId('ai-row-601-note')
    expect(note).toHaveTextContent(/^다른 작업에 양보했어요$/)
    // 예정 라벨이 최근 보고보다 앞에 온다(문서 순서 — 실제 x 좌표 비교는 같은 줄 flex 라 순서가 곧 위치).
    expect(next.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('ai-row-602-next-run')).toHaveTextContent(/^다른 작업 뒤 이어서$/)
    expect(screen.getByTestId('ai-row-602-next-run')).not.toHaveAttribute('title')
  })
})

describe('AI 위임 작업 빈·실패 상태', () => {
  // 필터 없는 빈 상태(4요소 + 「AI 배정하기」) → 빠른 필터 중 빈 상태(조건 문구 + 필터 초기화, 배정 버튼 없음).
  test('비어 있으면 안내 문구, 빠른 필터 중이면 조건 문구', async () => {
    const { user } = renderAiTasks('/me/ai-tasks', [], createAiTaskCounts())
    const empty = await screen.findByTestId('ai-row-empty')
    expect(empty.querySelector('svg')).not.toBeNull()
    expect(empty).toHaveTextContent('AI가 진행 중인 작업이 없어요')
    expect(empty).toHaveTextContent('내 이슈의 담당자에 AI 구성원을 추가하면 여기에 표시돼요.')
    expect(screen.getByTestId('ai-empty-assign')).toHaveTextContent(/^내 작업에서 AI 배정하기$/)
    expect(screen.queryByTestId('ai-empty-reset')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('ai-quick-blocked'))
    await waitFor(() => expect(screen.getByTestId('ai-row-empty')).toHaveTextContent('조건에 맞는 AI 작업이 없어요'))
    expect(screen.getByTestId('ai-row-empty')).not.toHaveTextContent('AI가 진행 중인 작업이 없어요')
    expect(screen.getByTestId('ai-empty-reset')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-empty-assign')).not.toBeInTheDocument()
  })

  // WP-942: 「내 작업에서 AI 배정하기」는 내 작업 할당 탭 주소로 보낸다(도착 화면 배선은 my-tasks 의 @wiring E2E).
  test('AI 작업이 없으면 「내 작업에서 AI 배정하기」로 내 작업(할당 탭)에 간다', async () => {
    const { user, location } = renderAiTasks('/me/ai-tasks', [], createAiTaskCounts())
    await user.click(await screen.findByTestId('ai-empty-assign'))
    await waitFor(() => expect(location()).toBe('/me/tasks/assigned'))
  })

  // facet 만 걸려도 조건 빈 상태, 필터 초기화는 빠른 필터·facet 을 지우고 범위(scope)만 남긴다.
  test('facet 만 걸려도 조건 문구 — 필터 초기화는 빠른 필터·facet 을 지우고 범위는 남긴다', async () => {
    const { user, location } = renderAiTasks('/me/ai-tasks?scope=all&state=BLOCKED&status=DONE&priority=HIGH', [], createAiTaskCounts())
    expect(await screen.findByTestId('ai-row-empty')).toHaveTextContent('조건에 맞는 AI 작업이 없어요')
    await user.click(screen.getByTestId('ai-empty-reset'))
    await waitFor(() => expect(location()).toBe('/me/ai-tasks?scope=all'))
    await waitFor(() => expect(screen.getByTestId('ai-row-empty')).toHaveTextContent('AI가 진행 중인 작업이 없어요'))
    expect(screen.getByTestId('ai-quick-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ai-scope-all')).toHaveAttribute('aria-pressed', 'true')
  })

  test('facet(status) 하나만 걸린 주소도 조건 빈 상태와 필터 초기화를 보인다', async () => {
    renderAiTasks('/me/ai-tasks?status=DONE', [], createAiTaskCounts())
    expect(await screen.findByTestId('ai-row-empty')).toHaveTextContent('조건에 맞는 AI 작업이 없어요')
    expect(screen.getByTestId('ai-empty-reset')).toBeInTheDocument()
  })

  // 완료 칩 0건은 「완료 기록 없음」 안내(초기화·배정 버튼 없음), 완료 칩 + facet 0건은 조건 문구 + 초기화.
  test('완료 칩 0건은 「아직 완료된 AI 작업이 없습니다」이고 필터 초기화가 없다', async () => {
    renderAiTasks('/me/ai-tasks?state=DONE', [], createAiTaskCounts())
    const empty = await screen.findByTestId('ai-row-empty')
    expect(empty).toHaveTextContent('아직 완료된 AI 작업이 없습니다')
    expect(empty).toHaveTextContent('AI가 작업을 끝내면 여기에 최근 종료순으로 쌓여요.')
    expect(empty.querySelector('svg')).not.toBeNull()
    expect(screen.queryByTestId('ai-empty-reset')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-empty-assign')).not.toBeInTheDocument()
  })

  test('완료 칩 + facet 0건은 조건 문구와 필터 초기화를 유지한다', async () => {
    renderAiTasks('/me/ai-tasks?state=DONE&priority=HIGH', [], createAiTaskCounts())
    expect(await screen.findByTestId('ai-row-empty')).toHaveTextContent('조건에 맞는 AI 작업이 없어요')
    expect(screen.getByTestId('ai-empty-reset')).toBeInTheDocument()
  })

  // 첫 페이지 500 은 빈 상태가 아니라 오류 안내 + 다시 시도, 다시 시도 성공이면 행이 그려지고 안내가 사라진다.
  test('첫 페이지 실패는 빈 상태가 아니라 오류 + 다시 시도', async () => {
    let failing = true
    const { user } = renderAiTasks('/me/ai-tasks', () =>
      failing ? HttpResponse.json({ message: 'boom' }, { status: 500 }) : HttpResponse.json(createIssueSearchResponse(ROWS)),
    )
    const error = await screen.findByTestId('ai-tasks-error')
    expect(error).toHaveTextContent('AI 위임 작업을 불러오지 못했습니다')
    expect(screen.queryByTestId('ai-row-empty')).not.toBeInTheDocument()
    failing = false
    await user.click(within(error).getByRole('button', { name: '다시 시도' }))
    await screen.findByTestId('ai-row-412')
    expect(screen.queryByTestId('ai-tasks-error')).not.toBeInTheDocument()
  })
})

describe('AI 위임 작업 묶음', () => {
  // WP-375: 에픽 묶음 머리(키·└ 완료/전체)·에픽 행은 머리로만·머리 줄에 에픽 자신 AI 진행·하위 행 부모 칩 숨김·에픽 행 없는 묶음 머리.
  test('에픽 묶음 머리 아래 하위 행이 오고 에픽 부모 칩은 숨는다', async () => {
    renderAiTasks('/me/ai-tasks', GROUPED_ROWS)
    const head = await screen.findByTestId('ai-epic-412')
    expect(head).toHaveTextContent('WP-412')
    expect(head).toHaveTextContent('└ 1/5')
    expect(screen.queryByTestId('ai-row-412')).not.toBeInTheDocument()
    expect(within(head).getByTestId('ai-row-412-state')).toBeInTheDocument()
    expect(screen.queryByTestId('issue-row-413-parent')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('ai-epic-420')).queryByTestId('ai-row-420-state')).not.toBeInTheDocument()
  })

  // 묶이지 않은 행의 부모 칩은 키 + 부모 제목(폭은 @layout E2E).
  test('묶이지 않은 행의 부모 칩은 키를 먼저 보인다', async () => {
    renderAiTasks('/me/ai-tasks', GROUPED_ROWS)
    const parent = await screen.findByTestId('issue-row-431-parent')
    expect(parent).toHaveTextContent(/^WP-377.*AI 작업 기록/)
  })

  // 다음 페이지 하위 행은 같은 묶음 머리 아래 이어 붙고 머리는 한 번만.
  test('다음 페이지의 하위 행은 같은 머리 아래 이어 붙는다', async () => {
    // 목록 끝 sentinel 이 곧바로 보인다고 알리는 IntersectionObserver — jsdom 은 교차를 재지 않으므로 「끝에 닿음」을 흉내 낸다.
    vi.stubGlobal('IntersectionObserver', class {
      private cb: IntersectionObserverCallback
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb
      }
      observe(el: Element) {
        queueMicrotask(() => this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver))
      }
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    })
    const rows = GROUPED_ROWS.filter((r) => [421, 422, 430].includes(r.number)).map((r) =>
      r.aiGroup ? { ...r, aiGroup: { ...r.aiGroup, size: 2 } } : r,
    )
    renderAiTasks('/me/ai-tasks', (sp) =>
      HttpResponse.json(
        sp.get('cursor') === 'c2' ? createIssueSearchResponse([rows[1], rows[2]]) : createIssueSearchResponse([rows[0]], 'c2'),
      ),
      createAiTaskCounts(),
    )
    await screen.findByTestId('ai-row-421')
    await screen.findByTestId('ai-row-430')
    expect(screen.getAllByTestId('ai-epic-420')).toHaveLength(1)
    expect(rowOrder(document.body, /^ai-(row|epic)-\d+$/)).toEqual(['ai-epic-420', 'ai-row-421', 'ai-row-422', 'ai-row-430'])
  })

  // WP-426: 프로젝트 머리 줄 순서·이름 링크·서버 건수(aiProject.size), 구간 안에는 그 프로젝트 행만, 에픽 묶음은 구간 안에서 유지.
  test('프로젝트별 머리 줄 아래에 그 프로젝트 행이 서버 순서대로 온다', async () => {
    renderAiTasks('/me/ai-tasks', projectRows())
    await screen.findByTestId('ai-row-2061')
    expect(rowOrder(document.body, /^ai-project-[A-Z]+-head$/)).toEqual(['ai-project-WP-head', 'ai-project-HR-head', 'ai-project-MKT-head'])
    const name = screen.getByTestId('ai-project-HR-head-name')
    expect(name).toHaveTextContent(/^인사팀$/)
    expect(name).toHaveAttribute('href', '/projects/HR')
    expect(screen.getByTestId('ai-project-HR-head-count')).toHaveTextContent(/^HR · 4$/)
    expect(screen.getByTestId('ai-project-WP-head-count')).toHaveTextContent(/^WP · 5$/)
    expect(rowOrder(screen.getByTestId('ai-project-HR'))).toEqual(['ai-row-1012', 'ai-row-1015'])
    const wp = screen.getByTestId('ai-project-WP')
    expect(within(wp).getByTestId('ai-epic-412')).toBeInTheDocument()
    expect(rowOrder(wp, /^ai-(row|epic)-\d+$/)).toEqual(['ai-epic-412', 'ai-row-413', 'ai-row-414', 'ai-row-418', 'ai-row-430'])
  })
})
