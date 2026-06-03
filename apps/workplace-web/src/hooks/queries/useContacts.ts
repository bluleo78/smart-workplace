// 통합 연락처 목록 cursor 페이징.
import { useInfiniteQuery } from '@tanstack/react-query'

import { contactsApi } from '../../api/contacts'
import type { ContactPage, ContactTypeFilter } from '../../types/contact'
import { contactKeys } from './contactKeys'

export function useContacts(search: string, type: ContactTypeFilter) {
  return useInfiniteQuery<ContactPage>({
    queryKey: contactKeys.list(search, type),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      contactsApi
        .list({
          search: search.trim() || undefined,
          type,
          cursor: pageParam as string | undefined,
        })
        .then((r) => r.data),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  })
}
