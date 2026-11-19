// 사람 카드 휴대폰 모양(WP-1767) — 뷰포트가 파일당 하나라 데스크톱 테스트(PersonCard.test.tsx)와 나눈다. 아래 시트로 열린다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import { MailComposeProvider } from '@/components/mail/MailComposeContext'
import { renderScreen } from '@/test/renderScreen'
import { mockViewport } from '@/test/viewport'

import { PersonCardTrigger } from './PersonCardTrigger'

mockViewport()

test('모바일에서는 아래 시트로 열리고 닫으면 트리거로 포커스가 돌아온다', async () => {
  const person = { id: 7, name: '김민수', kind: 'HUMAN' as const, username: 'minsu' }
  const { user } = renderScreen(
    <MailComposeProvider>
      <PersonCardTrigger person={person}>{person.name}</PersonCardTrigger>
    </MailComposeProvider>,
    {
      handlers: [
        http.get('/api/v1/members/:id', () => HttpResponse.json({ userId: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null })),
        http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({ id: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', groups: [], isFavorite: false })),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
      ],
    },
  )
  await user.click(screen.getByTestId('person-card-trigger-7'))
  const sheet = await screen.findByTestId('person-card-sheet')
  const card = within(sheet).getByTestId('person-card')
  expect(within(card).getByRole('button', { name: '메시지' })).toBeInTheDocument()
  expect(within(card).getByRole('button', { name: '일정 잡기' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('person-card-sheet')).not.toBeInTheDocument())
  expect(screen.getByTestId('person-card-trigger-7')).toHaveFocus()
})

test('모바일 시트도 마지막 칸에서 Tab 을 누르면 첫 단추로 돌아오고, 부모 onKeyDown 은 키를 받지 않는다', async () => {
  const person = { id: 7, name: '김민수', kind: 'HUMAN' as const, username: 'minsu' }
  const parentKeys: string[] = []
  const { user } = renderScreen(
    <MailComposeProvider>
      <div onKeyDown={(e) => parentKeys.push(e.key)}>
        <PersonCardTrigger person={person}>{person.name}</PersonCardTrigger>
      </div>
    </MailComposeProvider>,
    {
      handlers: [
        http.get('/api/v1/members/:id', () => HttpResponse.json({ userId: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null })),
        http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({ id: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', groups: [], isFavorite: false })),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
      ],
    },
  )
  await user.click(screen.getByTestId('person-card-trigger-7'))
  const sheet = await screen.findByTestId('person-card-sheet')
  const card = within(sheet).getByTestId('person-card')
  // 메일 계정이 없어 「메일 쓰기」는 툴팁 래퍼가 탭 정지점이 된다 — 이유가 정해질 때까지 기다린다.
  await waitFor(() => expect(within(card).getByRole('button', { name: '메일 쓰기' })).toHaveAttribute('tabindex', '-1'))
  const last = within(card).getByRole('link', { name: '연락처에서 보기' })
  last.focus()
  await user.tab()
  expect(within(card).getByRole('button', { name: '메시지' })).toHaveFocus()
  expect(parentKeys).toEqual([])
})

test('모바일 시트 안 탭은 부모 onPointerUp(행 툴바 드러내기)으로 올라가지 않는다', async () => {
  const person = { id: 7, name: '김민수', kind: 'HUMAN' as const, username: 'minsu' }
  const onParentPointerUp = vi.fn()
  const { user } = renderScreen(
    <MailComposeProvider>
      <div onPointerUp={onParentPointerUp}>
        <PersonCardTrigger person={person}>{person.name}</PersonCardTrigger>
      </div>
    </MailComposeProvider>,
    {
      handlers: [
        http.get('/api/v1/members/:id', () => HttpResponse.json({ userId: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', active: true, membershipRole: null, membershipStatus: null })),
        http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({ id: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', groups: [], isFavorite: false })),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([])),
      ],
    },
  )
  await user.click(screen.getByTestId('person-card-trigger-7'))
  const card = within(await screen.findByTestId('person-card-sheet')).getByTestId('person-card')
  onParentPointerUp.mockClear()
  await user.click(within(card).getByText('김민수'))
  expect(onParentPointerUp).not.toHaveBeenCalled()
})
