// 알림 목록 행의 「읽지 않음」 접근 이름(WP-1844) — 화면 컴포넌트 테스트.
// 안 읽은 행은 파란 점(색)만으로 표시돼 스크린 리더가 읽음/안읽음을 구분하지 못했다. 행 이름 맨 앞의 sr-only 문구를 지킨다.
// 하네스·notif() 기본값·MSW 핸들러는 test/kits/notifications/inboxTestKit.tsx(inboxArchive.test.tsx 와 공유)를 쓴다.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { notif, renderInbox } from '@/test/kits/notifications/inboxTestKit'

describe('알림 행 읽지 않음 접근 이름 (WP-1844)', () => {
  test('안 읽은 행은 이름이 「읽지 않음」으로 시작하고 읽은 행은 그렇지 않다', async () => {
    renderInbox({
      inbox: [notif({ id: 1, read: false, issueTitle: '안읽은이슈' }), notif({ id: 2, read: true, issueTitle: '읽은이슈' })],
    })
    const rows = await screen.findAllByTestId('inbox-item')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveAccessibleName(/^읽지 않음, /)
    expect(rows[1]).not.toHaveAccessibleName(/읽지 않음/)
  })

  test('일정 알림(REMINDER)도 안 읽었으면 「읽지 않음」으로 시작한다', async () => {
    renderInbox({
      inbox: [notif({ type: 'REMINDER', read: false, eventTitle: '주간 회의', eventStartsAt: new Date().toISOString() })],
    })
    expect(await screen.findByTestId('inbox-item')).toHaveAccessibleName(/^읽지 않음, 일정 알림/)
  })

  test('파란 점은 보조기기에서 숨는다', async () => {
    renderInbox({ inbox: [notif({ read: false })] })
    const row = await screen.findByTestId('inbox-item')
    expect(within(row).getByTestId('inbox-unread-dot')).toHaveAttribute('aria-hidden', 'true')
  })

  test('보관함 탭의 안 읽은 행도 「읽지 않음」으로 시작하고 되돌리기는 이름에 섞이지 않는다', async () => {
    const { user } = renderInbox({ archived: [notif({ id: 5, read: false, issueTitle: '보관된이슈' })] })
    await user.click(await screen.findByTestId('inbox-tab-archive'))
    const row = await screen.findByTestId('inbox-item')
    expect(row).toHaveAccessibleName(/^읽지 않음, /)
    expect(row).not.toHaveAccessibleName(/되돌리기/)
    expect(within(row.parentElement as HTMLElement).getByTestId('inbox-unarchive')).toBeInTheDocument()
  })

  test('읽음 처리 뒤 다시 받은 행은 「읽지 않음」이 빠진다', async () => {
    // 서버의 읽음 상태 — 읽음 요청 핸들러 안에서만 뒤집어, 클릭 전 응답은 항상 안 읽음이다.
    let serverRead = false
    const { user, markedRead } = renderInbox({
      inbox: () => [notif({ id: 1, read: serverRead, issueTitle: '곧읽음' })],
      onMarkRead: () => {
        serverRead = true
      },
    })
    const row = await screen.findByTestId('inbox-item')
    expect(row).toHaveAccessibleName(/^읽지 않음, /)
    // 행 클릭 → 읽음 요청 + 목록 무효화 → 다시 받은 응답은 read:true
    await user.click(row)
    await waitFor(() => expect(markedRead).toEqual([1]))
    await waitFor(() => expect(screen.getByTestId('inbox-item')).not.toHaveAccessibleName(/^읽지 않음/))
  })
})
