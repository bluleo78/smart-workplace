// 일정 폼의 시작·종료 칸(WP-1072) — 시각 일정은 날짜·시각(datetime-local), 종일 일정은 날짜만(종료는 마지막 날 포함) 보인다.
// 폼 값은 둘 다 같은 형식(종일은 자정 경계 half-open [start, end))이고, 종일 날짜 칸은 보일 때·고칠 때만 바꿔 쓴다.
// 시작·종료를 여기서만 구독한다 — 대화상자(EventDialog)에서 구독하면 시각 한 자리를 칠 때마다 대화상자 전체가 다시 그려진다(WP-801).
import { Controller, type UseFormReturn, useWatch } from 'react-hook-form'

import { Input } from '@/components/ui/input'
import { allDayDisplayDates, allDayRangeFromDates, type EventFormValues } from '@/lib/calendarEventForm'

const INPUT_CLASS = 'h-8 w-full px-2 sm:w-auto pointer-coarse:h-11'

interface Props {
  form: UseFormReturn<EventFormValues>
  allDay: boolean
}

export function EventRangeInputs({ form, allDay }: Props) {
  const [start, end] = useWatch({ control: form.control, name: ['start', 'end'] })
  const dates = allDay ? allDayDisplayDates(start, end) : null

  /** 종일 날짜 칸을 고치면 폼 값(자정 경계)으로 되돌려 넣는다. */
  function setAllDayDates(startDate: string, endDate: string) {
    const next = allDayRangeFromDates(startDate, endDate)
    form.setValue('start', next.start, { shouldValidate: true })
    form.setValue('end', next.end, { shouldValidate: true })
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
            // 시작을 종료 뒤로 옮기면 종료를 시작일로 끌어온다 — 하루 일정의 날짜를 옮길 때 종료를 따로 고치지 않게.
            if (name === 'start') setAllDayDates(v, v > dates.endDate ? v : dates.endDate)
            else setAllDayDates(dates.startDate, v)
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
