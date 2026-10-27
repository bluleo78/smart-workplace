// 모바일 이슈 상세(WP-196) — 페이지 테스트(WP-981).
// 속성 칩의 문구·접근 이름·조건부 렌더, 칩 시트에서 고른 값의 PATCH/PUT payload, ＋ 속성 시트 구성·권한 안내,
// 제목·본문 편집 바의 저장/취소 요청 횟수는 브라우저 없이 판정되므로 e2e/pages/mobile/issue-detail.spec.ts 에서 옮겼다.
// 칩 줄 위치·넘침·말줄임·팝오버 위치·키보드 위 하단 바(@layout), 포커스 유지·IME·파일 선택(@input)은 E2E 에 남는다.
// 앱 셸을 보지 않으므로 이슈 상세 화면만 renderScreen 으로 띄운다(WP-1002).
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { renderMobileRoute } from '@/test/kits/mobile/mobileScreen'
import { mockViewport } from '@/test/viewport'
import type { IssueDetailResponse, IssueResponse } from '@/types/issue'

import { createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { makeEpicType, makeSubtaskType, makeTaskType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { statusFieldsOf } from '../../../e2e/factories/projectStatus.factory'
import IssueDetailPage from '../projects/IssueDetailPage'

// 휴대폰 폭·터치 포인터 — 모바일 상세(칩 줄·시트)로 그려지게 한다. 파일 안 첫 렌더 전에 한 번.
mockViewport()

const KEY = 'WP'
const BASE = `/api/v1/projects/${KEY}/issues/7`
type Call = { method: string; path: string; body: unknown }

const EPIC = createIssue({
  id: 50, number: 50, projectKey: KEY, type: makeEpicType(), childCount: 3, childDoneCount: 1,
  title: '결제 시스템 전면 개편 에픽 — 칩에서 말줄임되는지 확인하는 아주 긴 제목',
})
const MEMBERS = [
  { userId: 1, name: '양동희', username: 'dh.yang@iacloud.kr', kind: 'HUMAN' },
  { userId: 2, name: '김개발', username: 'dev.kim@iacloud.kr', kind: 'HUMAN' },
]

type Opts = {
  over?: Partial<IssueResponse>
  /** 상세 응답의 권한 플래그 등 — 비멤버 화면(WP-503)에서 viewerCanEditWorkflow 를 끈다. */
  detailOver?: Partial<IssueDetailResponse>
  /** 에픽 목록(부모 필터 없는 검색) 응답 — 지연·교체용. */
  epicList?: () => Promise<IssueResponse[]> | IssueResponse[]
  extra?: RequestHandler[]
}

/**
 * 이슈 7 상세 + 주변 API(MSW). PATCH 는 상세 응답에 반영해 재조회에도 유지된다.
 * calls 는 쓰기 요청(이슈 생성 POST · 상세 PATCH · 담당자/에픽/보고자) 기록이다 — E2E mockDetail 과 같은 범위.
 */
function detailApi({ over = {}, detailOver = {}, epicList, extra = [] }: Opts = {}) {
  let issue = createIssue({
    id: 7, number: 7, projectKey: KEY, type: makeTaskType(), status: 'TODO', priority: 'MID',
    title: '모바일 상세에서 속성을 첫 화면에 보여주기',
    assignees: [{ id: 1, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' }],
    ...over,
  })
  let body = '본문 첫 줄'
  const calls: Call[] = []
  const record = async (request: Request) => {
    const text = await request.clone().text()
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : null
    calls.push({ method: request.method, path: new URL(request.url).pathname, body: json })
    return json
  }
  const handlers = [
    ...extra,
    http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY }))),
    http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
    http.get(`/api/v1/projects/${KEY}/members`, () => HttpResponse.json(MEMBERS)),
    http.get(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
      const isChildren = new URL(request.url).searchParams.has('parent')
      if (isChildren) return HttpResponse.json(createIssueSearchResponse([], null))
      return HttpResponse.json(createIssueSearchResponse(epicList ? await epicList() : [EPIC], null))
    }),
    http.post(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
      await record(request)
      return HttpResponse.json(createIssue({ id: 99, number: 99, projectKey: KEY, title: 'new' }))
    }),
    http.get(BASE, () => HttpResponse.json(createIssueDetail({ summary: issue, body, ...detailOver }))),
    http.patch(BASE, async ({ request }) => {
      const patch = (await record(request)) as Partial<IssueResponse> & { body?: string }
      // 상태는 statusId 로 온다(WP-808) — 서버처럼 범주·이름까지 맞춘다.
      const { body: nextBody, ...rest } = patch
      issue = { ...issue, ...rest, ...(patch.statusId != null ? statusFieldsOf(patch.statusId) : {}) }
      if (nextBody != null) body = nextBody
      return HttpResponse.json(createIssueDetail({ summary: issue, body, ...detailOver }))
    }),
    http.put(`${BASE}/assignees`, async ({ request }) => {
      await record(request)
      return HttpResponse.json([])
    }),
    http.all(`${BASE}/parent`, async ({ request }) => {
      await record(request)
      return HttpResponse.json(createIssueDetail({ summary: issue, body }))
    }),
    http.get(`${BASE}/chat/thread`, () => HttpResponse.json(createChatThread({ threadId: 999, recentMessages: [] }))),
    ...['watchers', 'labels', 'attachments', 'drive-links'].map((s) => http.get(`${BASE}/${s}`, () => HttpResponse.json([]))),
    // 에픽 하위 목록(WP-1038) — 에픽 이슈 상세가 부른다.
    http.get(`${BASE}/children`, () => HttpResponse.json({ items: [], hiddenCount: 0 })),
    http.get('/api/v1/issues/7/comments', () => HttpResponse.json([])),
    http.get('/api/v1/drive/spaces', () => HttpResponse.json([{ id: 1, type: 'PERSONAL', name: '내 드라이브' }])),
  ]
  return { handlers, calls }
}

/** 상세를 열고 제목이 뜰 때까지 기다린다. */
async function open(opts: Opts = {}) {
  const api = detailApi(opts)
  const view = renderMobileRoute('/projects/:key/issues/:number', <IssueDetailPage />, { path: `/projects/${KEY}/issues/7`, handlers: api.handlers })
  await screen.findByTestId('issue-title-heading')
  await screen.findByTestId('mobile-prop-chips')
  const patches = () => api.calls.filter((c) => c.method === 'PATCH')
  return { ...view, calls: api.calls, patches }
}

const blockedBy = [{ number: 3, title: '선행 작업', status: 'IN_PROGRESS', dueDate: null }] as IssueResponse['blockedBy']

describe('속성 칩 — 문구·조건부 렌더', () => {
  // 칩 문구·접근 이름(WP-853)은 렌더 결과라 jsdom 에서 판정된다. 칩 줄 위치·넘침은 E2E(@layout)가 본다.
  test('상태·담당자·우선순위·마감·에픽·＋ 속성 칩, 접근 이름에 보이는 값이 붙는다', async () => {
    await open({ over: { parent: { number: 50, title: EPIC.title, type: makeEpicType() }, dueDate: '2026-10-20' } })
    const chips = screen.getByTestId('mobile-prop-chips')
    for (const k of ['status', 'assignee', 'priority', 'due', 'epic', 'more']) {
      expect(within(chips).getByTestId(`mobile-prop-${k}`)).toBeInTheDocument()
    }
    expect(within(chips).getByTestId('mobile-prop-status')).toHaveTextContent('할 일')
    expect(within(chips).getByRole('button', { name: '상태: 할 일' })).toBeInTheDocument()
    expect(within(chips).getByRole('button', { name: `에픽: ${EPIC.title}` })).toBeInTheDocument()
    expect(within(chips).getByTestId('mobile-prop-due')).toHaveTextContent('10')
  })

  // WP-649 — 마감 지난 미완료 이슈는 경고 톤·「· 지남」·접근 이름 「마감 지남」.
  test('마감 지난 미완료 이슈는 마감 칩이 경고 톤 + 「· 지남」, 이름에도 「마감 지남」', async () => {
    await open({ over: { dueDate: '2020-01-15' } })
    const due = screen.getByTestId('mobile-prop-due')
    expect(due).toHaveTextContent('1월 15일')
    expect(within(due).getByTestId('issue-overdue-badge')).toHaveTextContent('· 지남')
    expect(due).toHaveAttribute('aria-label', '마감일: 1월 15일, 마감 지남')
    expect(due.className).toMatch(/text-destructive/)
  })

  // 차단 표시는 상태 칩에 합쳐진다(별도 칩 없음) — 담당자 칩 이름에 +N. +N 잘림 여부는 E2E(@layout).
  test('차단됨은 상태 칩에 합쳐지고, 담당자 칩 이름에 첫 담당자 +N', async () => {
    await open({
      over: {
        blocked: true,
        blockedBy,
        assignees: [
          { id: 1, username: 'a', name: '아주긴이름을가진담당자홍길동선생님', kind: 'HUMAN' },
          { id: 2, username: 'b', name: '김개발', kind: 'HUMAN' },
          { id: 3, username: 'c', name: '이기획', kind: 'HUMAN' },
        ],
      },
    })
    const status = screen.getByTestId('mobile-prop-status')
    expect(within(status).getByTestId('issue-blocked-badge')).toHaveTextContent('· 차단됨')
    expect(status).toHaveAttribute('aria-label', '상태: 할 일, 차단됨')
    expect(screen.getAllByTestId('issue-blocked-badge')).toHaveLength(1)
    expect(screen.getByTestId('mobile-prop-assignee')).toHaveAttribute('aria-label', '담당자: 아주긴이름을가진담당자홍길동선생님 +2')
    expect(within(screen.getByTestId('mobile-prop-assignee')).getByText('+2', { exact: true })).toBeInTheDocument()
  })

  // WP-725 — 해석할 수 없는 마감일(+10000-01-01)은 「잘못된 날짜」, 시트의 지우기로 고칠 수 있다.
  test('해석할 수 없는 마감일은 「잘못된 날짜」로 보이고 시트에서 지우면 clearDueDate', async () => {
    const { user, patches } = await open({ over: { dueDate: '+10000-01-01' } })
    const due = screen.getByTestId('mobile-prop-due')
    expect(due).toHaveTextContent('잘못된 날짜')
    await user.click(due)
    await user.click(await screen.findByTestId('issue-due-sheet-clear'))
    await waitFor(() => expect(patches().some((c) => (c.body as { clearDueDate?: boolean }).clearDueDate === true)).toBe(true))
  })

  test('에픽 이슈에는 에픽 칩이 없다', async () => {
    await open({ over: { type: makeEpicType() } })
    expect(screen.getByTestId('mobile-prop-status')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-prop-epic')).not.toBeInTheDocument()
  })

  test('서브태스크 이슈에는 에픽 칩이 없다', async () => {
    await open({ over: { type: makeSubtaskType(), parent: { number: 3, title: '부모 태스크', type: makeTaskType() } } })
    expect(screen.getByTestId('mobile-prop-status')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-prop-epic')).not.toBeInTheDocument()
  })
})

describe('속성 칩 — 시트 → 요청', () => {
  // 상태 시트 선택지는 프로젝트 상태(시드 「완료」 id 3, WP-808) — statusId 로 보내고 칩이 바로 바뀐다.
  test('상태 칩 → 시트에서 완료 → PATCH statusId, 칩이 「완료」', async () => {
    const { user, patches } = await open()
    await user.click(screen.getByTestId('mobile-prop-status'))
    await user.click(within(await screen.findByTestId('issue-status-sheet')).getByTestId('picker-option-3'))
    await waitFor(() => expect(patches()[0]?.body).toMatchObject({ statusId: 3 }))
    await waitFor(() => expect(screen.getByTestId('mobile-prop-status')).toHaveTextContent('완료'))
  })

  test('미완료 선행 이슈가 있으면 완료 전환 전에 확인하고, 확인해야 PATCH', async () => {
    const { user, patches } = await open({ over: { blocked: true, blockedBy } })
    await user.click(screen.getByTestId('mobile-prop-status'))
    await user.click(await screen.findByTestId('picker-option-3'))
    expect(await screen.findByTestId('status-done-blocked-dialog')).toBeInTheDocument()
    expect(patches()).toHaveLength(0)
    await user.click(screen.getByTestId('status-done-blocked-confirm'))
    await waitFor(() => expect(patches()[0]?.body).toMatchObject({ statusId: 3 }))
  })

  test('우선순위·마감 칩 — 선택/오늘/지우기가 PATCH 로 반영', async () => {
    const { user, patches } = await open({ over: { dueDate: '2026-10-20' } })
    await user.click(screen.getByTestId('mobile-prop-priority'))
    await user.click(within(await screen.findByTestId('issue-priority-sheet')).getByTestId('picker-option-HIGH'))
    await waitFor(() => expect(patches().some((c) => (c.body as { priority?: string }).priority === 'HIGH')).toBe(true))

    await user.click(screen.getByTestId('mobile-prop-due'))
    await user.click(await screen.findByTestId('issue-due-sheet-today'))
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    await waitFor(() => expect(patches().some((c) => (c.body as { dueDate?: string }).dueDate === today)).toBe(true))

    await waitFor(() => expect(screen.queryByTestId('issue-due-sheet')).not.toBeInTheDocument())
    await user.click(screen.getByTestId('mobile-prop-due'))
    await user.click(await screen.findByTestId('issue-due-sheet-clear'))
    await waitFor(() => expect(patches().some((c) => (c.body as { clearDueDate?: boolean }).clearDueDate === true)).toBe(true))
  })

  // 다중 선택은 시트를 닫을 때 한 번에 커밋한다 — 고르는 동안엔 요청이 없다. 안내 문구 조사(WP-499).
  test('담당자 칩 → 다중 선택 → 완료 시 한 번에 PUT', async () => {
    const { user, calls } = await open()
    await user.click(screen.getByTestId('mobile-prop-assignee'))
    const sheet = await screen.findByTestId('issue-assignee-sheet')
    expect(within(sheet).getByText('담당자를 여러 명 고를 수 있습니다.')).toBeInTheDocument()
    await user.click(within(sheet).getByTestId('multi-option-2'))
    expect(calls.filter((c) => c.path.endsWith('/assignees'))).toHaveLength(0)
    await user.click(within(sheet).getByTestId('issue-assignee-sheet-done'))
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/assignees'))?.body).toEqual({ userIds: [1, 2] }))
  })

  test('에픽 칩 → 에픽 선택 → PUT/PATCH parent { parentNumber }', async () => {
    const { user, calls } = await open()
    await user.click(screen.getByTestId('mobile-prop-epic'))
    await user.click(within(await screen.findByTestId('issue-epic-sheet')).getByTestId('picker-option-50'))
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/parent'))?.body).toEqual({ parentNumber: 50 }))
  })

  // 에픽 목록 조회 중엔 「에픽 없음」 아래 로딩 문구, 응답 뒤 에픽 옵션으로 바뀐다.
  test('에픽 목록 조회 중엔 「불러오는 중…」 — 응답 후 에픽 옵션으로 바뀐다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const { user } = await open({
      epicList: async () => {
        await gate
        return [EPIC]
      },
    })
    await user.click(screen.getByTestId('mobile-prop-epic'))
    const sheet = await screen.findByTestId('issue-epic-sheet')
    expect(within(sheet).getByTestId('picker-option-none')).toBeInTheDocument()
    expect(within(sheet).getByTestId('issue-epic-sheet-loading')).toHaveTextContent('불러오는 중…')
    expect(within(sheet).queryByTestId('picker-option-50')).not.toBeInTheDocument()
    release()
    expect(await within(sheet).findByTestId('picker-option-50')).toBeInTheDocument()
    expect(within(sheet).queryByTestId('issue-epic-sheet-loading')).not.toBeInTheDocument()
  })

  // WP-1039 부모가 다른 프로젝트 에픽 CLA-50 이면 이 프로젝트 #50 줄에 체크하지 않고, #50 을 고르면 바꾼다.
  // 시트 검색어로 다른 프로젝트 에픽을 찾아 고르면 PATCH /parent { parentKey }.
  test('다른 프로젝트 에픽 부모 — 같은 번호 줄에 체크가 없고, 검색으로 찾은 다른 프로젝트 에픽은 parentKey 로 연결한다', async () => {
    const lookups: string[] = []
    const { user, calls } = await open({
      over: { parent: { number: 50, title: '다른 팀 에픽', type: makeEpicType(), projectKey: 'CLA' } },
      extra: [
        http.get('/api/v1/issues/lookup', ({ request }) => {
          lookups.push(new URL(request.url).search)
          return HttpResponse.json([
            { projectKey: 'WP', number: 50, title: '결제 같은 프로젝트', status: 'TODO', type: makeEpicType() },
            { projectKey: 'PLAN', number: 3, title: '분기 계획', status: 'TODO', type: makeEpicType() },
            // 지금 부모 — 찾기에 걸려도 「다른 프로젝트」 줄로 보이지 않는다(데스크톱 피커와 같다).
            { projectKey: 'CLA', number: 50, title: '다른 팀 에픽', status: 'TODO', type: makeEpicType() },
          ])
        }),
      ],
    })
    await user.click(screen.getByTestId('mobile-prop-epic'))
    const sheet = await screen.findByTestId('issue-epic-sheet')
    expect(await within(sheet).findByTestId('picker-option-50')).toHaveAttribute('aria-selected', 'false')
    expect(within(sheet).getByTestId('picker-option-none')).toHaveAttribute('aria-selected', 'false')

    // 첫 글자부터 디바운스가 걸린다 — 「계」→「계획」을 잇달아 치면 마지막 검색어로 한 번만 묻는다(첫 글자로 바로 묻지 않는다).
    const search = within(sheet).getByTestId('issue-epic-sheet-search')
    fireEvent.change(search, { target: { value: '계' } })
    fireEvent.change(search, { target: { value: '계획' } })
    const other = await within(sheet).findByTestId('picker-other-epic-PLAN-3')
    expect(lookups.map((q) => new URLSearchParams(q).get('q'))).toEqual(['계획'])
    expect(new URLSearchParams(lookups[0]).get('excludeFrom')).toBe('true')
    expect(other).toHaveTextContent('PLAN-3분기 계획')
    // 같은 프로젝트 에픽은 찾기 결과에서 빠진다(위 목록이 맡는다).
    expect(within(sheet).queryByTestId('picker-other-epic-WP-50')).not.toBeInTheDocument()
    expect(within(sheet).queryByTestId('picker-other-epic-CLA-50')).not.toBeInTheDocument()
    expect(lookups.at(-1)).toContain('from=WP')
    await user.click(other)
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/parent'))?.body).toEqual({ parentKey: 'PLAN-3' }))
  })

  test('다른 프로젝트 에픽 부모에서 같은 번호의 이 프로젝트 에픽을 고르면 { parentNumber } 로 바꾼다 (WP-1039)', async () => {
    const { user, calls } = await open({
      over: { parent: { number: 50, title: '다른 팀 에픽', type: makeEpicType(), projectKey: 'CLA' } },
      extra: [http.get('/api/v1/issues/lookup', () => HttpResponse.json([]))],
    })
    await user.click(screen.getByTestId('mobile-prop-epic'))
    await user.click(await within(await screen.findByTestId('issue-epic-sheet')).findByTestId('picker-option-50'))
    await waitFor(() => expect(calls.find((c) => c.path.endsWith('/parent'))?.body).toEqual({ parentNumber: 50 }))
  })
})

// WP-503 — 비멤버에겐 칩이 비활성이고, 자물쇠 칩 팝오버·＋ 속성 시트 맨 위에 같은 이유 문구가 보인다.
test('비멤버: 칩은 비활성, 자물쇠를 누르면 이유가 뜨고 ＋ 속성 시트 맨 위에도 같은 안내', async () => {
  const { user } = await open({ detailOver: { viewerCanEditContent: true, viewerCanEditWorkflow: false } })
  const notice = '이슈 속성(유형·상태·일정 등)은 프로젝트 멤버만 바꿀 수 있어요. 바꿔야 하면 코멘트로 알려 주세요.'
  const chips = screen.getByTestId('mobile-prop-chips')
  expect(within(chips).getByTestId('mobile-prop-status')).toBeDisabled()
  await user.click(within(chips).getByTestId('issue-workflow-locked-hint'))
  expect(await screen.findByTestId('issue-workflow-locked-popover')).toHaveTextContent(notice)
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('issue-workflow-locked-popover')).not.toBeInTheDocument())
  await user.click(screen.getByTestId('mobile-prop-more'))
  const sheet = await screen.findByTestId('issue-more-props-sheet')
  expect(within(sheet).getByTestId('issue-workflow-locked-notice')).toHaveTextContent(notice)
})

describe('＋ 속성 시트', () => {
  // WP-944 — 보고자를 바꿀 수 있으면 시트에서 구성원을 골라 PUT reporter.
  test('보고자를 바꿀 수 있으면 시트에서 구성원을 골라 바꾼다', async () => {
    let putBody: unknown = null
    const { user } = await open({
      detailOver: { reporter: { id: 2, username: 'dev.kim@iacloud.kr', name: '김개발', kind: 'HUMAN' }, viewerCanChangeReporter: true },
      extra: [
        http.all(`${BASE}/reporter`, async ({ request }) => {
          putBody = await request.json()
          return HttpResponse.json({ id: 1, username: 'dh.yang@iacloud.kr', name: '양동희', kind: 'HUMAN' })
        }),
      ],
    })
    await user.click(screen.getByTestId('mobile-prop-more'))
    const row = within(await screen.findByTestId('issue-more-props-sheet')).getByTestId('issue-more-props-reporter')
    await user.click(within(row).getByTestId('reporter-picker-trigger'))
    await user.click(within(await screen.findByTestId('reporter-picker')).getByTestId('reporter-option-1'))
    await waitFor(() => expect(putBody).toEqual({ userId: 1 }))
  })

  // 하단 레일 대신 시트에 유형·보고자·일정·분류·커스텀 필드 — 칩과 겹치는 항목은 없다. 보고자 행은 유형 다음(문서 순서).
  test('하단 레일이 없고, 시트에 유형·보고자·일정·분류·커스텀 필드가 있고 칩과 중복 항목은 없다', async () => {
    const { user } = await open()
    expect(screen.queryByTestId('property-rail')).not.toBeInTheDocument()
    await user.click(screen.getByTestId('mobile-prop-more'))
    const sheet = await screen.findByTestId('issue-more-props-sheet')
    const type = within(sheet).getByTestId('issue-more-props-type')
    const reporterRow = within(sheet).getByTestId('issue-more-props-reporter')
    expect(reporterRow).toHaveTextContent('보고자')
    expect(within(reporterRow).getByTestId('issue-reporter')).toHaveTextContent('양동희')
    expect(within(reporterRow).getByTestId('issue-reporter-created')).toHaveTextContent('생성')
    expect(type.compareDocumentPosition(reporterRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const id of ['property-group-planning', 'issue-cycles-section', 'issue-milestone-section', 'property-group-classification', 'property-group-custom-fields']) {
      expect(within(sheet).getByTestId(id)).toBeInTheDocument()
    }
    for (const id of ['issue-status-select', 'due-date-trigger', 'issue-parent-slot']) {
      expect(within(sheet).queryByTestId(id)).not.toBeInTheDocument()
    }
  })

  test('서브태스크는 시트에 부모 슬롯이 있고, 그 링크로 다른 이슈로 가면 시트가 닫힌다', async () => {
    const target = createIssueDetail({ summary: createIssue({ id: 3, number: 3, projectKey: KEY, type: makeTaskType(), title: '선행 작업' }), body: '' })
    const { user, location } = await open({
      over: { type: makeSubtaskType(), parent: { number: 3, title: '선행 작업', type: makeTaskType() } },
      extra: [
        http.get(`/api/v1/projects/${KEY}/issues/3`, () => HttpResponse.json(target)),
        http.get('/api/v1/issues/3/comments', () => HttpResponse.json([])),
        ...['watchers', 'labels', 'attachments', 'drive-links'].map((s) => http.get(`/api/v1/projects/${KEY}/issues/3/${s}`, () => HttpResponse.json([]))),
      ],
    })
    await user.click(screen.getByTestId('mobile-prop-more'))
    const slot = within(await screen.findByTestId('issue-more-props-sheet')).getByTestId('issue-parent-slot')
    await user.click(within(slot).getByRole('link'))
    await waitFor(() => expect(location()).toBe(`/projects/${KEY}/issues/3`))
    await waitFor(() => expect(screen.getByTestId('issue-title-heading')).toHaveTextContent('선행 작업'))
    await waitFor(() => expect(screen.queryByTestId('issue-more-props-sheet')).not.toBeInTheDocument())
  })
})

describe('하단 편집 바 — 저장·취소 요청', () => {
  // 제목 편집 중엔 작성창 대신 [취소·저장] 바(작성창은 숨김 — 초안 보존), 저장은 PATCH 1회.
  test('제목 편집 → 저장은 PATCH 1회, 바가 닫히고 작성창이 돌아온다', async () => {
    const { user, patches } = await open()
    await user.click(screen.getByTestId('issue-title-edit'))
    expect(await screen.findByTestId('mobile-edit-bar')).toBeInTheDocument()
    expect(screen.getByTestId('issue-comment-input')).not.toBeVisible()
    fireEvent.change(screen.getByTestId('issue-title-input'), { target: { value: '새 제목' } })
    await user.click(screen.getByTestId('mobile-edit-save'))
    await waitFor(() => expect(screen.queryByTestId('mobile-edit-bar')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-comment-input')).toBeVisible()
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0].body).toMatchObject({ title: '새 제목' })
  })

  // 편집 중 다른 속성을 바꿔(요청 중 상태 변화) 다시 그려져도 편집 바·입력칸이 남는다.
  test('제목 편집 중 우선순위를 바꿔도 편집 바가 사라지지 않는다', async () => {
    const { user, patches } = await open()
    await user.click(screen.getByTestId('issue-title-edit'))
    await screen.findByTestId('mobile-edit-bar')
    await user.click(screen.getByTestId('mobile-prop-priority'))
    await user.click(within(await screen.findByTestId('issue-priority-sheet')).getByTestId('picker-option-HIGH'))
    await waitFor(() => expect(patches().some((c) => (c.body as { priority?: string }).priority === 'HIGH')).toBe(true))
    expect(screen.getByTestId('mobile-edit-bar')).toBeInTheDocument()
    expect(screen.getByTestId('issue-title-input')).toBeInTheDocument()
  })

  test('제목 편집 취소는 PATCH 없음', async () => {
    const { user, patches } = await open()
    await user.click(screen.getByTestId('issue-title-edit'))
    fireEvent.change(await screen.findByTestId('issue-title-input'), { target: { value: '버릴 제목' } })
    await user.click(screen.getByTestId('mobile-edit-cancel'))
    await waitFor(() => expect(screen.queryByTestId('mobile-edit-bar')).not.toBeInTheDocument())
    expect(patches()).toHaveLength(0)
  })

  // 모바일 본문 편집은 하단 바로 저장 — 본문 아래 저장/취소 버튼은 없다.
  test('본문 편집도 하단 바로 저장 — 본문 아래 저장 버튼은 없고 PATCH 1회', async () => {
    const { user, patches } = await open()
    await user.click(screen.getByRole('button', { name: '본문 편집' }))
    expect(screen.queryByTestId('issue-body-save')).not.toBeInTheDocument()
    fireEvent.change(await screen.findByTestId('issue-body-textarea'), { target: { value: '바뀐 본문' } })
    await user.click(screen.getByTestId('mobile-edit-save'))
    await waitFor(() => expect(patches()[0]?.body).toMatchObject({ body: '바뀐 본문' }))
    await waitFor(() => expect(screen.queryByTestId('mobile-edit-bar')).not.toBeInTheDocument())
    expect(screen.getByTestId('issue-comment-input')).toBeVisible()
    expect(patches()).toHaveLength(1)
  })

  // 모바일 제목은 blur 저장이 없어 두 편집기가 동시에 열릴 수 있다 — 나중에 연 쪽을 저장하면 바가 먼저 연 쪽으로 넘어간다.
  for (const order of ['title→body', 'body→title'] as const) {
    test(`제목·본문 동시 편집(${order}) — 나중 쪽 저장 후 바가 먼저 쪽을 저장한다`, async () => {
      const { user, patches } = await open()
      const openTitle = async () => {
        await user.click(screen.getByTestId('issue-title-edit'))
        fireEvent.change(await screen.findByTestId('issue-title-input'), { target: { value: '동시 편집 제목' } })
      }
      const openBody = async () => {
        await user.click(screen.getByRole('button', { name: '본문 편집' }))
        fireEvent.change(await screen.findByTestId('issue-body-textarea'), { target: { value: '동시 편집 본문' } })
      }
      const [first, second] = order === 'title→body' ? [openTitle, openBody] : [openBody, openTitle]
      const [firstField, secondField] = order === 'title→body' ? ['title', 'body'] : ['body', 'title']
      await first()
      await second()
      await user.click(screen.getByTestId('mobile-edit-save'))
      await waitFor(() => expect(patches()).toHaveLength(1))
      expect(patches()[0].body).toHaveProperty(secondField)
      expect(patches()[0].body).not.toHaveProperty(firstField)
      expect(screen.getByTestId('mobile-edit-bar')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByTestId('mobile-edit-save')).toBeEnabled())
      await user.click(screen.getByTestId('mobile-edit-save'))
      await waitFor(() => expect(patches()).toHaveLength(2))
      expect(patches()[1].body).toMatchObject(firstField === 'title' ? { title: '동시 편집 제목' } : { body: '동시 편집 본문' })
      await waitFor(() => expect(screen.queryByTestId('mobile-edit-bar')).not.toBeInTheDocument())
      expect(screen.getByTestId('issue-comment-input')).toBeVisible()
    })
  }
})
