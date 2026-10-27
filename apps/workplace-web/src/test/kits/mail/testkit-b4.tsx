// 메일 화면 테스트 도우미(WP-984, WP-966 웨이브 3 b4) — 메일 모듈(사이드바 + 받은편지함 + 작성 도크)을 renderScreen 으로 띄운다.
// App·인증 부팅·앱 셸(레일·인박스·AI 패널)은 거치지 않는다. 메일 화면이 실제로 쓰는 공급자만 둔다:
// 작성 상태(MailComposeProvider)는 AppLayout 수준이라 여기서 감싸고, 도크가 AI 모드를 읽으므로 AIAssistantProvider 도 둔다.
// 메일 기본 조회(계정·동기화 상태·목록·안 읽은 수·메일함·임시저장)는 빈 성공으로 깔고, 테스트가 handlers 로 덮는다(MSW 는 나중 등록 우선).
import { http, HttpResponse, type RequestHandler } from 'msw'
import { Route, Routes } from 'react-router-dom'

import { AIAssistantProvider } from '@/components/ai/AIAssistantContext'
import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { MailComposeDock } from '@/components/mail/MailComposeDock'
import { MailModuleLayout } from '@/components/mail/MailModuleLayout'
import { MailInboxPage } from '@/pages/mail/MailInboxPage'
import { renderScreen } from '@/test/renderScreen'
import type { MailAccountResponse } from '@/types/mailAccount'
import type { EmailMessageSummary } from '@/types/mailMessage'

import { mailAccount } from '../../../../e2e/factories/mail.factory'

const API = '/api/v1'

// 작성창 본문(TipTap/ProseMirror)은 입력마다 선택 영역 좌표(Range.getClientRects)를 재 스크롤을 맞춘다. jsdom 은 Range 에
// 레이아웃 API 가 없어 던지므로 빈 사각형으로 둔다 — 좌표·스크롤은 이 파일들의 관심사가 아니다(그건 E2E @layout).
const emptyRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
document.elementFromPoint ??= () => null

/** 안 읽은 수(사이드바 하위 분류·회신필요) 기본값 — AI 분류가 켜진 계정의 0건. */
export function unreadCounts(overrides: Partial<{ classificationActive: boolean; inbox: number; needsReply: number; byCategory: Record<string, number> }> = {}) {
  return {
    classificationActive: true,
    inbox: 0,
    byCategory: { 업무: 0, 개인: 0, 알림: 0, 프로모션: 0, 뉴스레터: 0 },
    needsReply: 0,
    ...overrides,
  }
}

/** 메일 화면 기본 조회 — 계정 1건(또는 주어진 목록)·빈 목록·0 건. 테스트 handlers 가 이보다 우선한다. */
export function mailBaseHandlers({
  accounts = [mailAccount()],
  messages = [],
}: { accounts?: MailAccountResponse[]; messages?: EmailMessageSummary[] } = {}): RequestHandler[] {
  return [
    http.get(`${API}/mail/accounts`, () => HttpResponse.json(accounts)),
    http.get(`${API}/mail/accounts/:id/sync-status`, () => HttpResponse.json({ running: false })),
    http.get(`${API}/mail/accounts/:id/messages`, () => HttpResponse.json(messages)),
    http.get(`${API}/mail/accounts/:id/unread-counts`, () => HttpResponse.json(unreadCounts())),
    http.get(`${API}/mail/accounts/:id/folders`, () => HttpResponse.json([])),
    // 목록 끝이 바로 보이면 서버 이전 메일을 부른다(WP-965) — 기본은 「더 없음」(E2E setupAuthMocks 와 같음).
    http.post(`${API}/mail/accounts/:id/messages/older`, () =>
      HttpResponse.json({ running: false, fetched: 0, saved: 0, syncedSince: null, hasMore: false }),
    ),
    http.get(`${API}/mail/drafts/count`, () => HttpResponse.json({ count: 0 })),
    http.get(`${API}/mail/drafts`, () => HttpResponse.json([])),
    http.get(`${API}/mail/unread-summary`, () => HttpResponse.json({ workUnread: 0 })),
    http.post(`${API}/mail/messages/:id/read`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${API}/mail/messages/:id/unread`, () => new HttpResponse(null, { status: 204 })),
    // 상세의 연결 이슈 배지·요약 — 기본은 없음.
    http.get(`${API}/mail/messages/:id/linked-issue`, () => HttpResponse.json({ issueKey: null })),
    http.get(`${API}/mail/messages/:id/summary`, () => HttpResponse.json({ summary: null })),
    // 받는사람 자동완성 — 기본은 후보 없음.
    http.get(`${API}/mail/recent-recipients`, () => HttpResponse.json([])),
    http.get(`${API}/contacts`, () => HttpResponse.json({ items: [], nextCursor: null, hasMore: false })),
  ]
}

type RenderMailOptions = NonNullable<Parameters<typeof renderScreen>[1]> & {
  accounts?: MailAccountResponse[]
  messages?: EmailMessageSummary[]
}

/** 메일 화면을 path 로 띄운다. handlers 는 기본 조회보다 우선한다. */
export function renderMail(path = '/mail/1', { handlers = [], accounts, messages, ...rest }: RenderMailOptions = {}) {
  // App 의 메일 라우트(MailModuleLayout + MailInboxPage)와 AppLayout 의 작성 상태·도크만 그린다.
  const ui = (
    <MailComposeProvider>
      <AIAssistantProvider hotkeysEnabled={false}>
        {/* AppLayout 처럼 페이지 영역 표식 — 크게 보기 작성창이 이 안을 inert 로 만든다. 도크는 이 바깥(앱 전역)에 둔다. */}
        <div data-ai-page-root>
          <main>
            <Routes>
              <Route element={<MailModuleLayout />}>
                <Route path="/mail" element={<MailInboxPage />} />
                <Route path="/mail/:accountId" element={<MailInboxPage />} />
              </Route>
              {/* 메일 모듈 밖 — 이탈 뒤 도크 유지 같은 판정에 쓴다. */}
              <Route path="*" element={<div data-testid="outside-mail" />} />
            </Routes>
          </main>
        </div>
        <MailComposeDock />
      </AIAssistantProvider>
    </MailComposeProvider>
  )
  return renderScreen(ui, {
    ...rest,
    path,
    // MSW 는 한 번에 넘긴 목록에서 앞의 것이 우선한다 — 테스트 handlers 를 기본 조회보다 앞에 둔다.
    handlers: [...handlers, ...mailBaseHandlers({ accounts, messages })],
  })
}

/** 요청 기록 — 핸들러 안에서 URL·본문을 모은다. */
export type Recorded<T = unknown> = { url: URL; body: T }

/** method + 경로 핸들러를 만들고 요청을 calls 에 쌓는다. reply 는 응답(기본 204). */
export function record<T = unknown>(
  method: 'get' | 'post' | 'put' | 'delete' | 'patch',
  path: string,
  reply: (call: Recorded<T>, n: number) => Response | Promise<Response> = () => new HttpResponse(null, { status: 204 }),
) {
  const calls: Recorded<T>[] = []
  const handler = http[method](path, async ({ request }) => {
    let body: unknown = null
    const text = await request.clone().text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    }
    const call = { url: new URL(request.url), body: body as T }
    calls.push(call)
    return reply(call, calls.length)
  })
  return { handler, calls, last: () => calls[calls.length - 1] }
}
