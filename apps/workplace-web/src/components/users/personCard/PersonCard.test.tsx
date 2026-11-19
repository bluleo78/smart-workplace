// 사람 카드(WP-1767) — 이름을 누르면 열리는 카드의 내용·단추 동작. 데스크톱(팝오버) 기준이며 모바일 시트는 PersonCardMobile.test.tsx.
import { screen, waitFor, within } from '@testing-library/react'
import { delay, http, HttpResponse } from 'msw'
import { expect, test, vi } from 'vitest'

import { MailComposeProvider, useMailCompose } from '@/components/mail/MailComposeContext'
import { renderScreen } from '@/test/renderScreen'

import { PersonCardAssignContext } from './PersonCardAssignContext'
import { PersonCardTrigger } from './PersonCardTrigger'
import type { PersonRef } from './usePersonCard'

const human: PersonRef = { id: 7, name: '김민수', kind: 'HUMAN', username: 'minsu' }
const agent: PersonRef = { id: 9, name: '리뷰봇', kind: 'AGENT', username: 'reviewbot' }

const profile = (over: Record<string, unknown> = {}) => ({
  userId: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', active: true,
  membershipRole: null, membershipStatus: null, department: '개발팀', ...over,
})
const detail = { id: 7, username: 'minsu', name: '김민수', email: 'minsu@example.com', title: '팀장', kind: 'HUMAN', groups: ['개발팀', '보안TF'], isFavorite: false }
const account = { id: 3, provider: 'IMAP', emailAddress: 'me@example.com', displayName: null }

/** 열린 쓰기 창의 받는 사람 — 컨텍스트가 든 초안을 그대로 보인다(도크 본체 없이). */
function DraftProbe() {
  const { draft } = useMailCompose()
  return draft ? <div data-testid="draft-to">{draft.to.join(',')}</div> : null
}

function setup(person: PersonRef, handlers: Parameters<typeof renderScreen>[1] extends infer O ? (O extends { handlers?: infer H } ? H : never) : never = [], extra: { onAssignWork?: (id: number) => void; onParentClick?: () => void; auth?: Parameters<typeof renderScreen>[1] extends infer O ? (O extends { auth?: infer A } ? A : never) : never } = {}) {
  return renderScreen(
    <MailComposeProvider>
      <div onClick={extra.onParentClick}>
        <PersonCardAssignContext.Provider value={extra.onAssignWork}>
          <PersonCardTrigger person={person}>{person.name}</PersonCardTrigger>
        </PersonCardAssignContext.Provider>
      </div>
      <DraftProbe />
    </MailComposeProvider>,
    {
      // 테스트가 준 핸들러가 먼저 걸린다(MSW 는 앞선 것 우선) — 기본 응답은 뒤에 깐다.
      handlers: [
        ...handlers,
        http.get('/api/v1/members/:id', () => HttpResponse.json(profile())),
        http.get('/api/v1/contacts/members/:id', () => HttpResponse.json(detail)),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([account])),
      ],
      auth: extra.auth,
    },
  )
}

async function openCard(person: PersonRef, view: ReturnType<typeof setup>) {
  await view.user.click(screen.getByTestId(`person-card-trigger-${person.id}`))
  const card = await screen.findByTestId('person-card')
  // 비활성 여부를 알기 전에는 단추를 미루므로(WP-1767) 프로필 응답이 올 때까지 기다린 뒤 단추를 본다.
  await waitFor(() => expect(within(card).queryByTestId('person-card-actions-pending')).not.toBeInTheDocument())
  return card
}

/** 「메일 쓰기」 — 프로필·계정 응답이 끝나 이유가 정해질 때까지(막힌 단추는 툴팁 래퍼가 탭 정지점이 된다) 기다린 뒤 잡는다. */
async function settledMailButton(card: HTMLElement, blocked: boolean) {
  if (blocked) await waitFor(() => expect(within(card).getByRole('button', { name: '메일 쓰기' })).toHaveAttribute('tabindex', '-1'))
  else await waitFor(() => expect(within(card).getByRole('button', { name: '메일 쓰기' })).not.toHaveAttribute('aria-disabled'))
  return within(card).getByRole('button', { name: '메일 쓰기' })
}

test('사람 카드: 이름·직책·아이디·그룹과 단추 셋·연락처 링크가 보이고 Esc 로 닫힌다', async () => {
  const view = setup(human)
  const card = await openCard(human, view)
  expect(within(card).getByText('김민수')).toBeInTheDocument()
  expect(await within(card).findByText('팀장 · 개발팀')).toBeInTheDocument()
  expect(within(card).getByText('minsu')).toBeInTheDocument()
  expect(await within(card).findByText('개발팀, 보안TF')).toBeInTheDocument()
  for (const name of ['메시지', '메일 쓰기', '일정 잡기']) expect(within(card).getByRole('button', { name })).toBeInTheDocument()
  expect(within(card).getByRole('link', { name: '연락처에서 보기' })).toHaveAttribute('href', '/contacts?contact=member:7')
  // 열리면 첫 단추에 포커스
  await waitFor(() => expect(within(card).getByRole('button', { name: '메시지' })).toHaveFocus())
  await view.user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('person-card')).not.toBeInTheDocument())
  expect(screen.getByTestId('person-card-trigger-7')).toHaveFocus()
})

test('「메시지」는 DM 을 만들고 그 대화로 이동한다', async () => {
  let body: unknown
  const view = setup(human, [
    http.post('/api/v1/messaging/dms', async ({ request }) => {
      body = await request.json()
      return HttpResponse.json({ id: 55 })
    }),
  ])
  const card = await openCard(human, view)
  await view.user.click(within(card).getByRole('button', { name: '메시지' }))
  await waitFor(() => expect(view.location()).toBe('/chat/dms/55'))
  expect(body).toEqual({ userIds: [7] })
  expect(screen.queryByTestId('person-card')).not.toBeInTheDocument()
})

test('「메일 쓰기」는 쓰기 창을 그 이메일 받는 사람으로 연다', async () => {
  const view = setup(human)
  const card = await openCard(human, view)
  const mail = await settledMailButton(card, false)
  await view.user.click(mail)
  expect(await screen.findByTestId('draft-to')).toHaveTextContent('minsu@example.com')
  expect(screen.queryByTestId('person-card')).not.toBeInTheDocument()
})

test('메일 계정이 0개면 「메일 쓰기」는 흐리고 「메일 계정 연결 필요」를 안내한다', async () => {
  const view = setup(human, [http.get('/api/v1/mail/accounts', () => HttpResponse.json([]))])
  const card = await openCard(human, view)
  const mail = await settledMailButton(card, true)
  expect(mail).toHaveAttribute('aria-disabled', 'true')
  await view.user.hover(mail)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('메일 계정 연결 필요')
  await view.user.click(mail)
  expect(screen.queryByTestId('draft-to')).not.toBeInTheDocument()
})

test('이메일이 없으면 「메일 쓰기」는 「이메일 없음」을 안내한다', async () => {
  const view = setup(human, [http.get('/api/v1/members/:id', () => HttpResponse.json(profile({ email: null })))])
  const card = await openCard(human, view)
  const mail = await settledMailButton(card, true)
  expect(mail).toHaveAttribute('aria-disabled', 'true')
  await view.user.hover(mail)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('이메일 없음')
})

test('「일정 잡기」는 그 사람을 참석자로 새 일정 주소로 이동한다', async () => {
  const view = setup(human)
  const card = await openCard(human, view)
  await view.user.click(within(card).getByRole('button', { name: '일정 잡기' }))
  await waitFor(() => expect(view.location()).toBe('/calendar?new=true&attendee=minsu'))
})

test('AI 카드: 「AI」·설명·작업 수가 보이고 「일 맡기기」가 onAssignWork 를 부른다. 연락처 링크는 없다', async () => {
  const onAssignWork = vi.fn()
  const view = setup(agent, [
    http.get('/api/v1/members/:id', () => HttpResponse.json(profile({ userId: 9, username: 'reviewbot', name: '리뷰봇', kind: 'AGENT', email: null, title: null, department: null, description: '코드를 리뷰합니다' }))),
    http.get('/api/v1/me/ai-agents', () => HttpResponse.json({ slotLimit: 3, agents: [{ agent: { id: 9, username: 'reviewbot', name: '리뷰봇', kind: 'AGENT' }, description: null, connected: true, disconnectedAt: null, lastEndedAt: null, works: [], hiddenWorks: 0, slotsUsed: 2, slotLimit: 3 }] })),
  ], { onAssignWork })
  const card = await openCard(agent, view)
  expect(within(card).getByText('AI')).toBeInTheDocument()
  expect(await within(card).findByText('코드를 리뷰합니다')).toBeInTheDocument()
  expect(await within(card).findByText('지금 작업 2개')).toBeInTheDocument()
  expect(within(card).queryByRole('link', { name: '연락처에서 보기' })).not.toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: '메일 쓰기' })).not.toBeInTheDocument()
  await view.user.click(within(card).getByRole('button', { name: '일 맡기기' }))
  expect(onAssignWork).toHaveBeenCalledWith(9)
  expect(screen.queryByTestId('person-card')).not.toBeInTheDocument()
})

test('onAssignWork 가 없으면 AI 카드에 「일 맡기기」가 없다', async () => {
  const view = setup(agent, [http.get('/api/v1/me/ai-agents', () => HttpResponse.json({ slotLimit: 3, agents: [] }))])
  const card = await openCard(agent, view)
  expect(within(card).getByRole('button', { name: '메시지' })).toBeInTheDocument()
  expect(within(card).queryByRole('button', { name: '일 맡기기' })).not.toBeInTheDocument()
  expect(within(card).getByRole('button', { name: '일정 잡기' })).toBeInTheDocument()
})

test('나는 「내 프로필」만 보인다', async () => {
  const view = setup({ ...human, id: 1 })
  const card = await openCard({ ...human, id: 1 }, view)
  expect(within(card).getByRole('link', { name: '내 프로필' })).toHaveAttribute('href', '/settings/profile')
  expect(within(card).queryByRole('button', { name: '메시지' })).not.toBeInTheDocument()
})

test('비활성 멤버는 단추 없이 「비활성 멤버」만 보인다(나보다 앞선다)', async () => {
  const view = setup({ ...human, id: 1 }, [http.get('/api/v1/members/:id', () => HttpResponse.json(profile({ userId: 1, active: false })))])
  const card = await openCard({ ...human, id: 1 }, view)
  expect(await within(card).findByText('비활성 멤버')).toBeInTheDocument()
  expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  expect(within(card).queryByRole('link', { name: '내 프로필' })).not.toBeInTheDocument()
})

test('프로필 요청이 500 이어도 카드는 이름과 사람 단추로 열린다', async () => {
  const view = setup(human, [
    http.get('/api/v1/members/:id', () => HttpResponse.json({ message: 'x' }, { status: 500 })),
    http.get('/api/v1/contacts/members/:id', () => HttpResponse.json({ message: 'x' }, { status: 500 })),
  ])
  const card = await openCard(human, view)
  expect(within(card).getByText('김민수')).toBeInTheDocument()
  expect(within(card).getByRole('button', { name: '메시지' })).toBeInTheDocument()
  expect(within(card).getByRole('button', { name: '일정 잡기' })).toBeInTheDocument()
  const mail = await settledMailButton(card, true)
  await view.user.hover(mail)
  expect(await screen.findByRole('tooltip')).toHaveTextContent('이메일 없음')
  expect(within(card).queryByText('팀장 · 개발팀')).not.toBeInTheDocument()
})

test('트리거와 카드 안 클릭은 부모 onClick 을 부르지 않는다', async () => {
  const onParentClick = vi.fn()
  const view = setup(human, [], { onParentClick })
  const card = await openCard(human, view)
  await view.user.click(within(card).getByText('김민수'))
  expect(onParentClick).not.toHaveBeenCalled()
})

test('카드를 열기 전에는 프로필·그룹·메일 계정 요청이 가지 않는다', async () => {
  const calls: string[] = []
  const track = (name: string) => () => {
    calls.push(name)
    return HttpResponse.json({})
  }
  const view = setup(human, [
    http.get('/api/v1/members/:id', track('profile')),
    http.get('/api/v1/contacts/members/:id', track('groups')),
    http.get('/api/v1/mail/accounts', track('accounts')),
  ])
  expect(calls).toEqual([])
  await view.user.click(screen.getByTestId('person-card-trigger-7'))
  await screen.findByTestId('person-card')
  await waitFor(() => expect(calls).toContain('profile'))
})

test('active 를 모르면 프로필 응답 전에는 단추 대신 자리 표시 줄을 보이고, 비활성 멤버는 단추가 한 번도 뜨지 않는다', async () => {
  const view = setup(human, [
    http.get('/api/v1/members/:id', async () => {
      await delay(150)
      return HttpResponse.json(profile({ active: false }))
    }),
  ])
  await view.user.click(screen.getByTestId('person-card-trigger-7'))
  const card = await screen.findByTestId('person-card')
  expect(within(card).getByTestId('person-card-actions-pending')).toBeInTheDocument()
  expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  expect(await within(card).findByText('비활성 멤버')).toBeInTheDocument()
  expect(within(card).queryByRole('button')).not.toBeInTheDocument()
})

test('active 를 알면(호출부가 줌) 프로필 응답 전에도 단추가 보이고, 메일은 이유 없이 막혀 있다가 계정이 오면 열린다', async () => {
  const view = setup({ ...human, active: true }, [
    http.get('/api/v1/mail/accounts', async () => {
      await delay(200)
      return HttpResponse.json([account])
    }),
  ])
  await view.user.click(screen.getByTestId('person-card-trigger-7'))
  const card = await screen.findByTestId('person-card')
  const loadingMail = within(card).getByRole('button', { name: '메일 쓰기' })
  expect(within(card).getByRole('button', { name: '메시지' })).toBeInTheDocument()
  expect(loadingMail).toHaveAttribute('aria-disabled', 'true')
  await view.user.hover(loadingMail)
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  expect(screen.queryByText('이메일 없음')).not.toBeInTheDocument()
  expect(screen.queryByText('메일 계정 연결 필요')).not.toBeInTheDocument()
  await settledMailButton(card, false)
})

test('Esc 는 카드를 닫지만 Enter·Esc 키 입력이 부모 onKeyDown 으로 올라가지 않는다', async () => {
  const parentKeys: string[] = []
  const view = renderScreen(
    <MailComposeProvider>
      <div onKeyDown={(e) => parentKeys.push(e.key)}>
        <PersonCardTrigger person={human}>{human.name}</PersonCardTrigger>
      </div>
    </MailComposeProvider>,
    {
      handlers: [
        http.get('/api/v1/members/:id', () => HttpResponse.json(profile())),
        http.get('/api/v1/contacts/members/:id', () => HttpResponse.json(detail)),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([account])),
      ],
    },
  )
  screen.getByTestId('person-card-trigger-7').focus()
  await view.user.keyboard('{Enter}')
  const card = await screen.findByTestId('person-card')
  await waitFor(() => expect(within(card).getByRole('button', { name: '메시지' })).toHaveFocus())
  await view.user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByTestId('person-card')).not.toBeInTheDocument())
  expect(parentKeys).toEqual([])
})

test('카드 안에서 마지막 칸에서 Tab 을 누르면 첫 단추로 돌아온다(포커스가 카드 밖으로 새지 않는다). 부모 onKeyDown 은 키를 받지 않는다', async () => {
  const parentKeys: string[] = []
  const view = renderScreen(
    <MailComposeProvider>
      <div onKeyDown={(e) => parentKeys.push(e.key)}>
        <PersonCardTrigger person={human}>{human.name}</PersonCardTrigger>
      </div>
    </MailComposeProvider>,
    {
      handlers: [
        http.get('/api/v1/members/:id', () => HttpResponse.json(profile())),
        http.get('/api/v1/contacts/members/:id', () => HttpResponse.json(detail)),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([account])),
      ],
    },
  )
  const card = await openCard(human, view)
  await settledMailButton(card, false)
  const last = within(card).getByRole('link', { name: '연락처에서 보기' })
  last.focus()
  await view.user.tab()
  expect(within(card).getByRole('button', { name: '메시지' })).toHaveFocus()
  // 거꾸로(Shift+Tab) 첫 단추에서는 마지막 칸으로 돈다.
  await view.user.tab({ shift: true })
  expect(last).toHaveFocus()
  expect(parentKeys).toEqual([])
})

test('카드 안 누르기는 부모 onPointerUp(행 툴바 드러내기)으로 올라가지 않고, 안을 누른 뒤에도 바깥 한 번 누르기로 닫힌다', async () => {
  const onParentPointerUp = vi.fn()
  const view = renderScreen(
    <MailComposeProvider>
      <div onPointerUp={onParentPointerUp}>
        <PersonCardTrigger person={human}>{human.name}</PersonCardTrigger>
      </div>
      <div data-testid="outside">바깥</div>
    </MailComposeProvider>,
    {
      handlers: [
        http.get('/api/v1/members/:id', () => HttpResponse.json(profile())),
        http.get('/api/v1/contacts/members/:id', () => HttpResponse.json(detail)),
        http.get('/api/v1/mail/accounts', () => HttpResponse.json([account])),
      ],
    },
  )
  const card = await openCard(human, view)
  onParentPointerUp.mockClear()
  await view.user.click(within(card).getByText('김민수'))
  expect(onParentPointerUp).not.toHaveBeenCalled()
  // 안쪽 pointerdown 이 문서까지 가야 Radix 가 「안쪽 누름」 표식을 지운다 — 바깥을 한 번 누르면 바로 닫혀야 한다.
  await view.user.click(screen.getByTestId('outside'))
  await waitFor(() => expect(screen.queryByTestId('person-card')).not.toBeInTheDocument())
})
