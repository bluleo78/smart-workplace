// 즐겨찾기 토글 mutation. 성공/실패 후 contactKeys.all 무효화로 목록·상세 캐시 갱신.
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { contactsApi } from '../../api/contacts'
import { handleApiError } from '../../lib/api-error'
import type { ContactType } from '../../types/contact'
import { contactKeys } from './contactKeys'

interface ToggleArgs {
  targetType: ContactType
  targetId: number
  isFavorite: boolean // 현재 상태 — true 면 해제, false 면 추가
}

/**
 * 즐겨찾기 토글. 현재 isFavorite 에 따라 add/remove 를 호출하고, 성공 후 연락처 캐시를 무효화한다.
 * 즐겨찾기 모드에서 해제 시 무효화로 해당 행이 목록에서 빠진다.
 */
export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ targetType, targetId, isFavorite }: ToggleArgs) =>
      isFavorite
        ? contactsApi.removeFavorite({ targetType, targetId }).then((r) => r.data)
        : contactsApi.addFavorite({ targetType, targetId }).then((r) => r.data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: contactKeys.all })
    },
    onError: (e) => handleApiError(e, '즐겨찾기 변경에 실패했습니다'),
  })
}
