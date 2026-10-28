// 개인 프로젝트 전용 상세 화면 — 화면 테스트(WP-971, WP-1002 에서 PersonalProjectDetail 만 띄우게 바꿈).
// 뷰 토글·패널/모달 분기·URL(task·필터·그룹) 상태·리다이렉트·빈/오류 상태·행 표시·요청 payload/쿼리 파라미터는
// 브라우저 없이 판정되므로 e2e/pages/projects/personal-project-detail.spec.ts 에서 옮겼다.
// 셸 배선(@wiring)·새로고침 유지(@platform)·포커스·Esc 겹침·날짜 칸 키 입력(@input)·헤더 아래 패널 위치와
// 스크롤·무한 로드·글자 변환(@layout)은 E2E 에 남는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import IssueDetailPage from '@/pages/projects/IssueDetailPage'
import { PersonalProjectDetail } from '@/pages/projects/personal/PersonalProjectDetail'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { IssueResponse } from '@/types/issue'
import type { IssueRecurrence } from '@/types/issueRecurrence'
import type { UserSummary } from '@/types/user'

import { createAgentWork } from '../../../e2e/factories/agentWork.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createLabel, toLabelSummary } from '../../../e2e/factories/label.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

const KEY = 'PME'
const BASE = `/api/v1/projects/${KEY}`
const PROJECT = createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true })
const LABEL = toLabelSummary(createLabel({ id: 5, name: '긴급' }))

type Patch = { number: number; body: Record<string, unknown> }

type ApiOptions = {
  /** 목록 GET 이 실패를 돌려줄지 — 테스트가 도중에 바꿔 다시 시도를 본다. */
  failList?: { on: boolean }
  /** 목록에 붙일 다음 커서(더 받을 페이지가 남은 상태). */
  nextCursor?: string | null
  /** 프로젝트 유형 목록 — 빠른 추가가 TASK 를 찾는다. */
  types?: unknown[]
  /** 프로젝트 멤버 — 담당자 픽커가 부른다. */
  members?: unknown[]
  /** 작업의 반복(WP-989) — 없으면 GET 204. */
  recurrence?: IssueRecurrence | null
  /** PUT 반복이 돌려줄 오류(예: 409 쓸 수 있는 AI 비서 없음). */
  recurrencePutError?: { status: number; message: string }
  /** 반복 GET 이 500 을 돌려줄지 — 테스트가 도중에 꺼서 다시 시도를 본다. */
  failRecurrenceGet?: { on: boolean }
}

/** 반복 응답 — 매주 월·수 08:30, 다음 실행 10/29(목) 08:30. */
function recurrenceOf(o: Partial<IssueRecurrence> = {}): IssueRecurrence {
  return {
    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', time: '08:30', enabled: true, nextRunAt: '2026-10-28T23:30:00Z',
    consecutiveFailures: 0, lastRunAt: null, agentUserId: 9, agentName: 'AI 비서', ...o,
  }
}

/**
 * 개인 프로젝트 + 목록·단건·변경 API. 이슈는 메모리 db 에 두어 PATCH 가 재조회에도 반영된다(무효화 확인용).
 * 목록은 status 파라미터만 백엔드처럼 거른다. 서버 version 과 다른 version 이 오면 409 를 돌려준다(#611).
 */
function personalApi(issues: IssueResponse[] = [createIssue({ projectKey: KEY })], opts: ApiOptions = {}) {
  const db = new Map(issues.map((i) => [i.number, structuredClone(i)]))
  const searches: URLSearchParams[] = []
  const patches: Patch[] = []
  const posts: Record<string, unknown>[] = []
  const detailGets: number[] = []
  const recurrencePuts: Record<string, unknown>[] = []
  let recurrenceDeletes = 0
  let recurrence = opts.recurrence ?? null
  const handlers = [
    // 반복(WP-989) — 패널을 열면 조회한다. 저장·끄기는 기록하고 메모리 값을 바꾼다.
    http.get(`${BASE}/issues/:num/recurrence`, () => {
      if (opts.failRecurrenceGet?.on) return HttpResponse.json({ message: 'boom' }, { status: 500 })
      return recurrence ? HttpResponse.json(recurrence) : new HttpResponse(null, { status: 204 })
    }),
    http.put(`${BASE}/issues/:num/recurrence`, async ({ request }) => {
      const body = (await request.json()) as { rrule: string; time: string }
      recurrencePuts.push(body)
      if (opts.recurrencePutError) {
        return HttpResponse.json({ status: opts.recurrencePutError.status, message: opts.recurrencePutError.message }, { status: opts.recurrencePutError.status })
      }
      recurrence = recurrenceOf(body)
      return HttpResponse.json(recurrence)
    }),
    http.delete(`${BASE}/issues/:num/recurrence`, () => {
      recurrenceDeletes++
      recurrence = null
      return new HttpResponse(null, { status: 204 })
    }),
    http.get(BASE, () => HttpResponse.json(PROJECT)),
    http.get(`${BASE}/types`, () => HttpResponse.json(opts.types ?? [])),
    ...(opts.members ? [http.get(`${BASE}/members`, () => HttpResponse.json(opts.members))] : []),
    http.get(`${BASE}/issues`, ({ request }) => {
      const params = new URL(request.url).searchParams
      searches.push(params)
      if (opts.failList?.on) return HttpResponse.json({ message: 'boom' }, { status: 500 })
      const status = params.get('status')
      const all = [...db.values()]
      const list = status ? all.filter((i) => status.split(',').includes(i.status)) : all
      return HttpResponse.json(createIssueSearchResponse(list, opts.nextCursor ?? null))
    }),
    http.post(`${BASE}/issues`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      posts.push(body)
      return HttpResponse.json(createIssue({ projectKey: KEY, number: 50, title: String(body.title) }))
    }),
    http.get(`${BASE}/issues/:num`, ({ params }) => {
      const num = Number(params.num)
      detailGets.push(num)
      const it = db.get(num)
      if (!it) return HttpResponse.json({ message: 'not found' }, { status: 404 })
      return HttpResponse.json(createIssueDetail({ summary: it, body: '서론은 짧게' }))
    }),
    // 풀페이지 이슈 화면이 리다이렉트 전에 구독자를 부른다.
    http.get(`${BASE}/issues/:num/watchers`, () => HttpResponse.json([])),
    http.patch(`${BASE}/issues/:num`, async ({ request, params }) => {
      const num = Number(params.num)
      const body = (await request.json()) as Record<string, unknown>
      patches.push({ number: num, body })
      const it = db.get(num)!
      if (body.version !== undefined && body.version !== it.version) {
        return HttpResponse.json({ status: 409, message: '다른 사용자가 먼저 이 이슈를 수정했습니다' }, { status: 409 })
      }
      Object.assign(it, body, { version: (it.version ?? 0) + 1 })
      return HttpResponse.json(createIssueDetail({ summary: it, body: '서론은 짧게' }))
    }),
  ]
  return { handlers, db, searches, patches, posts, detailGets, recurrencePuts, deletes: () => recurrenceDeletes }
}

/**
 * 개인 화면을 path 로 띄우고 waitFor testid 가 뜰 때까지 기다린다.
 * 프로젝트 화면은 개인 프로젝트면 PersonalProjectDetail 로 갈라지므로 그것만 띄운다(같은 project props).
 * 풀페이지 이슈 주소의 리다이렉트(#207)는 이슈 상세 화면이 하므로 그 라우트도 둔다 — 상세는 AI 패널 모드를 읽어 Provider 로 감싼다.
 */
async function open(path: string, api: ReturnType<typeof personalApi>, waitForTestId: string) {
  const view = renderScreen(
    <Routes>
      <Route path="/projects/:key" element={<PersonalProjectDetail project={PROJECT} />} />
      <Route
        path="/projects/:key/issues/:number"
        element={
          <AIAssistantProvider hotkeysEnabled={false}>
            <IssueDetailPage />
          </AIAssistantProvider>
        }
      />
    </Routes>,
    { path, handlers: [...api.handlers, ...shellHandlers] },
  )
  await screen.findByTestId(waitForTestId)
  return view
}

/** 주소의 쿼리 파라미터. */
const paramsOf = (location: string) => new URL(location, 'http://x').searchParams

describe('뷰 토글·목록/보드 표시', () => {
  // 공유 툴바 setView 는 URL 을 필터+view+group 으로 다시 짠다 — 열린 작업(task=)은 남지 않고, list 는 기본값이라 view= 를 생략한다.
  test('뷰 토글 → view=board 로 바뀌며 task 가 빠지고, 체크리스트로 돌아오면 view= 가 없다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    await user.click(screen.getByRole('button', { name: '보드' }))
    await waitFor(() => expect(paramsOf(location()).get('view')).toBe('board'))
    expect(paramsOf(location()).get('task')).toBeNull()
    await user.click(screen.getByRole('button', { name: '체크리스트' }))
    await waitFor(() => expect(paramsOf(location()).has('view')).toBe(false))
  })

  // 체크리스트 행에 AI 위임 배지가 연결되는가 — 상태별 판정은 AiDelegationBadge 단위 테스트가 맡고 여기선 대표 상태·없음만 본다.
  test('체크리스트는 작업 행과 AI 위임 배지(가장 급한 상태)를 그리고, 비위임 행엔 배지가 없다', async () => {
    const agent: UserSummary = { id: 99, username: 'ai', name: 'AI', kind: 'AGENT' }
    const api = personalApi([
      createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'IN_PROGRESS', assignees: [agent] }),
      createIssue({ projectKey: KEY, number: 2, title: '운동 계획', status: 'TODO', assignees: [] }),
      createIssue({
        projectKey: KEY, number: 4, title: '여행 예약', status: 'IN_PROGRESS', assignees: [agent],
        // 서버는 급한 순으로 내려준다(BLOCKED 가 WORKING 보다 앞) — 화면은 첫 항목을 쓴다.
        agentWork: [createAgentWork({ worker: agent, state: 'BLOCKED' }), createAgentWork({ worker: agent, state: 'WORKING' })],
      }),
    ])
    await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    expect(screen.getByTestId('personal-task-row-1')).toHaveTextContent('블로그 초안')
    expect(screen.getByTestId('personal-task-row-2')).toHaveTextContent('운동 계획')
    expect(screen.queryByTestId('ai-delegation-badge-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-delegation-badge-4')).toHaveTextContent('막힘')
    expect(screen.getByTestId('personal-checklist')).not.toHaveTextContent('처리중')
  })

  // 개인 보드는 상태 3컬럼 — 취소 컬럼도 취소 카드도 없다.
  test('보드 뷰는 팀 리치카드를 상태 3컬럼으로 배치하고 CANCELED 컬럼·카드는 없다', async () => {
    // id 는 카드별로 달라야 한다 — 보드는 컬럼별 쿼리를 합칠 때 id 로 중복 제거한다(#875).
    const api = personalApi([
      createIssue({ id: 1, projectKey: KEY, number: 1, title: '할일카드', status: 'TODO' }),
      createIssue({ id: 2, projectKey: KEY, number: 2, title: '진행카드', status: 'IN_PROGRESS' }),
      createIssue({ id: 3, projectKey: KEY, number: 3, title: '완료카드', status: 'DONE' }),
      createIssue({ id: 4, projectKey: KEY, number: 4, title: '취소카드', status: 'CANCELED' }),
    ])
    await open(`/projects/${KEY}?view=board`, api, 'issue-card-1')
    await waitFor(() => expect(screen.getByTestId('board-col-1')).toHaveTextContent('할일카드'))
    await waitFor(() => expect(screen.getByTestId('board-col-2')).toHaveTextContent('진행카드'))
    await waitFor(() => expect(screen.getByTestId('board-col-3')).toHaveTextContent('완료카드'))
    expect(screen.queryByTestId('board-col-4')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-card-4')).not.toBeInTheDocument()
  })

  // 우선순위로 묶은 보드에서도 취소 이슈가 HIGH 레인으로 새지 않는다(개인 3컬럼 보드 규칙).
  // 그룹 보드는 스윔레인(WP-1021) — 열은 개인 보드 상태 열과 같은 3개(취소 열 없음).
  test('보드+우선순위 그룹 — 스윔레인 열은 취소 없는 3상태이고 CANCELED 이슈는 어떤 레인에도 없다', async () => {
    const api = personalApi([
      createIssue({ id: 1, projectKey: KEY, number: 1, title: '높음활성', status: 'TODO', priority: 'HIGH' }),
      createIssue({ id: 2, projectKey: KEY, number: 2, title: '높음취소', status: 'CANCELED', priority: 'HIGH' }),
      createIssue({ id: 3, projectKey: KEY, number: 3, title: '낮음완료', status: 'DONE', priority: 'LOW' }),
    ])
    await open(`/projects/${KEY}?view=board&group=priority`, api, 'issue-card-1')
    expect(screen.queryByTestId('issue-card-2')).not.toBeInTheDocument()
    expect(screen.getAllByTestId(/^board-lane-head-\d+$/).map((h) => h.dataset.testid)).toEqual([
      'board-lane-head-1',
      'board-lane-head-2',
      'board-lane-head-3',
    ])
    expect(screen.queryByTestId('board-lane-HIGH-col-4')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('board-lane-HIGH-col-1')).getByTestId('issue-card-1')).toBeInTheDocument()
    expect(within(screen.getByTestId('board-lane-LOW-col-3')).getByTestId('issue-card-3')).toBeInTheDocument()
    // 취소 이슈는 레인 개수에도 들지 않는다. 이슈 없는 우선순위(중간)도 레인은 남는다(0건, 빈 칸).
    expect(screen.getByTestId('board-lane-count-HIGH')).toHaveTextContent(/^1$/)
    expect(screen.getByTestId('board-lane-count-MID')).toHaveTextContent(/^0$/)
    expect(screen.getByTestId('board-lane-MID-col-1')).toBeEmptyDOMElement()
  })

  // 우선순위는 막대(data-priority)로, 라벨은 칩으로, 지난 마감은 짧은 날짜 + 경고색으로 그린다. 문구 규칙은 personalDue 단위 테스트.
  test('행에 우선순위(막대)·라벨·지난 마감 짧은 텍스트(경고색)와 data-status 가 그려진다', async () => {
    const api = personalApi([
      createIssue({ projectKey: KEY, number: 1, title: '중요작업', status: 'IN_PROGRESS', priority: 'HIGH', dueDate: '2020-01-10', labels: [LABEL] }),
    ])
    await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    const row = screen.getByTestId('personal-task-row-1')
    expect(row).toHaveTextContent('중요작업')
    expect(row).toHaveTextContent('긴급')
    expect(row).toHaveAttribute('data-priority', 'HIGH')
    expect(row).not.toHaveTextContent('높음')
    expect(row).toHaveAttribute('data-status', 'IN_PROGRESS')
    expect(row.querySelector('span.text-destructive')).toHaveTextContent('2020. 1. 10')
  })

  // 행 안 순서(완료 토글 → 우선순위 막대)와 레이블 5개의 「칩 2개 + +3」 접기.
  test('행 순서는 완료 토글 다음 우선순위, 레이블 5개면 칩 2개와 +3', async () => {
    const labels = ['세금', '긴급', '가족', '병원', '보험'].map((name, i) => toLabelSummary(createLabel({ id: i + 1, name })))
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '레이블 많은 작업', labels })])
    await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    const flex = screen.getByTestId('personal-task-row-1').firstElementChild!
    const [first, second] = Array.from(flex.children)
    expect(first.getAttribute('data-testid')).toBe('personal-task-check-1')
    expect(second.getAttribute('data-testid')).not.toBe('personal-task-check-1')
    const chips = screen.getByTestId('personal-task-labels-1')
    expect(chips).toHaveTextContent('세금')
    expect(chips).toHaveTextContent('긴급')
    expect(chips).not.toHaveTextContent('가족')
    expect(chips).toHaveTextContent('+3')
  })

  // 첫 페이지 실패 → 오류 안내, 다시 시도 → 회복.
  test('첫 페이지 실패는 오류를 보이고 다시 시도로 회복한다', async () => {
    const failList = { on: true }
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '회복된 작업' })], { failList })
    const { user } = await open(`/projects/${KEY}`, api, 'personal-error')
    expect(screen.getByTestId('personal-error')).toHaveTextContent('작업을 불러오지 못했습니다')
    failList.on = false
    await user.click(screen.getByTestId('personal-error-retry'))
    expect(await screen.findByTestId('personal-task-row-1')).toHaveTextContent('회복된 작업')
    expect(screen.queryByTestId('personal-error')).not.toBeInTheDocument()
  })

  // 다음 페이지가 남은 동안 마지막 섹션(오늘)은 건수를 숨긴다 — 위 섹션(지남)은 완결이라 정확한 건수를 보인다(WP-918).
  test('다음 페이지가 남으면 마지막 섹션 건수는 숨기고 위 섹션 건수는 보인다', async () => {
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const api = personalApi(
      [
        createIssue({ id: 1, projectKey: KEY, number: 1, title: '지난 작업', dueDate: '2020-01-10' }),
        createIssue({ id: 2, projectKey: KEY, number: 2, title: '오늘 작업', dueDate: today }),
      ],
      { nextCursor: 'c1|page2' },
    )
    await open(`/projects/${KEY}`, api, 'personal-task-row-2')
    expect(screen.getByTestId('personal-section-count-overdue')).toHaveTextContent('1')
    expect(screen.queryByTestId('personal-section-count-today')).not.toBeInTheDocument()
  })
})

describe('작업 패널·모달(?task=)', () => {
  // 행 클릭 한 번으로 패널이 열리고 URL 에 task 가 반영되며 행은 눌림으로 그려진다.
  // 같은 행 재클릭 닫힘·다른 행 전환은 브라우저 history 항목 key 로 낡은 스냅숏을 가르는 가드(useHistoryParam)가 있어 E2E 에 남는다.
  test('행 클릭 → 패널 + ?task=1, 행은 aria-pressed', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    await user.click(screen.getByTestId('personal-task-row-1'))
    expect(await screen.findByTestId('personal-task-panel')).toBeInTheDocument()
    expect(paramsOf(location()).get('task')).toBe('1')
    await waitFor(() => expect(screen.getByTestId('personal-task-row-1')).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(screen.getByTestId('personal-task-panel-title')).toHaveTextContent('블로그 초안'))
  })

  // Esc 로 패널을 닫으면 URL 에서 task 가 빠진다.
  test('Esc 로 패널이 닫히고 URL 에서 task 가 빠진다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('personal-task-panel')).not.toBeInTheDocument())
    expect(paramsOf(location()).get('task')).toBeNull()
  })

  // 열린 행은 선택 배경으로 표시한다.
  test('열린 행은 bg-selected 로 표시한다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    expect(await screen.findByTestId('personal-task-row-1')).toHaveClass('bg-selected')
  })

  // 개인 패널은 라벨·AI 대화를 보이고, 팀 전용(사이클·관계·구독)은 감춘다.
  test('패널은 라벨·AI 대화 노출 / 사이클·관계·구독 미노출', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', labels: [LABEL] })])
    await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const panel = screen.getByTestId('personal-task-panel')
    await waitFor(() => expect(panel).toHaveTextContent('긴급'))
    expect(within(panel).getByTestId('personal-panel-chat')).toBeInTheDocument()
    expect(within(panel).queryByText('사이클')).not.toBeInTheDocument()
    expect(within(panel).queryByTestId('property-group-relations')).not.toBeInTheDocument()
    expect(within(panel).queryByText('관계', { exact: true })).not.toBeInTheDocument()
    expect(within(panel).queryByText('구독')).not.toBeInTheDocument()
  })

  // 체크리스트는 인플로우 패널, 보드는 중앙 모달로 상세를 연다(#231).
  test('체크리스트 ?task= 는 패널(모달 없음), 보드 ?task= 는 모달(패널 없음)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })])
    const first = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument()
    first.unmount()
    await open(`/projects/${KEY}?view=board&task=1`, personalApi([createIssue({ projectKey: KEY, number: 1, status: 'TODO' })]), 'personal-task-modal')
    expect(screen.queryByTestId('personal-task-panel')).not.toBeInTheDocument()
  })

  // 보드 카드 링크는 풀페이지(/issues/1)가 아니라 같은 화면의 ?task= 모달로 열고, 걸려 있던 필터는 남긴다(#616).
  test('보드 카드 클릭 → ?task=1 모달(풀페이지 아님), priority 필터 유지 (#616)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '높음작업', status: 'TODO', priority: 'HIGH' })])
    const { user, location } = await open(`/projects/${KEY}?view=board&priority=HIGH`, api, 'issue-card-1')
    await user.click(within(screen.getByTestId('issue-card-1')).getByRole('link'))
    expect(await screen.findByTestId('personal-task-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('personal-task-panel')).not.toBeInTheDocument()
    const p = paramsOf(location())
    expect(location().startsWith(`/projects/${KEY}?`)).toBe(true)
    expect([p.get('view'), p.get('task'), p.get('priority')]).toEqual(['board', '1', 'HIGH'])
  })

  // 모달을 Esc 로 닫아도 필터는 남는다(#616).
  test('보드 모달을 Esc 로 닫으면 task 만 빠지고 priority 필터는 유지된다 (#616)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '높음작업', status: 'TODO', priority: 'HIGH' })])
    const { user, location } = await open(`/projects/${KEY}?view=board&priority=HIGH&task=1`, api, 'personal-task-modal')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(paramsOf(location()).get('task')).toBeNull())
    expect(paramsOf(location()).get('priority')).toBe('HIGH')
  })

  // 없는 작업(404)은 패널 안 안내 + 닫기로 끝난다.
  test('존재하지 않는 task 진입 → 오류 안내, 닫기 누르면 task 가 빠진다', async () => {
    const api = personalApi()
    const { user, location } = await open(`/projects/${KEY}?task=999`, api, 'personal-task-panel-notfound')
    await user.click(within(screen.getByTestId('personal-task-panel-notfound')).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(paramsOf(location()).get('task')).toBeNull())
  })

  // 알림·북마크의 풀페이지 이슈 주소는 개인 프로젝트에선 패널 주소로 바뀐다(#207).
  test('개인 프로젝트의 풀페이지 이슈 URL 은 ?task= 패널로 리다이렉트된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { location } = await open(`/projects/${KEY}/issues/1`, api, 'personal-task-panel')
    expect(location()).toBe(`/projects/${KEY}?task=1`)
  })

  // 담당자가 있으면 픽커 트리거가 아이콘 대신 아바타(이니셜·사진)를 그린다(#362).
  test('패널 담당자 픽커 — 담당자가 있으면 아바타를 그린다 (#362)', async () => {
    const me: UserSummary = { id: 1, username: 'testuser', name: '테스트 사용자', kind: 'HUMAN' }
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '담당자있는작업', assignees: [me] })], {
      members: [createMember({ userId: me.id, username: me.username, name: me.name })],
    })
    await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const trigger = await screen.findByTestId('assignee-picker-trigger')
    expect(trigger.querySelector('img') ?? within(trigger).queryByText('테')).not.toBeNull()
  })
})

describe('반복(WP-989)', () => {
  test('패널에 「반복」 칸 — 없으면 「반복 안 함」, 매주 월·수 08:30 을 고르면 PUT 하고 요약·다음 실행이 보인다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '주간 보고' })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const panel = screen.getByTestId('personal-task-panel')
    expect(await within(panel).findByText('반복', { exact: true })).toBeInTheDocument()
    const trigger = await within(panel).findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(trigger).toHaveTextContent('반복 안 함')

    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    expect(pop).toHaveTextContent('반복을 켜면 내 AI 비서가 담당에 들어가요')
    expect(pop).toHaveTextContent('결과는 이 작업의 채팅에 남습니다')
    await user.click(within(pop).getByRole('button', { name: '매주' }))
    // 기본 월요일이 켜져 있다 — 수요일을 더한다.
    expect(within(pop).getByRole('button', { name: '월요일' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(pop).getByRole('button', { name: '수요일' }))
    expect(within(pop).getByText('한국 시간')).toBeInTheDocument()
    const time = within(pop).getByLabelText('실행 시각 (한국 시간)')
    await user.clear(time)
    await user.type(time, '08:30')
    // 저장하면 서버가 AI 비서를 담당에 넣는다 — 작업 상세·목록을 다시 받는지 요청 수로 본다.
    const before = { detail: api.detailGets.length, list: api.searches.length }
    await user.click(within(pop).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(api.recurrencePuts).toEqual([{ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', time: '08:30' }]))
    await waitFor(() => expect(api.detailGets.length).toBeGreaterThan(before.detail))
    await waitFor(() => expect(api.searches.length).toBeGreaterThan(before.list))
    await waitFor(() => expect(screen.queryByTestId('task-recurrence-popover')).not.toBeInTheDocument())
    expect(within(panel).getByTestId('task-recurrence-trigger')).toHaveTextContent('매주 월·수 08:30')
    expect(within(panel).getByTestId('task-recurrence-status')).toHaveTextContent('다음 실행 10/29(목) 08:30')
  })

  test('반복 조회가 실패하면 「반복 안 함」 대신 실패 안내 — 편집 버튼 없음, 다시 시도로 회복한다', async () => {
    const fail = { on: true }
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })], {
      failRecurrenceGet: fail,
      recurrence: recurrenceOf({ rrule: 'FREQ=DAILY' }),
    })
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const err = await screen.findByTestId('task-recurrence-error-state')
    expect(err).toHaveTextContent('반복을 불러오지 못했어요')
    expect(screen.queryByTestId('task-recurrence-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText('반복 안 함')).not.toBeInTheDocument()
    fail.on = false
    await user.click(within(err).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('task-recurrence-trigger')).toHaveTextContent('매일 08:30')
  })

  test('매월 29~31일을 고르면 「그 날짜가 없는 달은 건너뜁니다」, 28일 이하는 안내 없음', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const trigger = await screen.findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    await user.click(within(pop).getByRole('button', { name: '매월' }))
    const day = within(pop).getByLabelText('날짜')
    fireEvent.change(day, { target: { value: '28' } })
    expect(within(pop).queryByTestId('task-recurrence-monthday-hint')).not.toBeInTheDocument()
    fireEvent.change(day, { target: { value: '31' } })
    expect(within(pop).getByTestId('task-recurrence-monthday-hint')).toHaveTextContent('그 날짜가 없는 달은 건너뜁니다')
    await user.click(within(pop).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(api.recurrencePuts).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', time: '09:00' }]))
  })

  test('요일을 모두 끄고 저장하면 요청 없이 「요일을 하나 이상 고르세요」', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const trigger = await screen.findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    await user.click(within(pop).getByRole('button', { name: '매주' }))
    await user.click(within(pop).getByRole('button', { name: '월요일' }))
    await user.click(within(pop).getByRole('button', { name: '저장' }))
    expect(within(pop).getByRole('alert')).toHaveTextContent('요일을 하나 이상 고르세요')
    expect(api.recurrencePuts).toEqual([])
  })

  test('서버 409(쓸 수 있는 AI 비서 없음)는 그 문구를 보이고 편집기를 닫지 않는다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })], {
      recurrencePutError: { status: 409, message: '쓸 수 있는 AI 비서가 없습니다 — 개인 비서를 연결하거나 관리자에게 공통 비서 지정을 요청하세요' },
    })
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const trigger = await screen.findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    await user.click(within(pop).getByRole('button', { name: '매일' }))
    await user.click(within(pop).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('쓸 수 있는 AI 비서가 없습니다 — 개인 비서를 연결하거나 관리자에게 공통 비서 지정을 요청하세요')).toBeInTheDocument()
    expect(api.recurrencePuts).toEqual([{ rrule: 'FREQ=DAILY', time: '09:00' }])
    expect(screen.getByTestId('task-recurrence-popover')).toBeInTheDocument()
    expect(trigger).toHaveTextContent('반복 안 함')
  })

  test('3회 연속 실패로 멈춘 반복은 「멈춤 — 3회 연속 실패」, 「반복 끄기」는 DELETE 하고 「반복 안 함」으로', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })], {
      recurrence: recurrenceOf({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', enabled: false, consecutiveFailures: 3 }),
    })
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const trigger = await screen.findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toHaveTextContent('매월 15일 08:30'))
    expect(screen.getByTestId('task-recurrence-status')).toHaveTextContent('멈춤 — 3회 연속 실패')
    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    // 편집기는 지금 규칙으로 시작한다.
    expect(within(pop).getByRole('button', { name: '매월' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(pop).getByLabelText('날짜')).toHaveValue(15)
    await user.click(within(pop).getByRole('button', { name: '반복 끄기' }))
    await waitFor(() => expect(api.deletes()).toBe(1))
    await waitFor(() => expect(screen.getByTestId('task-recurrence-trigger')).toHaveTextContent('반복 안 함'))
    expect(screen.queryByTestId('task-recurrence-status')).not.toBeInTheDocument()
  })
})

describe('편집·완료 토글', () => {
  // 체크 = 완료 토글. 행 클릭과 분리돼 패널을 열지 않고, 무효화 재조회로 행이 완료 섹션으로 옮겨 취소선으로 그려진다(WP-918).
  test('체크 토글 → PATCH { status: DONE }, 패널은 열리지 않고 행이 완료 섹션으로 옮겨진다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '운동 계획', status: 'TODO', dueDate: null })])
    const { user } = await open(`/projects/${KEY}`, api, 'personal-task-check-1')
    expect(screen.getByTestId('personal-section-noDue')).toBeInTheDocument()
    await user.click(screen.getByTestId('personal-task-check-1'))
    await waitFor(() => expect(api.patches.map((p) => p.body)).toEqual([{ status: 'DONE' }]))
    expect(screen.queryByTestId('personal-task-panel')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('personal-section-noDue')).not.toBeInTheDocument())
    await user.click(within(screen.getByTestId('personal-section-done')).getByRole('button'))
    const row = await within(screen.getByTestId('personal-section-done')).findByTestId('personal-task-row-1')
    expect(row.querySelector('.line-through')).toHaveTextContent('운동 계획')
  })

  // #611 — 상세를 보고 있지 않아도 409 뒤 상세를 다시 불러 옛 version 을 버리고, 다음 토글은 새 version 으로 성공한다.
  test('체크리스트 토글이 409 로 충돌하면 최신 version 을 다시 불러와 다음 토글은 성공한다 (#611)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO', version: 1 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    // 패널을 한 번 열어 상세 캐시(version 1)를 채운 뒤 닫는다.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('personal-task-panel')).not.toBeInTheDocument())
    // 다른 곳에서 먼저 수정됨.
    api.db.get(1)!.version = 2
    const getsBefore = api.detailGets.length
    await user.click(screen.getByTestId('personal-task-check-1'))
    expect(await screen.findByText('다른 사용자가 먼저 이 이슈를 수정했습니다')).toBeInTheDocument()
    expect(api.patches[0].body.version).toBe(1)
    await waitFor(() => expect(api.detailGets.length).toBeGreaterThan(getsBefore))
    await user.click(screen.getByTestId('personal-task-check-1'))
    await waitFor(() => expect(api.db.get(1)!.status).toBe('DONE'))
    expect(api.patches).toHaveLength(2)
    expect(api.patches[1].body.version).toBe(2)
  })

  // 개인 작업은 풀페이지가 막혀 있어 패널(#718)이 유일한 편집 경로 — 제목 연필 → Enter → PATCH { title }, 패널과 뒤 목록이 함께 갱신된다.
  test('패널 제목 연필 → 인라인 편집 → PATCH { title }, 패널 제목과 체크리스트 행이 갱신된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const panel = screen.getByTestId('personal-task-panel')
    expect(within(panel).queryByTestId('personal-task-panel-title-link')).not.toBeInTheDocument()
    await user.click(await within(panel).findByTestId('issue-title-edit'))
    const input = within(panel).getByTestId('issue-title-input')
    await user.clear(input)
    await user.paste('블로그 최종본')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.patches.map((p) => p.body)).toContainEqual({ title: '블로그 최종본' }))
    await waitFor(() => expect(within(panel).getByTestId('personal-task-panel-title')).toHaveTextContent('블로그 최종본'))
    await waitFor(() => expect(screen.getByTestId('personal-task-row-1')).toHaveTextContent('블로그 최종본'))
  })

  // 빈/공백 제목은 zod min(1) 로 막혀 PATCH 없이 원래 제목이 남는다.
  test('패널 제목 편집 — 공백 제목은 PATCH 없이 원복된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-panel')
    const panel = screen.getByTestId('personal-task-panel')
    await user.click(await within(panel).findByTestId('issue-title-edit'))
    const input = within(panel).getByTestId('issue-title-input')
    await user.clear(input)
    await user.paste('   ')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(within(panel).getByTestId('personal-task-panel-title')).toHaveTextContent('블로그 초안'))
    expect(api.patches).toEqual([])
  })

  // 보드 모달 헤더에서도 같은 인라인 편집 — 루프만 유발하던 「전체 보기」 링크는 없다(#718).
  test('보드 모달 헤더에서도 제목 인라인 편집 → PATCH { title } + 제목 갱신 (#718)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })])
    const { user } = await open(`/projects/${KEY}?view=board&task=1`, api, 'personal-task-modal')
    const modal = screen.getByTestId('personal-task-modal')
    expect(within(modal).queryByRole('link', { name: '전체 보기' })).not.toBeInTheDocument()
    await user.click(await within(modal).findByTestId('issue-title-edit'))
    const input = within(modal).getByTestId('issue-title-input')
    await user.clear(input)
    await user.paste('보드 최종본')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.patches.map((p) => p.body)).toContainEqual({ title: '보드 최종본' }))
    await waitFor(() => expect(within(modal).getByTestId('personal-task-panel-title')).toHaveTextContent('보드 최종본'))
  })

  // 개인은 TASK 단일 유형(#226) — 빠른 추가 대화상자에 유형 칸이 없고 POST typeId 는 TASK 로 고정된다.
  test('빠른 추가 다이얼로그는 유형 select 를 숨기고 POST typeId 가 TASK 로 고정된다', async () => {
    const api = personalApi([], { types: systemTypes() })
    const { user } = await open(`/projects/${KEY}`, api, 'personal-empty')
    await user.click(within(screen.getByTestId('page-header')).getByRole('button', { name: /빠른 추가/ }))
    const dialog = await screen.findByRole('dialog')
    expect(screen.queryByTestId('create-type-select')).not.toBeInTheDocument()
    await user.click(within(dialog).getByLabelText(/^제목/))
    await user.paste('새 작업')
    await user.click(within(dialog).getByRole('button', { name: '생성' }))
    await waitFor(() => expect(api.posts).toHaveLength(1))
    expect(api.posts[0].typeId).toBe(systemTypes().find((t) => t.name === 'TASK')!.id)
  })
})

describe('툴바 — 검색·필터·그룹 → URL·요청 파라미터', () => {
  // 개인 필터는 상태/우선순위/라벨 등만 — 사이클·유형(팀 전용)과 완료일 기간(WP-873, 종료 이슈 옵트아웃)은 없다.
  // 빠른 필터 칩(WP-1020)은 상태·우선순위만 바로 보이고, 상태 범주·라벨·담당자는 「더 보기」에 있다.
  test('개인 칩은 상태·우선순위, 「더 보기」엔 상태 범주·라벨·담당자(사이클·유형·완료일 부재)', async () => {
    const api = personalApi()
    const { user } = await open(`/projects/${KEY}`, api, 'personal-checklist')
    const chips = Array.from(within(await screen.findByTestId('quick-filter-bar')).getAllByTestId(/^quick-filter-\w+-trigger$/))
    expect(chips.map((c) => c.dataset.testid)).toEqual(['quick-filter-statusId-trigger', 'quick-filter-priority-trigger'])
    await user.click(screen.getByTestId('quick-filter-more'))
    expect(await screen.findByTestId('quick-filter-more-facet-status')).toBeInTheDocument()
    expect(screen.getByTestId('quick-filter-more-facet-label')).toBeInTheDocument()
    expect(screen.getByTestId('quick-filter-more-facet-assignee')).toBeInTheDocument()
    for (const key of ['cycle', 'type', 'closedIn']) {
      expect(screen.queryByTestId(`quick-filter-more-facet-${key}`)).not.toBeInTheDocument()
      expect(screen.queryByTestId(`quick-filter-${key}`)).not.toBeInTheDocument()
    }
  })

  // 검색 입력 → (디바운스) URL ?q= → 목록 API q 파라미터.
  test('툴바 검색 입력 → ?q= URL 반영 + 이슈 API q 파라미터', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}`, api, 'personal-checklist')
    await user.click(screen.getByRole('textbox', { name: '태스크 검색' }))
    await user.paste('블로그')
    await waitFor(() => expect(paramsOf(location()).get('q')).toBe('블로그'))
    await waitFor(() => expect(api.searches.some((s) => s.get('q') === '블로그')).toBe(true))
  })

  // 상태 필터(할 일) → URL ?status=TODO → API status 파라미터 → 걸러진 결과만 그린다.
  test('상태 필터 「할 일」 → ?status=TODO + API status 파라미터 + DONE 행 사라짐', async () => {
    const api = personalApi([
      createIssue({ id: 1, projectKey: KEY, number: 1, title: '할일작업', status: 'TODO', dueDate: '2020-01-01' }),
      createIssue({ id: 2, projectKey: KEY, number: 2, title: '완료작업', status: 'DONE', dueDate: null }),
    ])
    const { user, location } = await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    await openQuickFacet(user, 'status')
    await user.click(await screen.findByTestId('facet-value-status-TODO'))
    await waitFor(() => expect(screen.getByTestId('quick-filter-status')).toHaveAttribute('data-active', 'true'))
    await user.keyboard('{Escape}')
    await waitFor(() => expect(paramsOf(location()).get('status')).toBe('TODO'))
    await waitFor(() => expect(api.searches.some((s) => s.get('status') === 'TODO')).toBe(true))
    expect(screen.getByTestId('personal-task-row-1')).toHaveTextContent('할일작업')
    await waitFor(() => expect(screen.queryByText('완료작업')).not.toBeInTheDocument())
  })

  // 기본 요청은 서버 체크리스트 정렬(order·mode=due·오늘·주 끝)이고, 그룹=상태로 바꾸면 mode 만 바꿔 1페이지부터 받으며
  // 체크리스트는 마감 섹션 대신 상태 섹션으로 다시 짜인다(섹션 규칙은 personalGrouping 단위 테스트).
  test('기본 요청 order=checklist·mode=due·today·weekEnd, 그룹=상태 → mode=status 1페이지 + 상태 섹션', async () => {
    const api = personalApi([
      createIssue({ id: 1, projectKey: KEY, number: 1, title: '할일A', status: 'TODO', dueDate: '2020-01-01' }),
      createIssue({ id: 2, projectKey: KEY, number: 2, title: '진행B', status: 'IN_PROGRESS', dueDate: null }),
      createIssue({ id: 3, projectKey: KEY, number: 3, title: '완료C', status: 'DONE', dueDate: null }),
    ])
    const { user, location } = await open(`/projects/${KEY}`, api, 'personal-section-overdue')
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date()
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7))
    const first = api.searches.at(-1)!
    expect([first.get('order'), first.get('mode'), first.get('today'), first.get('weekEnd')]).toEqual([
      'checklist', 'due', ymd(now), ymd(weekEnd),
    ])
    expect(screen.getByTestId('personal-section-overdue')).toHaveTextContent('할일A')
    expect(screen.queryByTestId('personal-section-TODO')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('group-by-trigger'))
    await user.click(await screen.findByTestId('group-by-status'))
    await waitFor(() => expect(paramsOf(location()).get('group')).toBe('status'))
    await waitFor(() => expect(api.searches.at(-1)!.get('mode')).toBe('status'))
    const status = api.searches.at(-1)!
    expect([status.get('cursor'), status.get('today'), status.get('weekEnd')]).toEqual([null, null, null])
    expect(await screen.findByTestId('personal-section-TODO')).toHaveTextContent('할일A')
    expect(screen.getByTestId('personal-section-IN_PROGRESS')).toHaveTextContent('진행B')
    expect(screen.queryByTestId('personal-section-overdue')).not.toBeInTheDocument()
  })
})

describe('빈 상태(#252·WP-918)', () => {
  // 검색어로 0건 → 필터 0건 안내 + 초기화(빠른 추가 유도 없음). 초기화는 검색어만 지우고 그룹은 남긴다.
  test('검색어 0건 → 필터 0건 빈 상태, 초기화는 q 만 지우고 group 은 남긴다', async () => {
    const api = personalApi([])
    const { user, location } = await open(`/projects/${KEY}?q=zzz없는검색어&group=priority`, api, 'personal-empty-filter')
    expect(screen.getByTestId('personal-empty-filter')).toHaveTextContent('일치하는 작업이 없습니다')
    expect(screen.queryByTestId('personal-empty-create')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('personal-empty-reset'))
    await waitFor(() => expect(paramsOf(location()).get('q')).toBeNull())
    expect(paramsOf(location()).get('group')).toBe('priority')
  })

  // 서버는 취소 이슈를 주지만 체크리스트는 CANCELED 를 섹션에 넣지 않는다 — 그릴 행 0개도 「필터 0건」이다(WP-918).
  test('상태 「취소」로 거른 결과가 섹션에 안 보이면 필터 0건 빈 상태, 초기화는 status 만 지운다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '취소된 작업', status: 'CANCELED' })])
    const { user, location } = await open(`/projects/${KEY}?status=CANCELED&group=priority`, api, 'personal-empty-filter')
    expect(screen.getByTestId('personal-empty-filter')).toHaveTextContent('일치하는 작업이 없습니다')
    expect(screen.queryByTestId('personal-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('personal-empty-create')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('personal-empty-reset'))
    await waitFor(() => expect(paramsOf(location()).get('status')).toBeNull())
    expect(paramsOf(location()).get('group')).toBe('priority')
  })

  // 담당자 「미지정」(assignee=null)만 걸린 0건도 필터 0건 — 프로젝트 목록 판정(includeUnassigned)과 같게.
  test('담당자 미지정 필터만 걸린 0건 → 필터 0건 빈 상태', async () => {
    const api = personalApi([])
    await open(`/projects/${KEY}?assignee=null`, api, 'personal-empty-filter')
    expect(screen.getByTestId('personal-empty-filter')).toHaveTextContent('일치하는 작업이 없습니다')
    expect(screen.queryByTestId('personal-empty-create')).not.toBeInTheDocument()
  })

  // 필터 없는 빈 프로젝트 → 데이터 없음 안내 + 빠른 추가(헤더와 같은 대화상자).
  test('필터 없는 빈 프로젝트 → 데이터 없음 빈 상태 + 빠른 추가가 대화상자를 연다', async () => {
    const api = personalApi([])
    const { user } = await open(`/projects/${KEY}`, api, 'personal-empty')
    expect(screen.getByTestId('personal-empty')).toHaveTextContent('작업이 없습니다')
    expect(screen.queryByTestId('personal-empty-filter')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('personal-empty-create'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
