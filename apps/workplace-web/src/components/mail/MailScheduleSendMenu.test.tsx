// 메일 예약 보내기 메뉴(WP-1787) — ▾ 드롭다운(프리셋·날짜 선택 대화상자)과 모바일 ⋯ 시트.
// 시계는 2026-11-19 22:30(목, 로컬)로 고정한다.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { MailScheduleSendMenu } from './MailScheduleSendMenu'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 19, 22, 30))
})
afterEach(() => {
  vi.useRealTimers()
})

const setup = (props: Partial<React.ComponentProps<typeof MailScheduleSendMenu>> = {}) => {
  const onSchedule = vi.fn()
  const user = userEvent.setup()
  render(<MailScheduleSendMenu disabled={false} onSchedule={onSchedule} variant="dock" {...props} />)
  return { onSchedule, user }
}

test('▾ 를 누르면 예약 보내기 머리와 두 프리셋(날짜 라벨 포함)·날짜·시간 선택이 보인다', async () => {
  const { user } = setup()
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  expect(await screen.findByText('예약 보내기')).toBeInTheDocument()
  const tomorrow = screen.getByTestId('mail-schedule-preset-tomorrow')
  expect(tomorrow).toHaveTextContent('내일 오전 9:00')
  expect(tomorrow).toHaveTextContent('11월 20일 (금)')
  const monday = screen.getByTestId('mail-schedule-preset-monday')
  expect(monday).toHaveTextContent('월요일 오전 9:00')
  expect(monday).toHaveTextContent('11월 23일 (월)')
  expect(screen.getByTestId('mail-schedule-custom')).toHaveTextContent('날짜·시간 선택')
})

test('내일 오전 9:00 → onSchedule 에 내일 9시(로컬) 한 번', async () => {
  const { user, onSchedule } = setup()
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByTestId('mail-schedule-preset-tomorrow'))
  expect(onSchedule).toHaveBeenCalledTimes(1)
  expect(onSchedule.mock.calls[0][0]).toEqual(new Date(2026, 10, 20, 9, 0))
})

test('날짜·시간 선택 — min 은 지금+2분, 지난 값이면 예약이 막히고 미래 값이면 onSchedule', async () => {
  const { user, onSchedule } = setup()
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByTestId('mail-schedule-custom'))
  const input = (await screen.findByTestId('mail-schedule-datetime')) as HTMLInputElement
  expect(input.type).toBe('datetime-local')
  expect(input.min).toBe('2026-11-19T22:32')
  const confirm = screen.getByTestId('mail-schedule-confirm')
  expect(confirm).toHaveTextContent('예약')

  // 지난 값 — 막힌다.
  input.focus()
  await user.clear(input)
  await user.type(input, '2026-11-19T22:00')
  expect(confirm).toBeDisabled()
  await user.click(confirm)
  expect(onSchedule).not.toHaveBeenCalled()

  // 미래 값
  await user.clear(input)
  await user.type(input, '2026-11-25T14:30')
  expect(confirm).toBeEnabled()
  await user.click(confirm)
  expect(onSchedule).toHaveBeenCalledTimes(1)
  expect(onSchedule.mock.calls[0][0]).toEqual(new Date(2026, 10, 25, 14, 30))
})

test('disabled 면 ▾ 도 disabled', () => {
  setup({ disabled: true })
  expect(screen.getByTestId('mail-compose-schedule-trigger')).toBeDisabled()
})

test('모바일 — ⋯ → 예약 보내기 → 시트에 같은 프리셋, 고르면 onSchedule', async () => {
  const { user, onSchedule } = setup({ variant: 'mobile' })
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByRole('menuitem', { name: '예약 보내기' }))
  const sheet = await screen.findByTestId('mail-schedule-sheet')
  expect(within(sheet).getByTestId('mail-schedule-preset-tomorrow')).toHaveTextContent('내일 오전 9:00')
  expect(within(sheet).getByTestId('mail-schedule-preset-monday')).toHaveTextContent('11월 23일 (월)')
  expect(within(sheet).getByTestId('mail-schedule-custom')).toBeInTheDocument()
  await user.click(within(sheet).getByTestId('mail-schedule-preset-monday'))
  expect(onSchedule).toHaveBeenCalledTimes(1)
  expect(onSchedule.mock.calls[0][0]).toEqual(new Date(2026, 10, 23, 9, 0))
})

test('날짜·시간 선택 — 열어 둔 사이 최소 시각이 지나면 확인해도 보내지 않고 안내가 뜬다', async () => {
  const { user, onSchedule } = setup()
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByTestId('mail-schedule-custom'))
  const input = (await screen.findByTestId('mail-schedule-datetime')) as HTMLInputElement
  // 최소 시각(22:32) 그대로 고른다 — 이 시점엔 유효.
  input.focus()
  await user.clear(input)
  await user.type(input, '2026-11-19T22:32')
  expect(screen.getByTestId('mail-schedule-confirm')).toBeEnabled()
  // 3분이 흐른 뒤 확인
  vi.setSystemTime(new Date(2026, 10, 19, 22, 33))
  await user.click(screen.getByTestId('mail-schedule-confirm'))
  expect(onSchedule).not.toHaveBeenCalled()
  expect(screen.getByText('지금부터 2분 뒤 이후로 골라 주세요')).toBeInTheDocument()
  expect(screen.getByTestId('mail-schedule-datetime')).toBeInTheDocument()
})

// 코드 리뷰 — 메뉴 항목은 메뉴가 다 닫힌 뒤 대화상자를 연다: 열린 대화상자가 초점을 갖고(트리거로 돌아가지 않음) 그대로 열려 있다.
test('날짜·시간 선택 — 메뉴가 닫힌 뒤 대화상자가 열리고 초점이 대화상자 안에 있다', async () => {
  const { user } = setup()
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByTestId('mail-schedule-custom'))
  const dialog = await screen.findByRole('dialog')
  expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  expect(screen.getByTestId('mail-compose-schedule-trigger')).not.toHaveFocus()
})

// 코드 리뷰 — 1년보다 먼 시각은 서버가 거절하므로 고를 때 막는다(max 도 1년 뒤).
test('날짜·시간 선택 — max 는 1년 뒤, 그보다 먼 값은 예약이 막히고 안내가 뜬다', async () => {
  const { user, onSchedule } = setup()
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByTestId('mail-schedule-custom'))
  const input = (await screen.findByTestId('mail-schedule-datetime')) as HTMLInputElement
  expect(input.max).toBe('2027-11-19T22:30')
  input.focus()
  await user.clear(input)
  await user.type(input, '2027-11-20T09:00')
  expect(screen.getByTestId('mail-schedule-confirm')).toBeDisabled()
  expect(screen.getByText('지금부터 1년 안으로 골라 주세요')).toBeInTheDocument()
  await user.click(screen.getByTestId('mail-schedule-confirm'))
  expect(onSchedule).not.toHaveBeenCalled()
})

// 코드 리뷰 — 대화상자를 열어 둔 사이 보내기가 잠기면(첨부 업로드 시작 등) 확인해도 닫지 않고 안내한다.
test('날짜·시간 선택 — 열어 둔 사이 disabled 가 되면 확인해도 예약하지 않고 대화상자에 안내가 뜬다', async () => {
  const onSchedule = vi.fn()
  const user = userEvent.setup()
  const { rerender } = render(<MailScheduleSendMenu disabled={false} onSchedule={onSchedule} variant="dock" />)
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByTestId('mail-schedule-custom'))
  await screen.findByTestId('mail-schedule-datetime')
  rerender(<MailScheduleSendMenu disabled onSchedule={onSchedule} variant="dock" />)
  await user.click(screen.getByTestId('mail-schedule-confirm'))
  expect(onSchedule).not.toHaveBeenCalled()
  expect(screen.getByTestId('mail-schedule-blocked')).toHaveTextContent('지금은 예약할 수 없어요')
  expect(screen.getByTestId('mail-schedule-datetime')).toBeInTheDocument()

  // 잠금이 풀리면 같은 대화상자에서 예약된다.
  rerender(<MailScheduleSendMenu disabled={false} onSchedule={onSchedule} variant="dock" />)
  await user.click(screen.getByTestId('mail-schedule-confirm'))
  expect(onSchedule).toHaveBeenCalledTimes(1)
  expect(onSchedule.mock.calls[0][0]).toEqual(new Date(2026, 10, 20, 9, 0))
})

test('모바일 — 시트를 열어 둔 사이 disabled 가 되면 프리셋을 눌러도 예약하지 않고 시트에 안내가 뜬다', async () => {
  const onSchedule = vi.fn()
  const user = userEvent.setup()
  const { rerender } = render(<MailScheduleSendMenu disabled={false} onSchedule={onSchedule} variant="mobile" />)
  await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
  await user.click(await screen.findByRole('menuitem', { name: '예약 보내기' }))
  const sheet = await screen.findByTestId('mail-schedule-sheet')
  rerender(<MailScheduleSendMenu disabled onSchedule={onSchedule} variant="mobile" />)
  await user.click(within(sheet).getByTestId('mail-schedule-preset-tomorrow'))
  expect(onSchedule).not.toHaveBeenCalled()
  expect(within(sheet).getByTestId('mail-schedule-blocked')).toBeInTheDocument()
  expect(screen.getByTestId('mail-schedule-sheet')).toBeInTheDocument()
})
