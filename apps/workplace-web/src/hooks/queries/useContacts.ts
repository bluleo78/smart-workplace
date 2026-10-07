// 통합 연락처 목록 cursor 페이징.
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import { contactsApi } from '../../api/contacts'
import type { ContactPage, ContactTypeFilter } from '../../types/contact'
import { contactKeys } from './contactKeys'

/** 화면 필터 → 연락처 목록 API 파라미터. FAVORITE 모드는 type 대신 favorite=true 로 변환(서버 필터 재사용). */
function listParams(search: string, type: ContactTypeFilter, organization?: string, title?: string) {
  return {
    search: search.trim() || undefined,
    type: type === 'FAVORITE' ? undefined : type,
    favorite: type === 'FAVORITE' ? true : undefined,
    organization: organization || undefined,
    title: title || undefined,
  }
}

export function useContacts(
  search: string,
  type: ContactTypeFilter,
  organization?: string,
  title?: string,
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery<ContactPage>({
    queryKey: contactKeys.list(search, type, organization, title),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      contactsApi
        .list({ ...listParams(search, type, organization, title), cursor: pageParam as string | undefined })
        .then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}

/**
 * 연락처 첫 페이지의 앞 limit 명만(WP-160) — 모바일 홈 연락처 타일 요약(이름 몇 개 나열)처럼 무한 스크롤이 필요 없는 곳용.
 */
export function useContactsHead(
  search: string,
  type: ContactTypeFilter,
  organization: string | undefined,
  title: string | undefined,
  limit: number,
) {
  return useQuery<ContactPage>({
    queryKey: contactKeys.head(search, type, organization, title, limit),
    queryFn: () => contactsApi.list({ ...listParams(search, type, organization, title), limit }).then((r) => r.data),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })
}
