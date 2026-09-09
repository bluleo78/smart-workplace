// 외부 연락처 생성/수정/삭제 mutation. 성공 시 contactKeys.all 무효화(목록·상세 갱신).
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'

import { contactsApi } from '../../api/contacts'
import { handleApiError } from '../../lib/api-error'
import type { ExternalContactRequest } from '../../types/contact'
import { contactKeys } from './contactKeys'

/** 409(동일 이름+이메일 소프트 경고, #790) 여부 — 이 경우 토스트 대신 다이얼로그가 확인을 받는다. */
export function isDuplicateWarning(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 409
}

export function useCreateExternalContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ body, force }: { body: ExternalContactRequest; force?: boolean }) =>
      contactsApi.createExternal(body, force).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contactKeys.all })
      toast.success('연락처를 추가했습니다')
    },
    onError: (e) => {
      if (isDuplicateWarning(e)) return // 409 는 다이얼로그가 확인 흐름으로 처리
      handleApiError(e, '연락처 추가에 실패했습니다')
    },
  })
}

export function useUpdateExternalContact() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      body,
      force,
    }: {
      id: number
      body: ExternalContactRequest
      force?: boolean
    }) => contactsApi.updateExternal(id, body, force).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: contactKeys.all })
      toast.success('연락처를 수정했습니다')
    },
    onError: (e) => {
      if (isDuplicateWarning(e)) return
      handleApiError(e, '연락처 수정에 실패했습니다')
    },
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
