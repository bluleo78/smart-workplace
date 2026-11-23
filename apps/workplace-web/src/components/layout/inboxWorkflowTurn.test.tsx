// 워크플로우 차례 타이머 알림(WP-1987) 행 — 화면 컴포넌트 테스트.
// 행위자 없는 시스템 알림이라 「시스템」 같은 이름 접두·AI 배지 없이 문구와 이슈 줄만 보여야 한다(InboxList 의 WORKFLOW_TURN_* 갈래).
// 하네스·notif() 기본값·MSW 핸들러는 test/kits/notifications/inboxTestKit.tsx 를 쓴다.
import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { notif, renderInbox } from '@/test/kits/notifications/inboxTestKit'

/** 서버가 보내는 모양 그대로 — 행위자 필드가 모두 비어 있다. */
function turn(type: 'WORKFLOW_TURN_REMIND' | 'WORKFLOW_TURN_ESCALATE') {
  return notif({ type, actorId: null, actorName: null, actorKind: null, commentId: null, read: false, issueTitle: '결재 대기' })
}

describe('워크플로우 차례 타이머 알림 행 (WP-1987)', () => {
  test('다시 알림(REMIND)은 행위자 이름 없이 문구와 이슈 줄을 보인다', async () => {
    renderInbox({ inbox: [turn('WORKFLOW_TURN_REMIND')] })
    const row = await screen.findByTestId('inbox-item')
    expect(within(row).getByText('워크플로우 차례가 오래 기다리고 있습니다')).toBeInTheDocument()
    expect(within(row).getByText('WP-3 결재 대기')).toBeInTheDocument()
    // 행위자 없는 알림이 「시스템」으로 읽히거나 이름 뒤 문구로 이어지지 않는다.
    expect(row).not.toHaveTextContent('시스템')
    expect(row).not.toHaveTextContent('님이')
    expect(row).toHaveAccessibleName(/^읽지 않음, 워크플로우 차례가 오래 기다리고 있습니다/)
  })

  test('관리자 알림(ESCALATE)은 행위자 이름 없이 관리자 확인 문구와 이슈 줄을 보인다', async () => {
    renderInbox({ inbox: [turn('WORKFLOW_TURN_ESCALATE')] })
    const row = await screen.findByTestId('inbox-item')
    expect(within(row).getByText('워크플로우 단계가 오래 멈춰 있습니다 — 관리자 확인이 필요합니다')).toBeInTheDocument()
    expect(within(row).getByText('WP-3 결재 대기')).toBeInTheDocument()
    expect(row).not.toHaveTextContent('시스템')
    expect(row).toHaveAccessibleName(/^읽지 않음, 워크플로우 단계가 오래 멈춰 있습니다/)
  })
})
