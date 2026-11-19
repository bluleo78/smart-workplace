// 노트 접속자 목록 → 사람 카드(WP-1768) — 이름·아바타를 누르면 카드, 커서 이동은 편집 중인 사람의 ⌖ 단추만.
import { screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import type { PresencePerson } from '@/lib/collab/presence'
import { renderScreen } from '@/test/renderScreen'

import { WikiPresence, WikiPresenceList } from './WikiPresence'

const KIM: PresencePerson = { userId: 2, name: '김철수', aiWriting: false, editing: true, clientIds: [1] }
const PARK: PresencePerson = { userId: 3, name: '박민수', aiWriting: false, editing: false, clientIds: [2] }
const BOT: PresencePerson = { userId: 9, name: '리뷰봇', aiWriting: true, editing: false, clientIds: [3] }

const handlers = [
  http.get('/api/v1/members/:id', ({ params }) =>
    HttpResponse.json({ userId: Number(params.id), username: 'u', name: '김철수', email: 'a@b.c', title: null, kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null, department: null }),
  ),
  http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({ id: 2, username: 'u', name: '김철수', email: 'a@b.c', title: null, kind: 'HUMAN', groups: [], isFavorite: false })),
  http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
]

test('접속자 이름을 누르면 사람 카드가 열리고 커서로 이동하지 않는다', async () => {
  const onSelect = vi.fn()
  const { user } = renderScreen(<WikiPresenceList people={[KIM, PARK]} onSelect={onSelect} />, { handlers })
  await user.click(within(screen.getByTestId('wiki-presence-row-2')).getByTestId('person-card-trigger-2'))
  expect(await screen.findByTestId('person-card')).toBeInTheDocument()
  expect(onSelect).not.toHaveBeenCalled()
})

test('편집 중인 사람에게만 「커서로 이동」 단추가 있고 누르면 onSelect 가 불린다', async () => {
  const onSelect = vi.fn()
  const { user } = renderScreen(<WikiPresenceList people={[KIM, PARK, BOT]} onSelect={onSelect} />, { handlers })
  await user.click(screen.getByRole('button', { name: '김철수 커서로 이동' }))
  expect(onSelect).toHaveBeenCalledWith(KIM)
  expect(screen.getByRole('button', { name: '리뷰봇 커서로 이동' })).toBeInTheDocument()
})

test('보는 중인 사람에게는 이동 단추가 없다', () => {
  renderScreen(<WikiPresenceList people={[PARK]} onSelect={vi.fn()} />, { handlers })
  expect(screen.queryByRole('button', { name: /커서로 이동/ })).not.toBeInTheDocument()
  expect(screen.getByText('보는 중')).toBeInTheDocument()
})

test('모바일 시트 설명 문구', async () => {
  const mm = window.matchMedia
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as typeof window.matchMedia
  try {
    const { user } = renderScreen(<WikiPresence people={[KIM]} compact stale={false} onJump={vi.fn()} />, { handlers })
    await user.click(screen.getByTestId('wiki-presence'))
    expect(await screen.findByText('이름을 누르면 사람 카드, ⌖ 를 누르면 커서 위치로 이동')).toBeInTheDocument()
  } finally {
    window.matchMedia = mm
  }
})

test('카드 안을 눌러도 접속자 팝오버가 닫히지 않는다', async () => {
  const { user } = renderScreen(<WikiPresence people={[KIM, PARK]} compact={false} stale={false} onJump={vi.fn()} />, { handlers })
  await user.click(screen.getByTestId('wiki-presence'))
  await user.click(await screen.findByTestId('person-card-trigger-3'))
  const card = await screen.findByTestId('person-card')
  await user.click(card)
  expect(screen.getByTestId('wiki-presence-popover')).toBeInTheDocument()
  expect(screen.getByTestId('person-card')).toBeInTheDocument()
})
