// 메일 첫 화면(/mail, 계정 미지정)에서 계정 목록 조회가 실패했을 때의 안내 — 화면 테스트(WP-1761).
// 실패를 「연결된 계정 없음」 빈 상태로 보이면 계정이 있는데도 연결을 새로 하라는 오해를 주므로, 오류 안내 + 다시 시도를 보인다.
// 같은 파일에서 데스크톱·모바일을 모두 보기 위해 폭을 바꿀 수 있는 뷰포트(mockResizableViewport)를 쓴다.
import { screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, expect, test } from 'vitest'

import { renderMail } from '@/test/kits/mail/testkit-b4'
import { mockResizableViewport } from '@/test/viewport'

import { mailAccount, summary } from '../../../e2e/factories/mail.factory'

const viewport = mockResizableViewport({ width: 1280, height: 900, pointer: 'fine' })

afterEach(() => {
  // 모바일 테스트가 바꾼 폭을 다음 테스트 전에 데스크톱으로 되돌린다.
  viewport.setWidth(1280)
})

const ACCOUNTS = '/api/v1/mail/accounts'
// 휴대폰 메일 머리줄의 🔔 가 부르는 알림 수 — 이 파일의 관심사가 아니라 0 으로 둔다.
const BELL = http.get('/api/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 }))
// 계정 목록 조회가 항상 500 인 핸들러.
const FAIL = http.get(ACCOUNTS, () => new HttpResponse(null, { status: 500 }))
/** 첫 화면 오류 안내 안의 「다시 시도」 단추. */
const retryButton = () => within(screen.getByTestId('mail-accounts-error')).getByRole('button', { name: '다시 시도' })

/** 첫 호출은 500, 이후는 주어진 응답. 호출 횟수를 함께 돌려준다. */
function failThen(next: () => Response | Promise<Response>) {
  const state = { calls: 0 }
  const handler = http.get(ACCOUNTS, () => {
    state.calls += 1
    return state.calls === 1 ? new HttpResponse(null, { status: 500 }) : next()
  })
  return { handler, state }
}

/** failThen 에 문을 단다 — 재시도 응답이 release() 를 부를 때까지 보류돼 「다시 시도 중」 상태를 붙잡아 둔다. */
function gatedFailThen(body: () => Response) {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const { handler } = failThen(async () => {
    await gate
    return body()
  })
  return { handler, release }
}

test('계정 목록 조회가 500 이면 빈 상태 대신 오류 안내와 다시 시도를 보인다', async () => {
  renderMail('/mail', { handlers: [FAIL] })
  const box = await screen.findByTestId('mail-accounts-error')
  expect(box).toHaveTextContent('메일 계정을 불러오지 못했습니다')
  // 설명은 LoadErrorState 공용 기본 문구를 쓴다(WP-1761).
  expect(box).toHaveTextContent('일시적인 문제일 수 있어요. 잠시 뒤 다시 시도해 주세요.')
  expect(box).toHaveAttribute('role', 'alert')
  expect(within(box).getByRole('button', { name: '다시 시도' })).not.toHaveAttribute('aria-disabled')
  expect(screen.queryByTestId('mail-empty-accounts')).toBeNull()
})

test('다시 시도로 성공하면 첫 계정 받은편지함으로 간다', async () => {
  const { handler } = failThen(() => HttpResponse.json([mailAccount({ id: 1 })]))
  const { user, location } = renderMail('/mail', { handlers: [handler] })
  await screen.findByTestId('mail-accounts-error')
  await user.click(retryButton())
  await waitFor(() => expect(location()).toMatch(/^\/mail\/1/))
})

test('다시 시도로 성공했는데 계정이 없으면 기존 빈 상태', async () => {
  const { handler } = failThen(() => HttpResponse.json([]))
  const { user } = renderMail('/mail', { handlers: [handler] })
  await screen.findByTestId('mail-accounts-error')
  await user.click(retryButton())
  expect(await screen.findByTestId('mail-empty-accounts')).toBeInTheDocument()
  expect(screen.queryByTestId('mail-accounts-error')).toBeNull()
})

test('다시 시도 중에는 단추가 비활성', async () => {
  const { handler, release } = gatedFailThen(() => HttpResponse.json([]))
  const { user } = renderMail('/mail', { handlers: [handler] })
  await screen.findByTestId('mail-accounts-error')
  await user.click(retryButton())
  await waitFor(() => expect(retryButton()).toHaveAttribute('aria-disabled', 'true'))
  release()
  await waitFor(() => expect(screen.queryByTestId('mail-accounts-error')).toBeNull())
})

test('모바일에서도 오류 안내와 헤더 메일 제목', async () => {
  viewport.setWidth(390)
  renderMail('/mail', { handlers: [BELL, FAIL] })
  expect(await screen.findByTestId('mail-accounts-error')).toHaveTextContent('메일 계정을 불러오지 못했습니다')
  expect(screen.getByRole('heading', { name: '메일' })).toBeInTheDocument()
  expect(screen.queryByTestId('mail-empty-accounts')).toBeNull()
})

// ── 사이드바(WP-1761): 목록 조회 실패를 「연결된 계정이 없습니다」와 구분한다 ──

test('사이드바 — 조회 500 이면 「계정을 불러오지 못했습니다」와 다시 시도, 계정 없음 문구·스위처는 없다', async () => {
  renderMail('/mail', { handlers: [FAIL] })
  const side = within(await screen.findByTestId('mail-sidebar'))
  const row = await side.findByTestId('mail-sidebar-accounts-error')
  expect(row).toHaveTextContent('계정을 불러오지 못했습니다')
  expect(row).toHaveAttribute('role', 'alert')
  expect(side.queryByTestId('mail-no-account')).toBeNull()
  expect(side.queryByTestId('mail-account-switcher')).toBeNull()
})

test('사이드바 다시 시도로 성공하면 계정 스위처가 나온다', async () => {
  const { handler } = failThen(() => HttpResponse.json([mailAccount({ id: 1, emailAddress: 'a@x.com' })]))
  const { user } = renderMail('/mail', { handlers: [handler] })
  const side = within(await screen.findByTestId('mail-sidebar'))
  await user.click(await side.findByTestId('mail-sidebar-accounts-error-retry'))
  expect(await side.findByTestId('mail-account-switcher')).toHaveTextContent('a@x.com')
})

test('사이드바 다시 시도 중에는 단추가 비활성', async () => {
  const { handler, release } = gatedFailThen(() => HttpResponse.json([mailAccount({ id: 1, emailAddress: 'a@x.com' })]))
  const { user } = renderMail('/mail', { handlers: [handler] })
  const side = within(await screen.findByTestId('mail-sidebar'))
  await user.click(await side.findByTestId('mail-sidebar-accounts-error-retry'))
  await waitFor(() => expect(side.getByTestId('mail-sidebar-accounts-error-retry')).toHaveAttribute('aria-disabled', 'true'))
  release()
  expect(await side.findByTestId('mail-account-switcher')).toBeInTheDocument()
})

test('사이드바 — 이미 받은 목록은 이후 백그라운드 재조회가 실패해도 스위처가 남는다', async () => {
  let calls = 0
  const handler = http.get(ACCOUNTS, () => {
    calls += 1
    return calls === 1
      ? HttpResponse.json([mailAccount({ id: 1, emailAddress: 'a@x.com' })])
      : new HttpResponse(null, { status: 500 })
  })
  const { queryClient } = renderMail('/mail/1', { handlers: [handler] })
  const side = within(await screen.findByTestId('mail-sidebar'))
  expect(await side.findByTestId('mail-account-switcher')).toHaveTextContent('a@x.com')
  await queryClient.refetchQueries({ queryKey: ['mail-accounts'] })
  // 재조회가 실제로 실패 상태에 닿은 뒤에 확인한다 — 아니면 실패 전에 통과해 회귀를 못 잡는다.
  await waitFor(() => expect(queryClient.getQueryState(['mail-accounts'])?.status).toBe('error'))
  expect(side.getByTestId('mail-account-switcher')).toBeInTheDocument()
  expect(side.queryByTestId('mail-sidebar-accounts-error')).toBeNull()
})

test('/mail/:accountId 에서 사이드바 다시 시도 중에도 메일함이 「불러오는 중…」으로 바뀌지 않는다', async () => {
  const { handler, release } = gatedFailThen(() => HttpResponse.json([mailAccount({ id: 1, emailAddress: 'a@x.com' })]))
  const messages = http.get('/api/v1/mail/accounts/:id/messages', () => HttpResponse.json([summary({ id: 11, subject: '유지 확인' })]))
  const { user } = renderMail('/mail/1', { handlers: [handler, messages] })
  const side = within(await screen.findByTestId('mail-sidebar'))
  // 첫 조회 실패 뒤: 메일함(메일 행)은 이미 그려져 있다.
  const status = await screen.findByTestId('mail-row-11')
  await user.click(await side.findByTestId('mail-sidebar-accounts-error-retry'))
  await waitFor(() => expect(side.getByTestId('mail-sidebar-accounts-error-retry')).toHaveAttribute('aria-disabled', 'true'))
  // 재조회가 진행 중인데도 같은 메일함 노드가 그대로 붙어 있고 로딩 자리표시는 없다.
  expect(screen.getByTestId('mail-row-11')).toBe(status)
  expect(screen.queryByText('불러오는 중…')).toBeNull()
  release()
  expect(await side.findByTestId('mail-account-switcher')).toHaveTextContent('a@x.com')
  expect(screen.getByTestId('mail-row-11')).toBe(status)
})
