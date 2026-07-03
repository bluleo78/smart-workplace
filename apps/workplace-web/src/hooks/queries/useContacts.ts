// 통합 연락처 목록 cursor 페이징.
import { useInfiniteQuery } from '@tanstack/react-query'

import { contactsApi } from '../../api/contacts'
import type { ContactPage, ContactTypeFilter } from '../../types/contact'
import { contactKeys } from './contactKeys'

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
        .list({
          search: search.trim() || undefined,
          // FAVORITE 모드는 type 대신 favorite=true 로 변환(서버 필터 재사용)
          type: type === 'FAVORITE' ? undefined : type,
          favorite: type === 'FAVORITE' ? true : undefined,
          organization: organization || undefined,
          title: title || undefined,
          cursor: pageParam as string | undefined,
        })
        .then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  })
}
