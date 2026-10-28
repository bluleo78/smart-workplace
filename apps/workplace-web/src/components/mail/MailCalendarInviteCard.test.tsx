// 메일 일정 초대 카드(WP-986) 화면 테스트 — 초대·취소·옛 초대·응답 불가 렌더, 응답 → POST payload·카드 갱신·캘린더 무효화, 실패 토스트.
// 카드는 상세 캐시(useMailMessage)에서 초대를 읽는 작은 틀로 띄운다 — 응답 뒤 캐시 갱신이 카드에 닿는지까지 본다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse, type RequestHandler } from 'msw'
import { expect, test } from 'vitest'

import { useMailMessage } from '@/hooks/queries/useMailMessages'
import { record } from '@/test/kits/mail/testkit-b4'
import { renderScreen } from '@/test/renderScreen'
import type { CalendarInvite } from '@/types/mailMessage'

import { calendarInvite, detail } from '../../../e2e/factories/mail.factory'
import { MailCalendarInviteCard } from './MailCalendarInviteCard'

/** 7번 메일 상세를 받아 초대가 있으면 카드를 그린다(메일 상세 패널과 같은 캐시). */
function Harness() {
  const { data } = useMailMessage(7)
  if (!data) return null
  return data.calendarInvite ? <MailCalendarInviteCard messageId={7} invite={data.calendarInvite} /> : <div data-testid="no-invite" />
}

function renderCard(invite: CalendarInvite | null, handlers: RequestHandler[] = []) {
  return renderScreen(<Harness />, {
    path: '/mail/1',
    handlers: [...handlers, http.get('/api/v1/mail/messages/7', () => HttpResponse.json(detail({ id: 7, calendarInvite: invite })))],
  })
}

test('초대(REQUEST) — 제목·일정 초대 태그·일시·장소·주최자·참석자 수와 응답 버튼(응답 전이면 눌림 없음)', async () => {
  renderCard(calendarInvite())
  const card = await screen.findByTestId('mail-invite-card')
  expect(within(card).getByTestId('mail-invite-title')).toHaveTextContent('주간 제품 회의')
  expect(within(card).getByTestId('mail-invite-tag')).toHaveTextContent('일정 초대')
  expect(within(card).getByTestId('mail-invite-time')).toHaveTextContent('11월 3일 (화) 오후 2:00 – 3:00')
  expect(within(card).getByTestId('mail-invite-time').className).not.toMatch(/line-through/)
  expect(within(card).getByTestId('mail-invite-location')).toHaveTextContent('장소 3층 대회의실 · Teams')
  expect(within(card).getByTestId('mail-invite-people')).toHaveTextContent('주최자 Ethan Lee <ethan@partner.com> · 참석자 5명')
  const group = within(card).getByRole('group', { name: '참석 여부' })
  expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['수락', '미정', '거절'])
  for (const b of within(group).getAllByRole('button')) expect(b).toHaveAttribute('aria-pressed', 'false')
  // 응답 전이면 결과 문구가 없고, 내 캘린더에 없으면 「캘린더에서 보기」도 없다.
  expect(within(card).queryByTestId('mail-invite-result')).toBeNull()
  expect(within(card).queryByTestId('mail-invite-open-calendar')).toBeNull()
})

test('수락을 누르면 { response: ACCEPTED } 를 보내고, 돌려받은 초대로 카드가 바뀌며 캘린더 쿼리를 무효화한다', async () => {
  const respond = record('post', '/api/v1/mail/messages/7/invite-response', () =>
    HttpResponse.json(calendarInvite({ myResponse: 'ACCEPTED', eventId: 42 })),
  )
  const { user, queryClient } = renderCard(calendarInvite(), [respond.handler])
  // 캘린더 화면이 받아 둔 목록 — 응답 뒤 다시 받도록 무효화돼야 한다.
  queryClient.setQueryData(['calendar', 'events', { from: 'a', to: 'b' }], [])
  await user.click(await screen.findByTestId('rsvp-btn-accepted'))

  expect(await screen.findByTestId('mail-invite-result')).toHaveTextContent('수락했습니다 — 주최자에게 응답을 보냈습니다')
  expect(respond.calls).toHaveLength(1)
  expect(respond.last().body).toEqual({ response: 'ACCEPTED' })
  expect(screen.getByTestId('rsvp-btn-accepted')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('rsvp-btn-declined')).toHaveAttribute('aria-pressed', 'false')
  // 서버가 내 캘린더에 넣은 일정 — 캘린더 상세 딥링크.
  expect(screen.getByTestId('mail-invite-open-calendar')).toHaveAttribute('href', '/calendar?eventId=42')
  expect(queryClient.getQueryState(['calendar', 'events', { from: 'a', to: 'b' }])?.isInvalidated).toBe(true)
})

test('응답을 보내는 동안 세 버튼이 막히고, 응답이 오면 다시 풀린다', async () => {
  let release: () => void = () => {}
  const gate = new Promise<void>((r) => (release = r))
  const respond = record('post', '/api/v1/mail/messages/7/invite-response', async () => {
    await gate
    return HttpResponse.json(calendarInvite({ myResponse: 'DECLINED' }))
  })
  const { user } = renderCard(calendarInvite({ myResponse: 'ACCEPTED' }), [respond.handler])
  await user.click(await screen.findByTestId('rsvp-btn-declined'))
  await waitFor(() => expect(screen.getByTestId('rsvp-btn-accepted')).toBeDisabled())
  expect(screen.getByTestId('rsvp-btn-tentative')).toBeDisabled()
  expect(screen.getByTestId('rsvp-btn-declined')).toBeDisabled()
  release()
  await waitFor(() => expect(screen.getByTestId('rsvp-btn-declined')).toHaveAttribute('aria-pressed', 'true'))
  expect(screen.getByTestId('rsvp-btn-declined')).toBeEnabled()
  expect(screen.getByTestId('mail-invite-result')).toHaveTextContent('거절했습니다 — 주최자에게 응답을 보냈습니다')
  expect(respond.last().body).toEqual({ response: 'DECLINED' })
})

test('이미 응답한 초대는 지금 응답이 눌림으로 보이고 결과 문구·캘린더 링크가 있다', async () => {
  renderCard(calendarInvite({ myResponse: 'TENTATIVE', eventId: 9 }))
  expect(await screen.findByTestId('rsvp-btn-tentative')).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('mail-invite-result')).toHaveTextContent('미정으로 응답했습니다')
  expect(screen.getByTestId('mail-invite-open-calendar')).toHaveTextContent('캘린더에서 보기')
})

test('응답 실패(409)는 서버 문구를 토스트로 보이고, 카드를 다시 받아 버튼을 내리고 안내를 보인다', async () => {
  const respond = record('post', '/api/v1/mail/messages/7/invite-response', () =>
    HttpResponse.json({ status: 409, message: '이 초대는 이후 변경되었습니다 — 최신 메일에서 응답하세요' }, { status: 409 }),
  )
  // 처음 연 상세는 응답 가능한 초대, 409 뒤 다시 받은 상세는 그사이 변경돼 낡은 초대다.
  let gets = 0
  const reload = http.get('/api/v1/mail/messages/7', () => {
    gets += 1
    const invite = gets === 1 ? calendarInvite() : calendarInvite({ outdated: true, canRespond: false })
    return HttpResponse.json(detail({ id: 7, calendarInvite: invite }))
  })
  const { user } = renderCard(calendarInvite(), [respond.handler, reload])
  await user.click(await screen.findByTestId('rsvp-btn-accepted'))
  expect(await screen.findByText('이 초대는 이후 변경되었습니다 — 최신 메일에서 응답하세요', { selector: '[data-sonner-toast] *' })).toBeInTheDocument()
  expect(await screen.findByTestId('mail-invite-outdated')).toBeInTheDocument()
  expect(screen.queryByTestId('rsvp-btn-accepted')).toBeNull()
  expect(screen.queryByTestId('mail-invite-result')).toBeNull()
  expect(gets).toBe(2)
})

test('이후 변경된 옛 초대(outdated) — 버튼 없이 「최신 메일에서 응답하세요」 안내', async () => {
  renderCard(calendarInvite({ outdated: true, canRespond: false, myResponse: 'ACCEPTED' }))
  expect(await screen.findByTestId('mail-invite-outdated')).toHaveTextContent('이 초대는 이후 변경되었습니다 — 최신 메일에서 응답하세요')
  expect(screen.queryByTestId('rsvp-controls')).toBeNull()
  expect(screen.queryByTestId('mail-invite-result')).toBeNull()
})

test('응답할 수 없는 초대(canRespond=false, 최신) — 카드 내용은 보이고 버튼·안내는 없다', async () => {
  renderCard(calendarInvite({ canRespond: false, organizer: null, attendeeCount: 0, location: null }))
  const card = await screen.findByTestId('mail-invite-card')
  expect(within(card).getByTestId('mail-invite-title')).toHaveTextContent('주간 제품 회의')
  expect(within(card).queryByTestId('rsvp-controls')).toBeNull()
  expect(within(card).queryByTestId('mail-invite-outdated')).toBeNull()
  // 주최자·참석자·장소를 모르면 그 줄을 생략한다.
  expect(within(card).queryByTestId('mail-invite-people')).toBeNull()
  expect(within(card).queryByTestId('mail-invite-location')).toBeNull()
})

test('취소(CANCEL) — 취소된 일정 태그·줄 그은 일시·취소 안내, 버튼 없음', async () => {
  renderCard(calendarInvite({ method: 'CANCEL', canRespond: false, sequence: 1 }))
  const card = await screen.findByTestId('mail-invite-card')
  expect(card).toHaveAttribute('aria-label', '취소된 일정')
  expect(within(card).getByTestId('mail-invite-tag')).toHaveTextContent('취소된 일정')
  expect(within(card).getByTestId('mail-invite-tag').className).toMatch(/text-destructive-text/)
  expect(within(card).getByTestId('mail-invite-time').className).toMatch(/line-through/)
  expect(within(card).getByTestId('mail-invite-cancelled')).toHaveTextContent('주최자가 일정을 취소했습니다.')
  expect(within(card).queryByTestId('rsvp-controls')).toBeNull()
})

test('초대가 없는 메일은 카드를 그리지 않는다', async () => {
  renderCard(null)
  expect(await screen.findByTestId('no-invite')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-invite-card')).toBeNull()
})
