// AI 채팅 화면 컨텍스트(WP-54) — 페이지 테스트(WP-971, WP-966).
// 각 화면이 등록한 컨텍스트가 칩으로 보이고 전송 body(screenContext)에 실리는지, × 의 1회 제외·되돌리기·화면 이동 뒤 복원은
// 브라우저 없이 판정되므로 e2e/pages/ai-screen-context.spec.ts 에서 옮겼다.
// renderPage 를 쓰는 이유: 컨텍스트 store·AI 사이드 패널·풀스크린이 앱 셸(AppLayout)에 있고, 페이지(Outlet)가 등록한 값을
// 패널이 읽는 배선 자체가 판정 대상이다. 화면 이동 뒤 복원도 라우트를 넘나든다.
// 이슈 상세 대표 흐름(@wiring), 칩 두 상태 높이(@layout), 키보드·툴팁·엔티티 다이얼로그와 패널의 상호작용(@input·@layout)은 E2E 에 남는다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { describe, expect, test } from 'vitest'

import { issueDetailHandlers, issueDetailSubHandlers } from '@/test/kits/projects/issueDetailStubs'
import { PAGE_LOAD_TIMEOUT, renderPage, settleHistory } from '@/test/renderPage'
import type { AiScreenContext } from '@/types/aiScreenContext'

import { createAiTaskCounts } from '../../../../e2e/factories/agentWork.factory'
import { calendar, calendarEvent } from '../../../../e2e/factories/calendar.factory'
import { createChatMessagePage, createChatThread } from '../../../../e2e/factories/chat.factory'
import {
  external as contactExternal,
  externalDetail as contactExternalDetail,
  member as contactMember,
  memberDetail as contactMemberDetail,
  page as contactsPage,
} from '../../../../e2e/factories/contacts.factory'
import { createFile, createFolder, createSpace } from '../../../../e2e/factories/drive.factory'
import { createIssue, createIssueDetail, createIssueSearchResponse } from '../../../../e2e/factories/issue.factory'
import { detail, mailAccount, summary } from '../../../../e2e/factories/mail.factory'
import {
  createChannel,
  createChannelMember,
  createDm,
  createDmParticipant,
  createMessage,
  createThreadInboxItem,
} from '../../../../e2e/factories/messaging.factory'
import { createProject } from '../../../../e2e/factories/project.factory'

/** POST /api/v1/ai/chat 시작 본문 — 화면 컨텍스트·앱이 여기에 실린다. */
type ChatStartBody = { query: string; correlationId: string; screenContext?: AiScreenContext; app?: string }

const emptyCursor = { items: [], nextCursor: null, hasMore: false }

/**
 * AI 채팅 시작을 기록하고, 통합 SSE(/api/v1/events)로 done 프레임을 밀어 응답을 끝낸다 — 끝나야 다음 전송이 열린다.
 * 기본 SSE(baseHandlers)는 열린 채 아무것도 보내지 않으므로 같은 경로를 밀어 넣을 수 있는 스트림으로 바꾼다.
 */
function chatCapture() {
  const bodies: ChatStartBody[] = []
  const enc = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const handlers: RequestHandler[] = [
    http.get('/api/v1/events', ({ request }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
          request.signal.addEventListener('abort', () => {
            try {
              c.close()
            } catch {
              // 이미 닫혔으면 무시
            }
          })
        },
      })
      return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } })
    }),
    http.post('/api/v1/ai/chat', async ({ request }) => {
      const body = (await request.json()) as ChatStartBody
      bodies.push(body)
      // 응답을 보낸 뒤 done 프레임을 흘려 생성을 끝낸다.
      setTimeout(() => {
        act(() => {
          controller?.enqueue(
            enc.encode(`event: home.chat.done\ndata: ${JSON.stringify({ correlationId: body.correlationId, sessionId: 's-ctx' })}\n\n`),
          )
        })
      }, 0)
      return HttpResponse.json({ correlationId: body.correlationId })
    }),
  ]
  return { bodies, handlers }
}

type PageView = ReturnType<typeof renderPage>

/**
 * path 를 열고 AI 칩(chat-launcher)으로 사이드 패널을 연다. waitFor 가 있으면 그 testid 가 보인 뒤,
 * before 가 있으면 그 조작(목록 행 열기 등)을 마친 뒤 연다.
 */
async function openPanelAt(
  path: string,
  handlers: RequestHandler[] = [],
  opts: { waitFor?: string; before?: (view: PageView) => Promise<void> } = {},
) {
  const chat = chatCapture()
  const view = renderPage(path, { handlers: [...chat.handlers, ...handlers] })
  if (opts.waitFor) await screen.findByTestId(opts.waitFor, {}, { timeout: PAGE_LOAD_TIMEOUT })
  if (opts.before) await opts.before(view)
  await view.user.click(await screen.findByTestId('chat-launcher', {}, { timeout: PAGE_LOAD_TIMEOUT }))
  await screen.findByTestId('ai-side-panel')
  return { ...view, chat }
}

/** 패널 입력창에 글을 넣고 패널의 「보내기」를 누른 뒤, n 번째 전송 본문을 돌려준다. */
async function send(view: Awaited<ReturnType<typeof openPanelAt>>, text: string) {
  const n = view.chat.bodies.length + 1
  const panel = screen.getByTestId('chat-panel')
  const input = within(panel).getByTestId('chat-input')
  await view.user.click(input)
  await view.user.paste(text)
  await view.user.click(within(panel).getByRole('button', { name: '보내기' }))
  await waitFor(() => expect(view.chat.bodies).toHaveLength(n))
  return view.chat.bodies[n - 1]
}

/** 칩 문구가 나타날 때까지 기다린다 — 화면 모듈을 처음 불러오는 이동 직후에도 쓰므로 첫 화면과 같은 여유를 둔다. */
async function chipHas(text: string) {
  await waitFor(() => expect(screen.getByTestId('chat-context-chip')).toHaveTextContent(text), { timeout: PAGE_LOAD_TIMEOUT })
}

// 이슈 상세(WP-12 · 로그인 버그 수정) — e2e/fixtures/issue-detail-mock.ts 의 mockIssueDetail 과 같은 응답.
// 상세가 섹션마다 부르는 부가 조회는 공용 kit(issueDetailHandlers)이 빈 성공으로 채운다.
const issueDetail = (extra: RequestHandler[] = []): RequestHandler[] =>
  issueDetailHandlers({
    number: 12,
    detail: createIssueDetail({ summary: createIssue({ number: 12, title: '로그인 버그 수정', status: 'IN_PROGRESS', priority: 'HIGH' }) }),
    extra,
  })

describe('공통 — 이슈 상세', () => {
  // × 는 다음 1회만 화면 정보를 뺀다(제외 칩으로 바뀌어 상태가 보인다). 화면 앱(app)은 그대로 보내고, 보낸 뒤엔 칩이 돌아와 다음 전송에 다시 실린다.
  test('× 는 다음 1회 전송만 컨텍스트를 빼고, 그 다음 전송에는 다시 포함한다', async () => {
    const view = await openPanelAt('/projects/WP/issues/12', issueDetail())
    await chipHas('이슈 WP-12 로그인 버그 수정')
    await view.user.click(screen.getByTestId('chat-context-remove'))
    expect(screen.queryByTestId('chat-context-chip')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-context-chip-excluded')).toHaveTextContent('화면 정보 빼고 보내요')
    // 스크린리더 알림 영역도 제외 상태를 읽는다.
    expect(screen.getByTestId('chat-context-live')).toHaveTextContent('화면 정보 빼고 보내요')

    const first = await send(view, '첫 질문')
    expect(first).not.toHaveProperty('screenContext')
    // WP-379: × 는 화면 내용만 뺀다 — 지금 화면 앱(app)은 그대로 보낸다.
    expect(first.app).toBe('ISSUE')

    expect(await screen.findByTestId('chat-context-chip')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-context-chip-excluded')).not.toBeInTheDocument()
    expect(screen.getByTestId('chat-context-live')).toHaveTextContent('화면 정보: 이슈 WP-12 로그인 버그 수정')
    const second = await send(view, '두 번째 질문')
    expect(second.screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })

  // 되돌리기는 제외를 취소해 칩을 복원하고 입력창으로 포커스를 돌린다(× 가 사라져도 키보드 위치를 잃지 않게). 다음 전송에 컨텍스트가 실린다.
  test('되돌리기는 제외를 취소해 칩을 복원하고 다음 전송에 컨텍스트를 싣는다', async () => {
    const view = await openPanelAt('/projects/WP/issues/12', issueDetail())
    await chipHas('로그인 버그 수정')
    await view.user.click(screen.getByTestId('chat-context-remove'))
    await view.user.click(screen.getByTestId('chat-context-restore'))
    expect(screen.getByTestId('chat-context-chip')).toHaveTextContent('이슈 WP-12 로그인 버그 수정')
    expect(screen.queryByTestId('chat-context-chip-excluded')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('chat-panel')).getByTestId('chat-input')).toHaveFocus()
    expect((await send(view, '되돌린 뒤 질문')).screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })

  // × 상태는 화면 정체성에 묶인다 — 다른 화면에 갔다 뒤로 돌아오면 칩이 복원되고 전송에 다시 실린다.
  test('× 후 다른 화면에 갔다 돌아오면 칩이 복원되고 전송에 다시 포함된다', async () => {
    const view = await openPanelAt('/projects/WP/issues/12', issueDetail([
      http.get('/api/v1/projects/WP/issues', () => HttpResponse.json({ items: [createIssue({ number: 12 })], nextCursor: null, hasMore: false })),
    ]))
    await chipHas('로그인 버그 수정')
    await view.user.click(screen.getByTestId('chat-context-remove'))
    expect(screen.getByTestId('chat-context-chip-excluded')).toBeInTheDocument()

    // 앱 내부 이동(브레드크럼 → 프로젝트 이슈 목록) 후 뒤로 가기 — 새로고침 없이 패널 상태가 유지되는 경로.
    await view.user.click(within(screen.getByRole('navigation', { name: '이슈 경로' })).getByRole('link', { name: 'Workplace' }))
    await chipHas('프로젝트 Workplace 이슈 목록')
    act(() => window.history.back())
    await settleHistory()
    await chipHas('이슈 WP-12 로그인 버그 수정')
    expect((await send(view, '돌아와서 질문')).screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })

  // 풀스크린으로 바꿔도 뒤 화면(이슈 상세)의 컨텍스트를 유지한다.
  test('풀스크린에서도 뒤 화면 컨텍스트를 유지한다', async () => {
    const view = await openPanelAt('/projects/WP/issues/12', issueDetail())
    // 사이드 → 풀스크린 전환(같은 AI 칩을 한 번 더 누른다).
    await view.user.click(screen.getByTestId('chat-launcher'))
    await waitFor(() => expect(screen.getByTestId('chat-launcher')).toHaveAttribute('data-mode', 'fullscreen'))
    expect(screen.getByTestId('ai-fullscreen')).toBeInTheDocument()
    await chipHas('WP-12')
    expect((await send(view, '이거')).screenContext?.focus?.refs).toEqual({ issueKey: 'WP-12' })
  })
})

// 등록 화면이 없는 홈 — 칩이 없고 screenContext 를 보내지 않는다.
test('등록 화면이 없는 홈에서는 칩이 없고 screenContext 를 보내지 않는다', async () => {
  const view = await openPanelAt('/', [http.get('/api/v1/push/config', () => HttpResponse.json({ enabled: false, vapidPublicKey: null }))])
  expect(screen.queryByTestId('chat-context-chip')).not.toBeInTheDocument()
  expect(screen.queryByTestId('chat-context-chip-excluded')).not.toBeInTheDocument()
  expect(await send(view, '안녕')).not.toHaveProperty('screenContext')
})

describe('이슈 목록', () => {
  // 범위 라벨이 화면 이름을 포함하므로 칩은 범위 라벨만 보이고, URL 필터(상태·검색어)가 이름으로 facts 에 실린다. 건수는 목록 응답에서 온다.
  test('프로젝트 이슈 목록의 필터가 이름으로 실린다', async () => {
    const view = await openPanelAt('/projects/WP?status=TODO&q=%EB%A1%9C%EA%B7%B8%EC%9D%B8', [
      http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject({ name: 'Workplace' }))),
      http.get('/api/v1/projects/WP/issues', () => HttpResponse.json({ items: [createIssue()], nextCursor: null, hasMore: false })),
    ])
    await chipHas('프로젝트 Workplace 이슈 목록')
    expect(screen.getByTestId('chat-context-chip')).not.toHaveTextContent('이슈 목록 · ')
    // count/hasMore 는 목록 fetch 결과에서 오므로 행이 그려진 뒤 보낸다(칩 라벨은 프로젝트 fetch 만으로 뜬다).
    await screen.findByTestId('issue-row-1')
    const body = await send(view, '여기서 급한 거')
    expect(body.screenContext).toMatchObject({ view: '이슈 목록', scope: { refs: { projectKey: 'WP' }, count: 1, hasMore: false } })
    expect(body.screenContext!.scope!.facts).toEqual(
      expect.arrayContaining([{ label: '상태 범주', value: '할 일' }, { label: '검색어', value: '로그인' }]),
    )
  })

  // 건수는 휘발 값이라 화면 정체성에 들지 않는다 — × 뒤에 건수가 도착해도 제외가 유지되고, 보낸 뒤엔 복원되며 도착한 건수가 실린다.
  test('같은 화면에서 목록 건수가 뒤늦게 도착해도 × 상태가 유지된다', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const view = await openPanelAt('/projects/WP', [
      http.get('/api/v1/projects/WP', () => HttpResponse.json(createProject({ name: 'Workplace' }))),
      // 이슈 목록 응답을 × 클릭 뒤까지 붙잡아 둔다 — 건수가 × 이후에 결정론적으로 도착하도록.
      http.get('/api/v1/projects/WP/issues', async () => {
        await gate
        return HttpResponse.json({ items: [createIssue({ number: 7 })], nextCursor: null, hasMore: false })
      }),
    ])
    await chipHas('프로젝트 Workplace 이슈 목록')
    await view.user.click(screen.getByTestId('chat-context-remove'))
    expect(screen.getByTestId('chat-context-chip-excluded')).toBeInTheDocument()

    release()
    await screen.findByTestId('issue-row-7')
    expect(screen.getByTestId('chat-context-chip-excluded')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-context-chip')).not.toBeInTheDocument()
    expect(await send(view, '건수 도착 후 질문')).not.toHaveProperty('screenContext')

    await screen.findByTestId('chat-context-chip')
    expect((await send(view, '다음 질문')).screenContext?.scope).toMatchObject({ count: 1, hasMore: false })
  })
})

describe('내 작업 · AI 위임', () => {
  const agent = { id: 9, username: 'claude', name: 'Claude', kind: 'AGENT' as const }

  // 내 작업 탭(내가 만든)과 상태 facet 이 목록 범위로 실린다 — 칩에 「내 작업 · 내 작업」 같은 중복이 없다.
  test('내 작업 탭과 상태 facet 이 목록 범위로 실린다', async () => {
    const view = await openPanelAt('/me/tasks/reported?status=IN_PROGRESS', [
      http.get('/api/v1/me/issues', () => HttpResponse.json(createIssueSearchResponse([createIssue()]))),
    ])
    await chipHas('내 작업 · 내가 만든')
    expect(screen.getByTestId('chat-context-chip')).not.toHaveTextContent('내 작업 · 내 작업')
    expect((await send(view, '이 중 급한 거')).screenContext).toEqual({
      view: '내 작업',
      scope: { label: '내 작업 · 내가 만든', facts: [{ label: '상태', value: '진행 중' }] },
    })
  })

  // WP-377: 건수는 로드된 행 수(2)가 아니라 서버 전체 건수(/me/ai-tasks/counts 의 all=12).
  test('AI 위임 작업은 counts 의 전체 건수를 싣는다', async () => {
    const view = await openPanelAt(
      '/me/ai-tasks',
      [
        http.get('/api/v1/me/ai-tasks', () =>
          HttpResponse.json(createIssueSearchResponse([createIssue({ id: 31, assignees: [agent] }), createIssue({ id: 33, assignees: [agent] })])),
        ),
        http.get('/api/v1/me/ai-tasks/counts', () => HttpResponse.json(createAiTaskCounts({ all: 12 }))),
      ],
      { waitFor: 'ai-row-31' },
    )
    await chipHas('AI 위임 작업')
    expect((await send(view, '진행 상황 알려줘')).screenContext).toEqual({ view: 'AI 위임 작업', scope: { label: 'AI 위임 작업', count: 12 } })
  })

  // 빠른 필터 중이면 건수는 보이는 집합(칩 건수 7)이고 범위·켜진 칩이 facts 로 실린다. /me/ai-tasks 가 무시하는 막힘(blocked)은 싣지 않는다.
  test('AI 위임 작업 — 빠른 필터·전체 범위면 칩 건수와 facts 를 싣는다', async () => {
    const view = await openPanelAt(
      '/me/ai-tasks?scope=all&state=INPUT_REQUIRED&blocked=true',
      [
        http.get('/api/v1/me/ai-tasks', () => HttpResponse.json(createIssueSearchResponse([createIssue({ id: 31, assignees: [agent] })]))),
        http.get('/api/v1/me/ai-tasks/counts', () => HttpResponse.json(createAiTaskCounts({ all: 12, inputRequired: 7 }))),
      ],
      { waitFor: 'ai-row-31' },
    )
    await waitFor(() => expect(screen.getByTestId('ai-quick-count-inputRequired')).toHaveTextContent('7'))
    expect((await send(view, '답변할 것 알려줘')).screenContext).toEqual({
      view: 'AI 위임 작업',
      scope: { label: 'AI 위임 작업', facts: [{ label: '범위', value: '전체' }, { label: 'AI 진행', value: '답변 필요' }], count: 7 },
    })
  })
})

// 개인 프로젝트에서 연 태스크 패널 — 열린 태스크가 대상(focus), 범위는 「개인 프로젝트」.
test('개인 프로젝트 — 열린 개인 태스크가 대상으로, 범위는 개인 프로젝트로 실린다', async () => {
  const KEY = 'PME'
  const thread = createChatThread()
  const view = await openPanelAt(
    `/projects/${KEY}?task=1`,
    [
      http.get(`/api/v1/projects/${KEY}`, () => HttpResponse.json(createProject({ id: 7, key: KEY, name: '개인 작업', type: 'PERSONAL', isDefault: true }))),
      http.get(`/api/v1/projects/${KEY}/issues`, () =>
        HttpResponse.json(createIssueSearchResponse([createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' })])),
      ),
      ...issueDetailSubHandlers({ key: KEY, detail: createIssueDetail({ summary: createIssue({ projectKey: KEY, number: 1, title: '블로그 초안' }) }) }),
      http.get(`/api/v1/projects/${KEY}/issues/1/chat/thread`, () => HttpResponse.json(thread)),
      http.get(`/api/v1/chat/threads/${thread.threadId}/messages`, () => HttpResponse.json(createChatMessagePage([]))),
    ],
    { waitFor: 'personal-task-panel' },
  )
  await chipHas('이슈 PME-1 블로그 초안')
  expect((await send(view, '이거 정리해줘')).screenContext).toMatchObject({
    view: '이슈 상세',
    focus: { refs: { issueKey: 'PME-1' } },
    scope: { label: '개인 프로젝트', refs: { projectKey: KEY } },
  })
})

describe('메일', () => {
  /** 메일 상세가 함께 부르는 부가 조회 — 미읽음 수·AI 요약·연결 이슈는 비어 있다. */
  const mailExtras = (): RequestHandler[] => [
    http.get('/api/v1/mail/accounts/3/unread-counts', () =>
      HttpResponse.json({ classificationActive: false, inbox: 0, byCategory: {}, needsReply: 0 }),
    ),
    http.get('/api/v1/mail/messages/91/summary', () => new HttpResponse(null, { status: 404 })),
    http.get('/api/v1/mail/messages/91/linked-issue', () => HttpResponse.json({ issueKey: null })),
  ]

  // 열린 메일의 messageId·제목과 폴더(INBOX)·목록 건수가 실린다.
  test('열린 메일의 messageId·제목과 폴더가 실린다', async () => {
    const view = await openPanelAt('/mail/3?messageId=91', [
      ...mailExtras(),
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount({ id: 3 })])),
      http.get('/api/v1/mail/accounts/3/messages', () =>
        HttpResponse.json([summary({ id: 91, accountId: 3, subject: '견적 요청', fromName: '김철수', fromAddress: 'kim@a.com' })]),
      ),
      http.get('/api/v1/mail/messages/91', () => HttpResponse.json(detail({ id: 91, subject: '견적 요청' }))),
    ])
    await chipHas('메일 견적 요청')
    expect((await send(view, '이 메일 요약해줘')).screenContext).toMatchObject({
      view: '메일함',
      focus: { type: '메일', label: '견적 요청', refs: { messageId: '91' } },
      scope: { refs: { accountId: '3', folder: 'INBOX' }, count: 1 },
    })
  })

  // WP-146: 회신필요 필터에서 연 메일이 읽음 처리로 목록 refetch 에서 빠져도 열린 메일은 컨텍스트에 남는다.
  test('열린 메일이 목록 refetch 로 빠져도 컨텍스트에 유지된다(WP-146)', async () => {
    let listCalls = 0
    const view = await openPanelAt(
      '/mail/3?needsReply=true',
      [
        ...mailExtras(),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([mailAccount({ id: 3, aiEnabled: true })])),
        // 처음엔 회신필요 1건, 그 뒤 refetch 부터는 읽음 처리돼 빈 목록.
        http.get('/api/v1/mail/accounts/3/messages', () => {
          listCalls += 1
          return HttpResponse.json(
            listCalls === 1
              ? [summary({ id: 91, accountId: 3, subject: '견적 요청', fromName: '김철수', fromAddress: 'kim@a.com', aiNeedsReply: true, seen: false })]
              : [],
          )
        }),
        http.get('/api/v1/mail/messages/91', () => HttpResponse.json(detail({ id: 91, subject: '견적 요청', fromName: '김철수', fromAddress: 'kim@a.com' }))),
      ],
      {
        waitFor: 'mail-row-91',
        before: async ({ user, queryClient }) => {
          await user.click(screen.getByTestId('mail-row-91'))
          await screen.findByTestId('mail-detail')
          // 60초 주기 refetch 를 대신해 활성 쿼리를 다시 불러 빈 목록을 받게 한다.
          await act(() => queryClient.refetchQueries({ type: 'active' }))
          await waitFor(() => expect(screen.queryByTestId('mail-row-91')).not.toBeInTheDocument())
          expect(listCalls).toBeGreaterThanOrEqual(2)
        },
      },
    )
    await chipHas('메일 견적 요청')
    expect((await send(view, '이 메일 요약해줘')).screenContext).toMatchObject({
      view: '메일함',
      focus: { type: '메일', label: '견적 요청', refs: { messageId: '91' } },
    })
  })
})

describe('캘린더', () => {
  // 오늘 정오(UTC) 일정 — 기본 월 보기에 항상 보이도록 팩토리 기본 날짜를 덮어쓴다.
  const startsAt = new Date(new Date().toISOString().slice(0, 10) + 'T03:00:00Z')
  const ev = calendarEvent({
    id: 42, title: '주간회의', location: '3층',
    startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + 3600_000).toISOString(),
  })
  const calendarHandlers = (): RequestHandler[] => [
    http.get('/api/v1/calendars', () => HttpResponse.json([calendar()])),
    http.get('/api/v1/calendar/events', () => HttpResponse.json([ev])),
    http.get('/api/v1/calendar/events/42', () => HttpResponse.json(ev)),
  ]

  // ?eventId 딥링크로 열린 일정 다이얼로그가 칩(focus)에 반영되고, 다이얼로그 위에서 ⌘K 로 연 패널로 보내면 eventId·장소·월 보기 범위가 실린다.
  // 다이얼로그와 패널 사이의 실제 클릭·포커스 상호작용은 E2E(@input)가 지킨다.
  test('?eventId 딥링크로 열린 일정이 칩에 반영되고 전송에 eventId 가 실린다', async () => {
    const chat = chatCapture()
    const view = renderPage('/calendar?eventId=42', { handlers: [...chat.handlers, ...calendarHandlers()] })
    await screen.findByTestId('calendar-event-dialog', {}, { timeout: PAGE_LOAD_TIMEOUT })
    // 모달 다이얼로그가 런처 클릭을 가로막으므로 ⌘K 로 AI 패널을 연다.
    await view.user.keyboard('{Control>}k{/Control}')
    await screen.findByTestId('ai-side-panel')
    await chipHas('일정 주간회의')
    const body = await send({ ...view, chat }, '이 회의 참석자 알려줘')
    expect(body.screenContext).toMatchObject({
      view: '캘린더',
      focus: { type: '일정', label: '주간회의', refs: { eventId: '42' } },
      scope: { label: '월 보기', count: 1 },
    })
    expect(body.screenContext!.scope!.refs).toHaveProperty('from')
    expect(body.screenContext!.focus!.facts).toContainEqual({ label: '장소', value: '3층' })
    expect(screen.getByTestId('calendar-event-dialog')).toBeInTheDocument()
  })
})

describe('채팅', () => {
  /** 사이드바 채널·DM 목록·스레드 미읽음. */
  const sidebar = (channels: ReturnType<typeof createChannel>[], dms: ReturnType<typeof createDm>[]): RequestHandler[] => [
    http.get('/api/v1/messaging/channels', () => HttpResponse.json(channels)),
    http.get('/api/v1/messaging/dms', () => HttpResponse.json(dms)),
  ]

  // 채널 + 열린 스레드 — focus 는 스레드 루트(messageId), 범위는 채널(#dev, 멤버 수).
  test('채널 + 열린 스레드가 실린다', async () => {
    const channel = createChannel({ id: 5, name: 'dev', memberCount: 8 })
    const root = createMessage({ id: 77, channelId: 5, authorId: 2, authorName: '김철수', body: '배포 언제?\n내일 가능?', replyCount: 3 })
    const view = await openPanelAt('/chat/channels/5?thread=77', [
      ...sidebar([channel], []),
      http.get('/api/v1/messaging/channels/5', () => HttpResponse.json(channel)),
      http.get('/api/v1/messaging/channels/5/members', () => HttpResponse.json([createChannelMember({ userId: 1, name: '나' })])),
      http.get('/api/v1/messaging/channels/5/messages', () => HttpResponse.json({ items: [root], nextCursor: null, hasMore: false })),
      http.get('/api/v1/messaging/messages/77/replies', () => HttpResponse.json(emptyCursor)),
    ])
    // 채널 상세 + 메시지 목록(스레드 루트)이 모두 반영된 최종 칩을 확인한 뒤 보낸다 — 부분 payload 경합 방지.
    await chipHas('스레드 김철수: 배포 언제?')
    const body = await send(view, '이 스레드 정리해줘')
    expect(body.screenContext).toMatchObject({
      view: '채널',
      focus: { type: '스레드', refs: { messageId: '77' } },
      scope: { label: '채널 #dev', refs: { channelId: '5' } },
    })
    expect(body.screenContext!.scope!.facts).toContainEqual({ label: '멤버', value: '8' })
  })

  // DM 은 상대 이름과 channelId 가 범위로 실린다.
  test('DM 은 상대 이름과 channelId 가 실린다', async () => {
    const dm = createDm({ id: 9, participants: [createDmParticipant({ userId: 1, name: '나' }), createDmParticipant({ userId: 2, name: '김철수' })] })
    const view = await openPanelAt('/chat/dms/9', [
      ...sidebar([], [dm]),
      http.get('/api/v1/messaging/channels/9', () => HttpResponse.json(dm)),
      http.get('/api/v1/messaging/channels/9/messages', () => HttpResponse.json(emptyCursor)),
    ])
    await chipHas('DM · 김철수')
    expect((await send(view, '무슨 얘기 했지?')).screenContext).toMatchObject({ view: 'DM', scope: { label: 'DM · 김철수', refs: { channelId: '9' } } })
  })

  // 스레드 모아보기는 로드된 스레드 수와 더 있음 여부가 실린다.
  test('스레드 모아보기는 로드된 스레드 수가 실린다', async () => {
    const view = await openPanelAt(
      '/chat/threads/inbox',
      [
        ...sidebar([], []),
        http.get('/api/v1/messaging/threads/inbox', () =>
          HttpResponse.json({
            items: [
              createThreadInboxItem({ rootMessage: { id: 11, channelId: 5, body: 'A' } }),
              createThreadInboxItem({ rootMessage: { id: 12, channelId: 5, body: 'B' } }),
            ],
            nextCursor: null,
            hasMore: false,
          }),
        ),
      ],
      { waitFor: 'thread-inbox-card-12' },
    )
    await chipHas('내 스레드 모아보기')
    expect((await send(view, '정리해줘')).screenContext).toMatchObject({ view: '스레드 모아보기', scope: { count: 2, hasMore: false } })
  })
})

describe('드라이브', () => {
  // 스페이스 4('팀 드라이브'), 폴더 11(경로 기획/2026), 파일 drive_file id=300 (core fileId=999 와 구분).
  const driveHandlers = (opts: { folderId: number | null; pathFails?: boolean }): RequestHandler[] => {
    const file = createFile({
      id: 300, fileId: 999, name: '회의록.txt', mimeType: 'text/plain', sizeBytes: 2048, folderId: opts.folderId, updatedAt: '2026-09-29T00:00:00Z',
    })
    return [
      http.get('/api/v1/drive/spaces', () => HttpResponse.json([createSpace({ id: 4, name: '팀 드라이브' })])),
      http.get('/api/v1/drive/spaces/4', () => HttpResponse.json(createSpace({ id: 4, name: '팀 드라이브' }))),
      http.get('/api/v1/drive/quota', () => HttpResponse.json({ usedBytes: 0, quotaBytes: 10737418240 })),
      http.get('/api/v1/drive/spaces/4/items', () =>
        HttpResponse.json({ folders: opts.folderId == null ? [createFolder({ id: 11, name: '2026' })] : [], files: [file] }),
      ),
      http.get('/api/v1/drive/folders/11/path', () =>
        opts.pathFails
          ? HttpResponse.json({ message: 'fail' }, { status: 500 })
          : HttpResponse.json([{ id: 5, name: '기획' }, { id: 11, name: '2026' }]),
      ),
      http.get('/api/v1/drive/files/300/thumbnail', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/v1/drive/files/300/content', () => new HttpResponse('회의 내용', { headers: { 'Content-Type': 'text/plain' } })),
      http.get('/api/v1/drive/files/300/summary', () => HttpResponse.json({ summary: null, status: 'PENDING' })),
      http.get('/api/v1/drive/files/300/backlinks', () => HttpResponse.json([])),
    ]
  }

  /** 패널을 연 채 파일 미리보기를 연다. */
  const openPreview = async (view: Awaited<ReturnType<typeof openPanelAt>>) => {
    await view.user.click(await screen.findByRole('button', { name: '회의록.txt' }))
    await screen.findByTestId('preview-body')
    await chipHas('파일 회의록.txt')
  }

  // 폴더 화면 — 스페이스·경로 라벨, spaceId·parentId, 항목 개수가 범위로 실리고 focus 는 없다.
  test('폴더 scope(스페이스·경로·parentId)와 항목 개수가 실린다', async () => {
    const view = await openPanelAt('/drive/spaces/4?folderId=11', driveHandlers({ folderId: 11 }))
    await chipHas('드라이브 팀 드라이브 / 기획 / 2026')
    await screen.findByRole('button', { name: '회의록.txt' })
    const body = await send(view, '이 폴더 정리해줘')
    expect(body.screenContext).toMatchObject({
      view: '드라이브',
      scope: { label: '드라이브 팀 드라이브 / 기획 / 2026', refs: { spaceId: '4', parentId: '11' }, facts: [{ label: '항목', value: '폴더 0 · 파일 1' }] },
    })
    expect(body.screenContext?.focus).toBeUndefined()
  })

  // 패널을 연 채 미리보기를 열면 파일 focus 에 drive_file id(300)가 실리고 core fileId(999)는 보내지 않는다.
  test('사이드 패널을 연 채 미리보기를 열고 전송하면 파일 focus 에 driveFileId 가 실린다', async () => {
    const view = await openPanelAt('/drive/spaces/4', driveHandlers({ folderId: null }))
    await openPreview(view)
    const body = await send(view, '이 파일 요약')
    expect(body.screenContext).toMatchObject({
      focus: { type: '파일', label: '회의록.txt', refs: { driveFileId: '300' } },
      scope: { label: '드라이브 팀 드라이브', refs: { spaceId: '4' } },
    })
    expect(JSON.stringify(body.screenContext)).not.toContain('999')
  })

  // 폴더 경로 조회가 500 이어도 경로 라벨만 빠지고 spaceId·parentId·파일 focus 는 실린다.
  test('폴더 경로 조회가 실패해도 spaceId·parentId·파일 focus 는 실린다(경로만 생략)', async () => {
    const view = await openPanelAt('/drive/spaces/4?folderId=11', driveHandlers({ folderId: 11, pathFails: true }))
    await openPreview(view)
    expect((await send(view, '이 파일 요약')).screenContext).toMatchObject({
      focus: { refs: { driveFileId: '300' } },
      scope: { label: '드라이브 팀 드라이브', refs: { spaceId: '4', parentId: '11' } },
    })
  })
})

describe('연락처', () => {
  // 통합 목록(외부 김철수 55 + 구성원 김멤버 1)·상세·사이드바용 facets/그룹 트리.
  const contactsHandlers = (): RequestHandler[] => [
    http.get('/api/v1/contacts', ({ request }) => {
      const type = new URL(request.url).searchParams.get('type') ?? 'ALL'
      const all = [contactMember(), contactExternal({ id: 55, name: '김철수', email: 'cs@corp.com', organization: '에이사' })]
      return HttpResponse.json(contactsPage(type === 'ALL' ? all : all.filter((c) => c.type === type)))
    }),
    http.get('/api/v1/contacts/facets', () => HttpResponse.json({ organizations: [], titles: [] })),
    http.get('/api/v1/contacts/external/55', () =>
      HttpResponse.json(contactExternalDetail({ id: 55, name: '김철수', email: 'cs@corp.com', organization: '에이사' })),
    ),
    http.get('/api/v1/contacts/members/1', () => HttpResponse.json(contactMemberDetail({ username: 'kim' }))),
  ]

  // 외부 연락처를 고르면 externalId·구분, 유형 필터와 건수가 실린다.
  test('외부 연락처 선택 시 externalId 와 필터·건수가 실린다', async () => {
    const view = await openPanelAt('/contacts?type=EXTERNAL', contactsHandlers(), {
      waitFor: 'contact-row-EXTERNAL-55',
      before: async ({ user }) => {
        await user.click(within(screen.getByTestId('contact-row-EXTERNAL-55')).getByRole('button', { name: /^외부\s*김철수/ }))
      },
    })
    await chipHas('연락처 김철수')
    const body = await send(view, '이 사람이랑 최근 메일')
    expect(body.screenContext).toMatchObject({
      view: '연락처',
      focus: { type: '연락처', label: '김철수', refs: { externalId: '55' } },
      scope: { label: '연락처', facts: [{ label: '유형', value: '외부' }], count: 1, hasMore: false },
    })
    expect(body.screenContext!.focus!.facts).toContainEqual({ label: '구분', value: '외부' })
  })

  // 구성원은 상세 응답이 온 뒤에야 username 이 실린다(userId 아님) — externalId 가 섞이지 않는다.
  test('구성원 선택은 상세 응답이 온 뒤 username 이 실린다(userId 아님)', async () => {
    const view = await openPanelAt('/contacts', contactsHandlers(), {
      waitFor: 'contact-row-MEMBER-1',
      before: async ({ user }) => {
        await user.click(within(screen.getByTestId('contact-row-MEMBER-1')).getByRole('button', { name: /^멤버\s*김멤버/ }))
        // 상세 패널에 응답 내용(그룹)이 그려진 뒤에야 컨텍스트가 username 을 가진다.
        await waitFor(() => expect(screen.getByTestId('contact-detail')).toHaveTextContent('개발팀'))
      },
    })
    await chipHas('연락처 김멤버')
    const body = await send(view, '이 사람 연락처')
    expect(body.screenContext).toMatchObject({ focus: { label: '김멤버', refs: { username: 'kim' } }, scope: { count: 2, hasMore: false } })
    expect(body.screenContext!.focus!.facts).toContainEqual({ label: '구분', value: '구성원' })
    expect(body.screenContext!.focus!.refs).not.toHaveProperty('externalId')
  })
})
