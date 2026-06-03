// 선택된 연락처(멤버/외부) 상세. selected 없으면 비활성.
import { useQuery } from '@tanstack/react-query'

import { contactsApi } from '../../api/contacts'
import type { ContactType, ExternalContactDetail, MemberDetail } from '../../types/contact'
import { contactKeys } from './contactKeys'

export interface ContactSelection {
  type: ContactType
  id: number
}

export function useContactDetail(selected: ContactSelection | null) {
  return useQuery<MemberDetail | ExternalContactDetail>({
    queryKey: selected
      ? selected.type === 'MEMBER'
        ? contactKeys.member(selected.id)
        : contactKeys.external(selected.id)
      : ['contacts', 'detail', 'idle'],
    enabled: !!selected,
    queryFn: () =>
      selected!.type === 'MEMBER'
        ? contactsApi.getMember(selected!.id).then((r) => r.data)
        : contactsApi.getExternal(selected!.id).then((r) => r.data),
    staleTime: 10_000,
  })
}
