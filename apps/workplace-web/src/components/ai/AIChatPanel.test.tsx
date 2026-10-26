// 메인 AI 채팅 패널(AIChatPanel) — 화면 컴포넌트 테스트(WP-971, WP-995).
// 첨부 초안(WP-234)의 × 제거·세션 상한·서버 거절(400)·대화 전환·보낸 직후 미리보기·4종 밖 이미지·세션 복원 렌더, 글자 수 상한(WP-674),
// 답 안 인라인 위젯(#431 mail_list·issue_list)은 브라우저 없이 판정되므로 e2e/pages/home-chat-attachments.spec.ts·home-chat-widgets.spec.ts 에서 옮겼다.
// 붙여넣기·드롭·업로드 중 Enter(@input), 캔버스 축소(@platform), 썸네일 크기·하단 고정·정렬(@layout), 진입 배선(@wiring)은 E2E 에 남는다.
// 패널만 renderScreen 으로 띄운다 — 앱 셸(useEventStream)이 없으므로 home.chat.* 프레임은 SSE 대신 이벤트 버스(emitAiStreamEvent)로 넣는다.
// 스트림 전송층(/api/v1/events → 버스)은 useEventStream.test.ts 가 지킨다.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { AIChatPanel } from '@/components/ai/AIChatPanel'
import { AiScreenContextProvider } from '@/components/ai/screen-context/AiScreenContextProvider'
import { ChatSessionProvider } from '@/hooks/ChatSessionContext'
import { useAssistantChat } from '@/hooks/useAssistantChat'
import { chatStreams } from '@/lib/ai/chatStreams'
import { emitAiStreamEvent } from '@/lib/aiEventBus'
import { PER_SESSION_LIMIT_MSG } from '@/lib/homeChatAttachments'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen } from '@/test/renderScreen'
import type { HomeMessage, HomeSessionPage } from '@/types/home'

import { createHomeAttachment } from '../../../e2e/factories/homeAttachment.factory'
import { createIssue, createIssueSearchResponse } from '../../../e2e/factories/issue.factory'
import { mailAccount, summary } from '../../../e2e/factories/mail.factory'

const API = '/api/v1'

/** 전송 시작 요청 본문(e2e/fixtures/home-chat-mock 의 HomeChatStartBody 와 같은 모양). */
type StartBody = { sessionId: string | null; query: string; correlationId: string; fileIds?: number[] }

/** 앱 셸처럼 대화 상태·AI 모드·화면 참고 공급자 안에 패널을 그린다(AISidePanel 이 하는 일에서 폭 조절만 뺐다). */
function Panel() {
  const chat = useAssistantChat()
  return <AIChatPanel {...chat} />
}

/**
 * 패널을 띄운다. 업로드는 파일마다 fileId 를 7000번부터 주고(hold 면 release 까지 붙잡는다), 전송 시작은 보낸 correlationId 를 그대로 돌려준다.
 * chat: 'reject' 면 첫 전송만(또는 rejectAll 이면 전부) 400, gate 를 주면 그 프라미스가 풀린 뒤 응답한다.
 */
function renderPanel(
  opts: { handlers?: RequestHandler[]; hold?: boolean; reject?: string; rejectAll?: boolean; rejectGate?: Promise<void> } = {},
) {
  const uploaded: string[] = []
  attached.length = 0
  const starts: StartBody[] = []
  let next = 7000
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let rejected = false
  const handlers: RequestHandler[] = [
    ...(opts.handlers ?? []),
    http.post(`${API}/home/attachments`, async ({ request }) => {
      // jsdom 의 File 은 전송층(undici)을 지나며 이름을 잃는다(filename="blob") — 파트 수·형식만 본문에서 읽고, 이름은 attach() 가 넣은 순서로 짝짓는다.
      const types = [...(await request.text()).matchAll(/name="files"; filename="[^"]*"\r\nContent-Type: ([^\r\n]+)/g)].map(([, type]) => type)
      const files = types.map((type) => ({ name: attached.shift()!, type }))
      uploaded.push(...files.map((f) => f.name))
      if (opts.hold) await gate
      return HttpResponse.json(files.map((f) => ({ fileId: next++, originalName: f.name, mimeType: f.type, sizeBytes: 3 })))
    }),
    http.post(`${API}/ai/chat`, async ({ request }) => {
      const body = (await request.json()) as StartBody
      starts.push(body)
      if (opts.reject && (opts.rejectAll || !rejected)) {
        rejected = true
        if (opts.rejectGate) await opts.rejectGate
        return HttpResponse.json({ status: 400, error: 'Bad Request', message: opts.reject }, { status: 400 })
      }
      return HttpResponse.json({ correlationId: body.correlationId })
    }),
    ...shellHandlers,
  ]
  const view = renderScreen(
    <ChatSessionProvider>
      <AIAssistantProvider hotkeysEnabled={false}>
        <AiScreenContextProvider>
          <Panel />
        </AiScreenContextProvider>
      </AIAssistantProvider>
    </ChatSessionProvider>,
    { handlers },
  )
  /** 마지막 전송의 home.chat.* 프레임을 버스로 넣는다(앱 셸의 SSE 라우팅 자리). */
  const frame = (event: string, data: Record<string, unknown>) =>
    act(() => emitAiStreamEvent(`home.chat.${event}`, { correlationId: starts.at(-1)!.correlationId, ...data }))
  return { ...view, uploaded, starts, release, frame }
}

/** ＋ 메뉴의 숨은 파일 입력으로 파일을 넣는다(＋·붙여넣기·드롭 모두 같은 addFiles 로 모인다 — 입력 수단 자체는 E2E). */
function attach(...files: { name: string; type: string; size?: number }[]) {
  attached.push(...files.map((f) => f.name))
  const input = screen.getByTestId('ai-composer-file-input')
  fireEvent.change(input, { target: { files: files.map((f) => new File([new Uint8Array(f.size ?? 3)], f.name, { type: f.type })) } })
}

/** 넣은 파일 이름 순서 — 업로드 목이 응답 이름으로 쓴다(테스트마다 renderPanel 이 비운다). */
const attached: string[] = []

const chips = () => screen.queryByTestId('ai-composer-attachments')
const input = () => screen.getByTestId('chat-input') as HTMLTextAreaElement
const send = () => screen.getByTestId('chat-send')

/** 첨부가 붙은 대화 하나를 세션 목록·메시지로 준다. */
function sessionHandlers(id: string, messages: HomeMessage[], title = '첨부 대화'): RequestHandler[] {
  return [
    http.get(`${API}/home/sessions`, () =>
      HttpResponse.json({ items: [{ id, title, lastMessageAt: '2026-10-06T00:00:00Z', widgetCount: 0 }], nextCursor: null } satisfies HomeSessionPage)),
    http.get(`${API}/home/sessions/${id}/messages`, () => HttpResponse.json(messages)),
  ]
}

const userMessage = (content: string | null, attachments: HomeMessage['attachments']): HomeMessage => ({
  id: 1, role: 'USER', content, widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:00Z', attachments,
})

/** 세션 스위처에서 첫 대화를 복원하고 첫 턴을 돌려준다. */
async function restoreFirstSession(user: ReturnType<typeof renderPanel>['user']) {
  await user.click(await screen.findByTestId('chat-session-switcher'))
  await user.click((await screen.findAllByTestId('chat-session-select'))[0])
  return (await screen.findAllByTestId('chat-turn'))[0]
}

const toast = (text: string) => screen.findByText(text)

beforeEach(() => {
  // 대화 저장소는 모듈 싱글턴 — 앞 테스트의 대화·생성 중 상태가 넘어오지 않게 비운다(마운트한 훅이 다시 owner 를 정한다).
  chatStreams.setOwner(null)
})

describe('첨부 초안 (WP-234)', () => {
  // × 로 뺀 파일은 payload 에서 빠지고 그 로컬 미리보기 URL 은 해제된다(메모리 누수 방지).
  test('칩 × 로 뺀 파일은 보내지 않고, 그 미리보기 URL 은 해제한다', async () => {
    let n = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${n++}`)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { user, starts } = renderPanel()
    attach({ name: 'a.png', type: 'image/png' })
    await waitFor(() => expect(chips()).toHaveTextContent('a.png'))
    attach({ name: 'b.png', type: 'image/png' })
    await waitFor(() => expect(chips()).toHaveTextContent('b.png'))

    const before = revoke.mock.calls.length
    await user.click(within(within(chips()!).getByText('a.png').closest('li')!).getByRole('button', { name: '첨부 제거' }))
    await waitFor(() => expect(chips()).not.toHaveTextContent('a.png'))
    expect(revoke.mock.calls.slice(before).map(([u]) => u)).toEqual(['blob:preview-0'])

    await user.click(send())
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toMatchObject({ query: '', fileIds: [7001] })
  })

  // 세션 30개 상한은 업로드 전에 막는다 — 복원된 대화의 29개 + 2개.
  test('세션에 이미 29개가 있으면 2개 추가는 안내하고 올리지 않는다', async () => {
    const atts = Array.from({ length: 29 }, (_, i) => createHomeAttachment({ fileId: 8000 + i, originalName: `doc-${i}.pdf` }))
    const { user, uploaded } = renderPanel({ handlers: sessionHandlers('s-full', [userMessage('자료 모음', atts)]) })
    const turn = await restoreFirstSession(user)
    // 복원된 사용자 말풍선 아래에 세션 첨부(마지막 29번째) 카드가 다시 그려진다(PF-C2).
    expect(await within(turn).findByTestId('attachment-card-8028')).toHaveTextContent('doc-28.pdf')
    attach({ name: 'a.txt', type: 'text/plain' }, { name: 'b.txt', type: 'text/plain' })
    expect(await toast(PER_SESSION_LIMIT_MSG)).toBeInTheDocument()
    expect(uploaded).toEqual([])
    expect(chips()).not.toBeInTheDocument()
  })

  test('서버가 전송을 거절(400)하면 message 를 그대로 보여 주고 칩은 남긴다', async () => {
    const reason = '첨부 파일이 만료되었어요. 다시 올려 주세요.'
    const { user } = renderPanel({ reject: reason })
    attach({ name: 'old.png', type: 'image/png' })
    await waitFor(() => expect(chips()).toHaveTextContent('old.png'))
    await user.click(send())
    expect(await toast(reason)).toBeInTheDocument()
    expect(chips()).toHaveTextContent('old.png')
    // 거절된 낙관적 사용자 턴에는 첨부가 남지 않는다.
    expect(within(screen.getByTestId('chat-panel')).queryByTestId('message-attachments')).not.toBeInTheDocument()
  })

  test('거절(400)된 전송의 첨부는 대화에 남지 않고, 남은 칩으로 같은 fileIds 를 다시 보낸다', async () => {
    const atts = Array.from({ length: 24 }, (_, i) => createHomeAttachment({ fileId: 8000 + i, originalName: `doc-${i}.pdf` }))
    const { user, starts } = renderPanel({
      reject: '잠시 후 다시 보내 주세요.',
      handlers: sessionHandlers('s-retry', [userMessage('자료 모음', atts)]),
    })
    await restoreFirstSession(user)
    attach(...Array.from({ length: 5 }, (_, i) => ({ name: `r${i}.txt`, type: 'text/plain' })))
    await waitFor(() => expect(within(chips()!).getAllByRole('listitem')).toHaveLength(5))
    fireEvent.change(input(), { target: { value: '이 파일들 정리해줘' } })
    await user.click(send())
    expect(await toast('잠시 후 다시 보내 주세요.')).toBeInTheDocument()
    // 거절되면 입력한 질문도 입력창에 되돌아온다(칩과 함께 그대로 다시 보낼 수 있게).
    await waitFor(() => expect(input()).toHaveValue('이 파일들 정리해줘'))
    // 거절된 턴의 말풍선엔 첨부가 없다 — 복원된 첫 턴의 첨부 목록 하나만 있다.
    const panel = screen.getByTestId('chat-panel')
    expect(within(panel).getAllByTestId('message-attachments')).toHaveLength(1)
    expect(within(panel).queryByTestId('attachment-card-7000')).not.toBeInTheDocument()
    expect(within(chips()!).getAllByRole('listitem')).toHaveLength(5)

    // 거절분이 세션 수에 잡혀 있으면(24 + 5) 1개 추가가 30개를 넘어 막힌다 — 떨어졌다면 24 + 초안 5 + 1 = 30 이라 올라간다.
    attach({ name: 'extra.png', type: 'image/png' })
    await waitFor(() => expect(chips()).toHaveTextContent('extra.png'))
    expect(screen.queryByText(PER_SESSION_LIMIT_MSG)).not.toBeInTheDocument()
    await user.click(within(within(chips()!).getByText('extra.png').closest('li')!).getByRole('button', { name: '첨부 제거' }))
    await waitFor(() => expect(within(chips()!).getAllByRole('listitem')).toHaveLength(5))

    // 다시 보내면 처음과 같은 fileIds 가 실린다.
    await user.click(send())
    await waitFor(() => expect(starts).toHaveLength(2))
    expect(starts[0].fileIds).toEqual([7000, 7001, 7002, 7003, 7004])
    expect(starts[1]).toMatchObject({ sessionId: 's-retry', query: '이 파일들 정리해줘', fileIds: starts[0].fileIds })
    await waitFor(() => expect(chips()).not.toBeInTheDocument())
  })

  test('거절(400)이 늦게 오면 그 사이 새로 입력한 글은 덮어쓰지 않는다', async () => {
    let releaseReject!: () => void
    const rejectGate = new Promise<void>((r) => (releaseReject = r))
    const { user } = renderPanel({ reject: '잠시 후 다시 보내 주세요.', rejectGate })
    attach({ name: 'memo.txt', type: 'text/plain' })
    await waitFor(() => expect(chips()).toHaveTextContent('memo.txt'))
    fireEvent.change(input(), { target: { value: '처음 질문' } })
    await user.click(send())
    await waitFor(() => expect(input()).toHaveValue(''))
    fireEvent.change(input(), { target: { value: '새로 쓰는 중' } })
    releaseReject()
    expect(await toast('잠시 후 다시 보내 주세요.')).toBeInTheDocument()
    expect(input()).toHaveValue('새로 쓰는 중')
  })

  test('새 대화로 옮기면 첨부 초안이 비고, 첫 응답으로 세션 id 가 정해질 땐 비지 않는다', async () => {
    const { user, starts, frame } = renderPanel()
    fireEvent.change(input(), { target: { value: '첫 질문' } })
    await user.click(send())
    await waitFor(() => expect(starts).toHaveLength(1))
    // 생성 중에 다음 질문용 첨부를 붙인다.
    attach({ name: 'next.png', type: 'image/png' })
    await waitFor(() => expect(chips()).toHaveTextContent('next.png'))
    await frame('delta', { text: '답했어요' })
    await frame('done', { sessionId: 's-first' })
    expect(await within(screen.getByTestId('chat-panel')).findByText('답했어요')).toBeInTheDocument()
    expect(chips()).toHaveTextContent('next.png')

    await user.click(screen.getByTestId('chat-new-session'))
    await waitFor(() => expect(chips()).not.toBeInTheDocument())
  })

  test('업로드 도중 새 대화로 옮기면 늦게 끝난 파일은 새 대화 초안에 들어오지 않는다', async () => {
    const { user, release } = renderPanel({ hold: true })
    attach({ name: 'late.png', type: 'image/png' })
    expect(await screen.findByTestId('ai-composer-uploading-chip')).toHaveTextContent('late.png')
    await user.click(screen.getByTestId('chat-new-session'))
    release()
    // 업로드가 끝나 진행 칩이 사라진 뒤에도 초안 칩은 생기지 않고, 보낼 것이 없어 보내기는 비활성이다.
    await waitFor(() => expect(screen.queryByTestId('ai-composer-uploading-chip')).not.toBeInTheDocument())
    expect(chips()).not.toBeInTheDocument()
    expect(send()).toHaveTextContent('보내기')
    expect(send()).toBeDisabled()
  })

  // 새 대화 첫 메시지는 세션 id 가 없어 서버 원본을 받을 수 없다 — 로컬 미리보기를 쓰고, 세션이 정해진 뒤에도 원본을 다시 받지 않는다.
  test('보낸 직후(세션 id 없음)에도 이미지는 로컬 미리보기로 보인다', async () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:local-shot')
    const contents: string[] = []
    const { user, starts, frame } = renderPanel({
      handlers: [http.get(`${API}/home/sessions/:id/attachments/:fileId/content`, ({ request }) => {
        contents.push(request.url)
        return new HttpResponse(null, { status: 404 })
      })],
    })
    attach({ name: 'shot.png', type: 'image/png' })
    await waitFor(() => expect(chips()).toHaveTextContent('shot.png'))
    await user.click(send())
    await waitFor(() => expect(starts).toHaveLength(1))
    const turn = screen.getAllByTestId('chat-turn')[0]
    const img = await within(turn).findByTestId('attachment-image-7000')
    expect(img).toHaveAttribute('src', 'blob:local-shot')
    expect(img).toHaveAttribute('alt', 'shot.png')
    // WP-279: 세션이 정해지기 전엔 원본 경로가 없어 뷰어로 열 수 없다(누를 수 있는 버튼이 아니다).
    expect(within(turn).queryByTestId('attachment-image-open-7000')).not.toBeInTheDocument()
    await frame('done', { sessionId: 's-new' })
    await waitFor(() => expect(within(turn).getByTestId('attachment-image-7000')).toHaveAttribute('src', 'blob:local-shot'))
    expect(contents).toEqual([])
  })

  // 4종(jpeg·png·gif·webp) 밖의 image/* 는 썸네일·blob 링크 없이 문서 카드로만 그린다(SVG 를 앱 출처 blob 으로 열면 스크립트가 돈다).
  test('4종 밖 이미지(SVG·HEIC)는 보낸 직후에도 문서 카드로 그리고 로컬 미리보기 blob 을 만들지 않는다', async () => {
    const blobTypes: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((o: Blob | MediaSource) => {
      if (o instanceof Blob) blobTypes.push(o.type)
      return 'blob:x'
    })
    const { user, starts } = renderPanel()
    attach({ name: 'logo.svg', type: 'image/svg+xml' })
    await waitFor(() => expect(chips()).toHaveTextContent('logo.svg'))
    attach({ name: 'IMG_0001.heic', type: 'image/heic' })
    await waitFor(() => expect(chips()).toHaveTextContent('IMG_0001.heic'))
    await user.click(send())
    await waitFor(() => expect(starts).toHaveLength(1))
    expect(starts[0]).toMatchObject({ query: '', fileIds: [7000, 7001] })

    const atts = await within(screen.getAllByTestId('chat-turn')[0]).findByTestId('message-attachments')
    expect(within(atts).getByTestId('attachment-card-7000')).toHaveTextContent('logo.svg')
    expect(within(atts).getByTestId('attachment-card-7001')).toHaveTextContent('IMG_0001.heic')
    expect(atts.querySelectorAll('img')).toHaveLength(0)
    expect(atts.querySelectorAll('a[target="_blank"]')).toHaveLength(0)
    expect(blobTypes.filter((t) => t === 'image/svg+xml' || t === 'image/heic')).toEqual([])
  })
})

describe('세션 복원 첨부 렌더 (WP-234·WP-279)', () => {
  // 첨부만 보낸 메시지의 content — api 는 "" 로 저장·응답하지만 타입상 null 도 올 수 있어 둘 다 고정한다.
  for (const emptyContent of [null, ''] as const) {
    test(`첨부만 보낸 메시지(content ${JSON.stringify(emptyContent)})도 썸네일·문서 카드로 다시 그리고 카드는 뷰어로 연다`, async () => {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:thumb')
      const { user } = renderPanel({
        handlers: [
          ...sessionHandlers('s-r', [
            userMessage(emptyContent, [
              createHomeAttachment({ fileId: 77, originalName: 'board.png', mimeType: 'image/png', sizeBytes: 68 }),
              createHomeAttachment({ fileId: 78, originalName: 'spec.pdf' }),
            ]),
            { id: 2, role: 'ASSISTANT', content: '두 파일 모두 확인했어요', widgets: null, toolCalls: null, createdAt: '2026-10-06T00:00:01Z' },
          ]),
          http.get(`${API}/home/sessions/s-r/attachments/:fileId/content`, ({ params }) =>
            new HttpResponse(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': params.fileId === '77' ? 'image/png' : 'application/pdf' } })),
        ],
      })
      const userTurn = await restoreFirstSession(user)
      expect(screen.getAllByTestId('chat-turn')).toHaveLength(2)
      expect(await within(userTurn).findByTestId('attachment-image-77')).toHaveAttribute('src', 'blob:thumb')
      expect(within(userTurn).getByTestId('attachment-card-78')).toHaveTextContent('spec.pdf')
      // 첨부만 보낸 턴은 본문 말풍선이 없다.
      expect(within(userTurn).queryByTestId('chat-user-bubble')).not.toBeInTheDocument()
      expect(screen.getByTestId('chat-panel')).toHaveTextContent('두 파일 모두 확인했어요')
      // WP-279: 카드는 바로 받지 않고 통합 뷰어로 연다(받기 ⬇ 는 다운로드라 E2E @platform).
      await user.click(within(userTurn).getByTestId('attachment-card-78'))
      expect(await screen.findByTestId('attachment-viewer')).toHaveAccessibleName('spec.pdf 미리보기')
    })
  }

  test('4종 밖 이미지(SVG·HEIC)는 원본을 미리 받지 않고 문서 카드로 그리며, 카드는 뷰어로 연다', async () => {
    const contents: string[] = []
    const { user } = renderPanel({
      handlers: [
        ...sessionHandlers('s-v', [
          userMessage('자료 모음', [
            createHomeAttachment({ fileId: 95, originalName: 'logo.svg', mimeType: 'image/svg+xml', sizeBytes: 512 }),
            createHomeAttachment({ fileId: 96, originalName: 'IMG_0001.heic', mimeType: 'image/heic', sizeBytes: 512 }),
          ]),
        ]),
        http.get(`${API}/home/sessions/s-v/attachments/:fileId/content`, ({ request }) => {
          contents.push(new URL(request.url).pathname)
          return new HttpResponse('<svg xmlns="http://www.w3.org/2000/svg"/>', { headers: { 'Content-Type': 'image/svg+xml' } })
        }),
      ],
    })
    const turn = await restoreFirstSession(user)
    const atts = within(turn).getByTestId('message-attachments')
    expect(within(atts).getByTestId('attachment-card-95')).toHaveTextContent('logo.svg')
    expect(within(atts).getByTestId('attachment-card-96')).toHaveTextContent('IMG_0001.heic')
    expect(atts.querySelectorAll('img')).toHaveLength(0)
    expect(atts.querySelectorAll('a[target="_blank"]')).toHaveLength(0)
    // 썸네일용 원본 요청이 나가지 않는다 — 카드를 눌러 뷰어를 열 때만 받는다.
    expect(contents).toEqual([])
    await user.click(within(atts).getByTestId('attachment-card-95'))
    expect(await screen.findByTestId('attachment-viewer')).toHaveAccessibleName('logo.svg 미리보기')
  })

  test('원본을 받지 못하면 썸네일 자리에 안내 문구, 본문 말풍선이 첨부 위에 온다', async () => {
    const { user } = renderPanel({
      handlers: [
        ...sessionHandlers('s-e', [userMessage('이거 봐줘', [createHomeAttachment({ fileId: 90, originalName: 'gone.png', mimeType: 'image/png' })])]),
        http.get(`${API}/home/sessions/s-e/attachments/90/content`, () =>
          HttpResponse.json({ status: 404, error: 'Not Found', message: '없음' }, { status: 404 })),
      ],
    })
    const turn = await restoreFirstSession(user)
    expect(await within(turn).findByText('이미지를 불러올 수 없습니다')).toBeInTheDocument()
    // 본문 말풍선이 위, 첨부가 아래(시안 5-1) — 같은 세로 흐름의 문서 순서로 본다.
    const bubble = within(turn).getByTestId('chat-user-bubble')
    expect(bubble).toHaveTextContent('이거 봐줘')
    expect(bubble.compareDocumentPosition(within(turn).getByTestId('message-attachments')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// WP-674: 본문 상한(10000자) — 80% 아래엔 카운터를 숨기고, 넘으면 빨간 카운터와 함께 보내기·Enter 를 막는다. 줄이면 잘리지 않고 그대로 간다.
test('본문이 10000자를 넘으면 글자 수가 빨갛게 보이고 보내기·Enter 가 막히며, 줄이면 그대로 보낸다', async () => {
  const { user, starts } = renderPanel()
  fireEvent.change(input(), { target: { value: '가'.repeat(100) } })
  expect(screen.queryByTestId('chat-char-count')).not.toBeInTheDocument()

  fireEvent.change(input(), { target: { value: '가'.repeat(10_001) } })
  const count = screen.getByTestId('chat-char-count')
  expect(count).toHaveTextContent('10001 / 10000')
  expect(count).toHaveClass('text-destructive')
  expect(send()).toBeDisabled()
  input().focus()
  await user.keyboard('{Enter}')
  expect(starts).toHaveLength(0)

  fireEvent.change(input(), { target: { value: '가'.repeat(10_000) } })
  expect(screen.getByTestId('chat-char-count')).toHaveTextContent('10000 / 10000')
  expect(screen.getByTestId('chat-char-count')).not.toHaveClass('text-destructive')
  await user.click(send())
  await waitFor(() => expect(starts).toHaveLength(1))
  expect(starts[0].query).toHaveLength(10_000)
})

// #431: show_* 도구가 지시한 위젯을 done 이벤트로 받아 렌더한다 — 예전엔 widgets[] 가 버려져 빈 버블이 됐다.
// 위젯은 자체 훅으로 데이터를 부르므로 params → 쿼리 전파와 셀 데이터를 함께 본다. 마감 초과 집계는 issueOverdue.test.ts.
describe('답 안 인라인 위젯 (#431)', () => {
  /** 질문을 보내고 위젯만 지시한 done 프레임을 넣는다. */
  async function askForWidget(view: ReturnType<typeof renderPanel>, query: string, widget: { type: string; params: Record<string, unknown> }) {
    fireEvent.change(input(), { target: { value: query } })
    await view.user.click(send())
    await waitFor(() => expect(view.starts).toHaveLength(1))
    await view.frame('done', { sessionId: 's-w', widgets: [widget] })
  }

  /** 계정 1 받은편지함 — 마지막 요청의 쿼리를 남긴다. */
  function mailHandlers(rows: ReturnType<typeof summary>[]) {
    const queries: URLSearchParams[] = []
    const handlers = [
      http.get(`${API}/mail/accounts`, () => HttpResponse.json([mailAccount({ id: 1 })])),
      http.get(`${API}/mail/accounts/1/messages`, ({ request }) => {
        queries.push(new URL(request.url).searchParams)
        return HttpResponse.json(rows)
      }),
    ]
    return { handlers, queries }
  }

  /** 내 이슈 — 마지막 요청의 쿼리를 남긴다. */
  function issueHandlers(respond: () => Response) {
    const queries: URLSearchParams[] = []
    const handlers = [
      http.get(`${API}/me/issues`, ({ request }) => {
        queries.push(new URL(request.url).searchParams)
        return respond()
      }),
    ]
    return { handlers, queries }
  }

  test('mail_list — folder 를 쿼리로 넘겨 메일 목록을 렌더하고 마크다운 표는 없다', async () => {
    const mail = mailHandlers([
      summary({ id: 10, subject: '프로젝트 회의 안내', fromName: '앨리스', seen: false }),
      summary({ id: 11, subject: '분기 보고서', fromName: '밥', seen: true, hasAttachment: false }),
    ])
    const view = renderPanel({ handlers: mail.handlers })
    await askForWidget(view, '메일 보여줘', { type: 'mail_list', params: { folder: 'INBOX' } })
    expect(screen.getByTestId('chat-widgets')).toBeInTheDocument()
    const items = await screen.findByTestId('maillist-items')
    expect(items).toHaveTextContent('프로젝트 회의 안내')
    expect(items).toHaveTextContent('앨리스')
    expect(items).toHaveTextContent('분기 보고서')
    expect(mail.queries.at(-1)?.get('folder')).toBe('INBOX')
    expect(screen.getByTestId('chat-panel')).not.toHaveTextContent('| # |')
  })

  test('mail_list — params.unreadOnly 가 unread=true 쿼리로 전파(#469)', async () => {
    const mail = mailHandlers([summary({ id: 20, subject: '안 읽은 공지', fromName: '캐럴', seen: false })])
    const view = renderPanel({ handlers: mail.handlers })
    await askForWidget(view, '안 읽은 메일 보여줘', { type: 'mail_list', params: { folder: 'INBOX', unreadOnly: true } })
    expect(await screen.findByTestId('maillist-items')).toHaveTextContent('안 읽은 공지')
    expect(mail.queries.at(-1)?.get('unread')).toBe('true')
  })

  test('#519 issue_list — 0건이면 요약 없이 정직한 빈 상태', async () => {
    const issues = issueHandlers(() => HttpResponse.json(createIssueSearchResponse([])))
    const view = renderPanel({ handlers: issues.handlers })
    await askForWidget(view, '내 이슈 보여줘', { type: 'issue_list', params: { assignee: 'me' } })
    expect(await screen.findByTestId('issuelist-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('issuelist-summary')).not.toBeInTheDocument()
  })

  // #841: AI 가 없는 라벨명으로 필터를 걸면 서버가 400 + 필드 사유로 거부한다 — 재시도로 풀리지 않으므로 서버 사유를 보인다.
  test('#841 issue_list — 필터 해석 실패(400)면 서버 사유를 표시', async () => {
    const issues = issueHandlers(() =>
      HttpResponse.json(
        {
          status: 400,
          error: 'Bad Request',
          message: '이슈 필터 값을 해석할 수 없습니다.',
          errors: { label: "라벨 '없는라벨' 을(를) 찾을 수 없습니다. 사용 가능: 버그, 문서" },
        },
        { status: 400 },
      ))
    const view = renderPanel({ handlers: issues.handlers })
    await askForWidget(view, '없는라벨 이슈 보여줘', { type: 'issue_list', params: { label: '없는라벨' } })
    const err = await screen.findByTestId('issuelist-error')
    expect(err).toHaveTextContent("라벨 '없는라벨' 을(를) 찾을 수 없습니다. 사용 가능: 버그, 문서")
    expect(err).not.toHaveTextContent('불러오지 못했습니다')
    expect(issues.queries.at(-1)?.get('label')).toBe('없는라벨')
  })

  test('issue_list — 빈 버블 회귀 방지(show_issue_list done 을 렌더)', async () => {
    const issues = issueHandlers(() =>
      HttpResponse.json(createIssueSearchResponse([createIssue({ projectKey: 'WP', number: 7, title: '위젯 렌더 이슈' })])))
    const view = renderPanel({ handlers: issues.handlers })
    await askForWidget(view, '내 이슈 목록 보여줘', { type: 'issue_list', params: { assignee: 'me' } })
    expect(screen.getByTestId('chat-widgets')).toBeInTheDocument()
    const items = await screen.findByTestId('issuelist-items')
    expect(items).toHaveTextContent('위젯 렌더 이슈')
    expect(items).toHaveTextContent('WP-7')
    expect(screen.getByTestId('issuelist-summary')).toHaveTextContent('총 1건')
    expect(issues.queries.at(-1)?.get('assignee')).toBe('me')
  })
})
