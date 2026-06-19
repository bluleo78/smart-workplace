// 일정 생성/편집 다이얼로그.
// event prop 이 있으면 편집 모드, 없으면 생성 모드.
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { buildRRule, parseRRule, type RecurrenceForm } from '@/lib/recurrence'
import type { CalendarEvent, CalendarEventRequest } from '@/types/calendar'

// ────────────────────────────────────────────────────────────
// Zod 스키마
// ────────────────────────────────────────────────────────────
const schema = z
  .object({
    title: z.string().min(1, '제목을 입력하세요').max(200, '제목은 200자 이하여야 합니다'),
    allDay: z.boolean(),
    start: z.string().min(1, '시작을 입력하세요'),
    end: z.string().min(1, '종료를 입력하세요'),
    location: z.string().max(200, '장소는 200자 이하여야 합니다').optional(),
    description: z.string().optional(),
    // 리마인더 — select 값은 문자열('none' = 없음, 그 외 분 단위). 제출 시 number|null 로 변환.
    // (Radix Select 는 빈 문자열 value 를 허용하지 않아 'none' 센티넬 사용)
    reminderMinutes: z.enum(['none', '10', '60', '1440']),
    // 반복 설정 — 폼에서는 평탄한 필드로 다루고 제출 시 RecurrenceForm 으로 조립한다. (이슈 #111)
    recurrenceFreq: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']),
    // interval/until/count 는 조건부 필드 — base 에서는 검증하지 않고 superRefine 에서 노출 조건일 때만 검증.
    // (숨겨진 필드의 잔존 값이 제출을 조용히 막는 것을 방지)
    recurrenceInterval: z.number().optional(),
    recurrenceEnd: z.enum(['none', 'until', 'count']),
    recurrenceUntil: z.string().optional(),
    recurrenceCount: z.number().optional(),
  })
  .refine((v) => new Date(v.end) > new Date(v.start), {
    message: '종료는 시작보다 뒤여야 합니다',
    path: ['end'],
  })
  // 반복 관련 필드는 해당 입력이 실제로 노출될 때(freq≠NONE)만 검증한다.
  .superRefine((v, ctx) => {
    if (v.recurrenceFreq === 'NONE') return
    // 간격 — 1 이상의 정수 필수 (freq≠NONE 일 때만 노출)
    if (!(Number.isInteger(v.recurrenceInterval) && (v.recurrenceInterval ?? 0) >= 1)) {
      ctx.addIssue({
        code: 'custom',
        message: '간격은 1 이상이어야 합니다',
        path: ['recurrenceInterval'],
      })
    }
    // 종료=날짜까지 → 종료 날짜 필수
    if (v.recurrenceEnd === 'until' && !v.recurrenceUntil) {
      ctx.addIssue({
        code: 'custom',
        message: '종료 날짜를 입력하세요',
        path: ['recurrenceUntil'],
      })
    }
    // 반복 종료 날짜가 시작일보다 이전이면 회차가 0개로 전개되어 조회·삭제 불가능한
    // orphan 일정이 된다(이슈 #114). 시작일(날짜 부분) 이상인지 검증한다.
    // start='YYYY-MM-DDTHH:mm', recurrenceUntil='YYYY-MM-DD' — 둘 다 로컬 ISO 라
    // 날짜 부분 문자열 비교로 안전하게 순서 판정(같은 날은 1회차 발생하므로 허용).
    if (v.recurrenceEnd === 'until' && v.recurrenceUntil && v.recurrenceUntil < v.start.slice(0, 10)) {
      ctx.addIssue({
        code: 'custom',
        message: '반복 종료 날짜는 시작일 이후여야 합니다',
        path: ['recurrenceUntil'],
      })
    }
    // 종료=횟수 → 1 이상의 정수 필수
    if (
      v.recurrenceEnd === 'count' &&
      !(Number.isInteger(v.recurrenceCount) && (v.recurrenceCount ?? 0) >= 1)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: '횟수는 1 이상이어야 합니다',
        path: ['recurrenceCount'],
      })
    }
  })

type FormValues = z.infer<typeof schema>

// ────────────────────────────────────────────────────────────
// ISO(UTC) ↔ datetime-local 변환 헬퍼
// ────────────────────────────────────────────────────────────

/** ISO(UTC) → datetime-local 문자열 (YYYY-MM-DDTHH:mm) */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

/** datetime-local 문자열 → ISO(UTC) 문자열 */
function toIso(local: string): string {
  return new Date(local).toISOString()
}

/** Date → datetime-local 문자열 */
function dateToLocalInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

/** 반복 빈도별 간격 단위 라벨 (예: '주' → "주마다") */
function recurrenceUnitLabel(freq: FormValues['recurrenceFreq']): string {
  switch (freq) {
    case 'DAILY':
      return '일'
    case 'WEEKLY':
      return '주'
    case 'MONTHLY':
      return '개월'
    default:
      return ''
  }
}

// ────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────
interface EventDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** 편집 모드: 이벤트 객체 제공 */
  event?: CalendarEvent | null
  /** 생성 모드: 기본 시작 시각 (미제공 시 현재 시각) */
  defaultStart?: Date
  onSubmit: (body: CalendarEventRequest) => void
  /** 편집 모드에서만 제공 — 삭제 버튼 표시 */
  onDelete?: () => void
  /** API 요청 진행 중 여부 — true 이면 저장 버튼 비활성화 + 로딩 텍스트 표시 (이슈 #130) */
  isPending?: boolean
}

// ────────────────────────────────────────────────────────────
// 컴포넌트
// ────────────────────────────────────────────────────────────
export function EventDialog({
  open,
  onOpenChange,
  event,
  defaultStart,
  onSubmit,
  onDelete,
  isPending = false,
}: EventDialogProps) {
  const isEdit = !!event

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      allDay: false,
      start: '',
      end: '',
      location: '',
      description: '',
      reminderMinutes: 'none',
      recurrenceFreq: 'NONE',
      recurrenceInterval: 1,
      recurrenceEnd: 'none',
      recurrenceUntil: '',
      recurrenceCount: 1,
    },
  })

  // 다이얼로그가 열릴 때마다 폼 초기화
  useEffect(() => {
    if (!open) return

    // 반복 규칙(RRULE) → 평탄한 폼 필드로 변환. 생성 모드(이벤트 없음)면 NONE 기본값.
    const rec = parseRRule(event?.recurrenceRule ?? null)
    const recFields = {
      recurrenceFreq: rec.freq,
      recurrenceInterval: rec.interval,
      recurrenceEnd: rec.end.type,
      recurrenceUntil: rec.end.type === 'until' ? rec.end.date : '',
      recurrenceCount: rec.end.type === 'count' ? rec.end.count : 1,
    }

    if (event) {
      // 편집 모드: 기존 이벤트 데이터로 프리필
      form.reset({
        title: event.title,
        allDay: event.allDay,
        start: toLocalInput(event.startsAt),
        end: toLocalInput(event.endsAt),
        location: event.location ?? '',
        description: event.description ?? '',
        reminderMinutes: (event.reminderMinutes?.toString() ??
          'none') as FormValues['reminderMinutes'],
        ...recFields,
      })
    } else {
      // 생성 모드: defaultStart(또는 현재 시각) 기준으로 초기화. 종료 = 시작 + 1시간
      const startDate = defaultStart ?? new Date()
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
      form.reset({
        title: '',
        allDay: false,
        start: dateToLocalInput(startDate),
        end: dateToLocalInput(endDate),
        location: '',
        description: '',
        reminderMinutes: 'none',
        ...recFields,
      })
    }
  }, [open, event, defaultStart, form])

  // 폼 제출 핸들러
  function handleSubmit(values: FormValues) {
    // 평탄한 폼 필드 → RecurrenceForm 조립 후 RRULE 문자열 생성. freq=NONE 이면 null(단일 일정).
    const recForm: RecurrenceForm = {
      freq: values.recurrenceFreq,
      interval: values.recurrenceInterval ?? 1,
      end:
        values.recurrenceEnd === 'until'
          ? { type: 'until', date: values.recurrenceUntil ?? '' }
          : values.recurrenceEnd === 'count'
            ? { type: 'count', count: values.recurrenceCount ?? 1 }
            : { type: 'none' },
    }

    const body: CalendarEventRequest = {
      title: values.title,
      allDay: values.allDay,
      startsAt: toIso(values.start),
      endsAt: toIso(values.end),
      location: values.location?.trim() || null,
      description: values.description?.trim() || null,
      color: null,
      // 'none'(없음) → null, 그 외 분 단위 숫자로 변환
      reminderMinutes: values.reminderMinutes === 'none' ? null : Number(values.reminderMinutes),
      // 반복 규칙 — freq=NONE 이면 buildRRule 이 null 반환 (이슈 #111)
      recurrenceRule: buildRRule(recForm),
    }
    onSubmit(body)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="calendar-event-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '일정 수정' : '새 일정'}</DialogTitle>
          <DialogDescription className="sr-only">{isEdit ? '일정 수정' : '새 일정'}</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-3">
          {/* 제목 */}
          <FormField
            label="제목"
            htmlFor="ev-title"
            required
            error={form.formState.errors.title?.message}
          >
            <Input
              id="ev-title"
              data-testid="calendar-form-title"
              placeholder="일정 제목"
              {...form.register('title')}
            />
          </FormField>

          {/* 종일 여부 — Radix Checkbox는 Controller 로 연결 */}
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="allDay"
              render={({ field }) => (
                <Checkbox
                  id="ev-allday"
                  data-testid="calendar-form-allday"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
            <label htmlFor="ev-allday" className="text-sm cursor-pointer select-none">
              종일
            </label>
          </div>

          {/* 시작 / 종료 */}
          <div className="grid grid-cols-2 gap-2">
            <FormField
              label="시작"
              htmlFor="ev-start"
              error={form.formState.errors.start?.message}
            >
              <Input
                id="ev-start"
                type="datetime-local"
                data-testid="calendar-form-start"
                {...form.register('start')}
              />
            </FormField>
            <FormField
              label="종료"
              htmlFor="ev-end"
              error={form.formState.errors.end?.message}
            >
              <Input
                id="ev-end"
                type="datetime-local"
                data-testid="calendar-form-end"
                {...form.register('end')}
              />
            </FormField>
          </div>

          {/* 장소 */}
          <FormField
            label="장소"
            htmlFor="ev-location"
            error={form.formState.errors.location?.message}
          >
            <Input
              id="ev-location"
              data-testid="calendar-form-location"
              placeholder="장소 (선택)"
              {...form.register('location')}
            />
          </FormField>

          {/* 알림(리마인더) — 시작 N분 전 알림 */}
          <FormField label="알림(리마인더)" htmlFor="ev-reminder">
            <Select
              value={form.watch('reminderMinutes')}
              onValueChange={(v) =>
                form.setValue('reminderMinutes', v as FormValues['reminderMinutes'])
              }
            >
              <SelectTrigger
                id="ev-reminder"
                data-testid="calendar-form-reminder"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">없음</SelectItem>
                <SelectItem value="10">10분 전</SelectItem>
                <SelectItem value="60">1시간 전</SelectItem>
                <SelectItem value="1440">1일 전</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {/* 반복 설정 — 빈도/간격/종료 (이슈 #111) */}
          <FormField label="반복" htmlFor="ev-recurrence-freq">
            <Select
              value={form.watch('recurrenceFreq')}
              onValueChange={(v) =>
                form.setValue('recurrenceFreq', v as FormValues['recurrenceFreq'])
              }
            >
              <SelectTrigger
                id="ev-recurrence-freq"
                data-testid="calendar-form-recurrence-freq"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">없음</SelectItem>
                <SelectItem value="DAILY">매일</SelectItem>
                <SelectItem value="WEEKLY">매주</SelectItem>
                <SelectItem value="MONTHLY">매월</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {/* freq ≠ NONE 일 때만 간격/종료 조건 표시 */}
          {form.watch('recurrenceFreq') !== 'NONE' && (
            <>
              <FormField
                label={`${recurrenceUnitLabel(form.watch('recurrenceFreq'))}마다`}
                htmlFor="ev-recurrence-interval"
                error={form.formState.errors.recurrenceInterval?.message}
              >
                <Input
                  id="ev-recurrence-interval"
                  type="number"
                  min={1}
                  data-testid="calendar-form-recurrence-interval"
                  {...form.register('recurrenceInterval', { valueAsNumber: true })}
                />
              </FormField>

              <FormField label="종료" htmlFor="ev-recurrence-end">
                <Select
                  value={form.watch('recurrenceEnd')}
                  onValueChange={(v) =>
                    form.setValue('recurrenceEnd', v as FormValues['recurrenceEnd'])
                  }
                >
                  <SelectTrigger
                    id="ev-recurrence-end"
                    data-testid="calendar-form-recurrence-end"
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">없음</SelectItem>
                    <SelectItem value="until">날짜까지</SelectItem>
                    <SelectItem value="count">횟수</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              {/* 종료=날짜까지 → 날짜 입력 */}
              {form.watch('recurrenceEnd') === 'until' && (
                <FormField
                  label="종료 날짜"
                  htmlFor="ev-recurrence-until"
                  error={form.formState.errors.recurrenceUntil?.message}
                >
                  <Input
                    id="ev-recurrence-until"
                    type="date"
                    data-testid="calendar-form-recurrence-until"
                    {...form.register('recurrenceUntil')}
                  />
                </FormField>
              )}

              {/* 종료=횟수 → 횟수 입력 */}
              {form.watch('recurrenceEnd') === 'count' && (
                <FormField
                  label="반복 횟수"
                  htmlFor="ev-recurrence-count"
                  error={form.formState.errors.recurrenceCount?.message}
                >
                  <Input
                    id="ev-recurrence-count"
                    type="number"
                    min={1}
                    data-testid="calendar-form-recurrence-count"
                    {...form.register('recurrenceCount', { valueAsNumber: true })}
                  />
                </FormField>
              )}
            </>
          )}

          {/* 설명 */}
          <FormField label="설명" htmlFor="ev-description">
            <Textarea
              id="ev-description"
              data-testid="calendar-form-description"
              placeholder="설명 (선택)"
              rows={3}
              {...form.register('description')}
            />
          </FormField>

          <DialogFooter className="pt-2">
            {/* 편집 모드에서 onDelete 제공 시 삭제 버튼 표시 */}
            {isEdit && onDelete && (
              <Button
                type="button"
                variant="destructive"
                data-testid="calendar-form-delete"
                onClick={onDelete}
              >
                삭제
              </Button>
            )}
            <div className="flex gap-2 sm:ml-auto">
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" data-testid="calendar-form-submit" disabled={isPending}>
                {isPending ? '저장 중…' : isEdit ? '수정' : '저장'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
