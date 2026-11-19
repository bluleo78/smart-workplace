// 채널·DM 메시지 작성자 이름·아바타를 누르면 사람 카드가 열린다(WP-1768).
//  - 남의 메시지 묶음 첫 줄에만 트리거가 있고, 내 메시지·묶음 둘째 줄에는 없다.
//  - 탭 순서에는 이름 트리거만(아바타 트리거는 tabIndex -1). 카드 안 클릭·우클릭은 행 툴바·링크 메뉴를 열지 않는다.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, test, vi } from 'vitest'

import { useMessageListLongPress } from '@/hooks/useMessageListLongPress'
import { server } from '@/test/msw/server'
import { renderScreen } from '@/test/renderScreen'

import { createMessage } from '../../../e2e/factories/messaging.factory'
import { MessageRow } from './MessageRow'

const cardHandlers = [
  http.get('/api/v1/members/:id', ({ params }) =>
    HttpResponse.json({
      userId: Number(params.id), username: 'minsu', name: '김민수', email: 'minsu@example.com', title: null, kind: 'HUMAN',
      active: true, membershipRole: null, membershipStatus: null, department: null,
    }),
  ),
  http.get('/api/v1/contacts/members/:id', ({ params }) =>
    HttpResponse.json({ id: Number(params.id), username: 'minsu', name: '김민수', email: null, title: null, kind: 'HUMAN', groups: [], isFavorite: false }),
  ),
  http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
  http.get('/api/v1/me/ai-agents', () => HttpResponse.json({ agents: [] })),
]

/** 목록처럼 길게 누르기 위임을 다는 틀(MessageList 와 같은 훅) — onOpen 으로 작업 시트 열림을 본다. */
function LongPressList({ onOpen, children }: { onOpen: (id: number) => void; children: ReactNode }) {
  const longPress = useMessageListLongPress(true, () => true, onOpen)
  return <div data-testid="message-list" {...longPress}>{children}</div>
}

function renderRow({ authorId = 7, startsGroup = true, authorKind = 'HUMAN' as 'HUMAN' | 'AGENT', authorName = '김민수', onOpenSheet = vi.fn() } = {}) {
  server.use(...cardHandlers)
  const noop = vi.fn()
  return renderScreen(
    <LongPressList onOpen={onOpenSheet}>
    <MessageRow
      message={createMessage({ id: 11, authorId, authorName, authorKind })}
      channelId={1}
      currentUserId={1}
      members={[]}
      startsGroup={startsGroup}
      isEditing={false}
      rowProps={{ 'data-tap-row': 11, 'data-tap-active': undefined, onPointerUp: noop, onPointerEnter: noop, onFocus: noop }}
      onStartEdit={noop}
      onCancelEdit={noop}
      onSaveEdit={noop}
      onDelete={noop}
      onDismissPreviews={noop}
      onToggleReaction={noop}
      onOpenReactors={noop}
      proposalBusy={false}
      onConfirmProposal={noop}
      onRejectProposal={noop}
      linkTarget={() => ({ kind: 'message', url: 'http://x/chat/channels/1?message=11', title: '안녕하세요' })}
    />
    </LongPressList>,
  )
}

// 이름 트리거 — 같은 접근 이름의 아바타 트리거(tabindex -1)와 구분해 탭 순서에 있는 쪽을 고른다.
function nameTrigger(name = '김민수') {
  return screen.getAllByRole('button', { name }).find((b) => b.getAttribute('tabindex') !== '-1')!
}

describe('채널·DM 메시지 작성자 사람 카드 (WP-1768)', () => {
  test('남의 메시지 작성자 이름을 누르면 사람 카드가 열린다', async () => {
    const { user } = renderRow()
    await user.click(nameTrigger())
    const card = await screen.findByTestId('person-card')
    expect(within(card).getByText('김민수')).toBeInTheDocument()
  })

  test('아바타를 눌러도 같은 카드가 열리고, 아바타 트리거는 탭 순서에서 빠진다', async () => {
    const { user } = renderRow()
    const triggers = screen.getAllByTestId('person-card-trigger-7')
    expect(triggers).toHaveLength(2)
    const avatarTrigger = triggers.find((t) => t.querySelector('[data-testid="chat-avatar-7"]'))!
    expect(avatarTrigger).toHaveAttribute('tabindex', '-1')
    expect(avatarTrigger).toHaveAccessibleName('김민수')
    const nameTrigger = triggers.find((t) => t !== avatarTrigger)!
    expect(nameTrigger).not.toHaveAttribute('tabindex')
    await user.click(avatarTrigger)
    expect(await screen.findByTestId('person-card')).toBeInTheDocument()
  })

  test('AI 작성자 이름 트리거의 접근 이름은 「이름 (에이전트)」다', () => {
    renderRow({ authorId: 9, authorKind: 'AGENT', authorName: '리뷰봇' })
    expect(screen.getAllByRole('button', { name: '리뷰봇 (에이전트)' }).length).toBeGreaterThan(0)
  })

  test('카드를 눌러도 행 툴바·우클릭 링크 메뉴가 열리지 않는다', async () => {
    const { user } = renderRow()
    await user.click(nameTrigger())
    const card = await screen.findByTestId('person-card')
    await user.pointer({ keys: '[MouseRight]', target: card })
    await user.click(card)
    expect(screen.queryByTestId('message-link-menu-11')).not.toBeInTheDocument()
    const row = screen.getByTestId('message-11')
    expect(row).not.toHaveAttribute('data-tap-active', 'true')
    await waitFor(() => expect(screen.getByTestId('person-card')).toBeInTheDocument())
  })

  test('터치로 작성자 이름·아바타를 길게 눌러도 메시지 작업 시트가 열리지 않는다 — 행 본문 길게 누르기는 연다', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const onOpenSheet = vi.fn()
      renderRow({ onOpenSheet })
      // 이름·아바타 트리거 — 누름 시작이 트리거 안이면 위임이 타이머를 걸지 않는다(트리거가 pointerup 을 막아도 남는 타이머가 없다).
      for (const trigger of screen.getAllByTestId('person-card-trigger-7')) {
        fireEvent.pointerDown(trigger, { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 })
        vi.advanceTimersByTime(1000)
        fireEvent.pointerUp(trigger, { pointerType: 'touch' })
      }
      expect(onOpenSheet).not.toHaveBeenCalled()
      // 같은 행의 본문은 그대로 길게 누르기로 작업 시트를 연다.
      const row = screen.getByTestId('message-11')
      fireEvent.pointerDown(row, { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 })
      vi.advanceTimersByTime(1000)
      expect(onOpenSheet).toHaveBeenCalledWith(11)
    } finally {
      vi.useRealTimers()
    }
  })

  test('작성자 이름 위 우클릭(안드로이드 길게 터치)도 작업 시트를 열지 않는다', () => {
    const onOpenSheet = vi.fn()
    renderRow({ onOpenSheet })
    fireEvent.contextMenu(nameTrigger())
    expect(onOpenSheet).not.toHaveBeenCalled()
  })

  test('내 메시지에는 트리거가 없다', () => {
    renderRow({ authorId: 1 })
    expect(screen.queryByTestId('person-card-trigger-1')).not.toBeInTheDocument()
  })

  test('묶음 둘째 줄에는 트리거가 없다', () => {
    renderRow({ startsGroup: false })
    expect(screen.queryByTestId('person-card-trigger-7')).not.toBeInTheDocument()
  })
})
