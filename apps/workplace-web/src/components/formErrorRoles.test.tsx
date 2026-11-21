// 안내 role 의 두 갈래(WP-1901 리뷰 반려) — 제출 실패는 alert(assertive), 실시간(입력 중) 검증은 status(polite) 다.
// 입력 중 바뀌는 문구까지 alert 로 그리면 스크린리더가 사용자의 타이핑을 끊고 끼어든다.
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { MailScheduleSendMenu } from '@/components/mail/MailScheduleSendMenu'
import { FieldError, FormError } from '@/components/ui/form-field'
import { RenameDialog } from '@/components/ui/rename-dialog'
import { PeriodRangeForm } from '@/pages/projects/timeline/PeriodRangeForm'
import { renderScreen } from '@/test/renderScreen'

afterEach(() => {
  vi.useRealTimers()
})

test('FormError(제출 실패) 는 alert, FieldError(실시간) 는 polite status 로 읽힌다', () => {
  const { container } = render(
    <>
      <FormError id="form-error">이미 같은 이름입니다</FormError>
      <FieldError id="field-error">종료일은 시작일 이후여야 합니다</FieldError>
    </>,
  )
  const alert = container.querySelector('#form-error') as HTMLElement
  const status = container.querySelector('#field-error') as HTMLElement
  expect(alert).toHaveAttribute('role', 'alert')
  expect(status).toHaveAttribute('role', 'status')
  expect(status).toHaveAttribute('aria-live', 'polite')
  expect(status).not.toHaveAttribute('role', 'alert')
})

test('비어 있는 FieldError 는 리전만 두고 글자를 남기지 않는다 — 빈 리전이 안내로 잡히지 않는다', () => {
  const { container } = render(<FieldError id="empty">{null}</FieldError>)
  const region = container.querySelector('#empty')
  // 리전은 조건 없이 늘 DOM 에 있어야 글자가 바뀔 때 polite 안내가 읽힌다(WP-1934) —
  // 빈 동안에는 sr-only 로 화면 흐름에서 빠져 간격을 만들지 않는다.
  expect(region).not.toBeNull()
  expect(region).toHaveClass('sr-only')
  expect(region).toBeEmptyDOMElement()
})

describe('실시간 검증 — 입력 중에 뜨는 안내는 status 다', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 19, 22, 30))
  })

  test('메일 예약 — 1년 밖의 시각 안내는 status 이고 입력칸이 그 문단을 가리킨다', async () => {
    const user = userEvent.setup()
    render(<MailScheduleSendMenu disabled={false} onSchedule={vi.fn()} variant="dock" />)
    await user.click(screen.getByTestId('mail-compose-schedule-trigger'))
    await user.click(await screen.findByTestId('mail-schedule-custom'))
    const input = (await screen.findByTestId('mail-schedule-datetime')) as HTMLInputElement
    input.focus()
    await user.clear(input)
    await user.type(input, '2027-11-20T09:00')

    const hint = screen.getByText('지금부터 1년 안으로 골라 주세요')
    expect(hint).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toBe(hint.id)
  })

  test('조회 기간 — 뒤집힌 기간 안내는 status 이고 두 칸이 함께 가리킨다', () => {
    render(<PeriodRangeForm initial={{ from: '', to: '' }} onApply={vi.fn()} />)
    // <input type="date"> 는 덜 넣은 날짜를 값 '' 로 올리므로 한 번에 넣는다.
    fireEvent.change(screen.getByTestId('period-range-from'), { target: { value: '2026-12-31' } })
    fireEvent.change(screen.getByTestId('period-range-to'), { target: { value: '2026-01-01' } })

    const hint = screen.getByTestId('period-range-error')
    expect(hint).toHaveAttribute('role', 'status')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('period-range-from')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('period-range-to').getAttribute('aria-describedby')).toBe(hint.id)
  })

  test('조회 기간 — 안내 리전은 오류 전부터 있고 오류가 떠도 같은 노드다(WP-1934)', () => {
    // 리전이 문구와 같은 렌더에 생기면 스크린리더가 polite 안내를 건너뛴다 — 리전을 미리 두고 글자만 바꿔야 한다.
    render(<PeriodRangeForm initial={{ from: '', to: '' }} onApply={vi.fn()} />)
    const before = screen.getByTestId('period-range-error')
    expect(before).toHaveAttribute('role', 'status')
    expect(before).toBeEmptyDOMElement()
    // 오류가 없을 때는 칸이 빈 리전을 가리키지 않는다.
    expect(screen.getByTestId('period-range-to')).not.toHaveAttribute('aria-describedby')

    fireEvent.change(screen.getByTestId('period-range-from'), { target: { value: '2026-12-31' } })
    fireEvent.change(screen.getByTestId('period-range-to'), { target: { value: '2026-01-01' } })

    const after = screen.getByTestId('period-range-error')
    expect(after).toBe(before)
    expect(after).toHaveTextContent('시작일이 종료일보다 늦어요')
    expect(after).not.toHaveClass('sr-only')
    expect(screen.getByTestId('period-range-to').getAttribute('aria-describedby')).toBe(after.id)
  })
})

test('제출 실패 — 서버가 거절한 안내는 alert 로 읽힌다(위 실시간 안내와 구분된다)', async () => {
  const user = userEvent.setup()
  renderScreen(
    <RenameDialog
      open
      title="이름 변경"
      initialValue="기존"
      onConfirm={() => Promise.reject(new Error('중복'))}
      onClose={() => {}}
      extractError={() => '이미 같은 이름이 있습니다.'}
    />,
  )
  await user.click(await screen.findByRole('button', { name: '확인' }))
  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('이미 같은 이름이 있습니다.')
})