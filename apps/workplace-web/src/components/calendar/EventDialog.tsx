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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { CalendarEvent, CalendarEventRequest } from '@/types/calendar'

// ────────────────────────────────────────────────────────────
// Zod 스키마
// ────────────────────────────────────────────────────────────
const schema = z
  .object({
    title: z.string().min(1, '제목을 입력하세요').max(200),
    allDay: z.boolean(),
    start: z.string().min(1, '시작을 입력하세요'),
    end: z.string().min(1, '종료를 입력하세요'),
    location: z.string().max(200).optional(),
    description: z.string().optional(),
  })
  .refine((v) => new Date(v.end) > new Date(v.start), {
    message: '종료는 시작보다 뒤여야 합니다',
    path: ['end'],
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
    },
  })

  // 다이얼로그가 열릴 때마다 폼 초기화
  useEffect(() => {
    if (!open) return

    if (event) {
      // 편집 모드: 기존 이벤트 데이터로 프리필
      form.reset({
        title: event.title,
        allDay: event.allDay,
        start: toLocalInput(event.startsAt),
        end: toLocalInput(event.endsAt),
        location: event.location ?? '',
        description: event.description ?? '',
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
      })
    }
  }, [open, event, defaultStart, form])

  // 폼 제출 핸들러
  function handleSubmit(values: FormValues) {
    const body: CalendarEventRequest = {
      title: values.title,
      allDay: values.allDay,
      startsAt: toIso(values.start),
      endsAt: toIso(values.end),
      location: values.location?.trim() || null,
      description: values.description?.trim() || null,
      color: null,
    }
    onSubmit(body)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="calendar-event-dialog" className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? '일정 수정' : '새 일정'}</DialogTitle>
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
              <Button type="submit" data-testid="calendar-form-submit">
                {isEdit ? '수정' : '저장'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
