// 개인 프로젝트 전용 상세 화면 — 화면 테스트(WP-971, WP-1002 에서 PersonalProjectDetail 만 띄우게 바꿈).
// 뷰 토글·상세 모달(WP-1374)·메모 편집·채팅 서랍·URL(task·chat·필터·그룹) 상태·리다이렉트·빈/오류 상태·행 표시·요청 payload/쿼리 파라미터는
// 브라우저 없이 판정되므로 e2e/pages/projects/personal-project-detail.spec.ts 에서 옮겼다.
// 셸 배선(@wiring)·새로고침 유지(@platform)·Esc 겹침·날짜 칸 키 입력(@input)·모달/서랍 기하와
// 스크롤·무한 로드·글자 변환(@layout)은 E2E 에 남는다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { notifTarget } from '@/components/home/notifTarget'
import IssueDetailPage from '@/pages/projects/IssueDetailPage'
import { PersonalProjectDetail } from '@/pages/projects/personal/PersonalProjectDetail'
import { openQuickFacet } from '@/test/kits/projects/quickFilter'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'
import type { IssueResponse } from '@/types/issue'
import type { IssueRecurrence } from '@/types/issueRecurrence'
import type { NotificationResponse } from '@/types/notification'
import type { UserSummary } from '@/types/user'

import { agentWorker, createAgentWork } from '../../../e2e/factories/agentWork.factory'
import { createChatMember, createChatMessage, createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { systemTypes } from '../../../e2e/factories/issueType.factory'
import { createLabel, toLabelSummary } from '../../../e2e/factories/label.factory'
import { createMember, createProject } from '../../../e2e/factories/project.factory'

// 데스크톱 폭·정밀 포인터(마우스) — 채팅 딥링크가 입력칸에 자동 포커스하는 조건(finePointerStore). 한 파일 = 뷰포트 하나.
mockViewport({ width: 1440, height: 900, pointer: 'fine' })

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
  /** 상세의 내용 수정 권한(viewerCanEditContent) — 기본 true. 메모 편집 가능 여부를 가른다(WP-1374). */
  canEditContent?: boolean
  /** 다음 PATCH 들이 차례로 돌려줄 오류 상태(예: [500]) — 비면 정상 처리. 테스트가 저장 실패를 만든다. */
  patchFailures?: number[]
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
  // 작업별 메모(본문) — PATCH { body } 가 바꾸고 재조회에 반영된다(WP-1374). 기본은 「서론은 짧게」.
  const bodies = new Map<number, string>()
  const detailOf = (it: IssueResponse) =>
    createIssueDetail({ summary: it, body: bodies.get(it.number) ?? '서론은 짧게', viewerCanEditContent: opts.canEditContent ?? true })
  const searches: URLSearchParams[] = []
  const patches: Patch[] = []
  const posts: Record<string, unknown>[] = []
  const detailGets: number[] = []
  const recurrencePuts: Record<string, unknown>[] = []
  let recurrenceDeletes = 0
  let recurrence = opts.recurrence ?? null
  const handlers = [
    // 반복(WP-989) — 상세를 열면 조회한다. 저장·끄기는 기록하고 메모리 값을 바꾼다.
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
    // 담당 AI 후보(WP-1314) — 내 AI 비서 하나(반복 응답의 agentUserId 9 와 같은 AI).
    http.get(`${BASE}/issues/:num/recurrence/agents`, () =>
      HttpResponse.json([{ id: 9, username: 'my-ai', name: 'AI 비서', personalAssistant: true }]),
    ),
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
      return HttpResponse.json(detailOf(it))
    }),
    // 풀페이지 이슈 화면이 리다이렉트 전에 구독자를 부른다.
    http.get(`${BASE}/issues/:num/watchers`, () => HttpResponse.json([])),
    http.patch(`${BASE}/issues/:num`, async ({ request, params }) => {
      const num = Number(params.num)
      const body = (await request.json()) as Record<string, unknown>
      patches.push({ number: num, body })
      const failure = opts.patchFailures?.shift()
      if (failure) return HttpResponse.json({ status: failure, message: '저장 실패' }, { status: failure })
      const it = db.get(num)!
      if (body.version !== undefined && body.version !== it.version) {
        return HttpResponse.json({ status: 409, message: '다른 사용자가 먼저 이 이슈를 수정했습니다' }, { status: 409 })
      }
      const { body: memo, ...fields } = body
      if (typeof memo === 'string') bodies.set(num, memo)
      Object.assign(it, fields, { version: (it.version ?? 0) + 1 })
      return HttpResponse.json(detailOf(it))
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
  // 공유 툴바 setView 는 URL 을 필터+view+group 으로 다시 짠다 — list 는 기본값이라 view= 를 생략한다.
  // (작업 상세는 WP-1374 부터 모달이라 열린 채로는 툴바를 누를 수 없다 — 닫힌 상태에서 본다.)
  test('뷰 토글 → view=board 로 바뀌고, 체크리스트로 돌아오면 view= 가 없다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    await user.click(screen.getByRole('button', { name: '보드' }))
    await waitFor(() => expect(paramsOf(location()).get('view')).toBe('board'))
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

describe('작업 상세 모달(?task=, WP-1374)', () => {
  /** 모달 안의 메모 칸·속성 레일. */
  const modal = () => screen.getByTestId('personal-task-modal')

  // 행 클릭 한 번으로 넓은 모달이 열리고 URL 에 task 가 반영되며 행은 눌림으로 그려진다. 옛 옆 칸(panel)은 없다.
  test('행 클릭 → 넓은 모달 + ?task=1 — 왼쪽 메모, 오른쪽 속성 레일(상태·우선순위·마감·담당자·AI 에게 맡기기·라벨)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    await user.click(screen.getByTestId('personal-task-row-1'))
    expect(await screen.findByTestId('personal-task-modal')).toBeInTheDocument()
    expect(screen.queryByTestId('personal-task-panel')).not.toBeInTheDocument()
    expect(paramsOf(location()).get('task')).toBe('1')
    await waitFor(() => expect(screen.getByTestId('personal-task-row-1')).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => expect(within(modal()).getByTestId('personal-task-panel-title')).toHaveTextContent('블로그 초안'))
    const memo = await within(modal()).findByTestId('personal-task-memo')
    expect(within(memo).getByRole('heading', { name: '메모' })).toBeInTheDocument()
    expect(memo).toHaveTextContent('서론은 짧게')
    const rail = within(modal()).getByTestId('personal-task-rail')
    for (const label of ['상태', '우선순위', '마감', '담당자', 'AI 에게 맡기기', '라벨']) {
      expect(within(rail).getByText(label, { exact: true })).toBeInTheDocument()
    }
  })

  // Esc 로 모달을 닫으면 URL 에서 task 가 빠진다.
  test('Esc 로 모달이 닫히고 URL 에서 task 가 빠진다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await screen.findByTestId('personal-task-memo')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
    expect(paramsOf(location()).get('task')).toBeNull()
  })

  // 머리의 ✕ 도 같은 닫기다.
  test('머리 ✕ 를 누르면 모달이 닫히고 task 가 빠진다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(within(modal()).getByTestId('personal-task-close'))
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
    expect(paramsOf(location()).get('task')).toBeNull()
  })

  // 열린 행은 선택 배경으로 표시한다.
  test('열린 행은 bg-selected 로 표시한다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    expect(await screen.findByTestId('personal-task-row-1')).toHaveClass('bg-selected')
  })

  // 개인 모달은 라벨을 보이고, 팀 전용(사이클·관계·구독)은 감춘다. 채팅은 본문에 두지 않는다 — 머리 버튼이 서랍을 연다.
  test('모달은 라벨 노출 / 사이클·관계·구독·본문 채팅 미노출', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', labels: [LABEL] })])
    await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const m = modal()
    await waitFor(() => expect(within(m).getByTestId('personal-task-rail')).toHaveTextContent('긴급'))
    expect(await within(m).findByTestId('issue-chat-open')).toBeInTheDocument()
    expect(within(m).queryByTestId('chat-composer-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument()
    expect(within(m).queryByText('사이클')).not.toBeInTheDocument()
    expect(within(m).queryByTestId('property-group-relations')).not.toBeInTheDocument()
    expect(within(m).queryByText('관계', { exact: true })).not.toBeInTheDocument()
    expect(within(m).queryByText('구독')).not.toBeInTheDocument()
  })

  // 체크리스트·보드 모두 같은 넓은 모달로 연다(옛: 체크리스트=옆 칸, 보드=좁은 모달).
  test('체크리스트 ?task= 와 보드 ?task= 모두 같은 넓은 모달(옆 칸 없음)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })])
    const first = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    expect(await screen.findByTestId('personal-task-rail')).toBeInTheDocument()
    first.unmount()
    await open(`/projects/${KEY}?view=board&task=1`, personalApi([createIssue({ projectKey: KEY, number: 1, status: 'TODO' })]), 'personal-task-modal')
    expect(await screen.findByTestId('personal-task-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('personal-task-panel')).not.toBeInTheDocument()
  })

  // 보드 카드 링크는 풀페이지(/issues/1)가 아니라 같은 화면의 ?task= 모달로 열고, 걸려 있던 필터는 남긴다(#616).
  test('보드 카드 클릭 → ?task=1 모달(풀페이지 아님), priority 필터 유지 (#616)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '높음작업', status: 'TODO', priority: 'HIGH' })])
    const { user, location } = await open(`/projects/${KEY}?view=board&priority=HIGH`, api, 'issue-card-1')
    await user.click(within(screen.getByTestId('issue-card-1')).getByRole('link'))
    expect(await screen.findByTestId('personal-task-modal')).toBeInTheDocument()
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

  // 없는 작업(404)은 모달 안 안내 + 닫기로 끝난다.
  test('존재하지 않는 task 진입 → 오류 안내, 닫기 누르면 task 가 빠진다', async () => {
    const api = personalApi()
    const { user, location } = await open(`/projects/${KEY}?task=999`, api, 'personal-task-panel-notfound')
    await user.click(within(screen.getByTestId('personal-task-panel-notfound')).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(paramsOf(location()).get('task')).toBeNull())
  })

  // 알림·북마크의 풀페이지 이슈 주소는 개인 프로젝트에선 ?task= 주소로 바뀐다(#207).
  test('개인 프로젝트의 풀페이지 이슈 URL 은 ?task= 모달로 리다이렉트된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { location } = await open(`/projects/${KEY}/issues/1`, api, 'personal-task-modal')
    expect(location()).toBe(`/projects/${KEY}?task=1`)
  })

  // 담당자가 있으면 픽커 트리거가 아이콘 대신 아바타(이니셜·사진)를 그린다(#362).
  test('모달 담당자 픽커 — 담당자가 있으면 아바타를 그린다 (#362)', async () => {
    const me: UserSummary = { id: 1, username: 'testuser', name: '테스트 사용자', kind: 'HUMAN' }
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '담당자있는작업', assignees: [me] })], {
      members: [createMember({ userId: me.id, username: me.username, name: me.name })],
    })
    await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const trigger = await screen.findByTestId('assignee-picker-trigger')
    expect(trigger.querySelector('img') ?? within(trigger).queryByText('테')).not.toBeNull()
  })
})

describe('메모 편집(WP-1374)', () => {
  const memo = () => screen.getByTestId('personal-task-memo')

  // 메모를 누르면 원문 편집칸 → 저장하면 PATCH { body, version(편집 시작 때) } → 보기로 돌아와 새 메모(마크다운)가 보인다.
  test('메모 누르기 → 원문 편집 → 저장 → PATCH { body, version }, 새 메모가 마크다운으로 보인다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', version: 3 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await within(await screen.findByTestId('personal-task-memo')).findByRole('button', { name: '메모 편집' }))
    const textarea = within(memo()).getByTestId('issue-body-textarea')
    expect(textarea).toHaveValue('서론은 짧게')
    await user.clear(textarea)
    await user.paste('**결론** 먼저\n\n- 하나')
    await user.click(within(memo()).getByTestId('issue-body-save'))
    await waitFor(() => expect(api.patches.map((p) => p.body)).toEqual([{ body: '**결론** 먼저\n\n- 하나', version: 3 }]))
    const view = await within(memo()).findByRole('button', { name: '메모 편집' })
    await waitFor(() => expect(view.querySelector('strong')).toHaveTextContent('결론'))
    expect(within(view).getByRole('listitem')).toHaveTextContent('하나')
    expect(screen.getByTestId('personal-task-modal')).toBeInTheDocument()
  })

  // 메모를 쓰다 상태를 바꿔도(내 저장으로 version 이 오름) 스스로와 충돌하지 않는다 — 편집 기준 version 이 함께 오른다(#611).
  test('메모 편집 중 상태를 바꾼 뒤 저장해도 409 없이 새 version 으로 저장된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO', version: 3 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await within(await screen.findByTestId('personal-task-memo')).findByRole('button', { name: '메모 편집' }))
    // 상태를 「진행 중」으로 — 속성 레일의 상태 선택.
    await user.click(within(screen.getByTestId('personal-task-rail')).getByTestId('issue-status-select'))
    await user.click(await screen.findByRole('option', { name: /진행 중/ }))
    await waitFor(() => expect(api.patches).toHaveLength(1))
    expect(api.patches[0].body).toMatchObject({ version: 3 })
    const textarea = within(memo()).getByTestId('issue-body-textarea')
    await user.type(textarea, ' 추가')
    await user.click(within(memo()).getByTestId('issue-body-save'))
    await waitFor(() => expect(api.patches).toHaveLength(2))
    expect(api.patches[1].body).toEqual({ body: '서론은 짧게 추가', version: 4 })
    expect(screen.queryByText('다른 사용자가 먼저 이 이슈를 수정했습니다')).not.toBeInTheDocument()
  })

  // 편집칸의 Esc 는 편집 취소 몫 — 모달은 그대로 남고 요청도 없다. 다음 Esc 가 모달을 닫는다.
  test('메모 편집칸에서 Esc → 편집만 취소되고 모달은 남는다, 다음 Esc 에 모달이 닫힌다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await within(await screen.findByTestId('personal-task-memo')).findByRole('button', { name: '메모 편집' }))
    await user.type(within(memo()).getByTestId('issue-body-textarea'), ' 고침')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(within(memo()).queryByTestId('issue-body-textarea')).not.toBeInTheDocument())
    expect(screen.getByTestId('personal-task-modal')).toBeInTheDocument()
    expect(paramsOf(location()).get('task')).toBe('1')
    expect(api.patches).toEqual([])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
  })

  // 409 가 아닌 실패(500)는 편집 기준 version 을 지킨다(팀 이슈 상세와 같다). 편집하는 사이 다른 사람이 메모를 바꿔 화면이 version 4 를
  // 불러왔어도, 다시 저장은 편집 시작 때의 3 으로 보내 409 로 알게 한다 — 기준을 풀어 버리면 화면의 4 로 보내 그 변경을 덮어쓴다.
  test('메모 저장이 500 으로 실패해도 편집 기준 version 을 지켜, 그 사이 바뀐 메모를 덮어쓰지 않는다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', version: 3 })], { patchFailures: [500] })
    const { user, queryClient } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await within(await screen.findByTestId('personal-task-memo')).findByRole('button', { name: '메모 편집' }))
    await user.type(within(memo()).getByTestId('issue-body-textarea'), ' 추가')
    // 그 사이 다른 사람(AI)이 메모를 바꿔 version 4 — 화면이 다시 불러온다.
    const fetched = api.detailGets.length
    api.db.get(1)!.version = 4
    await act(() => queryClient.invalidateQueries())
    await waitFor(() => expect(api.detailGets.length).toBeGreaterThan(fetched))
    await user.click(within(memo()).getByTestId('issue-body-save'))
    await waitFor(() => expect(api.patches).toHaveLength(1))
    expect(await within(memo()).findByTestId('issue-body-textarea')).toHaveValue('서론은 짧게 추가')
    await user.click(within(memo()).getByTestId('issue-body-save'))
    await waitFor(() => expect(api.patches).toHaveLength(2))
    expect(api.patches.map((p) => p.body)).toEqual([
      { body: '서론은 짧게 추가', version: 3 },
      { body: '서론은 짧게 추가', version: 3 },
    ])
  })

  // 고친 메모를 저장하지 않고 닫으려 하면(✕·Esc) 먼저 묻는다 — 「계속 쓰기」는 모달·입력을 그대로 두고, 「버리고 닫기」는 요청 없이 닫는다.
  test('고친 메모를 두고 ✕·Esc 로 닫으려 하면 확인을 묻고, 계속 쓰기는 입력을 지키며 버리고 닫기는 요청 없이 닫는다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await within(await screen.findByTestId('personal-task-memo')).findByRole('button', { name: '메모 편집' }))
    await user.type(within(memo()).getByTestId('issue-body-textarea'), ' 고침')
    // ✕ — 확인 창, 모달·task 는 그대로.
    await user.click(screen.getByTestId('personal-task-close'))
    const confirm = await screen.findByTestId('personal-task-discard-dialog')
    expect(confirm).toHaveTextContent('저장하지 않은 메모를 버릴까요?')
    expect(paramsOf(location()).get('task')).toBe('1')
    await user.click(within(confirm).getByTestId('personal-task-discard-keep'))
    await waitFor(() => expect(screen.queryByTestId('personal-task-discard-dialog')).not.toBeInTheDocument())
    expect(within(memo()).getByTestId('issue-body-textarea')).toHaveValue('서론은 짧게 고침')
    // 편집칸 밖(닫기 단추)에서 누른 Esc 도 같은 확인을 띄운다.
    act(() => screen.getByTestId('personal-task-close').focus())
    await user.keyboard('{Escape}')
    await user.click(within(await screen.findByTestId('personal-task-discard-dialog')).getByTestId('personal-task-discard-confirm'))
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
    expect(paramsOf(location()).get('task')).toBeNull()
    expect(api.patches).toEqual([])
  })

  // 바깥(dim) 클릭도 같은 확인 — 메모를 고치지 않았으면 묻지 않고 바로 닫는다.
  test('고친 메모를 두고 바깥을 누르면 확인을 묻고, 고치지 않았으면 바로 닫힌다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await within(await screen.findByTestId('personal-task-memo')).findByRole('button', { name: '메모 편집' }))
    await user.type(within(memo()).getByTestId('issue-body-textarea'), ' 고침')
    fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!)
    expect(await screen.findByTestId('personal-task-discard-dialog')).toBeInTheDocument()
    await user.click(screen.getByTestId('personal-task-discard-keep'))
    // 편집을 취소(Esc)해 고친 것이 없어지면 바깥 클릭은 묻지 않고 닫는다.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(within(memo()).queryByTestId('issue-body-textarea')).not.toBeInTheDocument())
    fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!)
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
    expect(screen.queryByTestId('personal-task-discard-dialog')).not.toBeInTheDocument()
    expect(paramsOf(location()).get('task')).toBeNull()
  })

  // 내용 수정 권한이 없으면(viewerCanEditContent=false) 메모를 눌러도 편집칸이 열리지 않는다 — 팀 이슈 본문과 같은 권한.
  test('내용 수정 권한이 없으면 메모 편집이 비활성이다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })], { canEditContent: false })
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const view = await within(await screen.findByTestId('personal-task-memo')).findByRole('button', { name: '메모 편집' })
    expect(view).toHaveAttribute('aria-disabled', 'true')
    await user.click(view)
    expect(within(memo()).queryByTestId('issue-body-textarea')).not.toBeInTheDocument()
  })
})

describe('채팅 서랍(WP-1374 — WP-1372 링크·알림 진입 보존)', () => {
  const drawer = () => screen.getByTestId('issue-chat-drawer')
  const drawerInput = () => within(drawer()).getByTestId('chat-composer-input')

  /** 다른 사람의 메시지(id 5) 1건이 있는 읽지 않은 스레드. */
  function withUnreadThread(api: ReturnType<typeof personalApi>) {
    const thread = createChatThread({
      members: [createChatMember({ userId: 1, lastReadMessageId: null })],
      recentMessages: [createChatMessage({ id: 5, threadId: 100, authorId: 99, authorName: '아키', authorKind: 'AGENT', body: '확인 부탁드려요' })],
    })
    api.handlers.unshift(
      http.get(`${BASE}/issues/1/chat/thread`, () => HttpResponse.json(thread)),
      http.get('/api/v1/chat/threads/100/messages', () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
      http.post('/api/v1/chat/threads/100/read', () => new HttpResponse(null, { status: 204 })),
    )
  }

  // 머리의 채팅 버튼 — 팀 이슈와 같은 버튼·읽지 않은 수. 누르면 모달 위 오른쪽 서랍이 열리고 주소에 chat=1, 배지는 사라진다.
  test('머리 채팅 버튼 — 읽지 않은 수를 보이고, 누르면 서랍이 열리며 ?chat=1, 모달은 남는다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    withUnreadThread(api)
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const header = screen.getByTestId('personal-task-panel-title').parentElement!
    const button = await within(header).findByTestId('issue-chat-open')
    await waitFor(() => expect(within(button).getByTestId('issue-chat-unread-badge')).toHaveTextContent('1'))
    expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument()
    await user.click(button)
    expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
    expect(await within(drawer()).findByText('확인 부탁드려요')).toBeInTheDocument()
    expect([paramsOf(location()).get('task'), paramsOf(location()).get('chat')]).toEqual(['1', '1'])
    expect(screen.getByTestId('personal-task-modal')).toBeInTheDocument()
    await waitFor(() => expect(within(button).queryByTestId('issue-chat-unread-badge')).not.toBeInTheDocument())
  })

  // ESC 는 위에 있는 것부터 — 첫 Esc 는 서랍만 닫아 chat 만 빠지고 모달로 돌아온다. 다음 Esc 가 모달을 닫는다.
  // (닫힌 뒤 포커스가 채팅 버튼으로 돌아오는지는 jsdom 의 중첩 포커스 가둠으로 판정되지 않아 E2E @input 이 본다.)
  test('서랍이 열린 채 Esc → 서랍만 닫혀 chat 만 빠지고 모달은 남는다, 다음 Esc 에 모달이 닫힌다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    withUnreadThread(api)
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await screen.findByTestId('issue-chat-open'))
    await waitFor(() => expect(drawerInput()).toHaveFocus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument())
    expect(screen.getByTestId('personal-task-modal')).toBeInTheDocument()
    expect([paramsOf(location()).get('task'), paramsOf(location()).get('chat')]).toEqual(['1', null])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
    expect(paramsOf(location()).get('task')).toBeNull()
  })

  // 알림·「내 AI 작업」의 채팅 링크(/issues/N?chat=1) → 리다이렉트가 chat 을 이어 줘 모달 + 서랍이 함께 열린다(WP-1372 동작 보존).
  // 처음부터 열린 서랍을 닫으면(✕) chat 만 지운다 — 출발 화면으로 되돌아가 모달까지 닫히지 않는다.
  test('/issues/1?chat=1 진입 → ?task=1&chat=1 모달 + 서랍(입력칸 포커스), 서랍 ✕ 는 chat 만 지우고 모달은 남는다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    withUnreadThread(api)
    const { user, location } = await open(`/projects/${KEY}/issues/1?chat=1`, api, 'personal-task-modal')
    expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}?task=1&chat=1`)
    await waitFor(() => expect(drawerInput()).toHaveFocus())
    await user.click(within(drawer()).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument())
    expect(location()).toBe(`/projects/${KEY}?task=1`)
    expect(screen.getByTestId('personal-task-modal')).toBeInTheDocument()
  })

  // 앱 안 링크(알림 목록 등 이전 화면이 있는 상태)로 들어온 서랍도 닫으면 chat 만 지운다 — 팀 이슈 서랍처럼 출발 화면으로 되돌아가면
  // 모달까지 함께 닫혀 버린다. 이전 화면(/projects/PME)에서 채팅 링크로 이동(push)한 상황을 브라우저 히스토리로 만든다.
  test('이전 화면에서 채팅 링크로 들어와 서랍을 닫으면 출발 화면으로 되돌아가지 않고 chat 만 지운다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    withUnreadThread(api)
    const { user, location } = await open(`/projects/${KEY}`, api, 'personal-task-row-1')
    act(() => {
      window.history.pushState({ usr: null, key: 'link', idx: 1 }, '', `/projects/${KEY}/issues/1?chat=1`)
      window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
    })
    expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}?task=1&chat=1`)
    await user.click(within(drawer()).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument())
    expect(location()).toBe(`/projects/${KEY}?task=1`)
    expect(screen.getByTestId('personal-task-modal')).toBeInTheDocument()
  })

  // chat 이 없으면 서랍 없이 모달만 연다(회귀).
  test('chat 없이 /issues/1 진입 → ?task=1 모달만, 서랍은 열리지 않는다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { location } = await open(`/projects/${KEY}/issues/1`, api, 'personal-task-modal')
    expect(await screen.findByTestId('personal-task-memo')).toBeInTheDocument()
    expect(location()).toBe(`/projects/${KEY}?task=1`)
    expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument()
  })

  // 이슈챗 알림(AI 질문)의 이동 주소도 같은 길 — 모달 + 서랍.
  test('이슈챗 알림 주소로 진입 → 모달 + 서랍', async () => {
    const target = notifTarget({ type: 'AI_QUESTION', projectKey: KEY, issueNumber: 1 } as NotificationResponse)
    expect(target).toBe(`/projects/${KEY}/issues/1?chat=1`)
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    withUnreadThread(api)
    await open(target, api, 'personal-task-modal')
    expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
    expect(await within(drawer()).findByText('확인 부탁드려요')).toBeInTheDocument()
  })

  // 보드도 같은 딥링크 — 모달 + 서랍, 보드·task 는 남는다.
  test('보드 ?task=1&chat=1 → 모달 + 서랍, view·task 유지', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO' })])
    withUnreadThread(api)
    const { location } = await open(`/projects/${KEY}?view=board&task=1&chat=1`, api, 'personal-task-modal')
    expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
    expect([paramsOf(location()).get('view'), paramsOf(location()).get('task'), paramsOf(location()).get('chat')]).toEqual(['board', '1', '1'])
  })

  // 없는 작업(404)이면 서랍을 열 수 없으므로 chat 을 지운다 — 남겨 두면 다음에 여는 작업(task 만 바꾼다)에 묻어 엉뚱하게 서랍이 열린다.
  test('없는 작업 ?task=999&chat=1 → 오류 안내와 함께 chat 이 빠지고, 다른 작업을 열어도 서랍은 열리지 않는다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=999&chat=1`, api, 'personal-task-panel-notfound')
    await waitFor(() => expect(paramsOf(location()).get('chat')).toBeNull())
    expect(paramsOf(location()).get('task')).toBe('999')
    expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument()
    await user.click(within(screen.getByTestId('personal-task-panel-notfound')).getByRole('button', { name: '닫기' }))
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
    await user.click(await screen.findByTestId('personal-task-row-1'))
    expect(await screen.findByTestId('personal-task-memo')).toBeInTheDocument()
    expect(paramsOf(location()).get('chat')).toBeNull()
    expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument()
  })

  // AI 진행 카드 — agentWork 가 있으면 메모 위에 보이고, 「답변 필요」 배지가 채팅 서랍을 연다. 없으면 카드가 없다.
  test('AI 진행 카드 — 진행 중 작업이 있으면 메모 위에 보이고 「답변 필요」 배지는 서랍을 연다, 없으면 카드 없음', async () => {
    const api = personalApi([
      createIssue({ projectKey: KEY, number: 1, title: '질문 받은 작업', agentWork: [createAgentWork({ worker: agentWorker, state: 'INPUT_REQUIRED' })] }),
      createIssue({ projectKey: KEY, number: 2, title: '평범한 작업' }),
    ])
    const { user, location, unmount } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const card = await within(await screen.findByTestId('personal-task-memo')).findByTestId('agent-work-card')
    expect(card).toHaveTextContent(agentWorker.name)
    await user.click(within(card).getByTestId(`agent-work-${agentWorker.id}-state`))
    expect(await screen.findByTestId('issue-chat-drawer')).toBeInTheDocument()
    expect(paramsOf(location()).get('chat')).toBe('1')
    unmount()
    await open(`/projects/${KEY}?task=2`, api, 'personal-task-modal')
    expect(await screen.findByTestId('personal-task-memo')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-work-card')).not.toBeInTheDocument()
  })
})

describe('AI 에게 맡기기(WP-989, WP-1314)', () => {
  test('모달에 「AI 에게 맡기기」 칸 — 없으면 「안 함」, 담당 AI 는 내 AI 비서, 매주 월·수 08:30 을 고르면 PUT 하고 요약·다음 실행이 보인다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '주간 보고' })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const panel = screen.getByTestId('personal-task-modal')
    expect(await within(panel).findByText('AI 에게 맡기기', { exact: true })).toBeInTheDocument()
    const trigger = await within(panel).findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(trigger).toHaveTextContent('안 함')

    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    expect(pop).toHaveTextContent('설명이 AI 에게 주는 지시가 됩니다')
    await waitFor(() => expect(within(pop).getByRole('combobox', { name: '담당 AI' })).toHaveTextContent('AI 비서 (내 AI 비서)'))
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

    await waitFor(() => expect(api.recurrencePuts).toEqual([{ rrule: 'FREQ=WEEKLY;BYDAY=MO,WE', time: '08:30', agentUserId: 9 }]))
    await waitFor(() => expect(api.detailGets.length).toBeGreaterThan(before.detail))
    await waitFor(() => expect(api.searches.length).toBeGreaterThan(before.list))
    await waitFor(() => expect(screen.queryByTestId('task-recurrence-popover')).not.toBeInTheDocument())
    expect(within(panel).getByTestId('task-recurrence-trigger')).toHaveAccessibleName('AI 에게 맡기기: AI 비서 · ↻ 매주 월·수 08:30')
    expect(within(panel).getByTestId('task-recurrence-status')).toHaveTextContent('다음 실행 10/29(목) 08:30')
  })

  test('실행 일정 조회가 실패하면 「안 함」 대신 실패 안내 — 편집 버튼 없음, 다시 시도로 회복한다', async () => {
    const fail = { on: true }
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })], {
      failRecurrenceGet: fail,
      recurrence: recurrenceOf({ rrule: 'FREQ=DAILY' }),
    })
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const err = await screen.findByTestId('task-recurrence-error-state')
    expect(err).toHaveTextContent('실행 일정을 불러오지 못했어요')
    expect(screen.queryByTestId('task-recurrence-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText('안 함')).not.toBeInTheDocument()
    fail.on = false
    await user.click(within(err).getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByTestId('task-recurrence-trigger')).toHaveTextContent('매일 08:30')
  })

  test('매월 29~31일을 고르면 「그 날짜가 없는 달은 건너뜁니다」, 28일 이하는 안내 없음', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
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
    await waitFor(() => expect(api.recurrencePuts).toEqual([{ rrule: 'FREQ=MONTHLY;BYMONTHDAY=31', time: '09:00', agentUserId: 9 }]))
  })

  test('요일을 모두 끄고 저장하면 요청 없이 「요일을 하나 이상 고르세요」', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
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
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const trigger = await screen.findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toBeEnabled())
    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    await user.click(within(pop).getByRole('button', { name: '매일' }))
    await user.click(within(pop).getByRole('button', { name: '저장' }))
    expect(await screen.findByText('쓸 수 있는 AI 비서가 없습니다 — 개인 비서를 연결하거나 관리자에게 공통 비서 지정을 요청하세요')).toBeInTheDocument()
    expect(api.recurrencePuts).toEqual([{ rrule: 'FREQ=DAILY', time: '09:00', agentUserId: 9 }])
    expect(screen.getByTestId('task-recurrence-popover')).toBeInTheDocument()
    expect(trigger).toHaveTextContent('안 함')
  })

  test('3회 연속 실패로 멈춘 반복은 「멈춤 — 3회 연속 실패」, 「일정 끄기」는 DELETE 하고 「안 함」으로', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1 })], {
      recurrence: recurrenceOf({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', enabled: false, consecutiveFailures: 3 }),
    })
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const trigger = await screen.findByTestId('task-recurrence-trigger')
    await waitFor(() => expect(trigger).toHaveTextContent('매월 15일 08:30'))
    expect(screen.getByTestId('task-recurrence-status')).toHaveTextContent('멈춤 — 3회 연속 실패')
    await user.click(trigger)
    const pop = await screen.findByTestId('task-recurrence-popover')
    // 편집기는 지금 규칙으로 시작한다.
    expect(within(pop).getByRole('button', { name: '매월' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(pop).getByLabelText('날짜')).toHaveValue(15)
    await user.click(within(pop).getByRole('button', { name: '일정 끄기' }))
    await waitFor(() => expect(api.deletes()).toBe(1))
    await waitFor(() => expect(screen.getByTestId('task-recurrence-trigger')).toHaveTextContent('안 함'))
    expect(screen.queryByTestId('task-recurrence-status')).not.toBeInTheDocument()
  })
})

describe('편집·완료 토글', () => {
  // 체크 = 완료 토글. 행 클릭과 분리돼 모달을 열지 않고, 무효화 재조회로 행이 완료 섹션으로 옮겨 취소선으로 그려진다(WP-918).
  test('체크 토글 → PATCH { status: DONE }, 모달은 열리지 않고 행이 완료 섹션으로 옮겨진다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '운동 계획', status: 'TODO', dueDate: null })])
    const { user } = await open(`/projects/${KEY}`, api, 'personal-task-check-1')
    expect(screen.getByTestId('personal-section-noDue')).toBeInTheDocument()
    await user.click(screen.getByTestId('personal-task-check-1'))
    await waitFor(() => expect(api.patches.map((p) => p.body)).toEqual([{ status: 'DONE' }]))
    expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('personal-section-noDue')).not.toBeInTheDocument())
    await user.click(within(screen.getByTestId('personal-section-done')).getByRole('button'))
    const row = await within(screen.getByTestId('personal-section-done')).findByTestId('personal-task-row-1')
    expect(row.querySelector('.line-through')).toHaveTextContent('운동 계획')
  })

  // #611 — 상세를 보고 있지 않아도 409 뒤 상세를 다시 불러 옛 version 을 버리고, 다음 토글은 새 version 으로 성공한다.
  test('체크리스트 토글이 409 로 충돌하면 최신 version 을 다시 불러와 다음 토글은 성공한다 (#611)', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안', status: 'TODO', version: 1 })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    // 모달을 한 번 열어 상세 캐시(version 1)를 채운 뒤 닫는다.
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('personal-task-modal')).not.toBeInTheDocument())
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

  // 개인 작업은 풀페이지가 막혀 있어 모달(#718)이 유일한 편집 경로 — 제목 연필 → Enter → PATCH { title }, 모달과 뒤 목록이 함께 갱신된다.
  test('모달 제목 연필 → 인라인 편집 → PATCH { title }, 모달 제목과 체크리스트 행이 갱신된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const panel = screen.getByTestId('personal-task-modal')
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
  // 제목을 고치던 중 바깥(dim)을 눌러 닫아도 고친 제목은 저장된다 — 닫기 전에 입력칸을 blur 해 제목의 blur 저장을 태운다.
  // (pointerdown 으로 바로 닫혀, 입력칸이 blur 를 받기 전에 사라지면 제목이 소리 없이 없어졌다.)
  test('모달 제목을 고치던 중 바깥을 눌러 닫아도 PATCH { title } 로 저장된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user, location } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    await user.click(await within(screen.getByTestId('personal-task-panel-title')).findByTestId('issue-title-edit'))
    const input = within(screen.getByTestId('personal-task-panel-title')).getByRole('textbox')
    await user.clear(input)
    await user.paste('바깥 닫기 제목')
    fireEvent.pointerDown(document.querySelector('[data-slot="dialog-overlay"]')!)
    await waitFor(() => expect(paramsOf(location()).get('task')).toBeNull())
    await waitFor(() => expect(api.patches.map((p) => p.body)).toEqual([expect.objectContaining({ title: '바깥 닫기 제목' })]))
  })

  test('모달 제목 편집 — 공백 제목은 PATCH 없이 원복된다', async () => {
    const api = personalApi([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])
    const { user } = await open(`/projects/${KEY}?task=1`, api, 'personal-task-modal')
    const panel = screen.getByTestId('personal-task-modal')
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
    const header = within(screen.getByTestId('page-header'))
    // 머리의 「설정」 링크는 설정 화면으로 간다(WP-1362). 링크 안 버튼 중첩 없이 링크 하나다(WP-1435).
    expect(header.getByRole('link', { name: '설정' })).toHaveAttribute('href', `/projects/${KEY}/settings`)
    expect(header.queryByRole('button', { name: '설정' })).not.toBeInTheDocument()
    await user.click(header.getByRole('button', { name: /빠른 추가/ }))
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
    await user.click(screen.getByRole('textbox', { name: '태스크 필터: 제목·키' }))
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
