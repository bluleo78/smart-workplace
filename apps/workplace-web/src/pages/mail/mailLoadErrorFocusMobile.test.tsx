// 휴대폰 상세 오류 안내의 부모가 성공 화면까지 남아야, 다시 시도로 성공해도 LoadErrorState 의 초점 정리가
// 끊기지 않고 상세 안 첫 조작 요소로 초점을 옮긴다(WP-1911) — jsdom 은 초점 이동 자체를 못 재니 부모만 본다.
import { act, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'

import { renderMail } from '@/test/kits/mail/testkit-b4'
import { mockViewport } from '@/test/viewport'

import { detail, summary } from '../../../e2e/factories/mail.factory'

mockViewport()

test('휴대폰 상세 오류 안내의 부모가 다시 시도 성공 뒤에도 연결돼 있다(WP-1911)', async () => {
  let calls = 0
  const handler = http.get('/api/v1/mail/messages/100', () => {
    calls += 1
    if (calls === 1) return new HttpResponse(null, { status: 500 })
    return HttpResponse.json(detail({ id: 100, subject: '월간 보고서' }))
  })
  const { user } = renderMail('/mail/1?messageId=100', {
    messages: [summary({ id: 100, subject: '월간 보고서' })],
    handlers: [handler],
  })
  const err = await screen.findByTestId('mail-detail-error')
  const parent = err.parentElement!
  await user.click(within(err).getByRole('button', { name: /다시 시도/ }))
  await screen.findByTestId('mail-detail')
  expect(parent.isConnected).toBe(true)
  // 부모가 MailComposePaneSlot 의 contents div 여야 성공 화면까지 같은 자리에 남는다(WP-1911).
  expect(parent).toHaveClass('contents')
  expect(parent.contains(screen.getByTestId('mail-detail'))).toBe(true)
})

// 이슈의 무대가 휴대폰이라, 데이터 있는 중 재조회가 실패해도 모바일 자리(상단바 아래)에서 배너가 뜨는지 데스크톱과
// 별개로 지킨다. 첫 조회는 200(데이터 보임) → 재조회만 500 으로 두고, 무효화로 재조회를 실제로 일으킨다.
test('휴대폰 데이터 있는 재조회 실패는 상단바 아래 배너로만 알리고 본문을 남긴다(WP-1911)', async () => {
  let calls = 0
  const handler = http.get('/api/v1/mail/messages/100', () => {
    calls += 1
    // 첫 호출은 성공(본문이 화면에 있음), 재조회부터 500 — 데이터 있는 중 재조회 실패 상황.
    if (calls === 1) return HttpResponse.json(detail({ id: 100, subject: '월간 보고서' }))
    return new HttpResponse(null, { status: 500 })
  })
  const { queryClient } = renderMail('/mail/1?messageId=100', {
    messages: [summary({ id: 100, subject: '월간 보고서' })],
    handlers: [handler],
  })
  await screen.findByTestId('mail-detail')
  // 기존 코드가 쓰는 무효화로 재조회를 실제로 일으킨다 — invalidateQueries 기본(refetchType 'active')이 활성
  // 쿼리를 바로 다시 부르고, 테스트 클라이언트는 retry 가 꺼져 있어 실패 한 번으로 오류 상태에 닿는다.
  await act(async () => {
    queryClient.invalidateQueries({ queryKey: ['mail-message', 100] })
  })
  const err = await screen.findByTestId('mail-detail-error')
  // 무효화가 실제로 재조회로 이어졌는지 호출 수로 확인한다(첫 200 이후 재조회가 한 번 이상 있었다).
  expect(calls).toBeGreaterThan(1)
  // 배너는 MailMobileDetail 상단바 바로 아래, mail-detail 의 바로 앞 형제 자리다.
  expect(screen.getByTestId('mail-detail').previousElementSibling).toHaveAttribute('data-testid', 'mail-detail-error')
  // 본문은 그대로 남아 있다 — 데이터 없이 실패한 block 안내 경로(MailInboxPage 단일 return)면 mail-detail 자체가 그려지지 않는다.
  expect(screen.getByTestId('mail-detail')).toHaveTextContent('월간 보고서')
  // 문구로 실제 banner 경로임을 확정한다 — block 안내의 제목은 「메일을 불러오지 못했습니다」라 둘이 다르다.
  expect(err).toHaveTextContent('메일을 다시 불러오지 못했습니다')
})
