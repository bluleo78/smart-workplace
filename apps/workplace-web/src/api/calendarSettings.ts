// 캘린더 사용자 설정 REST 호출(WP-2169) — 사용자당 하나인 「새 일정 기본 캘린더」를 읽고 지정한다.
import type { CalendarSettings } from '../types/calendarSettings'
import { client } from './client'

export const calendarSettingsApi = {
  /** 내 캘린더 설정 — 지정한 적 없거나 지정 캘린더를 쓸 수 없으면 서버가 Works 캘린더 id 를 돌려준다. */
  get: async (): Promise<CalendarSettings> => {
    const { data } = await client.get<CalendarSettings>('/calendar/settings')
    return data
  },
  /** 새 일정 기본 캘린더 지정 — 남의·없는 캘린더 404, 읽기 전용 409. 저장 뒤 실효값을 돌려준다. */
  update: async (calendarId: number): Promise<CalendarSettings> => {
    const { data } = await client.put<CalendarSettings>('/calendar/settings', { calendarId })
    return data
  },
}
