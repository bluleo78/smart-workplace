// 채팅 딥링크를 편 뒤의 출발 화면 복귀(WP-1416) — 화면 테스트(jsdom 실제 세션 히스토리).
// 앱 셸(AppLayout)처럼 화면의 부모에서 위치를 기록하는 useIssueOriginTracker 를 두고, 이슈 상세를 그 아래 라우트로 띄운다.
// 1. 이슈·프로젝트가 캐시에 있으면 첫 렌더부터 서랍을 편다(replace → push) — 부모의 기록이 자식의 펴기보다 늦으면 편 아래 항목(이슈)이
//    기록되지 않았다. 서랍을 닫으면 그 항목으로 돌아와 다시 기록되지만, 서랍이 열린 채 복귀하면(AI 옆 패널이 열려 서랍이 non-modal 이라
//    헤더 ← 를 누를 수 있다) 기록 없는 칸을 만나 출발 화면이 아니라 프로젝트 화면으로 갔다.
// 2. 서랍을 닫은 뒤 ESC 도 출발 화면으로 간다(닫기가 아래 항목으로 돌아와 다시 기록하므로 회귀 경계로 둔다).
// 위치 기록은 모듈 수명이라 테스트마다 비운다 — 앞 테스트가 같은 칸을 기록해 두면 빠진 칸이 가려진다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { Link, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, test } from 'vitest'

import { AIAssistantProvider, useAssistant } from '@/components/ai/AIAssistantContext'
import { resetIssueOriginForTest, useIssueOriginTracker } from '@/hooks/useIssueOrigin'
import IssueDetailPage from '@/pages/projects/IssueDetailPage'
import { settleHistory } from '@/test/history'
import { issueChatHandlers, issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { pageAuth, SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { shellHandlers } from '@/test/msw/baseHandlers'
import { renderScreen, type ScreenUser } from '@/test/renderScreen'

import { createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const ISSUE_PATH = '/projects/WP/issues/1'
const CHAT_LINK = `${ISSUE_PATH}?chat=1`

/** 이슈 상세 + 빈 채팅 스레드. */
function handlers() {
  return [
    ...issueChatHandlers({ thread: createChatThread({ threadId: 100, issueId: 1, recentMessages: [] }) }),
    ...issueDetailHandlers({ detail: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '출발 화면 이슈' }) }) }),
    ...shellHandlers,
  ]
}

/** 앱 셸 대역 — 화면의 부모에서 위치를 기록하고(AppLayout 과 같은 자리), 어느 화면에서나 누를 수 있는 앱 안 링크를 둔다. */
function Shell() {
  useIssueOriginTracker()
  // AI 옆 패널 열기 — 앱의 AI 칩 대역(패널 자체는 그리지 않는다. 서랍이 모드를 읽어 non-modal 로 열린다).
  const assistant = useAssistant()
  return (
    <>
      <Link to="/inbox" data-testid="go-inbox">인박스</Link>
      <Link to={ISSUE_PATH} data-testid="go-issue">이슈</Link>
      <Link to={CHAT_LINK} data-testid="go-chat">알림</Link>
      <button type="button" data-testid="open-ai-side" onClick={() => assistant.open('side')}>AI</button>
      <Outlet />
    </>
  )
}

function renderShell(path: string) {
  return renderScreen(
    <AIAssistantProvider hotkeysEnabled={false}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/projects/:key/issues/:number" element={<IssueDetailPage />} />
          <Route path="*" element={null} />
        </Route>
      </Routes>
    </AIAssistantProvider>,
    { path, handlers: handlers(), auth: pageAuth },
  )
}

/** 앱 안 링크를 누르고 이동이 끝나기를 기다린다. */
async function go(user: ScreenUser, testId: string) {
  await user.click(screen.getByTestId(testId))
  await settleHistory()
}

/** 서랍이 보인 뒤 ✕(닫기)로 닫고, 서랍이 사라질 때까지 기다린다. */
async function closeDrawer(user: ScreenUser) {
  const drawer = await screen.findByTestId('issue-chat-drawer', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  await user.click(within(drawer).getByRole('button', { name: '닫기' }))
  await settleHistory()
  await waitFor(() => expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument())
}

const historyIdx = () => (window.history.state as { idx?: number }).idx

describe('채팅 딥링크를 편 뒤 출발 화면 복귀 (WP-1416)', () => {
  beforeEach(() => resetIssueOriginForTest())

  test('캐시된 이슈를 알림으로 열고 AI 옆 패널을 연 채 헤더 ← 를 누르면 알림 전 화면으로 돌아간다', async () => {
    const { user, location } = renderShell('/inbox')
    await go(user, 'go-issue')
    await screen.findByTestId('issue-title-heading', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await go(user, 'go-inbox')
    expect(historyIdx()).toBe(2)

    // AI 옆 패널을 열어 둔다 — 옆 패널이 열려 있으면 채팅 서랍이 non-modal 로 열려, 서랍이 열린 채 헤더 ← 를 누를 수 있다.
    await user.click(screen.getByTestId('open-ai-side'))

    // 알림 → 캐시라 첫 렌더부터 편다: 이슈(3) → 이슈+채팅(4). 펴는 동안 셸의 기록이 늦으면 3 이 빠진다.
    await go(user, 'go-chat')
    await screen.findByTestId('issue-chat-drawer', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await waitFor(() => expect(historyIdx()).toBe(4))

    // 서랍이 열린 채 헤더 ← — 이슈 연속 구간(3·4)을 건너뛰어 인박스(2)로 되감는다.
    // 클릭만 보낸다: non-modal 서랍은 바깥 pointerdown 에 닫히며(-1) 브라우저에선 그 뒤로 가기가 끝나기 전에 ← 의 click 이 돈다(idx 4 에서 복귀).
    // userEvent 는 pointerdown 과 click 사이에 타이머를 돌려 jsdom 이 뒤로 가기를 먼저 끝내므로(idx 3 에서 복귀) 그 순서를 재현하지 못한다.
    fireEvent.click(screen.getByRole('button', { name: '이전 화면으로 돌아가기' }))
    await settleHistory()
    await waitFor(() => expect(location()).toBe('/inbox'))
    expect(historyIdx()).toBe(2)
  })

  test('이슈가 캐시에 있을 때 알림으로 들어와 서랍을 닫고 ESC 를 누르면 알림 전 화면으로 돌아간다', async () => {
    const { user, location } = renderShell('/inbox')
    // 이슈를 한 번 열어 이슈·프로젝트를 캐시에 올린 뒤 다른 화면으로 간다.
    await go(user, 'go-issue')
    await screen.findByTestId('issue-title-heading', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    await go(user, 'go-inbox')
    expect(location()).toBe('/inbox')
    expect(historyIdx()).toBe(2)

    // 알림 → 캐시라 첫 렌더부터 편다: 이슈(3) → 이슈+채팅(4).
    await go(user, 'go-chat')
    await waitFor(() => expect(historyIdx()).toBe(4))
    await closeDrawer(user)
    expect(location()).toBe(ISSUE_PATH)
    expect(historyIdx()).toBe(3)

    // ESC — 출발 화면(인박스, 2)으로 되감는다. 프로젝트 화면으로 가지 않는다.
    await user.keyboard('{Escape}')
    await settleHistory()
    await waitFor(() => expect(location()).toBe('/inbox'))
    expect(historyIdx()).toBe(2)
  })
})
