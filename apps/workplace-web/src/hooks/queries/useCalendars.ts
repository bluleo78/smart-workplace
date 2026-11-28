import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { calendarsApi } from '@/api/calendars'
import { calendarSettingsApi } from '@/api/calendarSettings'
import { handleApiError } from '@/lib/api-error'
import type { Calendar, CalendarRequest } from '@/types/calendar'
import type { CalendarSettings } from '@/types/calendarSettings'

import { calendarKeys } from './calendarKeys'

// 내 캘린더 목록.
export function useCalendars(opts?: {
  enabled?: boolean
  /** 목록을 주기적으로 다시 읽는 간격(ms) — 지금 데이터를 보고 정한다(WP-2171: Outlook 캘린더가 동기화돼 나타날 때까지). 기본은 끔 */
  refetchInterval?: (calendars: Calendar[] | undefined) => number | false
}) {
  const interval = opts?.refetchInterval
  return useQuery<Calendar[]>({
    queryKey: calendarKeys.calendars,
    queryFn: () => calendarsApi.list().then((r) => r.data),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
    refetchInterval: interval ? (q) => interval(q.state.data) : false,
  })
}

/**
 * 내 캘린더 설정(WP-2169) — 새 일정 기본 캘린더 실효 id.
 * 실패·로딩 중에는 data 가 없어 쓰는 쪽(사이드바 배지·새 일정 창)이 isDefault 캘린더로 폴백한다.
 */
export function useCalendarSettings(opts?: { enabled?: boolean }) {
  return useQuery<CalendarSettings>({
    queryKey: calendarKeys.calendarSettings,
    queryFn: calendarSettingsApi.get,
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  })
}

/**
 * 새 일정 기본 캘린더 id(WP-2169) — 설정 실효값이 목록에 있으면 그것(writableOnly 면 쓰기 가능한 것만),
 * 아니면 isDefault 캘린더, 그것도 없으면 첫 번째. 설정을 아직 모르거나 조회가 실패해도 같은 순서로 폴백한다.
 */
export function useDefaultCalendarId(
  calendars: Calendar[],
  opts?: { writableOnly?: boolean },
): number | undefined {
  const { data: settings } = useCalendarSettings()
  const preferred = settings?.defaultCalendarId
  const usable = (c: Calendar) => !opts?.writableOnly || !c.isReadOnly
  if (preferred != null && calendars.some((c) => c.id === preferred && usable(c))) return preferred
  return calendars.find((c) => c.isDefault)?.id ?? calendars[0]?.id
}

/**
 * 새 일정 기본 캘린더 지정(WP-2169) — 응답(실효값)을 바로 캐시에 넣어 배지가 즉시 옮긴다.
 * 404(없는·남의 캘린더)·409(읽기 전용)는 오류 토스트로 알린다.
 */
export function useUpdateCalendarSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (calendarId: number) => calendarSettingsApi.update(calendarId),
    onSuccess: (data) => {
      qc.setQueryData(calendarKeys.calendarSettings, data)
    },
    onError: (e) => handleApiError(e, '기본 캘린더를 지정하지 못했습니다'),
  })
}

/**
 * Outlook 기본 캘린더 확인을 물었다고 기록(WP-2171) — 성공하면 설정 캐시의 outlookPrompted 를 true 로 바꿔
 * 같은 세션에서 창이 다시 뜨지 않게 한다. 실패는 조용히 둔다(다음 진입에 다시 물을 뿐이다).
 */
export function useMarkOutlookPrompted() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => calendarSettingsApi.markOutlookPrompted(),
    onSuccess: () => {
      qc.setQueryData<CalendarSettings>(calendarKeys.calendarSettings, (old) =>
        old ? { ...old, outlookPrompted: true } : old,
      )
    },
  })
}

// 캘린더 생성/수정/삭제 — 성공 시 목록+일정 무효화(색 변경이 일정 렌더에 반영되도록).
export function useCreateCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CalendarRequest) => calendarsApi.create(body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      // 실효 기본 캘린더가 바뀔 수 있어 설정도 다시 읽는다(설정 키는 all 접두 밖).
      qc.invalidateQueries({ queryKey: calendarKeys.calendarSettings })
    },
    // 실패를 알린다 — 창은 열린 채 남아 다시 시도할 수 있다(WP-1623 전에는 아무 표시 없이 창만 남았다).
    onError: (e) => handleApiError(e, '캘린더를 추가하지 못했습니다'),
  })
}

export function useUpdateCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: number; body: CalendarRequest }) =>
      calendarsApi.update(v.id, v.body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      // 실효 기본 캘린더가 바뀔 수 있어 설정도 다시 읽는다(설정 키는 all 접두 밖).
      qc.invalidateQueries({ queryKey: calendarKeys.calendarSettings })
    },
    onError: (e) => handleApiError(e, '캘린더를 저장하지 못했습니다'),
  })
}

/**
 * 캘린더 삭제 — 서버가 소속 일정을 기본 캘린더로 옮기므로(CalendarService) 성공 안내에 그 결과를 함께 알린다.
 * 실패는 오류 토스트로 알린다(WP-1140 — 전에는 결과도 실패도 화면에 드러나지 않았다).
 */
export function useDeleteCalendar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calendarsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: calendarKeys.all })
      // 지정한 기본 캘린더가 지워지면 Works 로 돌아오므로 설정도 다시 읽는다(설정 키는 all 접두 밖).
      qc.invalidateQueries({ queryKey: calendarKeys.calendarSettings })
      toast.success('캘린더를 삭제했습니다. 일정은 Works 캘린더로 옮겼습니다')
    },
    onError: (e) => handleApiError(e, '캘린더 삭제에 실패했습니다'),
  })
}

/** 캘린더 강제 리셋(모든 일정 삭제) — 성공 시 일정/캘린더 캐시 무효화. */
export function useResetCalendarEvents() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calendarsApi.resetEvents(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.all }),
  })
}
