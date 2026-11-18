// WP-1743 접기 규칙(설계 결정 5) — 읽기 창(pane) 작성 중 조건이 맞으면 그 자리에서 우측 하단으로 접히고, 쓰던 내용은 유지된다.
// 접기 4규칙: ① 폭 < 1024(isMobile) → min ② 슬롯 소실(메일 화면 밖) → min ③ AI 전체 화면 → dock ④ 다른 메일 선택 → min(MailInboxPage 가 처리).
// 「읽기 창으로」 비활성 사유(슬롯 없음·AI 전체 화면) 툴팁도 이 파일에서 함께 본다 — 데스크톱 헤더에만 단추가 있으므로(모바일 상단 바엔 없다).
// 좁은 폭 판정은 test/viewport.ts 의 mockResizableViewport — 폭을 바꾸면 캐시된 mql 의 matches 가 바뀌고 change 리스너가 불린다.
// 화면은 testkit-b4 renderMail 에 AI 모드 단추(extra)를 더해 띄운다(테스트킷 트리엔 AI 패널이 없어 전체 화면 진입을 여기서 만든다).
import { act, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { afterEach, expect, test } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { MailComposeProvider, useMailCompose } from '@/components/mail/MailComposeContext'
import { MailComposeDock } from '@/components/mail/MailComposeDock'
import { composeHostEl as hostEl, composeInPane as inPane, openReplyWithBody, paneDetailHandlers, paneMessages } from '@/test/kits/mail/compose-pane'
import { mailBaseHandlers, renderMail } from '@/test/kits/mail/testkit-b4'
import { renderScreen } from '@/test/renderScreen'
import { mockResizableViewport } from '@/test/viewport'

// ── 좁은 폭 시뮬레이션 ──────────────

const DESKTOP_WIDTH = 1440
// 파일 맨 위(첫 렌더 전)에서 한 번 — 스토어가 이 스텁의 mql 을 캐시하므로 그 뒤로는 폭 변경이 이 객체를 통해 흐른다.
const viewport = mockResizableViewport({ width: DESKTOP_WIDTH, height: 900, pointer: 'fine' })
const setViewportWidth = viewport.setWidth

// 좁아진 채로 끝난 테스트가 다음 테스트에 새지 않게 — 데스크톱 폭으로 되돌리고 리스너를 한 번 부른다.
afterEach(() => {
  if (viewport.width() !== DESKTOP_WIDTH) setViewportWidth(DESKTOP_WIDTH)
})

// ── 화면 (testkit-b4 renderMail + AI 모드 단추) ──────────────

/** AI 전체 화면 넣기·내려오기 단추 — 테스트킷 트리엔 AI 패널이 없어 공급자 안에서 직접 모드를 바꾼다(helpAnswerActions.test 와 같은 방식). */
function AiModeSwitch() {
  const ai = useAssistant()
  return (
    <div>
      <button type="button" data-testid="ai-fullscreen-on" onClick={() => ai.open('fullscreen')}>
        AI 전체 화면으로
      </button>
      <button type="button" data-testid="ai-fullscreen-off" onClick={() => ai.open('side')}>
        AI 옆 패널로
      </button>
    </div>
  )
}

/** 메일 화면 밖에서 작성 도크만 띄우는 최소 하네스 — 슬롯이 없어(메일 화면이 아니면) 「읽기 창으로」 를 쓸 수 없는 판정에 쓴다. */
function DockOnlyHarness() {
  const { openCompose } = useMailCompose()
  return (
    <div data-ai-page-root>
      <button
        type="button"
        data-testid="open-compose"
        onClick={() =>
          openCompose({ mode: 'new', accountId: 1, to: [], cc: [], bcc: [], subject: '', initialHtml: '', quote: null, inReplyToMessageId: null })
        }
      >
        작성 열기
      </button>
      <MailComposeDock />
    </div>
  )
}

/** 슬롯 없음 하네스 — MailComposeProvider + MailComposeDock 만 렌더(MailInboxPage 없음이라 slotEl 이 늘 null). */
function renderDockOnly() {
  return renderScreen(
    <MailComposeProvider>
      <AIAssistantProvider hotkeysEnabled={false}>
        <DockOnlyHarness />
      </AIAssistantProvider>
    </MailComposeProvider>,
    { path: '/mail/1', handlers: mailBaseHandlers() },
  )
}

/** 원문 2통(5·6)이 있는 메일함 — 다른 메일 선택 시나리오에 쓴다. aiSwitch 면 AI 모드 단추를 더한다. */
function withMessages({ extra = [], aiSwitch = false }: { extra?: RequestHandler[]; aiSwitch?: boolean } = {}) {
  return renderMail('/mail/1', {
    messages: paneMessages,
    extra: aiSwitch ? <AiModeSwitch /> : undefined,
    handlers: [
      ...extra,
      // 자동 저장(본문 입력 1.5초 뒤)이 테스트 중에라도 끝나게 — 응답만 주면 진행을 막지 않는다.
      http.post('/api/v1/mail/drafts', () => HttpResponse.json({ id: 77, version: 1, updatedAt: '2026-11-18T00:00:00Z' })),
      ...paneDetailHandlers(),
    ],
  })
}

// ── 접기 규칙(설계 결정 5) ──────────────

test('다른 메일을 고르면 읽기 창 작성이 우측 하단으로 접힌다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '접혀도 남아야 하는 본문')
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  expect(inPane()).toBe(true)

  // 목록에서 다른 행을 고른다 — 읽기 자리가 다른 메일로 바뀌어 쓰던 글과 어긋나지 않게 접는다(MailInboxPage 의 selectedId 접기).
  await view.user.click(await screen.findByTestId('mail-row-6'))
  await waitFor(() => expect(view.location()).toContain('messageId=6'))
  const body = screen.getByTestId('mail-composer-body')
  // 접혔음(min) — 본문 영역에 hidden 이 걸려 있고 호스트는 주차 칸으로 돌아왔다.
  await waitFor(() => expect(body.closest('.hidden')).not.toBeNull())
  expect(hostEl()!.parentElement).toHaveAttribute('data-compose-parking')
  // 바뀐 선택의 메일 상세가 읽기 자리를 다시 채운다.
  expect(await screen.findByRole('heading', { level: 2, name: '두 번째 메일' })).toBeInTheDocument()

  // 다시 펼치면(최소화 단추) 입력한 본문이 남아 있다 — 에디터를 다시 만들지 않았다(같은 노드).
  await view.user.click(screen.getByRole('button', { name: '최소화' }))
  await waitFor(() => expect(body.closest('.hidden')).toBeNull())
  expect(screen.getByTestId('mail-composer-body')).toBe(body)
  expect(body).toHaveTextContent('접혀도 남아야 하는 본문')
})

test('메일 화면 밖에서는 「읽기 창으로」 를 쓸 수 없다', async () => {
  const view = renderDockOnly()
  await view.user.click(await screen.findByTestId('open-compose'))
  // 슬롯이 없는 화면(메일 모듈 밖) — 단추가 비활성이고 이유가 툴팁에 붙는다.
  const toPane = await screen.findByTestId('mail-compose-to-pane')
  expect(toPane).toBeDisabled()
  expect(toPane).toHaveAttribute('title', '메일 화면이 아니면 읽기 창으로 쓸 수 없어요')
})

test('좁은 폭에서는 읽기 창으로 옮기지 못하고 접힌다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '좁아져도 남는 본문')

  // 좁은 폭(≤1023px) — 모바일 셸이라 데스크톱 헤더(「읽기 창으로」 단추 자리) 자체가 그려지지 않는다(우측 하단으로 옮길 수 없다).
  setViewportWidth(900)
  await waitFor(() => expect(screen.queryByTestId('mail-compose-to-pane')).not.toBeInTheDocument())
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()

  // 다시 넓혀도 접히지 않는다 — 좁은 폭 접기는 pane 일 때만, 우측 하단(dock) 작성은 그대로다(본문이 숨지 않았다).
  setViewportWidth(DESKTOP_WIDTH)
  await waitFor(() => expect(screen.getByTestId('mail-compose-to-pane')).toBeInTheDocument())
  expect(screen.getByTestId('mail-composer-body').closest('.hidden')).toBeNull()

  // 넓은 폭에서 읽기 창으로 올라간 뒤 좁아지면 → min 으로 접힌다(호스트가 주차 칸으로, 단추는 모바일 상단 바로 사라진다).
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  await waitFor(() => expect(inPane()).toBe(true))
  setViewportWidth(900)
  await waitFor(() => expect(inPane()).toBe(false))
  expect(hostEl()!.parentElement).toHaveAttribute('data-compose-parking')
  expect(screen.queryByTestId('mail-compose-to-pane')).not.toBeInTheDocument()

  // 다시 넓혀도 자동 복귀는 없다 — min 접힌 채로 유지되고, 본문은 숨김뿐(내용은 남아 있다).
  setViewportWidth(DESKTOP_WIDTH)
  await waitFor(() => expect(screen.getByTestId('mail-compose-minimize')).toBeInTheDocument())
  expect(screen.getByTestId('mail-composer-body').closest('.hidden')).not.toBeNull()
  // 최소화 단추로 다시 펼치면 쓰던 본문이 그대로다(에디터를 다시 만들지 않았다).
  await view.user.click(screen.getByRole('button', { name: '최소화' }))
  await waitFor(() => expect(screen.getByTestId('mail-composer-body').closest('.hidden')).toBeNull())
  expect(screen.getByTestId('mail-composer-body')).toHaveTextContent('좁아져도 남는 본문')
})

test('AI 전체 화면에서는 읽기 창으로 옮기지 않는다', async () => {
  const view = withMessages({ aiSwitch: true })
  await openReplyWithBody(view, 'AI 에서도 남는 본문')
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  await waitFor(() => expect(inPane()).toBe(true))

  // AI 전체 화면 — size 가 dock 으로 접힌다(layout 만 바꾸면 읽기 자리 상세가 감춰진 채 빈 읽기 자리가 남는다).
  await view.user.click(await screen.findByTestId('ai-fullscreen-on'))
  await waitFor(() => expect(inPane()).toBe(false))
  expect(hostEl()!.parentElement).toHaveAttribute('data-compose-parking')
  // 읽기 자리에 메일 상세가 다시 보인다 — 접혀서 빈 읽기 자리가 되지 않는다(Important 2).
  expect(await screen.findByRole('heading', { level: 2, name: '첫 번째 메일' })).toBeInTheDocument()
  // dock 접기(min 이 아님) — 본문 영역은 숨지 않았다.
  expect(screen.getByTestId('mail-composer-body').closest('.hidden')).toBeNull()
  // 「읽기 창으로」 는 비활성이고 이유가 툴팁에 있다.
  const toPane = screen.getByTestId('mail-compose-to-pane')
  expect(toPane).toBeDisabled()
  expect(toPane).toHaveAttribute('title', 'AI 전체 화면에서는 읽기 창 대신 우측 하단을 씁니다')

  // 옆 패널로 돌아와도 자동 복귀는 없다 — 같은 접기 규칙(조건이 없어져도 되돌리지 않는다), 단추로 다시 들어간다.
  await view.user.click(await screen.findByTestId('ai-fullscreen-off'))
  expect(inPane()).toBe(false)
  await waitFor(() => expect(toPane).toBeEnabled())
  await view.user.click(toPane)
  await waitFor(() => expect(inPane()).toBe(true))
})

test('메일 화면을 떠나면 읽기 창이 우측 하단 최소화로 접힌다', async () => {
  const view = withMessages()
  await openReplyWithBody(view, '이탈해도 남는 본문')
  await view.user.click(screen.getByRole('button', { name: '읽기 창으로' }))
  await waitFor(() => expect(inPane()).toBe(true))
  const body = screen.getByTestId('mail-composer-body')

  // 앱 안 이동(다른 모듈) — 슬롯이 사라지면(메일 화면 밖) 호스트는 주차 칸으로, 본체는 최소화로 접는다(설계 결정 4).
  act(() => {
    window.history.pushState(null, '', '/projects')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  expect(await screen.findByTestId('outside-mail')).toBeInTheDocument()
  await waitFor(() => expect(body.closest('.hidden')).not.toBeNull())
  expect(hostEl()!.parentElement).toHaveAttribute('data-compose-parking')
  // 접혔을 뿐 본문은 남아 있다 — 도크 자체(#183)와 쓰던 글이 함께 살아 있다.
  expect(screen.getByTestId('mail-compose-dock')).toBeInTheDocument()
  expect(body).toHaveTextContent('이탈해도 남는 본문')
})
