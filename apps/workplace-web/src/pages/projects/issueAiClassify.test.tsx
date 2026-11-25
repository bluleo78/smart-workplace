// 이슈 AI 분류 제안(생성 대화상자·편집 속성 레일) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 제목 유무에 따른 버튼 활성, 제안 요청 payload, 제안이 폼(유형·우선순위)에 채워져 생성 payload 로 실리는 것,
// 편집 화면에서 우선순위·유형·라벨 3건을 적용하고 통합 토스트 1개만 띄우는 것(#578), 실패 토스트 뒤 폼 유지는
// 브라우저 없이 판정되므로 e2e/pages/issues/issue-ai-classify.spec.ts 에서 옮겼다(그 spec 은 지웠다).
// 이슈 목록·상세 화면 배선은 각 화면 spec 의 @wiring 이 지킨다. 적용 결과 → 토스트 문구 규칙은 lib/aiClassifyResult.test.ts 몫이다.
// 제안 유형이 상위를 풀 때 유형 PATCH 를 스킵하고 토스트에 이유를 덧붙이는지(WP-2097)는 편집 속성 레일 테스트가 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import { openIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { renderScreen } from '@/test/renderScreen'

import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'
import { makeEpicType, systemTypes } from '../../../e2e/factories/issueType.factory'
import { createProject } from '../../../e2e/factories/project.factory'
import { IssueCreateDialog } from './components/IssueCreateDialog'

const KEY = 'TEST'
const LABELS = [
  { id: 1, name: 'backend', colorToken: 'violet' },
  { id: 2, name: 'bug', colorToken: 'red' },
]
const SUGGESTION = { type: 'BUG', priority: 'HIGH', labels: ['backend'], reason: '500 오류 + 사용자 직접 영향 → HIGH, 버그 유형' }
// 상위를 풀는 유형 제안(WP-2097) — 옛 유형과 무관하게 제안 유형이 EPIC 이면 서버가 상위 연결을 풀어 준다.
const EPIC_SUGGESTION = { ...SUGGESTION, type: 'EPIC' }
const BUG_TYPE_ID = systemTypes().find((t) => t.name === 'BUG')!.id

/** 프로젝트 하위 조회 — 유형·라벨은 값, 나머지(멤버·컴포넌트 등)는 빈 목록. */
const projectMetaHandlers = [
  http.get(`/api/v1/projects/${KEY}/types`, () => HttpResponse.json(systemTypes())),
  http.get(`/api/v1/projects/${KEY}/labels`, () => HttpResponse.json(LABELS)),
]

/** AI 연동이 꺼졌을 때의 서버 응답(WP-1640) — 409 + errors.code=AI_DISABLED + 화면에 보일 문구. */
const AI_DISABLED_BODY = {
  status: 409,
  message: 'AI 연동이 꺼져 있어 분류를 제안할 수 없어요.',
  errors: { code: 'AI_DISABLED' },
}

/** AI 분류 엔드포인트 — 요청 본문을 모은다. status 가 있으면 그 상태(본문 errorBody, 없으면 문구 없는 본문)로 실패한다. suggestion 을 넘기면 그 제안을 돌려준다. */
function classifyHandler(bodies: unknown[], status?: number, errorBody?: object, suggestion: object = SUGGESTION) {
  return http.post(`/api/v1/projects/${KEY}/issues/ai-classify`, async ({ request }) => {
    bodies.push(await request.json())
    return status
      ? HttpResponse.json(errorBody ?? { error: 'issue_classify_failed' }, { status })
      : HttpResponse.json(suggestion)
  })
}

/** 생성 대화상자만 띄운다. 생성 POST 본문은 creates 에 모은다. */
function renderCreateDialog(classifyStatus?: number, classifyErrorBody?: object) {
  const classifies: unknown[] = []
  const creates: Record<string, unknown>[] = []
  const onOpenChange = vi.fn()
  const view = renderScreen(<IssueCreateDialog projectKey={KEY} open onOpenChange={onOpenChange} />, {
    path: `/projects/${KEY}`,
    handlers: [
      ...projectMetaHandlers,
      classifyHandler(classifies, classifyStatus, classifyErrorBody),
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ key: KEY, type: 'TEAM' }))),
      http.get(`/api/v1/projects/${KEY}/:sub`, () => HttpResponse.json([])),
      http.post(`/api/v1/projects/${KEY}/issues`, async ({ request }) => {
        creates.push((await request.json()) as Record<string, unknown>)
        return HttpResponse.json(createIssue({ projectKey: KEY, title: '로그인 버튼 클릭 시 500 오류' }))
      }),
    ],
  })
  return { ...view, classifies, creates, onOpenChange }
}

test('생성 대화상자 — 제목이 있어야 AI 제안이 켜지고, 제안이 유형·우선순위를 채워 생성 payload 로 실린다', async () => {
  const { user, classifies, creates, onOpenChange } = renderCreateDialog()
  const dialog = await screen.findByRole('dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  const aiBtn = within(dialog).getByTestId('ai-classify-btn')
  expect(aiBtn).toBeDisabled()

  await user.click(within(dialog).getByLabelText(/^제목/))
  await user.paste('로그인 버튼 클릭 시 500 오류')
  expect(aiBtn).toBeEnabled()
  await user.click(aiBtn)

  // 제안 요청 payload — 지금 폼의 제목·본문.
  await waitFor(() => expect(classifies).toEqual([{ title: '로그인 버튼 클릭 시 500 오류', body: '' }]))
  // 이유 서브텍스트와 채워진 우선순위.
  expect(await within(dialog).findByTestId('ai-classify-reason')).toHaveTextContent('500 오류')
  expect(dialog.querySelector('#issue-priority')).toHaveTextContent('높음')

  // 제안은 덮어쓰기일 뿐 — 사용자가 우선순위를 다시 고를 수 있고, 생성하면 제안된 유형(BUG)과 고른 우선순위가 실린다.
  await user.click(dialog.querySelector('#issue-priority')!)
  // ByRole 의 문자열 이름은 전체 일치라 「매우 낮음」(WP-886)과 섞이지 않는다.
  await user.click(await screen.findByRole('option', { name: '낮음' }))
  expect(dialog.querySelector('#issue-priority')).toHaveTextContent('낮음')
  await user.click(within(dialog).getByRole('button', { name: '생성' }))
  await waitFor(() => expect(creates).toHaveLength(1))
  expect(creates[0]).toMatchObject({ title: '로그인 버튼 클릭 시 500 오류', typeId: BUG_TYPE_ID, priority: 'LOW' })
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
})

test('생성 대화상자 — AI 제안이 실패하면 오류 토스트를 띄우고 폼은 그대로 열려 있다', async () => {
  const { user, onOpenChange } = renderCreateDialog(502)
  const dialog = await screen.findByRole('dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  await user.click(within(dialog).getByLabelText(/^제목/))
  await user.paste('제목')
  await user.click(within(dialog).getByTestId('ai-classify-btn'))
  expect(await screen.findByText('AI 제안을 받지 못했습니다')).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(within(dialog).getByLabelText(/^제목/)).toHaveValue('제목')
  expect(within(dialog).queryByTestId('ai-classify-reason')).not.toBeInTheDocument()
  expect(onOpenChange).not.toHaveBeenCalled()
})

test('생성 대화상자 — AI 연동이 꺼져 있으면(409 AI_DISABLED) 서버 문구를 토스트로 보인다', async () => {
  const { user } = renderCreateDialog(409, AI_DISABLED_BODY)
  const dialog = await screen.findByRole('dialog', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  await user.click(within(dialog).getByLabelText(/^제목/))
  await user.paste('제목')
  await user.click(within(dialog).getByTestId('ai-classify-btn'))
  expect(await screen.findByText('AI 연동이 꺼져 있어 분류를 제안할 수 없어요.')).toBeInTheDocument()
  expect(screen.queryByText('AI 제안을 받지 못했습니다')).not.toBeInTheDocument()
})

test('편집 속성 레일 — AI 연동이 꺼져 있으면(409 AI_DISABLED) 서버 문구를 토스트로 보이고 아무것도 바꾸지 않는다', async () => {
  const detail = createIssueDetail({
    summary: createIssue({ projectKey: KEY, number: 1, title: '기존 이슈 제목', priority: 'LOW' }),
    body: '기존 본문',
  })
  const writes: string[] = []
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      classifyHandler([], 409, AI_DISABLED_BODY),
      http.patch(`/api/v1/projects/${KEY}/issues/1`, ({ request }) => {
        writes.push(request.url)
        return HttpResponse.json(detail)
      }),
      ...projectMetaHandlers,
    ],
  })
  await user.click(await screen.findByTestId('ai-classify-btn'))
  expect(await screen.findByText('AI 연동이 꺼져 있어 분류를 제안할 수 없어요.')).toBeInTheDocument()
  expect(screen.queryByTestId('ai-classify-reason')).not.toBeInTheDocument()
  expect(writes).toEqual([])
})

test('편집 속성 레일 — 제안의 우선순위·유형·라벨을 각각 적용하고 토스트는 통합 1개만 띄운다(#578)', async () => {
  const detail = createIssueDetail({
    summary: createIssue({ projectKey: KEY, number: 1, title: '기존 이슈 제목', priority: 'LOW' }),
    body: '기존 본문',
  })
  const classifies: unknown[] = []
  const writes: { method: string; path: string; body: unknown }[] = []
  const record = async ({ request }: { request: Request }) => {
    writes.push({ method: request.method, path: new URL(request.url).pathname, body: await request.json() })
    return HttpResponse.json(detail)
  }
  // 속성 레일의 제안 적용은 상세 화면(우선순위·유형·라벨 칸과 통합 토스트)에서 이어져 — 이슈 상세 화면만 AI 비서 공급자와 함께 띄운다(WP-1002).
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      classifyHandler(classifies),
      http.patch(`/api/v1/projects/${KEY}/issues/1`, record),
      http.patch(`/api/v1/projects/${KEY}/issues/1/type`, record),
      http.put(`/api/v1/projects/${KEY}/issues/1/labels`, async ({ request }) => {
        writes.push({ method: 'PUT', path: new URL(request.url).pathname, body: await request.json() })
        return HttpResponse.json([{ id: 1, name: 'backend', colorToken: 'violet' }])
      }),
      ...projectMetaHandlers,
    ],
  })
  const aiBtn = await screen.findByTestId('ai-classify-btn')
  expect(aiBtn).toBeEnabled()
  await user.click(aiBtn)

  expect(await screen.findByTestId('ai-classify-reason')).toHaveTextContent('500 오류')
  expect(classifies).toEqual([{ title: '기존 이슈 제목', body: '기존 본문' }])
  // 처리: 우선순위 PATCH·유형 PATCH(이름 → id)·라벨 PUT(이름 → id 병합).
  expect(writes).toEqual(
    expect.arrayContaining([
      { method: 'PATCH', path: `/api/v1/projects/${KEY}/issues/1`, body: { priority: 'HIGH' } },
      { method: 'PATCH', path: `/api/v1/projects/${KEY}/issues/1/type`, body: { typeId: BUG_TYPE_ID } },
      { method: 'PUT', path: `/api/v1/projects/${KEY}/issues/1/labels`, body: { labelIds: [1] } },
    ]),
  )
  // 출력: 통합 토스트 1개 — 개별 성공 토스트는 쌓이지 않는다.
  expect(await screen.findByText('AI 제안을 적용했습니다')).toBeInTheDocument()
  for (const text of ['유형을 변경했습니다', '라벨을 저장했습니다', '이슈 필드가 업데이트되었습니다']) {
    expect(screen.queryByText(text)).not.toBeInTheDocument()
  }
  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
})

/**
 * 상위가 있는 이슈 상세를 열고 분류 제안을 적용한다 — 쓰기 요청 본문을 writes 에 모은다.
 * suggestion 을 넘기면 그 제안(유형)으로 분류 응답을 돌려준다. 이유 서브텍스트가 채워질 때까지
 * 기다려 통합 토스트까지 끝난 상태를 만든다(WP-2097).
 * failWrites 를 주면 우선순위·라벨 쓰기도 500 으로 돌려줘 적용 성공이 하나도 없게 한다(WP-2097 리뷰 후속 ③).
 */
async function classifyOnIssueWithParent(suggestion: object, opts?: { failWrites?: boolean }) {
  const detail = createIssueDetail({
    summary: createIssue({
      projectKey: KEY,
      number: 1,
      title: '기존 이슈 제목',
      priority: 'LOW',
      parent: { number: 5, title: '결제 개편 에픽', type: makeEpicType() },
    }),
    body: '기존 본문',
  })
  const writes: { method: string; path: string; body: unknown }[] = []
  // 요청 본문 기록은 네 핸들러가 한 곳에서만 — 갈래는 응답만 다르다(failWrites: 적용 0건 만들기).
  const pushWrite = async ({ request }: { request: Request }) => {
    writes.push({ method: request.method, path: new URL(request.url).pathname, body: await request.json() })
  }
  const record = async (ctx: { request: Request }) => {
    await pushWrite(ctx)
    return HttpResponse.json(detail)
  }
  const failWrite = async (ctx: { request: Request }) => {
    await pushWrite(ctx)
    return HttpResponse.json({ message: '적용 실패' }, { status: 500 })
  }
  const labelsOk = async (ctx: { request: Request }) => {
    await pushWrite(ctx)
    return HttpResponse.json([{ id: 1, name: 'backend', colorToken: 'violet' }])
  }
  const { user } = await openIssueDetailScreen({
    key: KEY,
    number: 1,
    detail,
    project: { type: 'TEAM' },
    handlers: [
      classifyHandler([], undefined, undefined, suggestion),
      http.patch(`/api/v1/projects/${KEY}/issues/1`, opts?.failWrites ? failWrite : record),
      http.patch(`/api/v1/projects/${KEY}/issues/1/type`, record),
      http.put(`/api/v1/projects/${KEY}/issues/1/labels`, opts?.failWrites ? failWrite : labelsOk),
      ...projectMetaHandlers,
    ],
  })
  await user.click(await screen.findByTestId('ai-classify-btn'))
  expect(await screen.findByTestId('ai-classify-reason')).toHaveTextContent('500 오류')
  return { writes }
}

test('편집 속성 레일 — 제안 유형이 상위를 풀면 유형 PATCH 를 보내지 않고 토스트에 이유를 덧붙인다(WP-2097)', async () => {
  const { writes } = await classifyOnIssueWithParent(EPIC_SUGGESTION)

  // 유형 PATCH 는 한 번도 나가지 않는다 — 상위를 풀 유형(→ EPIC)이라 서버에 상위 해제를 묻지 않고 아예 보내지 않는다.
  expect(writes.filter((w) => w.path.endsWith('/type'))).toEqual([])
  // 우선순위·라벨 제안은 그래도 적용된다(Review Focus 5).
  expect(writes).toEqual(
    expect.arrayContaining([
      { method: 'PATCH', path: `/api/v1/projects/${KEY}/issues/1`, body: { priority: 'HIGH' } },
      { method: 'PUT', path: `/api/v1/projects/${KEY}/issues/1/labels`, body: { labelIds: [1] } },
    ]),
  )
  // 출력: 통합 토스트 1개에 스킵 이유가 덧붙는다.
  expect(
    await screen.findByText('AI 제안을 적용했습니다 — 상위 연결 때문에 유형은 적용하지 않음'),
  ).toBeInTheDocument()
  expect(document.querySelectorAll('[data-sonner-toast]')).toHaveLength(1)
})

test('편집 속성 레일 — 상위가 있어도 유형이 상위를 풀지 않으면 유형도 그대로 적용된다(WP-2097)', async () => {
  const { writes } = await classifyOnIssueWithParent(SUGGESTION)

  // TASK → BUG 는 상위를 풀지 않는다 — 유형 PATCH 도 기존처럼 나간다.
  expect(writes).toEqual(
    expect.arrayContaining([
      { method: 'PATCH', path: `/api/v1/projects/${KEY}/issues/1/type`, body: { typeId: BUG_TYPE_ID } },
    ]),
  )
  expect(await screen.findByText('AI 제안을 적용했습니다')).toBeInTheDocument()
  expect(screen.queryByText(/상위 연결 때문에/)).not.toBeInTheDocument()
})

test('편집 속성 레일 — 적용된 제안이 하나도 없어도 유형 스킵 사실은 토스트로 알린다(WP-2097 리뷰 후속 ③)', async () => {
  const { writes } = await classifyOnIssueWithParent(EPIC_SUGGESTION, { failWrites: true })

  // 유형 PATCH 는 스킵, 우선순위·라벨 쓰기는 실패 — 통합 토스트 문구를 만들 성공이 하나도 없다.
  expect(writes.filter((w) => w.path.endsWith('/type'))).toEqual([])
  expect(writes.filter((w) => w.path.endsWith('/issues/1'))).toHaveLength(1)
  expect(writes.filter((w) => w.path.endsWith('/labels'))).toHaveLength(1)

  // 그래도 건너뛴 사실은 무음으로 지나가지 않고 토스트로 보인다(WP-2097 리뷰 후속 ③).
  expect(await screen.findByText('상위 연결 때문에 유형은 적용하지 않음')).toBeInTheDocument()
  expect(screen.queryByText('AI 제안을 적용했습니다')).not.toBeInTheDocument()
  // 이유 서브텍스트는 그대로 채워져 있다 — 왜 건너뛰었는지도 함께 보인다.
  expect(screen.getByTestId('ai-classify-reason')).toHaveTextContent('500 오류')
})
