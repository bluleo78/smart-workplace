import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ssoApi } from '../../api/sso'

const KEY = ['admin', 'sso'] as const

/** WP-48 현재 워크스페이스 SSO 설정. enabled=false 로 호출하면 조회하지 않는다(비관리자 화면 대비). */
export function useSsoSettings(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: ssoApi.getSettings, enabled })
}

export function useSetSsoEnabled() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) => ssoApi.setEnabled(enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
