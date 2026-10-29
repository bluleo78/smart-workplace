// 일정 폼의 시작·종료 칸(WP-1072) — 시각 일정은 날짜·시각(datetime-local), 종일 일정은 날짜만(종료는 마지막 날 포함) 보인다.
// 폼 값은 둘 다 같은 형식(종일은 자정 경계 half-open [start, end))이고, 종일 날짜 칸은 보일 때·고칠 때만 바꿔 쓴다.
// 시작·종료를 여기서만 구독한다 — 대화상자(EventDialog)에서 구독하면 시각 한 자리를 칠 때마다 대화상자 전체가 다시 그려진다(WP-801).
import { Controller, type UseFormReturn, useWatch } from 'react-hook-form'

import { Input } from '@/components/ui/input'
import { allDayDisplayDates, allDayRangeFromDates, type EventFormValues } from '@/lib/calendarEventForm'
import { parseValidDateKey } from '@/lib/formatters'

/** YYYY-MM-DD 이고 실제 달력 날짜인가. */
const isValidDateKey = (v: string) => parseValidDateKey(v) !== undefined

const INPUT_CLASS = 'h-8 w-full px-2 sm:w-auto pointer-coarse:h-11'

interface Props {
  form: UseFormReturn<EventFormValues>
  allDay: boolean
}

export function EventRangeInputs({ form, allDay }: Props) {
  const [start, end] = useWatch({ control: form.control, name: ['start', 'end'] })
  const dates = allDay ? allDayDisplayDates(start, end) : null

  /**
   * 종일 날짜 칸 하나를 고치면 그 칸의 폼 값(자정 경계)만 바꾼다 — 다른 칸을 화면 값에서 되돌려 다시 쓰면, 화면 값과 폼 값이 정확히 왕복하지 않는
   * 순간(칸이 비었거나 날짜가 아님)에 다른 칸이 하루 밀리거나 잘렸다(WP-1103).
   * 검사는 두 칸을 함께 한다 — 순서 오류(「종료일은 시작일보다 앞설 수 없습니다」)는 종료 칸에 달려, 시작을 고쳐 범위를 바로잡아도 시작 칸만
   * 다시 검사하면 종료 칸의 오류가 남는다.
   */
  function setAllDayDate(name: 'start' | 'end', date: string) {
    const next = allDayRangeFromDates(name === 'start' ? date : '', name === 'end' ? date : '')
    form.setValue(name, next[name])
    void form.trigger(['start', 'end'])
  }

  /** 한 칸 — 종일이면 날짜 칸(제어 값은 dates), 아니면 날짜·시각 칸(Controller). 둘 다 제어 칸이라 종일을 켜고 끌 때 값이 남지 않는다. */
  function slot(name: 'start' | 'end') {
    const common = {
      id: `ev-${name}`,
      'data-testid': `calendar-form-${name}`,
      'aria-invalid': !!form.formState.errors[name],
      className: INPUT_CLASS,
    }
    if (dates) {
      return (
        <Input
          {...common}
          type="date"
          aria-label={name === 'start' ? '시작일' : '종료일'}
          value={name === 'start' ? dates.startDate : dates.endDate}
          onChange={(e) => {
            const v = e.target.value
            setAllDayDate(name, v)
            // 시작을 종료 뒤로 옮기면 종료를 시작일로 끌어온다 — 하루 일정의 날짜를 옮길 때 종료를 따로 고치지 않게.
            // 둘 다 올바른 날짜일 때만 비교한다 — 빈 종료·연도 5자리를 글자로 비교해 사람이 고르지 않은 종료로 덮어쓰지 않게(WP-1103).
            if (name === 'start' && isValidDateKey(v) && isValidDateKey(dates.endDate) && v > dates.endDate) setAllDayDate('end', v)
          }}
        />
      )
    }
    return (
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => <Input {...common} {...field} type="datetime-local" aria-label={name === 'start' ? '시작' : '종료'} />}
      />
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {slot('start')}
      {/* 줄표는 종료 칸과 한 덩어리 — 좁아 꺾이면 줄표가 앞 줄 끝에 홀로 남지 않고 종료 칸과 함께 다음 줄로 간다 */}
      <span className="flex w-full items-center gap-2 sm:w-auto">
        <span className="hidden text-muted-foreground sm:inline" aria-hidden="true">
          –
        </span>
        {slot('end')}
      </span>
    </div>
  )
}
