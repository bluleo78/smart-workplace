// 휴대폰 폭 DM 헤더의 「대화 숨기기」(WP-1676)·그룹 DM 「대화 나가기」(WP-1677) — 데스크톱 ⋯ 메뉴 판정은 dmPage.test.tsx.
// matchMedia 결과가 파일 안에서 캐시되므로 휴대폰 뷰포트는 이 파일에서만 쓴다.
// 헤더 오른쪽 자리(mobilePrimaryAction)에 데스크톱과 같은 「⋯」(대화 메뉴) — 실수로 누르기 쉬운 인라인 글자 단추로 두지 않는다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, test } from 'vitest'

import { API, renderChat } from '@/test/kits/chat/testkit-b5'
import { testAuthValue } from '@/test/renderWithProviders'
import { mockViewport } from '@/test/viewport'

import { createChannel, createDm, createDmParticipant } from '../../../e2e/factories/messaging.factory'

mockViewport()

const auth = { user: { ...testAuthValue.user!, name: '테스트 사용자' } }

describe('휴대폰 DM 헤더', () => {
  test('헤더 ⋯ 를 누르면 대화 숨기기 하나가 보이고, 누르면 hide 를 보내고 /chat 으로 간다', async () => {
    const dm = createDm({ id: 930, participants: [createDmParticipant({ userId: 1, name: '테스트 사용자' }), createDmParticipant({ userId: 2, name: '밥' })] })
    const hidden: string[] = []
    const { user, location } = renderChat(`/chat/dms/${dm.id}`, {
      auth,
      dms: [dm],
      channels: [],
      handlers: [
        // 휴대폰 화면 머리글의 알림 종이 읽지 않은 수를 묻는다.
        http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 0 })),
        http.get(`${API}/messaging/channels/${dm.id}`, () => HttpResponse.json(createChannel({ id: dm.id, kind: 'DM', member: true }))),
        http.post(`${API}/messaging/dms/:id/hide`, ({ params }) => {
          hidden.push(String(params.id))
          return new HttpResponse(null, { status: 204 })
        }),
      ],
      messages: { [dm.id]: [] },
    })
    const header = await screen.findByTestId('dm-header')
    // 숨기기 단추가 헤더에 바로 나와 있지 않다 — ⋯ 를 먼저 눌러야 한다.
    expect(within(header).queryByTestId('mobile-header-inline-action')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dm-hide-action')).not.toBeInTheDocument()
    await user.click(within(header).getByRole('button', { name: '대화 메뉴' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['대화 숨기기'])
    await user.click(screen.getByTestId('dm-hide-action'))
    await waitFor(() => expect(location()).toBe('/chat'))
    expect(hidden).toEqual([String(dm.id)])
  })

  // WP-1677: 그룹 DM 은 같은 ⋯ 메뉴에 「대화 나가기」가 붙고, 확인하면 leave 를 보내고 /chat 으로 간다.
  test('그룹 DM 헤더 ⋯ 에 대화 나가기가 있고, 확인하면 leave 를 보내고 /chat 으로 간다', async () => {
    const dm = createDm({
      id: 931,
      participants: [
        createDmParticipant({ userId: 1, name: '테스트 사용자' }),
        createDmParticipant({ userId: 2, name: '밥' }),
        createDmParticipant({ userId: 3, name: '앨리스' }),
      ],
    })
    const left: string[] = []
    const { user, location } = renderChat(`/chat/dms/${dm.id}`, {
      auth,
      dms: [dm],
      channels: [],
      handlers: [
        http.get(`${API}/notifications/unread-count`, () => HttpResponse.json({ count: 0 })),
        http.get(`${API}/messaging/channels/${dm.id}`, () => HttpResponse.json(createChannel({ id: dm.id, kind: 'DM', member: true }))),
        http.post(`${API}/messaging/channels/:id/leave`, ({ params }) => {
          left.push(String(params.id))
          return new HttpResponse(null, { status: 204 })
        }),
      ],
      messages: { [dm.id]: [] },
    })
    const header = await screen.findByTestId('dm-header')
    await user.click(within(header).getByRole('button', { name: '대화 메뉴' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual(['대화 숨기기', '대화 나가기'])
    await user.click(screen.getByTestId('dm-leave-action'))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '나가기' }))
    await waitFor(() => expect(location()).toBe('/chat'))
    expect(left).toEqual([String(dm.id)])
  })
})
