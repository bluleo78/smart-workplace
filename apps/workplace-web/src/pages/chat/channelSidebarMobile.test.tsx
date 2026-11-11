// 휴대폰 폭 대화 목록의 그룹 DM 아이콘(WP-1466) — 데스크톱 사이드바 판정은 channelSidebar.test.tsx.
// matchMedia 결과가 파일 안에서 캐시되므로 휴대폰 뷰포트는 이 파일에서만 쓴다.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, renderChat } from '@/test/kits/chat/testkit-b5'
import { testAuthValue } from '@/test/renderWithProviders'
import { mockViewport } from '@/test/viewport'

import { createDm, createDmParticipant } from '../../../e2e/factories/messaging.factory'

mockViewport()

const auth = { user: { ...testAuthValue.user!, name: '테스트 사용자' } }

describe('휴대폰 대화 목록', () => {
  test('그룹 DM 은 앞의 두 상대로 나눈 큰 아바타, 1:1 은 한 사람 아바타', async () => {
    const me = createDmParticipant({ userId: 1, name: '테스트 사용자' })
    renderChat('/chat', {
      auth,
      // 휴대폰 화면 머리글의 알림 종이 읽지 않은 수를 묻는다.
      handlers: [http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 0 }))],
      dms: [
        createDm({ id: 2, participants: [me, createDmParticipant({ userId: 2, name: '밥' })] }),
        createDm({
          id: 4,
          participants: [me, createDmParticipant({ userId: 2, name: '밥' }), createDmParticipant({ userId: 3, name: '캐럴' })],
        }),
      ],
    })
    const one = await screen.findByTestId('dm-link-2')
    expect(within(one).getByTestId('user-avatar-2')).toHaveTextContent('밥')
    expect(within(one).queryByTestId('group-avatar')).toBeNull()

    const group = within(screen.getByTestId('dm-link-4')).getByTestId('group-avatar')
    expect(group).toHaveAttribute('data-size', 'lg')
    expect(within(group).getAllByTestId(/^group-avatar-part-/).map((h) => h.textContent)).toEqual(['밥', '캐'])
  })
})
