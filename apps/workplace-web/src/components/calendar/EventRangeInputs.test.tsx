// 일정 폼 시작·종료 칸(WP-1103) — 종일 일정에서 시작 칸을 지웠다가 다시 넣어도 종료일(폼 값의 끝)이 늘지 않는다.
import { fireEvent, render, screen } from '@testing-library/react'
import { useForm, useWatch } from 'react-hook-form'
import { describe, expect, it } from 'vitest'

import type { EventFormValues } from '@/lib/calendarEventForm'

import { EventRangeInputs } from './EventRangeInputs'

/** 종일 06-10 ~ 06-12(폼 값 끝 06-13 0시)로 시작하는 폼에 칸만 띄운다. 폼 값의 끝은 output 으로 내보여 단언한다. */
function Harness() {
  const form = useForm<EventFormValues>({
    defaultValues: { start: '2026-06-10T00:00', end: '2026-06-13T00:00' } as EventFormValues,
  })
  const end = useWatch({ control: form.control, name: 'end' })
  return (
    <>
      <EventRangeInputs form={form} allDay />
      <output data-testid="form-end">{end}</output>
    </>
  )
}

describe('EventRangeInputs 종일', () => {
  it('시작 칸을 비웠다가 다시 넣어도 종료일이 하루 늘지 않는다', () => {
    render(<Harness />)
    const start = screen.getByTestId('calendar-form-start')
    const end = screen.getByTestId('calendar-form-end')
    expect(end).toHaveValue('2026-06-12')

    fireEvent.change(start, { target: { value: '' } })
    // 시작이 빈 사이에도 종료 칸은 마지막 날 그대로다.
    expect(end).toHaveValue('2026-06-12')

    fireEvent.change(start, { target: { value: '2026-06-10' } })
    expect(end).toHaveValue('2026-06-12')
    expect(screen.getByTestId('form-end')).toHaveTextContent('2026-06-13T00:00')
  })

  it('종료 칸이 비었으면 시작을 고쳐도 종료를 시작일로 덮어쓰지 않는다', () => {
    render(<Harness />)
    fireEvent.change(screen.getByTestId('calendar-form-end'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('calendar-form-start'), { target: { value: '2026-06-11' } })
    expect(screen.getByTestId('form-end')).toBeEmptyDOMElement()
  })

  it('시작을 종료 뒤로 옮기면 종료를 시작일로 끌어온다(하루 일정)', () => {
    render(<Harness />)
    fireEvent.change(screen.getByTestId('calendar-form-start'), { target: { value: '2026-06-20' } })
    expect(screen.getByTestId('calendar-form-end')).toHaveValue('2026-06-20')
    expect(screen.getByTestId('form-end')).toHaveTextContent('2026-06-21T00:00')
  })
})
