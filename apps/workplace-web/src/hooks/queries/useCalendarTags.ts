// 캘린더 태그 쿼리·뮤테이션 훅 (WP-714·715).
// 태그 이름·색·삭제·일정 태그 교체는 일정 칩에도 보이므로 일정 캐시(범위 목록·상세)와 태그 목록을 무효화하고,
// 구독 주소만 바뀌는 건 태그 쪽만 무효화한다. 캘린더 목록(/calendars)은 태그와 무관해 건드리지 않는다.
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { calendarTagsApi } from '@/api/calendarTags'
import { handleApiError } from '@/lib/api-error'
import type { CalendarTag, CalendarTagRequest, TagFeed } from '@/types/calendar'

import { calendarKeys } from './calendarKeys'

/**
 * 태그가 칩으로 보이는 캐시를 무효화한다 — 범위 목록·딥링크 상세(['calendar','events',…]), 편집 창·홈 위젯 상세
 * (['calendar','event',id] — calendarKeys.event 와 키가 달라 따로), 태그 목록(일정 수, 그 아래 구독 주소의 일정 수까지).
 */
function invalidateTaggedEvents(qc: QueryClient) {
  // 돌려준 Promise 를 onSuccess 가 그대로 돌려줘, mutateAsync 가 재조회까지 기다린다(전체 무효화 때와 같게).
  return Promise.all([
    qc.invalidateQueries({ queryKey: calendarKeys.events }),
    qc.invalidateQueries({ queryKey: calendarKeys.eventDetails }),
    qc.invalidateQueries({ queryKey: calendarKeys.tags }),
  ])
}

// 내 태그 목록(이름순) — 사이드바 「태그」 묶음과 태그 피커가 함께 쓴다.
export function useCalendarTags() {
  return useQuery<CalendarTag[]>({
    queryKey: calendarKeys.tags,
    queryFn: () => calendarTagsApi.list().then((r) => r.data),
    staleTime: 30_000,
  })
}

// 태그 만들기 — 같은 이름이 있으면 서버가 409. 성공 시 목록 갱신(호출부가 onSuccess 로 새 태그를 받는다).
export function useCreateCalendarTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: CalendarTagRequest) => calendarTagsApi.create(body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: calendarKeys.tags }),
    onError: (e) => handleApiError(e, '태그를 만들지 못했습니다'),
  })
}

// 이름·색 바꾸기 — 일정에 달린 칩 이름·색도 바뀌므로 일정 캐시까지 무효화.
export function useUpdateCalendarTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: number; body: CalendarTagRequest }) =>
      calendarTagsApi.update(v.id, v.body).then((r) => r.data),
    onSuccess: () => invalidateTaggedEvents(qc),
    onError: (e) => handleApiError(e, '태그를 바꾸지 못했습니다'),
  })
}

// 태그 지우기 — 연결도 함께 사라지므로 일정 캐시까지 무효화.
export function useDeleteCalendarTag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => calendarTagsApi.remove(id),
    onSuccess: () => invalidateTaggedEvents(qc),
    onError: (e) => handleApiError(e, '태그를 지우지 못했습니다'),
  })
}

/**
 * 일정의 태그를 id 집합으로 교체 — 성공 시 상세·목록·태그(일정 수) 모두 무효화.
 * 상세는 두 키(calendarKeys.event = ['calendar','events',id], 편집 창의 ['calendar','event',id])라 invalidateTaggedEvents 가 둘 다 갱신한다.
 */
export function useSetEventTags() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { eventId: number; tagIds: number[] }) => calendarTagsApi.setEventTags(v.eventId, v.tagIds),
    onSuccess: () => invalidateTaggedEvents(qc),
    onError: (e) => handleApiError(e, '태그를 저장하지 못했습니다'),
  })
}

/**
 * 목록 캐시의 한 태그 hasFeed 를 바로 바꾼다 — 구독 주소 창이 목록 재조회를 기다리는 동안 낡은 hasFeed 로
 * 지워진 주소를 다시 조회(404)하거나 새 주소를 못 보이는 틈을 없앤다.
 */
function setHasFeed(qc: QueryClient, tagId: number, hasFeed: boolean) {
  qc.setQueryData<CalendarTag[]>(calendarKeys.tags, (list) => list?.map((t) => (t.id === tagId ? { ...t, hasFeed } : t)))
}

// 구독 주소 조회 — 발급된 태그(hasFeed)만 부른다. 없는 태그를 부르면 404 라 enabled 로 막는다.
export function useTagFeed(tagId: number | undefined, enabled: boolean) {
  return useQuery<TagFeed>({
    queryKey: calendarKeys.tagFeed(tagId ?? 0),
    queryFn: () => calendarTagsApi.getFeed(tagId as number).then((r) => r.data),
    enabled: enabled && tagId != null,
    // 주소는 재발급·폐기 때만 바뀌고 그때 무효화한다 — 창을 열 때마다 다시 받지 않는다.
    staleTime: 60_000,
  })
}

// 구독 주소 발급·재발급 — 태그의 hasFeed 와 주소가 바뀐다. 응답의 새 주소를 캐시에 바로 넣어 창이 곧장 새 주소를 보이게 한다.
export function useCreateTagFeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tagId: number) => calendarTagsApi.createFeed(tagId).then((r) => r.data),
    onSuccess: (feed, tagId) => {
      qc.setQueryData(calendarKeys.tagFeed(tagId), feed)
      setHasFeed(qc, tagId, true)
      qc.invalidateQueries({ queryKey: calendarKeys.tags, exact: true })
    },
    onError: (e) => handleApiError(e, '구독 주소를 만들지 못했습니다'),
  })
}

// 구독 주소 없애기 — 그 주소는 바로 막힌다. 캐시의 주소는 지워 다시 조회(404)하지 않게 한다.
export function useDeleteTagFeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tagId: number) => calendarTagsApi.removeFeed(tagId),
    onSuccess: (_, tagId) => {
      setHasFeed(qc, tagId, false)
      qc.removeQueries({ queryKey: calendarKeys.tagFeed(tagId) })
      qc.invalidateQueries({ queryKey: calendarKeys.tags, exact: true })
    },
    onError: (e) => handleApiError(e, '구독 주소를 없애지 못했습니다'),
  })
}
