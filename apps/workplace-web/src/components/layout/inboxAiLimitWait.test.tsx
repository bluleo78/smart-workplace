// 비서 사용 한도 대기 알림(WP-2108) 행 — 화면 컴포넌트 테스트.
// 서버가 만든 완성 문장(message)을 행위자 이름 접두 없이 그대로 보여야 한다(InboxList 의 AI_ASSISTANT_LIMIT_WAIT 갈래).
// 하네스·notif() 기본값·MSW 핸들러는 test/kits/notifications/inboxTestKit.tsx 를 쓴다.
import { screen, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { notif, renderInbox } from '@/test/kits/notifications/inboxTestKit'

/** 서버가 보내는 모양 그대로 — 행위자는 비서 AGENT, 범위는 statusName, 문장은 message. */
function limit(over: Record<string, unknown> = {}) {
  return notif({
    type: 'AI_ASSISTANT_LIMIT_WAIT',
    actorId: 7,
    actorName: '개인 비서',
    actorKind: 'AGENT',
    statusName: 'PERSONAL_ASSISTANT',
    issueId: 0,
    projectKey: '',
    issueNumber: 0,
    issueTitle: '',
    commentId: null,
    read: false,
    message: '개인 비서가 사용 한도에 걸려 15:30까지 쉽니다. 다른 모델로 바꾸거나 기다려 주세요',
    ...over,
  })
}

describe('AI 사용 한도 알림 행 (WP-2108)', () => {
  test('서버 문장을 행위자 이름 접두 없이 그대로 보인다', async () => {
    renderInbox({ inbox: [limit()] })
    const row = await screen.findByTestId('inbox-item')
    expect(within(row).getByText(/개인 비서가 사용 한도에 걸려 15:30까지 쉽니다/)).toBeInTheDocument()
    // 비서 이름이 「~님이」 접두로 붙지 않는다.
    expect(row).not.toHaveTextContent('님이')
    expect(row).toHaveAccessibleName(/^읽지 않음, 개인 비서가 사용 한도에 걸려/)
  })

  test('문장이 비어 있으면 기본 문구', async () => {
    renderInbox({ inbox: [limit({ message: null })] })
    const row = await screen.findByTestId('inbox-item')
    expect(within(row).getByText('AI 비서가 사용 한도에 걸렸어요')).toBeInTheDocument()
  })
})
