// 외부 연락처 조직·직책 distinct 목록 — 고급 필터 드롭다운 옵션. '외부' 탭일 때만 fetch.
import { useQuery } from '@tanstack/react-query'

import { contactsApi } from '../../api/contacts'
import type { ContactFacets } from '../../types/contact'
import { contactKeys } from './contactKeys'

export function useContactFacets(enabled: boolean) {
  return useQuery<ContactFacets>({
    queryKey: contactKeys.facets(),
    queryFn: () => contactsApi.getFacets().then((r) => r.data),
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}
