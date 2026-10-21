import type { CalendarTag, CalendarTagRequest, TagFeed } from '../types/calendar'
import { client } from './client'

// 캘린더 태그 CRUD + 일정에 태그 붙이기 + 태그별 구독 주소(iCal 피드). (WP-714·715)
export const calendarTagsApi = {
  list: () => client.get<CalendarTag[]>('/calendar/tags'),
  create: (body: CalendarTagRequest) => client.post<CalendarTag>('/calendar/tags', body),
  update: (id: number, body: CalendarTagRequest) => client.patch<CalendarTag>(`/calendar/tags/${id}`, body),
  remove: (id: number) => client.delete<void>(`/calendar/tags/${id}`),
  // 일정의 태그를 이 id 집합으로 교체 — 앱 일정만(반복 회차 id 면 서버가 마스터에 붙인다).
  setEventTags: (eventId: number, tagIds: number[]) =>
    client.put<void>(`/calendar/events/${eventId}/tags`, { tagIds }),
  // 구독 주소 — GET 조회, POST 발급·재발급(이전 주소 즉시 무효), DELETE 폐기.
  getFeed: (id: number) => client.get<TagFeed>(`/calendar/tags/${id}/feed`),
  createFeed: (id: number) => client.post<TagFeed>(`/calendar/tags/${id}/feed`),
  removeFeed: (id: number) => client.delete<void>(`/calendar/tags/${id}/feed`),
}
