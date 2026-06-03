// 외부 연락처 생성/수정/삭제 mutation. 성공 시 contactKeys.all 무효화(목록·상세 갱신).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { contactsApi } from '../../api/contacts'
import { handleApiError } from '../../lib/api-error'
import type { ExternalContactRequest } from '../../types/contact'
import { contactKeys } from './contactKeys'

export function useCreateExternalContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ExternalContactRequest) =>
      contactsApi.createExternal(body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contactKeys.all })
      toast.success('연락처를 추가했습니다')
    },
    onError: (e) => handleApiError(e, '연락처 추가에 실패했습니다'),
  })
}

export function useUpdateExternalContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ExternalContactRequest }) =>
      contactsApi.updateExternal(id, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contactKeys.all })
      toast.success('연락처를 수정했습니다')
    },
    onError: (e) => handleApiError(e, '연락처 수정에 실패했습니다'),
  })
}

export function useDeleteExternalContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => contactsApi.deleteExternal(id).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contactKeys.all })
      toast.success('연락처를 삭제했습니다')
    },
    onError: (e) => handleApiError(e, '연락처 삭제에 실패했습니다'),
  })
}
