// 연락처 멤버 상세의 단추 줄(WP-1769) — 사람 카드와 같은 「메시지」·「메일 쓰기」·「일정 잡기」가 상세 패널에서도 동작한다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { useState } from 'react'
import { expect, test } from 'vitest'

import { useMailCompose } from '@/components/mail/MailComposeContext'
import { type AuthContextValue } from '@/hooks/auth-context-value'
import { renderScreen } from '@/test/renderScreen'
import { testAuthValue } from '@/test/renderWithProviders'

import type { ContactSelection } from '../../hooks/queries/useContactDetail'
import { ContactDetailPanel } from './ContactDetailPanel'

const detail = (over: Record<string, unknown> = {}) => ({
  id: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', groups: ['개발팀'], isFavorite: false, ...over,
})
const account = { id: 3, provider: 'IMAP', emailAddress: 'me@example.com', displayName: null }

/** 열린 쓰기 창의 받는 사람 — 컨텍스트가 든 초안을 그대로 보인다(도크 본체 없이). */
function DraftProbe() {
  const { draft } = useMailCompose()
  return draft ? <div data-testid="draft-to">{draft.to.join(',')}</div> : null
}

/** 선택을 바꾸는 단추가 달린 판 — renderScreen 의 감싸개(라우터·쿼리)를 유지한 채 같은 패널의 selected 만 바꿔 다시 그린다. */
function Harness() {
  const [selected, setSelected] = useState<ContactSelection>({ type: 'MEMBER', id: 7 })
  return (
    <>
      <button type="button" onClick={() => setSelected({ type: 'MEMBER', id: 8 })}>다른 멤버 선택</button>
      <ContactDetailPanel selected={selected} />
      <DraftProbe />
    </>
  )
}

function setup(handlers: RequestHandler[] = [], auth?: Partial<AuthContextValue>) {
  const view = renderScreen(<Harness />, {
    handlers: [
      ...handlers,
      http.get('/api/v1/contacts/members/:id', () => HttpResponse.json(detail())),
      http.get('/api/v1/mail/accounts', () => HttpResponse.json([account])),
    ],
    auth,
  })
  return view
}

async function actions() {
  return within(await screen.findByTestId('contact-detail-actions'))
}

test('메시지를 누르면 DM 을 열고 그 화면으로 간다', async () => {
  const view = setup([http.post('/api/v1/messaging/dms', () => HttpResponse.json({ id: 42 }))])
  const bar = await actions()
  await view.user.click(bar.getByRole('button', { name: '메시지' }))
  await waitFor(() => expect(view.location()).toBe('/chat/dms/42'))
})

test('메일 쓰기는 받는 사람을 채운 쓰기 창을 연다', async () => {
  const view = setup()
  const bar = await actions()
  await waitFor(() => expect(bar.getByRole('button', { name: '메일 쓰기' })).not.toHaveAttribute('aria-disabled'))
  await view.user.click(bar.getByRole('button', { name: '메일 쓰기' }))
  expect(await screen.findByTestId('draft-to')).toHaveTextContent('minsu@example.com')
})

test('일정 잡기는 참석자를 채운 새 일정으로 간다', async () => {
  const view = setup()
  const bar = await actions()
  await view.user.click(bar.getByRole('button', { name: '일정 잡기' }))
  await waitFor(() => expect(view.location()).toBe('/calendar?new=true&attendee=minsu'))
})

test('이메일이 없으면 메일 쓰기가 막히고 이메일 없음', async () => {
  const view = setup([http.get('/api/v1/contacts/members/:id', () => HttpResponse.json(detail({ email: null })))])
  const bar = await actions()
  await waitFor(() => expect(bar.getByRole('button', { name: /^메일 쓰기 — / })).toHaveAttribute('aria-disabled', 'true'))
  await view.user.hover(bar.getByRole('button', { name: /^메일 쓰기 — / }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('이메일 없음')
})

test('메일 계정이 없으면 메일 계정 연결 필요', async () => {
  const view = setup([http.get('/api/v1/mail/accounts', () => HttpResponse.json([]))])
  const bar = await actions()
  await waitFor(() => expect(bar.getByRole('button', { name: /^메일 쓰기 — / })).toHaveAttribute('aria-disabled', 'true'))
  await view.user.hover(bar.getByRole('button', { name: /^메일 쓰기 — / }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('메일 계정 연결 필요')
})

test('나 자신이면 내 프로필만', async () => {
  setup([], { user: { ...testAuthValue.user!, id: 7, username: 'minsu' } })
  const bar = await actions()
  expect(bar.getByRole('link', { name: '내 프로필' })).toHaveAttribute('href', '/settings/profile')
  expect(bar.queryByRole('button', { name: '메시지' })).not.toBeInTheDocument()
})

test('다른 멤버로 바꾸면 단추가 새 멤버를 가리킨다', async () => {
  const view = setup([
    http.get('/api/v1/contacts/members/8', () => HttpResponse.json(detail({ id: 8, username: 'jisu', name: '박지수', email: 'jisu@example.com' }))),
  ])
  await actions()
  await view.user.click(screen.getByRole('button', { name: '다른 멤버 선택' }))
  await screen.findByText('박지수')
  const bar = await actions()
  await waitFor(() => expect(bar.getByRole('button', { name: '메일 쓰기' })).not.toHaveAttribute('aria-disabled'))
  await view.user.click(bar.getByRole('button', { name: '메일 쓰기' }))
  expect(await screen.findByTestId('draft-to')).toHaveTextContent('jisu@example.com')
})

test('이메일 username 멤버는 메타에 @ 를 겹쳐 붙이지 않는다 (WP-1880)', async () => {
  setup([http.get('/api/v1/contacts/members/:id', () => HttpResponse.json(detail({ username: 'admin@work-loop.local' })))])
  expect(await screen.findByText('멤버 · admin@work-loop.local')).toBeInTheDocument()
  expect(screen.queryByText(/@admin@/)).toBeNull()
})

test('핸들 username 멤버는 @ 를 붙인다 (WP-1880)', async () => {
  setup()
  expect(await screen.findByText('멤버 · @minsu')).toBeInTheDocument()
})
