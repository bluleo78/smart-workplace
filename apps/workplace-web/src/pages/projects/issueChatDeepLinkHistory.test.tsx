// 이슈 채팅 딥링크(`?chat=1`)로 들어온 뒤 서랍 닫기·뒤로 가기(WP-1414) — 화면 테스트(jsdom 실제 세션 히스토리).
// 알림·인박스·홈 위젯 링크로 서랍이 열린 채 들어오면 「이슈에 먼저 들어간 뒤 채팅을 열었다」로 히스토리를 편다:
// 출발 화면 → 이슈 → 이슈+채팅. 그래서 서랍을 닫으면 이슈 상세가 남고, 한 번 더 뒤로 가면 출발 화면으로 간다.
// 예전에는 마크 없는 닫기가 -1 이라 서랍을 닫는 순간 알림 전 화면으로 돌아갔다.
import { act, screen, waitFor, within } from '@testing-library/react'
import { Link } from 'react-router-dom'
import { describe, expect, test } from 'vitest'

import { renderIssueDetailScreen } from '@/test/kits/projects/issueDetailScreen'
import { issueChatHandlers, issueDetailHandlers } from '@/test/kits/projects/issueDetailStubs'
import { SCREEN_LOAD_TIMEOUT } from '@/test/kits/projects/routeScreen'
import { settleHistory } from '@/test/renderPage'

import { createChatThread } from '../../../e2e/factories/chat.factory'
import { createIssue, createIssueDetail } from '../../../e2e/factories/issue.factory'

const ISSUE_PATH = '/projects/WP/issues/1'
const CHAT_LINK = `${ISSUE_PATH}?chat=1`

/** 이슈 상세 + 빈 채팅 스레드. */
function handlers() {
  return [
    ...issueChatHandlers({ thread: createChatThread({ threadId: 100, issueId: 1, recentMessages: [] }) }),
    ...issueDetailHandlers({ detail: createIssueDetail({ summary: createIssue({ id: 1, number: 1, title: '딥링크 채팅 이슈' }) }) }),
  ]
}

/** 출발 화면의 알림 링크 — 인박스·홈 위젯처럼 앱 안 이동(push)으로 `?chat=1` 주소를 연다(이슈 라우트가 아니면 이것만 보인다). */
function NotificationLink() {
  return (
    <Link to={CHAT_LINK} data-testid="notif-link">
      알림
    </Link>
  )
}

/** 서랍이 보인 뒤 ✕(닫기)로 닫고, 서랍이 사라질 때까지 기다린다. */
async function closeDrawer(user: ReturnType<typeof renderIssueDetailScreen>['user']) {
  const drawer = await screen.findByTestId('issue-chat-drawer', {}, { timeout: SCREEN_LOAD_TIMEOUT })
  await user.click(within(drawer).getByRole('button', { name: '닫기' }))
  await settleHistory()
  await waitFor(() => expect(screen.queryByTestId('issue-chat-drawer')).not.toBeInTheDocument())
}

describe('채팅 딥링크로 들어와 서랍 닫기 (WP-1414)', () => {
  test('다른 화면에서 알림으로 들어와 서랍을 닫으면 이슈 상세가 남고, 뒤로 가면 출발 화면이다', async () => {
    const { user, location } = renderIssueDetailScreen('/inbox', { handlers: handlers(), extra: <NotificationLink /> })
    await user.click(screen.getByTestId('notif-link'))
    await closeDrawer(user)

    // 서랍만 닫히고 이슈 상세(chat 없는 주소)가 남는다.
    expect(location()).toBe(ISSUE_PATH)
    expect(screen.getByTestId('issue-title-heading')).toHaveTextContent('딥링크 채팅 이슈')

    // 한 번 더 뒤로 가면 알림을 누르기 전 화면.
    act(() => window.history.back())
    await settleHistory()
    await waitFor(() => expect(location()).toBe('/inbox'))
    expect(screen.queryByTestId('issue-title-heading')).not.toBeInTheDocument()
  })

  test('새 탭처럼 처음부터 `?chat=1` 로 열린 이슈도 서랍을 닫으면 이슈 상세다', async () => {
    const { user, location } = renderIssueDetailScreen(CHAT_LINK, { handlers: handlers() })
    await screen.findByTestId('issue-chat-drawer', {}, { timeout: SCREEN_LOAD_TIMEOUT })
    // 첫 항목(idx 0)이 「이슈 → 이슈+채팅(마크)」 두 항목으로 펴진다 — 닫기는 그 위 항목을 걷어 낸다.
    await waitFor(() => expect((window.history.state as { idx?: number }).idx).toBe(1))
    await closeDrawer(user)
    expect((window.history.state as { idx?: number }).idx).toBe(0)
    expect(location()).toBe(ISSUE_PATH)
    expect(screen.getByTestId('issue-title-heading')).toBeInTheDocument()
  })
})
